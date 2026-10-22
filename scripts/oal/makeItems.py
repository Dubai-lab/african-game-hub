# One Africa Life: the things sold at Furniture City (and kept, arranged, sold again at home), one
# game file of them all (public/oal/items.v2.glb, and src/games/oal/itemsPlan.json: each one's size),
# from the owner's downloads (art-src/one-africa-life/Houses_design_to_buy): each made real (its
# real size; its textures on it; the heaviest made lighter, unseen), standing on the floor at the
# origin, its front to -Y (the side away from its back: a sofa's backrest, a bed's headboard, a
# toilet's cistern, a sink's taps), each under a root named item_<id>.
#
#   blender -b --factory-startup --python scripts/oal/makeItems.py -- <out.glb> <plan.json>
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT, PLAN = sys.argv[sys.argv.index('--') + 1:][:2]
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art-src', 'one-africa-life', 'Houses_design_to_buy')

# id: (file, its real size's longest side (metres) or None to keep it, the most faces it keeps, textures to put on)
ITEMS = {
    'sofa_set': ('sofa_1.blend', None, 40000, None),
    'corner_sofa': ('sofa_8.blend', 2.7, 36000, None),
    'sofa': ('blue_sofa.blend', 2.0, 12000, None),
    'double_bed': ('double_bed_12.blend', 2.15, 12000, ('Textures_bed/PBR Metal Rough', 'Bed12')),
    'toilet': ('Toilet/Toilet.fbx', 0.72, 12000, ('Toilet', 'SkibidiToilet_high_Toilet')),
    'bathtub': ('simple_bathtub.glb', 1.7, 12000, None),
    'kitchen_counter': ('blue_kitchen_marble_counter_sink.glb', 2.35, 20000, None),
    'sink': ('sink.glb', 0.85, 12000, None),
    'chandelier': ('ligh45.blend', 0.85, 12000, None),
    'modern_bed': ('Modern Bed.fbx', 2.25, 20000, ('textures_modern_bed', 'Modern Bed', {'BaseColor': 'd', 'Roughness': 'r', 'Normal': 'n'})),
}

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    """The meshes of a file, in this scene."""
    before = set(bpy.data.objects)
    if path.endswith('.blend'):
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None and o.type == 'MESH':
                bpy.context.scene.collection.objects.link(o)
    elif path.endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in set(bpy.data.objects) - before if o.type == 'MESH' and o.name in bpy.context.scene.objects]


def textured(objs, folder, stem, names=None):
    """Its own textures put on it (a model that came without them linked)."""
    d = os.path.join(SRC, folder)
    mat = bpy.data.materials.new(stem)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes['Principled BSDF']
    for suffix, socket, colour in (('BaseColor', 'Base Color', True), ('Roughness', 'Roughness', False), ('Metallic', 'Metallic', False), ('Normal', 'Normal', False)):
        path = os.path.join(d, f'{stem}_{(names or {}).get(suffix, suffix)}.png')
        if not os.path.exists(path):
            continue
        tex = tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(path)
        if not colour:
            tex.image.colorspace_settings.name = 'Non-Color'
        if socket == 'Normal':
            nm = tree.nodes.new('ShaderNodeNormalMap')
            tree.links.new(tex.outputs['Color'], nm.inputs['Color'])
            tree.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        else:
            tree.links.new(tex.outputs['Color'], bsdf.inputs[socket])
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)


def one(objs, name):
    """One object of its meshes, its modifiers kept as they look, no parents."""
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
    with bpy.context.temp_override(selected_objects=objs, selected_editable_objects=objs, active_object=objs[0], object=objs[0]):
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    dg = bpy.context.evaluated_depsgraph_get()
    meshes = []
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        meshes.append(me)
    bm = bmesh.new()
    mats = []
    for me in meshes:
        offset = len(mats)
        for m in me.materials:
            mats.append(m)
        part = bmesh.new()
        part.from_mesh(me)
        for f in part.faces:
            f.material_index += offset
        tmp = bpy.data.meshes.new('tmp')
        part.to_mesh(tmp)
        part.free()
        bm.from_mesh(tmp)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    for m in mats:
        out.materials.append(m)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    obj = bpy.data.objects.new(name, out)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def lighter(obj, faces):
    """Fewer faces, the same look (only when there are many more than kept)."""
    if len(obj.data.polygons) <= faces:
        return
    dec = obj.modifiers.new('lighter', 'DECIMATE')
    dec.ratio = faces / len(obj.data.polygons)
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=dec.name)


def front_away_from_back(obj):
    """Turned so its back (where its tallest parts are, off its middle) is at +Y: its front -Y."""
    vs = [v.co for v in obj.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = (lo + hi) / 2
    top = sorted(vs, key=lambda v: v.z)[int(len(vs) * 0.85):]
    t = sum(top, Vector()) / max(1, len(top))
    off = Vector((t.x - c.x, t.y - c.y))
    # (Something round, its top in its middle (a chandelier): as it is.)
    if off.length < 0.08 * max(hi.x - lo.x, hi.y - lo.y):
        return
    # (By quarter turns: square to the room as it was made.)
    angle = round(math.atan2(off.y, off.x) / (math.pi / 2)) * (math.pi / 2)
    obj.data.transform(Matrix.Rotation(math.pi / 2 - angle, 4, 'Z'))
    obj.data.update()


def on_the_floor(obj, longest):
    """Its real size; standing at the origin."""
    vs = [v.co for v in obj.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    size = hi - lo
    s = longest / max(size) if longest else 1.0
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    obj.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-centre))
    obj.data.update()
    return size * s


plan = {}
for item_id, (file, longest, faces, tex) in ITEMS.items():
    objs = load(os.path.join(SRC, file))
    # (The files' cameras, lights, helpers and floors: not the thing itself.)
    objs = [o for o in objs if not any(k in o.name.lower() for k in ('plane', 'floor', 'ground', 'backdrop'))] or objs
    if tex:
        textured(objs, *tex)
    obj = one(objs, f'{item_id}_mesh')
    lighter(obj, faces)
    front_away_from_back(obj)
    size = on_the_floor(obj, longest)
    for p in obj.data.polygons:
        p.use_smooth = True
    root = bpy.data.objects.new(f'item_{item_id}', None)
    bpy.context.scene.collection.objects.link(root)
    obj.parent = root
    plan[item_id] = {'size': [round(size.x, 3), round(size.y, 3), round(size.z, 3)], 'faces': len(obj.data.polygons)}
    print('ITEM', item_id, plan[item_id])

# Laid out in a row (each at its own place for the export; the game puts each where it goes).
x = 0.0
for item_id in ITEMS:
    root = bpy.data.objects[f'item_{item_id}']
    root.location = (x, 0, 0)
    x += plan[item_id]['size'][0] + 1.0
# Pictures sharp close up, not heavier than that (1024 at most).
for img in bpy.data.images:
    if img.size[0] > 1024 or img.size[1] > 1024:
        k = 1024 / max(img.size)
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_image_quality=85, export_apply=True)
for item_id in ITEMS:
    plan[item_id]['at'] = list(bpy.data.objects[f'item_{item_id}'].location)
with open(PLAN, 'w') as f:
    json.dump(plan, f, indent=1)
print('GLB', os.path.getsize(OUT))
