# One Africa Life: the kekeh (a Bajaj RE auto rickshaw) as the town drives it
# (public/oal/kekeh.v1.glb and src/games/oal/kekehPlan.json). Its body made by Hyper3D Rodin from
# the owner's pictures (art-src/one-africa-life/cars/kekeh: ref_*.png, kekeh_rodin.glb), sized as a
# real one (2.63 m long); its three wheels cut off the body and made again, each on a pivot at its
# middle (turned as it rolls); the front wheel with its fork and its mudguard on one pivot, turned
# as it is steered, the handlebar turned with them. Facing +X (as the game's vehicles do), its
# wheels on the ground.
#
#   blender -b --factory-startup --python scripts/oal/makeKekeh.py -- <kekeh_rodin.glb> <out.glb> <plan.json>
import json
import math
import os
import sys

import bmesh
import bpy
import mathutils

SRC, OUT, PLAN_OUT = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
body = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
for o in list(bpy.context.scene.objects):
    if o is not body and o.type != 'MESH':
        body.parent = None
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Its size: a real one's length (the model's is in its own units), its wheels on the ground, its
# middle over the origin.
me = body.data
xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
zs = [v.co.z for v in me.vertices]
S = 2.63 / (max(ys) - min(ys))
shift = mathutils.Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)))
me.transform(mathutils.Matrix.Scale(S, 4) @ mathutils.Matrix.Translation(-shift))
me.update()

# The wheels (found in the model by where it meets the ground): their middles, their size.
R = 0.226
WIDTH = 0.11
WHEELS = {
    'f': ((-0.005 - shift.x) * S, (-0.804 - shift.y) * S),
    'rl': ((0.437 - shift.x) * S, (0.622 - shift.y) * S),
    'rr': ((-0.441 - shift.x) * S, (0.619 - shift.y) * S),
}
# Cut the body's own wheels off (what is within each wheel's drum).
bm = bmesh.new()
bm.from_mesh(me)
cut = []
for f in bm.faces:
    c = f.calc_center_median()
    for key, (wx, wy) in WHEELS.items():
        if abs(c.x - wx) < WIDTH / 2 + 0.035 and math.hypot(c.y - wy, c.z - R) < R + 0.02:
            cut.append(f)
            break
bmesh.ops.delete(bm, geom=cut, context='FACES')
# The front mudguard (over the front wheel, on its fork): cut off onto the steering's pivot.
fx, fy = WHEELS['f']
guard = [f for f in bm.faces if abs(f.calc_center_median().x - fx) < 0.16 and abs(f.calc_center_median().y - fy) < 0.3 and R * 1.9 < f.calc_center_median().z < R * 2.75]
gbm = bmesh.new()
uv_src = bm.loops.layers.uv.active
uv_dst = gbm.loops.layers.uv.new()
vmap = {}
for f in guard:
    vs = []
    for v in f.verts:
        if v not in vmap:
            vmap[v] = gbm.verts.new(v.co)
        vs.append(vmap[v])
    try:
        nf = gbm.faces.new(vs)
        nf.material_index = f.material_index
        if uv_src:
            for a, b in zip(nf.loops, f.loops):
                a[uv_dst].uv = b[uv_src].uv
    except ValueError:
        pass
bmesh.ops.delete(bm, geom=guard, context='FACES')
bm.to_mesh(me)
bm.free()
print('cut', len(cut), 'faces of wheels;', len(guard), 'of the mudguard')

root = bpy.data.objects.new('kekeh', None)
bpy.context.scene.collection.objects.link(root)
body.name = 'kekeh_body'
body.parent = root


def empty(name, at, parent):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = at
    return e


def material(name, rgb, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


M_TYRE = material('tyre', (0.025, 0.025, 0.027), 0.92)
M_RIM = material('rim', (0.62, 0.64, 0.66), 0.32, 0.85)
M_HUB = material('hub', (0.3, 0.31, 0.32), 0.45, 0.7)
M_BAR = material('handlebar', (0.06, 0.06, 0.065), 0.5, 0.3)
M_GRIP = material('grip', (0.03, 0.03, 0.03), 0.85)


def wheel(name):
    """A wheel at the origin, its axle along x: the tyre (its tread's ribs), the rim, the hub."""
    wbm = bmesh.new()
    segs = 40
    # The tyre: a rounded ring (its section a squashed circle), ribbed round its tread.
    ring = []
    sec = 10
    for i in range(segs):
        a = 2 * math.pi * i / segs
        rib = 0.006 if i % 2 == 0 else 0.0
        row = []
        for j in range(sec):
            b = 2 * math.pi * j / sec
            rr = R * 0.78 + (R * 0.22 + rib * max(0, math.cos(b))) * (0.5 + 0.5 * math.cos(b))
            x = math.sin(b) * WIDTH / 2
            row.append(wbm.verts.new((x, math.cos(a) * rr, math.sin(a) * rr)))
        ring.append(row)
    for i in range(segs):
        for j in range(sec):
            f = wbm.faces.new((ring[i][j], ring[(i + 1) % segs][j], ring[(i + 1) % segs][(j + 1) % sec], ring[i][(j + 1) % sec]))
            f.material_index = 0
    # The rim (a dished disc either side) and its hub.
    for side in (-1, 1):
        rim = bmesh.ops.create_circle(wbm, cap_ends=True, radius=R * 0.62, segments=segs)
        for v in rim['verts']:
            v.co = mathutils.Vector((side * WIDTH * 0.3, v.co.x, v.co.y))
        for f in {f for v in rim['verts'] for f in v.link_faces}:
            f.material_index = 1
        hub = bmesh.ops.create_circle(wbm, cap_ends=True, radius=R * 0.2, segments=16)
        for v in hub['verts']:
            v.co = mathutils.Vector((side * WIDTH * 0.36, v.co.x, v.co.y))
        for f in {f for v in hub['verts'] for f in v.link_faces}:
            f.material_index = 2
    bmesh.ops.recalc_face_normals(wbm, faces=wbm.faces)
    wme = bpy.data.meshes.new(name)
    wbm.to_mesh(wme)
    wbm.free()
    for m in (M_TYRE, M_RIM, M_HUB):
        wme.materials.append(m)
    for p in wme.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, wme)
    bpy.context.scene.collection.objects.link(o)
    return o


