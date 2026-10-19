# One Africa Life: a photo scan made light for phones the way games do it. The scan (the owner's
# vegetable stand, already slimmed to 50,000 triangles by slimModels.py) is wrapped in a simple
# shape of its own outline (remeshed, reduced to a few thousand triangles, laid out afresh), and
# the scan's colours are baked onto that shape's own picture. Seen from walking distance it looks
# the same; it weighs a fraction.
#
#   blender -b --factory-startup --python scripts/oal/bakeScan.py -- <in.glb> <out.glb> [triangles] [voxel m] [floor m]
#
# floor: the scan's own ground (the pavement it was scanned on) cut away up to that height.
import os
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
TRIANGLES = int(args[2]) if len(args) > 2 else 3000
VOXEL = float(args[3]) if len(args) > 3 else 0.05
FLOOR = float(args[4]) if len(args) > 4 else 0.0
SIZE = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
high = next(o for o in bpy.data.objects if o.type == 'MESH')

# The light shape: the scan's outline, remeshed into even faces, reduced, unwrapped.
low = high.copy()
low.data = high.data.copy()
low.name = 'light'
bpy.context.scene.collection.objects.link(low)
for m in list(low.data.materials):
    low.data.materials.pop(index=0)
remesh = low.modifiers.new('remesh', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = VOXEL
bpy.context.view_layer.objects.active = low
for o in bpy.data.objects:
    o.select_set(o is low)
bpy.ops.object.modifier_apply(modifier='remesh')
faces = sum(len(p.vertices) - 2 for p in low.data.polygons)
dec = low.modifiers.new('decimate', 'DECIMATE')
dec.ratio = min(1.0, TRIANGLES / max(1, faces))
bpy.ops.object.modifier_apply(modifier='decimate')
for uv in list(low.data.uv_layers):
    low.data.uv_layers.remove(uv)
low.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')

# Its picture, baked from the scan's colours (no light: the game lights it).
img = bpy.data.images.new('veg_light', SIZE, SIZE)
mat = bpy.data.materials.new('baked')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.85
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
for n in nt.nodes:
    n.select = False
# The picture baked into: the active node, and selected (made active first, which clears it).
nt.nodes.active = tex
tex.select = True
low.data.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 4
bake = scene.render.bake
bake.use_selected_to_active = True
bake.cage_extrusion = VOXEL * 2
bake.max_ray_distance = 0.0
bake.margin = 6
for o in bpy.data.objects:
    o.select_set(o in (high, low))
bpy.context.view_layer.objects.active = low
# A photo scan is unlit (its picture already holds the light): what it gives off is its colour.
unlit = any(n.type == 'EMISSION' for m in high.data.materials for n in m.node_tree.nodes)
bpy.ops.object.bake(type='EMIT') if unlit else bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
import numpy as np
px = np.array(img.pixels[:])
print("BAKE MEAN", px.reshape(-1, 4)[:, :3].mean(), "covered", (px.reshape(-1, 4)[:, :3].sum(axis=1) > 0.01).mean())
img.pack()

bpy.data.objects.remove(high)
# The scan's own ground: its low, flat faces (removed after the bake, since the remesh needs the
# whole scan to close its shape).
if FLOOR > 0:
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(low.data)
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < FLOOR and abs(f.normal.z) > 0.6], context='FACES')
    bm.to_mesh(low.data)
    bm.free()
for o in bpy.data.objects:
    o.select_set(o is low)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_image_quality=85, export_apply=True, use_selection=True)
print('BAKED', OUT, sum(len(p.vertices) - 2 for p in low.data.polygons), 'triangles', round(os.path.getsize(OUT) / 1e6, 2), 'MB')
