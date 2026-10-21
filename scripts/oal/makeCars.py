# One Africa Life: the town's cars as a game drives them (public/oal/cars.v1.glb and
# src/games/oal/carsPlan.json), from the owner's car pack (art-src/one-africa-life/cars/source):
#   sedan   Car 10   the taxis (painted yellow), private cars, the police
#   saloon  Car 1    private cars
#   hatch   Car 3    private cars (two doors)
#   pickup  Car 7    pickups (two doors)
# Each car: its body in one paint (the game paints it), its glass to see through, an inside (the
# floor, the dashboard, the seats, a steering wheel of its own that turns), its doors cut from its
# body on hinges at their front edges, its four wheels each on its own pivot (turned as it rolls,
# the front two steered), its head and brake lights. Facing +X (as the game's vehicles do), its
# left (the driver's side: Liberia drives on the right) toward -Z in the game, its wheels on the
# ground at y = 0.
#
#   blender -b --factory-startup --python scripts/oal/makeCars.py -- <car pack dir> <out.glb> <plan.json> [preview dir]
import json
import math
import os
import sys

import bmesh
import bpy
import mathutils

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, PLAN_OUT = args[:3]
PREVIEW = args[3] if len(args) > 3 else None

# The cars: their file; the beltline (the windows' foot) and the sill (the doors' foot), metres
# up; their doors a side (four, or two).
CARS = {
    'sedan': ('Car 10.fbx', 1.02, 0.42, 4),
    'saloon': ('Car 1.fbx', 1.0, 0.4, 4),
    'hatch': ('Car 3.fbx', 0.94, 0.38, 2),
    'pickup': ('Car 7.fbx', 1.14, 0.5, 2),
}

bpy.ops.wm.read_factory_settings(use_empty=True)


def flat(name, rgb, rough=0.6, metal=0.0, alpha=1.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 0.0
    return m


M_PAINT = flat('paint', (0.9, 0.9, 0.9), 0.32, 0.45)
M_GLASS = flat('glass', (0.04, 0.06, 0.07), 0.05, 0.0, alpha=0.32)
M_INSIDE = flat('inside', (0.09, 0.09, 0.1), 0.8)
M_SEAT = flat('seat', (0.16, 0.15, 0.14), 0.9)
M_DASH = flat('dash', (0.07, 0.07, 0.08), 0.5)
M_HEAD = flat('headlight', (0.95, 0.95, 0.9), 0.2, emit=(1.0, 0.95, 0.85))
M_BRAKE = flat('brakelight', (0.5, 0.03, 0.03), 0.3, emit=(1.0, 0.05, 0.03))

plan = {}


def world_bounds(objs):
    lo = mathutils.Vector((1e9,) * 3)
    hi = -lo
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


def box(bm, c, s, mat_index=0):
    """A box (centre x, y; bottom z; sizes) into a bmesh."""
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']:
        v.co = mathutils.Vector((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1], c[2] + (v.co.z + 0.5) * s[2]))
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = mat_index