# The steering: at the front wheel, about the upright through it (its fork, its mudguard, its wheel).
steer = empty('kekeh_steer', (fx, fy, 0), root)
gme = bpy.data.meshes.new('kekeh_mudguard')
gbm.to_mesh(gme)
gbm.free()
for m in me.materials:
    gme.materials.append(m)
mud = bpy.data.objects.new('kekeh_mudguard', gme)
bpy.context.scene.collection.objects.link(mud)
mud.parent = steer
mud.location = (-fx, -fy, 0)
# Its fork: two legs from the axle up to the body.
fbm = bmesh.new()
for side in (-1, 1):
    leg = bmesh.ops.create_cone(fbm, cap_ends=True, segments=10, radius1=0.018, radius2=0.018, depth=R * 1.5)
    for v in leg['verts']:
        v.co = mathutils.Vector((v.co.x + side * (WIDTH / 2 + 0.03), v.co.y, v.co.z + R + R * 0.75))
fme = bpy.data.meshes.new('kekeh_fork')
fbm.to_mesh(fme)
fbm.free()
fme.materials.append(M_HUB)
fork = bpy.data.objects.new('kekeh_fork', fme)
bpy.context.scene.collection.objects.link(fork)
fork.parent = steer
plan_wheels = {}
for key, (wx, wy) in WHEELS.items():
    parent = steer if key == 'f' else root
    at = (0, 0, R) if key == 'f' else (wx, wy, R)
    pivot = empty(f'kekeh_wheel_{key}', at, parent)
    w = wheel(f'kekeh_tyre_{key}')
    w.parent = pivot
    plan_wheels[key] = {'node': pivot.name, 'at': [round(-wy, 3), round(R, 3), round(-wx, 3)], 'r': R}

# The handlebar: before the driver, behind the windscreen, turned with the front wheel.
bar_at = (fx, fy + 0.62, 0.98)
bar = empty('kekeh_handlebar', bar_at, root)
bar.rotation_euler = (math.radians(-18), 0, 0)
hbm = bmesh.new()
tube = bmesh.ops.create_cone(hbm, cap_ends=True, segments=10, radius1=0.016, radius2=0.016, depth=0.62)
for v in tube['verts']:
    v.co = mathutils.Vector((v.co.z, v.co.y + (abs(v.co.z) ** 2) * 0.6, v.co.x))
col = bmesh.ops.create_cone(hbm, cap_ends=True, segments=10, radius1=0.02, radius2=0.02, depth=0.3)
for v in col['verts']:
    v.co = mathutils.Vector((v.co.x, v.co.y, v.co.z - 0.15))
for f in hbm.faces:
    f.material_index = 0
for side in (-1, 1):
    grip = bmesh.ops.create_cone(hbm, cap_ends=True, segments=10, radius1=0.022, radius2=0.022, depth=0.11)
    for v in grip['verts']:
        v.co = mathutils.Vector((v.co.z + side * 0.27, v.co.y + 0.05, v.co.x))
    for f in {f for v in grip['verts'] for f in v.link_faces}:
        f.material_index = 1
hme = bpy.data.meshes.new('kekeh_handlebar_mesh')
hbm.to_mesh(hme)
hbm.free()
hme.materials.append(M_BAR)
hme.materials.append(M_GRIP)
hb = bpy.data.objects.new('kekeh_handlebar_mesh', hme)
bpy.context.scene.collection.objects.link(hb)
hb.parent = bar

xs = [v.co.x for v in me.vertices]
ys = [v.co.y for v in me.vertices]
zs = [v.co.z for v in me.vertices]
driver = mathutils.Vector((fx, fy + 1.02, 0.62))
passenger = mathutils.Vector((fx, fy + 1.75, 0.58))
game = lambda v: [round(-v.y, 3), round(v.z, 3), round(-v.x, 3)]  # noqa: E731
plan = {
    'kekeh': {
        'wheels': plan_wheels,
        'steer': 'kekeh_steer',
        'handlebar': 'kekeh_handlebar',
        'driver': game(driver),
        'passenger': game(passenger),
        'size': [round(max(ys) - min(ys), 2), round(max(zs) - min(zs), 2), round(max(xs) - min(xs), 2)],
        'wheelbase': round(abs(WHEELS['rl'][1] - fy), 3),
    }
}
# Facing +X: a quarter turn about the upright.
root.rotation_euler = (0, 0, math.pi / 2)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=92, export_apply=True)
with open(PLAN_OUT, 'w') as f:
    json.dump(plan, f, indent=1)
print('EXPORTED', OUT, os.path.getsize(OUT), json.dumps(plan['kekeh']['size']), 'wheelbase', plan['kekeh']['wheelbase'])
