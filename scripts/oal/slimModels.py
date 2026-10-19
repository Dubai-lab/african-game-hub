# One Africa Life: makes the owner's downloaded models (Fab; cars, a police car, a plane, a
# rifle) light enough for budget phones: their triangles reduced to a target (Blender's
# decimate, collapsing edges, which keeps the shape), every picture at most 1024 pixels, the
# model stood on the ground at its real size (length in metres), facing +X, and saved as glTF.
#
#   blender -b --factory-startup --python scripts/oal/slimModels.py -- <out dir>
#
# The sources stay in art-src/one-africa-life/{cars,plane,weapons}; the light copies go to
# <out dir>/<name>.glb (then packed by gltfpack where the game uses them).
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

OUT = os.path.expanduser(sys.argv[sys.argv.index('--') + 1])
os.makedirs(OUT, exist_ok=True)
ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art-src', 'one-africa-life')

# name: (source, triangles wanted, real length in metres)
MODELS = {
    'sedan': ('cars/generic_sedan_car.glb', 24000, 4.6),
    'coupe': ('cars/generic_sport_coupe_car.glb', 24000, 4.5),
    'suv': ('cars/nexus_rx.glb', 26000, 4.8),
    'police_car': ('cars/police_car.glb', 28000, 4.9),
    'bus': ('cars/paz_652.glb', 26000, 7.6),
    'toy_bus': ('cars/toy_bus.glb', 20000, 7.6),
    # A four-engined wide-body: at a 747's length its span and height come out right too.
    'airliner': ('plane/2_plane.glb', 60000, 64.0),
    'rifle': ('weapons/AK105fbx.fbx', 4000, 0.82),
}
ONLY = os.environ.get('SLIM_ONLY', '').split(',') if os.environ.get('SLIM_ONLY') else None


def police_livery():
    """The downloaded police car is American (black and white, '911'). Ours: the black of the body
    made navy, the white panels kept, so 'POLICE' reads navy on white, as on Liberian and Ghanaian
    police cars; the '911' marks painted out."""
    import numpy as np
    body = bpy.data.materials.get('body')
    tex = next(n for n in body.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.channels >= 3 and n.outputs['Color'].is_linked)
    img = tex.image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)[::-1].copy()
    # The '911' marks (the picture's rows from the top, at 1024 pixels).
    k = w / 1024
    for (x0, y0, x1, y1) in ((355, 440, 410, 470), (750, 605, 805, 635)):
        px[int(y0 * k):int(y1 * k), int(x0 * k):int(x1 * k), :3] = 0.0
    rgb = px[:, :, :3]
    lum = rgb.mean(axis=2)
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    dark = (lum < 0.1) & (spread < 0.06)
    navy = np.array((0.035, 0.09, 0.3), dtype=np.float32)
    rgb[dark] = navy * (0.8 + lum[dark, None] * 4)
    px[:, :, :3] = rgb
    img.pixels.foreach_set(px[::-1].ravel())
    img.pack()


