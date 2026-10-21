# One Africa Life: the city's trees (public/oal/trees.v1.glb), from the owner's models slimmed by
# slimModels.py (art-src/one-africa-life/slim/): a shade tree, a coconut palm, a banana clump,
# each as it is (for near) and made lighter (for far, "<name>_far"); their pictures 512 px.
#
#   blender -b --factory-startup --python scripts/oal/makeTrees.py -- <slim dir> <out.glb>
#
# Each a root object standing on the origin (its foot at z = 0), its height as the model's.
import os
import sys

import bpy
import mathutils

SLIM, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)

# How light each far one is made (a share of its faces).
TREES = {'shade_tree': 0.12, 'coconut_palm': 0.15, 'banana_clump': 0.12}

for name, far in TREES.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SLIM, f'{name}.glb'))
    meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in bpy.data.objects:
        if o not in before:
            o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    tree = bpy.context.view_layer.objects.active
    tree.name = name
    tree.data.name = name
    for o in list(bpy.data.objects):
        if o not in before and o is not tree:
            bpy.data.objects.remove(o)
    # Its foot on the origin.
    lo = mathutils.Vector((1e9,) * 3)
    hi = -lo
    for v in tree.data.vertices:
        lo = mathutils.Vector(map(min, lo, v.co))
        hi = mathutils.Vector(map(max, hi, v.co))
    shift = mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in tree.data.vertices:
        v.co -= shift
    print(name, 'height', round(hi.z - lo.z, 2), 'faces', len(tree.data.polygons))
    # The far one: the same, a share of its faces.
    copy = tree.copy()
    copy.data = tree.data.copy()
    copy.name = f'{name}_far'
    copy.data.name = f'{name}_far'
    bpy.context.scene.collection.objects.link(copy)
    mod = copy.modifiers.new('lighter', 'DECIMATE')
    mod.ratio = far
    bpy.context.view_layer.objects.active = copy
    bpy.ops.object.modifier_apply(modifier='lighter')
    print(copy.name, 'faces', len(copy.data.polygons))

for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=80, export_apply=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
