# One Africa Life: the vehicles the game drives along its streets, in one file
# (public/oal/vehicles.v<n>.glb): the owner's saloon (repainted in the game: yellow for a taxi,
# any colour for a private car), police car and bus, made light for phones (a few thousand
# triangles each), and the kekeh drawn in code. Each is one object at the origin, standing on
# the ground, its front toward +X, named for what it is, drawn with three materials at most: its
# paint, a plain material named "paint" (white) that the game tints; its windows, a tinted
# glass that whoever rides inside is seen through; and everything else baked into one picture
# of its own (the models came with twenty materials each: twenty draws per car
# on a phone).
#
#   blender -b --factory-startup --python scripts/oal/makeVehicles.py -- <out.glb>
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenekit as kit  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]
# name: (slimmed model, triangles wanted, its paint material's name or None)
MODELS = {'sedan': ('sedan', 5000, 'Car_Paint'), 'police_car': ('police_car', 6000, None), 'bus': ('bus', 7000, None)}

bpy.ops.wm.read_factory_settings(use_empty=True)
paint = bpy.data.materials.new('paint')
paint.use_nodes = True
bsdf = paint.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
bsdf.inputs['Roughness'].default_value = 0.32
bsdf.inputs['Metallic'].default_value = 0.35


glass = bpy.data.materials.new('glass')
glass.use_nodes = True
gb = glass.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (0.04, 0.06, 0.07, 1)
gb.inputs['Roughness'].default_value = 0.05
gb.inputs['Alpha'].default_value = 0.35
glass.surface_render_method = 'BLENDED'


def one(objs, name):
    """The parts joined into one object named name, transforms applied."""
    for o in bpy.data.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def bake_atlas(obj, name, size=1024):
    """Everything but the paint baked into one picture on a fresh layout of the model."""
    import numpy as np
    src = obj.copy()
    src.data = obj.data.copy()
    bpy.context.scene.collection.objects.link(src)
    for uv in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(uv)
    obj.data.uv_layers.new(name='UVMap')
    for o in bpy.data.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(f'{name}_atlas', size, size)
    atlas = bpy.data.materials.new(f'{name}_atlas')
    atlas.use_nodes = True
    nt = atlas.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.5
    for n in nt.nodes:
        n.select = False
    nt.nodes.active = tex
    tex.select = True
    # While baking, the model has the atlas alone (Blender bakes into every material's picture);
    # the paint's faces are remembered and given it back after.
    painted = [p.index for p in obj.data.polygons if obj.data.materials[p.material_index] is paint]
    # The windows stay see-through (whoever rides inside is seen); red lenses are baked.
    glazed = [p.index for p in obj.data.polygons if (m := obj.data.materials[p.material_index]) and 'glass' in m.name.lower() and 'red' not in m.name.lower()]
    obj.data.materials.clear()
    obj.data.materials.append(atlas)
    for poly in obj.data.polygons:
        poly.material_index = 0
    # Bake from the copy's own materials, onto the atlas faces.
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    b = scene.render.bake
    b.use_selected_to_active = True
    b.cage_extrusion = 0.02
    b.max_ray_distance = 0.05
    b.margin = 4
    for o in bpy.data.objects:
        o.select_set(o in (obj, src))
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    px = np.array(img.pixels[:]).reshape(-1, 4)[:, :3]
    print('ATLAS', name, 'covered', round(float((px.sum(axis=1) > 0.01).mean()), 2))
    img.pack()
    bpy.data.objects.remove(src)
    if painted:
        obj.data.materials.append(paint)
        for i in painted:
            obj.data.polygons[i].material_index = len(obj.data.materials) - 1
    if glazed:
        obj.data.materials.append(glass)
        for i in glazed:
            obj.data.polygons[i].material_index = len(obj.data.materials) - 1


made = []
for name, (src, target, paint_name) in MODELS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(kit.SLIM, f'{src}.glb'))
    parts = [o for o in set(bpy.data.objects) - before if o.type == 'MESH']
    for o in set(bpy.data.objects) - before:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    obj = one(parts, name)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > target:
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = target / tris
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # The paint: a plain white the game tints.
    if paint_name:
        for i, m in enumerate(obj.data.materials):
            if m and m.name.startswith(paint_name):
                obj.data.materials[i] = paint
    bake_atlas(obj, name)
    # Front toward +X (the slimmed models already are, but for the airliner).
    obj.rotation_euler = (0, 0, kit.FRONT.get(src, 0.0))
    bpy.ops.object.transform_apply(rotation=True)
    made.append(obj)
    print('VEHICLE', name, sum(len(p.vertices) - 2 for p in obj.data.polygons), 'triangles', [round(x, 2) for x in obj.dimensions])

# The kekeh, from code, its body paint renamed so the game can tint it.
k = kit.kekeh((0, 0), 0.0)
for i, m in enumerate(k.data.materials):
    if m and m.name.startswith('paint_'):
        k.data.materials[i] = paint
k.name = 'kekeh'
made.append(k)
print('VEHICLE kekeh', sum(len(p.vertices) - 2 for p in k.data.polygons), 'triangles', [round(x, 2) for x in k.dimensions])

for o in list(bpy.data.objects):
    if o not in made:
        bpy.data.objects.remove(o)
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=80, export_apply=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