def wheels_back():
    """The police car's file lost where its rig held the wheels: all four (and their brakes) sit
    at one point inside the body. They go back into the wheel arches, found in the body itself
    (along the car, the body's lowest point near its sides rises where an arch is), each turned
    so its axle runs across the car, standing on the ground."""
    def box_of(objs):
        pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return lo, hi

    parts = [o for o in bpy.data.objects if o.type == 'MESH' and 'Wheel' in o.name]
    body = [o for o in bpy.data.objects if o.type == 'MESH' and o not in parts]
    lo, hi = box_of(body)
    length, half = hi.y - lo.y, (hi.x - lo.x) / 2
    cx = (lo.x + hi.x) / 2
    # The body's lowest point along the car, near its sides, in 60 slices.
    slices = 60
    low = [hi.z] * slices
    for o in body:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            if abs(p.x - cx) > 0.75 * half:
                k = min(slices - 1, int((p.y - lo.y) / length * slices))
                low[k] = min(low[k], p.z)
    floor = sorted(low)[slices // 4]
    arch = [z > floor + 0.12 * (hi.z - lo.z) for z in low]
    # The two longest runs of raised slices, away from the very ends, are the arches.
    runs, start = [], None
    for k, raised in enumerate(arch + [False]):
        if raised and start is None:
            start = k
        if not raised and start is not None:
            if start > 1 and k < slices - 1:
                runs.append((k - start, (start + k) / 2))
            start = None
    centres = sorted(c for _, c in sorted(runs)[-2:])
    ys = [lo.y + (c / slices) * length for c in centres]
    print('ARCHES', [round(y, 2) for y in ys], 'of', round(lo.y, 2), round(hi.y, 2))
    for o in parts:
        wlo, whi = box_of([o])
        size = whi - wlo
        # Turn the wheel so its thin side (the axle) is across the car (X).
        if size.y < size.x and size.y < size.z:
            c = (wlo + whi) / 2
            o.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Translation(-c) @ o.matrix_world
            wlo, whi = box_of([o])
            size = whi - wlo
        front = '.Ft.' in o.name
        left = '.L' in o.name.split('Wheel')[-1]
        y = ys[1] if front else ys[0]
        x = cx + (-1 if left else 1) * (half - size.x / 2 - 0.03 * half)
        z = lo.z + size.z / 2 if 'Brake' not in o.name else None
        here = (wlo + whi) / 2
        target = Vector((x, y, z if z is not None else here.z))
        o.matrix_world = Matrix.Translation(target - here) @ o.matrix_world
    # Brakes inside their wheel.
    for o in parts:
        if 'Brake' not in o.name:
            continue
        twin = next((w for w in parts if 'Brake' not in w.name and w.name.split('Wheel.')[-1] == o.name.split('WheelBrake.')[-1]), None)
        if twin:
            a_lo, a_hi = box_of([twin])
            b_lo, b_hi = box_of([o])
            o.matrix_world = Matrix.Translation((a_lo + a_hi) / 2 - (b_lo + b_hi) / 2) @ o.matrix_world


def triangles(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')


for name, (source, target, length) in MODELS.items():
    if ONLY and name not in ONLY:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(ART, source)
    if source.endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    before = triangles(meshes)
    # Everything as one: transforms applied, joined, so one decimation spreads evenly.
    for o in bpy.data.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes[0]
    # Parts drawn several times from one mesh (four wheels) each get their own copy first, or
    # they cannot be moved into place and joined.
    bpy.ops.object.make_single_user(object=True, obdata=True)
    # Parts hung on a rig's bones (the police car's wheels) keep where the bones hold them: every
    # place worked out, then each part fixed there, before the rig goes.
    bpy.context.view_layer.update()
    placed = {o: o.matrix_world.copy() for o in bpy.data.objects if o.type == 'MESH'}
    for o, m in placed.items():
        o.parent = None
        o.matrix_world = m
    if name == 'police_car':
        wheels_back()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for o in [o for o in bpy.data.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    if before > target:
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = target / before
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Its real size, on the ground, centred, its long side along X (the mesh itself moved, so
    # nothing depends on which objects an operator sees as selected).
    def bounds():
        xs = [v.co for v in obj.data.vertices]
        lo = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
        hi = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
        return lo, hi

    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    lo, hi = bounds()
    if (hi - lo).y > (hi - lo).x:
        obj.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
        lo, hi = bounds()
    s = length / (hi - lo).x
    centre = (lo + hi) / 2
    obj.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-centre.x, -centre.y, -lo.z))))
    obj.data.update()
    if name == 'police_car':
        police_livery()
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size)
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    out = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_image_quality=82, export_apply=True)
    lo, hi = bounds()
    dims = hi - lo
    print(f'SLIM {name}: {before} -> {triangles([obj])} triangles, {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f} m, {os.path.getsize(out) / 1e6:.1f} MB')