def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def empty(name, at, parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = at
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e


def game(v):
    """A point (Blender, the car facing -Y) in the game's car frame: x forward, y up, z to the right."""
    return [round(-v.y, 3), round(v.z, 3), round(-v.x, 3)]


for name, (file, belt, sill, doors) in CARS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, file))
    parts = [o for o in bpy.data.objects if o not in before]
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = [o for o in parts if o.type == 'MESH'][0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in parts:
        o.select_set(False)
    meshes = [o for o in parts if o.type == 'MESH']
    lo, hi = world_bounds(meshes)
    # Its wheels on the ground (z = 0), its middle over the origin.
    shift = mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for o in meshes:
        o.data.transform(mathutils.Matrix.Translation(-shift))
    root = empty(f'car_{name}', (0, 0, 0))
    wheels = {}
    rest = []
    for o in meshes:
        n = o.name.lower()
        if 'wheel' in n:
            key = ('f' if 'front' in n else 'r') + ('l' if 'left' in n else 'r')
            wl, wh = world_bounds([o])
            centre = (wl + wh) / 2
            o.data.transform(mathutils.Matrix.Translation(-centre))
            pivot = empty(f'{name}_wheel_{key}', centre, root)
            o.parent = pivot
            o.name = f'{name}_tyre_{key}'
            wheels[key] = {'at': centre.copy(), 'r': (wh.z - wl.z) / 2}
        else:
            rest.append(o)
    # The body and its trim, one mesh; its paint, its glass (the windows above the beltline).
    for o in rest:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rest[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = f'{name}_body'
    me = body.data
    slots = [m.name if m else '' for m in me.materials]
    paint_i = [i for i, s in enumerate(slots) if s.startswith('Body')]
    screens_i = [i for i, s in enumerate(slots) if s.startswith('Screens')]
    light_i = [i for i, s in enumerate(slots) if s in ('Light', 'Front light')]
    brake_i = [i for i, s in enumerate(slots) if 'Red' in s or 'Back light' in s]
    me.materials.append(M_GLASS)
    glass_i = len(me.materials) - 1
    for i in paint_i:
        me.materials[i] = M_PAINT
    for i in light_i:
        me.materials[i] = M_HEAD
    for i in brake_i:
        me.materials[i] = M_BRAKE
    # Glass: the windows' faces (steep, between the beltline and the roof), not the trim.
    roof = hi.z - lo.z
    for p in me.polygons:
        if p.material_index in screens_i and belt < p.center.z < roof - 0.04 and abs(p.normal.z) < 0.85:
            p.material_index = glass_i
    # The doors: the sides between the wheels, sill to roof, cut off onto hinges.
    front = wheels['fl']['at'].y
    rear = wheels['rl']['at'].y
    L = rear - front
    half = max(abs(wheels['fl']['at'].x), abs(wheels['fr']['at'].x)) + 0.12
    spans = [(front + 0.26 * L, front + 0.55 * L), (front + 0.55 * L, front + 0.84 * L)] if doors == 4 else [(front + 0.3 * L, front + 0.72 * L)]
    door_plan = []
    bm = bmesh.new()
    bm.from_mesh(me)
    # Cut along every door's outline first (its edges straight, as a door's are): its front and
    # back, its sill, its top under the roof's edge, its inside face.
    top = roof - 0.1
    xin = half * 0.7
    cuts = [((0, y, 0), (0, 1, 0)) for span in spans for y in span] + [((0, 0, sill), (0, 0, 1)), ((0, 0, top), (0, 0, 1)), ((xin, 0, 0), (1, 0, 0)), ((-xin, 0, 0), (1, 0, 0))]
    for co, no in cuts:
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
    bm.faces.ensure_lookup_table()
    for side in (1, -1):
        for k, (y0, y1) in enumerate(spans):
            pick = []
            for f in bm.faces:
                c = f.calc_center_median()
                if c.x * side > xin and y0 < c.y < y1 and sill < c.z < top:
                    pick.append(f)
            if not pick:
                continue
            dbm = bmesh.new()
            uvl = dbm.loops.layers.uv.new()
            src_uv = bm.loops.layers.uv.active
            vmap = {}
            for f in pick:
                vs = []
                for v in f.verts:
                    if v not in vmap:
                        vmap[v] = dbm.verts.new(v.co)
                    vs.append(vmap[v])
                try:
                    nf = dbm.faces.new(vs)
                    nf.material_index = f.material_index
                    if src_uv:
                        for l_new, l_old in zip(nf.loops, f.loops):
                            l_new[uvl].uv = l_old[src_uv].uv
                except ValueError:
                    pass
            bmesh.ops.delete(bm, geom=pick, context='FACES')
            bm.faces.ensure_lookup_table()
            key = ('f' if k == 0 else 'r') + ('l' if side > 0 else 'r')
            xs = [v.co.x for v in dbm.verts]
            hinge = mathutils.Vector((max(xs) * 0.98 if side > 0 else min(xs) * 0.98, y0, (sill + top) / 2))
            for v in dbm.verts:
                v.co -= hinge
            dme = bpy.data.meshes.new(f'{name}_door_{key}')
            dbm.to_mesh(dme)
            dbm.free()
            for m in me.materials:
                dme.materials.append(m)
            door = bpy.data.objects.new(f'{name}_doorpanel_{key}', dme)
            bpy.context.scene.collection.objects.link(door)
            pivot = empty(f'{name}_door_{key}', hinge, root)
            door.parent = pivot
            # Opens outward: its back edge swung away from the car (about the hinge's upright).
            door_plan.append({'name': f'{name}_door_{key}', 'side': 'left' if side > 0 else 'right', 'front': k == 0, 'open': -side})
    bm.to_mesh(me)
    bm.free()
    body.parent = root
    # The inside: the floor, the dashboard, the seats (the front two, a bench behind), the wheel.
    w = half - 0.25
    dash_y = front + 0.36 * L
    seat_y = front + 0.5 * L
    ibm = bmesh.new()
    box(ibm, (0, (dash_y + rear) / 2 - 0.2, 0.3), (w * 2, rear - dash_y, 0.06), 0)
    box(ibm, (0, dash_y - 0.05, belt - 0.32), (w * 2, 0.4, 0.32), 2)
    for x in ((w * 0.5), -(w * 0.5)):
        box(ibm, (x, seat_y, 0.36), (0.5, 0.52, 0.16), 1)
        box(ibm, (x, seat_y + 0.3, 0.5), (0.5, 0.12, 0.6), 1)
    if doors == 4 or name == 'hatch':
        box(ibm, (0, seat_y + 0.85, 0.36), (w * 1.8, 0.5, 0.16), 1)
        box(ibm, (0, seat_y + 1.12, 0.5), (w * 1.8, 0.12, 0.55), 1)
    inside = new_obj(f'{name}_inside', ibm, [M_INSIDE, M_SEAT, M_DASH])
    inside.parent = root
    driver = mathutils.Vector((w * 0.5, seat_y, 0.5))
    steer_at = mathutils.Vector((w * 0.5, dash_y + 0.32, belt - 0.08))
    sbm = bmesh.new()
    bmesh.ops.create_circle(sbm, cap_ends=False, radius=0.18, segments=20)
    ring = bpy.data.meshes.new('ring')
    sbm.to_mesh(ring)
    sbm.free()
    steer_obj = bpy.data.objects.new(f'{name}_steering', ring)
    bpy.context.scene.collection.objects.link(steer_obj)
    mod = steer_obj.modifiers.new('tube', 'SKIN')
    bpy.context.view_layer.objects.active = steer_obj
    for v in steer_obj.data.skin_vertices[0].data:
        v.radius = (0.022, 0.022)
    bpy.ops.object.modifier_apply(modifier='tube')
    cbm = bmesh.new()
    cbm.from_mesh(steer_obj.data)
    box(cbm, (0, 0, -0.02), (0.36, 0.03, 0.04))
    cbm.to_mesh(steer_obj.data)
    cbm.free()
    steer_obj.data.materials.append(M_DASH)
    # Facing the driver: the wheel's face tilted back (about the car's x), on its own pivot.
    steer = empty(f'{name}_steer', steer_at, root)
    steer.rotation_euler = (math.radians(65), 0, 0)
    steer_obj.parent = steer
    plan[name] = {
        'wheels': {k: {'at': game(v['at']), 'r': round(v['r'], 3), 'node': f'{name}_wheel_{k}'} for k, v in wheels.items()},
        'doors': door_plan,
        'steer': f'{name}_steer',
        'driver': game(driver),
        'size': [round(hi.y - lo.y, 2), round(hi.z - lo.z, 2), round(hi.x - lo.x, 2)],
        'wheelbase': round(L, 3),
    }
    print(name, json.dumps(plan[name]['size']), 'doors', len(door_plan), 'wheels', len(wheels))

# Face +X (the game's vehicles do): a quarter turn about the upright, every car.
for o in [o for o in bpy.data.objects if o.name.startswith('car_')]:
    o.rotation_euler = (0, 0, math.pi / 2)

for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))

if PREVIEW:
    # The cars in a row, their doors open, from three quarters.
    for i, o in enumerate([o for o in bpy.data.objects if o.name.startswith('car_')]):
        o.location = (0, i * 3.2, 0)
    for o in bpy.data.objects:
        if '_door_' in o.name and o.type == 'EMPTY':
            d = next(d for p in plan.values() for d in p['doors'] if d['name'] == o.name)
            o.rotation_euler = (0, 0, d['open'] * math.radians(65))
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x = 1400
    sc.render.resolution_y = 700
    wd = bpy.data.worlds.new('w')
    sc.world = wd
    wd.use_nodes = True
    wd.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sc.collection.objects.link(sun)
    sun.rotation_euler = (0.7, 0.2, 2.2)
    sun.data.energy = 3
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    for view, at in (('front', (9, -6, 4)), ('side', (-2, 4.8, 9))):
        cam.location = at
        d = mathutils.Vector((0, 4.8, 0.7)) - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'cars_{view}.png')
        bpy.ops.render.render(write_still=True)
    for o in bpy.data.objects:
        if o.name.startswith('car_'):
            o.location = (0, 0, 0)
        if '_door_' in o.name and o.type == 'EMPTY':
            o.rotation_euler = (0, 0, 0)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=80, export_apply=True)
with open(PLAN_OUT, 'w') as f:
    json.dump(plan, f, indent=1)
print('EXPORTED', OUT, os.path.getsize(OUT))
