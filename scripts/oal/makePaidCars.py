# One Africa Life: the town's cars (public/oal/cars.v2.glb and src/games/oal/carsPlan.v2.json),
# from the owner's car pack (art-src/one-africa-life/cars/paid/scene.blend: an SUV coupe as a
# private car, a taxi and a police car, each with its inside and without it): at full quality,
# their parts named as the game moves them (the wheels, each on a pivot at its middle: turned as
# it rolls, the front two steered; the doors and the boot on their hinges; the steering wheel;
# the dashboard's needles), facing +X (as the game's vehicles do), their wheels on the ground.
# What does not move is joined by material (fewer to draw, nothing lost). The ones without their
# inside are kept for far off (nobody sees in from there).
#
#   blender -b art-src/one-africa-life/cars/paid/scene.blend --python scripts/oal/makePaidCars.py -- <out.glb> <plan.json>
import json
import math
import os
import sys

import bpy
import mathutils

OUT, PLAN_OUT = sys.argv[sys.argv.index('--') + 1:][:2]

CARS = {
    'Private Car': 'suv',
    'Private Car No Interior': 'suv_far',
    'Taxi Car': 'suv_taxi',
    'Police Car': 'suv_police',
    'Taxi Car No Interior': 'suv_taxi_far',
    'Police Car No Interior': 'suv_police_far',
}
# The pack's moving parts (their names start so), as the game calls them.
PARTS = {
    'Left Front Door': 'door_fl',
    'Right Front Door': 'door_fr',
    'Left Back Door': 'door_rl',
    'Right Back Door': 'door_rr',
    'Car Trunk': 'trunk',
    'Steering Wheel': 'steer',
    'speed pointer': 'speedo',
    'RPM Pointer': 'rpm',
    'Left Windshield wiper': 'wiper_l',
    'Right Windshiled Wiper': 'wiper_r',
}
TYRES = {'Left Front Tire': 'fl', 'Right Front Tire': 'fr', 'Left Back Tire': 'rl', 'Right Back Tire': 'rr'}

scene = bpy.context.scene
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA') or o.name == 'Cube':
        bpy.data.objects.remove(o)


def base_name(name):
    return name.split('.')[0]


def world_bounds(objs):
    lo = mathutils.Vector((1e9,) * 3)
    hi = -lo
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


def game(v):
    """A point (Blender, the car facing -Y, its left +X) in the game's car frame: x ahead, y up, z to its right."""
    return [round(-v.y, 3), round(v.z, 3), round(-v.x, 3)]


def keep_parent(child, parent):
    m = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = m


# The private car: the taxi's body (its panels in a paint of their own) without its sign on the
# roof, its paint plain (painted in the game). Copied, with every part, from the taxi.
def copy_tree(root, name):
    made = {}
    for o in [root] + list(root.children_recursive):
        c = o.copy()
        if o.data:
            c.data = o.data.copy()
        scene.collection.objects.link(c)
        made[o] = c
    for o, c in made.items():
        if o.parent in made:
            c.parent = made[o.parent]
            c.matrix_parent_inverse = o.matrix_parent_inverse.copy()
    made[root].name = name
    return made[root]


paint = bpy.data.materials.new('paint')
paint.use_nodes = True
pb = paint.node_tree.nodes['Principled BSDF']
pb.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
pb.inputs['Metallic'].default_value = 0.35
pb.inputs['Roughness'].default_value = 0.22
for taxi, private in (('Taxi Car', 'Private Car'), ('Taxi Car No Interior', 'Private Car No Interior')):
    root = copy_tree(bpy.data.objects[taxi], private)
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        for i, m in enumerate(o.data.materials):
            if m and m.name.startswith('Taxi Body'):
                o.data.materials[i] = paint
        # The sign on its roof: what stands above the roof's line.
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(o.data)
        W = o.matrix_world
        roofSign = [f for f in bm.faces if (W @ f.calc_center_median()).z > 1.125]
        if roofSign:
            bmesh.ops.delete(bm, geom=roofSign, context='FACES')
            bm.to_mesh(o.data)
        bm.free()

plan = {}
for src_name, name in CARS.items():
    src = bpy.data.objects[src_name]
    meshes = [o for o in src.children_recursive if o.type == 'MESH']
    lo, hi = world_bounds(meshes)
    ground = lo.z
    top = bpy.data.objects.new(f'car_{name}', None)
    scene.collection.objects.link(top)
    # Its wheels on the ground, its middle (front to back) over the origin.
    src.location = (0, -(lo.y + hi.y) / 2, -ground)
    bpy.context.view_layer.update()
    keep_parent(src, top)
    moving = set()
    parts = {}
    for o in list(src.children_recursive):
        b = base_name(o.name)
        if b in PARTS:
            o.name = f'{name}_{PARTS[b]}'
            parts[PARTS[b]] = o
            moving.add(o)
            moving.update(o.children_recursive)
    # The wheels: each on a pivot at its middle (steered about the upright, rolled about its axle).
    wheels = {}
    for o in list(src.children_recursive):
        b = base_name(o.name)
        if b in TYRES and o.type == 'MESH':
            key = TYRES[b]
            wl, wh = world_bounds([o])
            centre = (wl + wh) / 2
            pivot = bpy.data.objects.new(f'{name}_wheel_{key}', None)
            scene.collection.objects.link(pivot)
            pivot.location = centre
            bpy.context.view_layer.update()
            keep_parent(pivot, src)
            keep_parent(o, pivot)
            o.name = f'{name}_tyre_{key}'
            moving.add(o)
            wheels[key] = {'node': pivot.name, 'at': game(centre - mathutils.Vector((0, 0, 0))), 'r': round((wh.z - wl.z) / 2, 3)}
    # What does not move, joined by its material (fewer to draw).
    statics = [o for o in src.children_recursive if o.type == 'MESH' and o not in moving]
    by_mat = {}
    for o in statics:
        key = tuple(m.name for m in o.data.materials if m)
        by_mat.setdefault(key, []).append(o)
    for i, group in enumerate(by_mat.values()):
        for o in group:
            keep_parent(o, src)
        if len(group) > 1:
            with bpy.context.temp_override(active_object=group[0], selected_editable_objects=group, selected_objects=group):
                bpy.ops.object.join()
        group[0].name = f'{name}_body{i}'
    print(name, 'joined into', len(by_mat), 'from', len(statics))
    # Where the driver sits: behind the steering wheel, on the seat.
    steer = parts.get('steer')
    sw = steer.matrix_world.translation if steer else mathutils.Vector((0.36, -0.54, 0.54 - ground))
    driver = mathutils.Vector((sw.x, sw.y + 0.62, sw.z - 0.62))
    doors = []
    for key in ('door_fl', 'door_fr', 'door_rl', 'door_rr'):
        if key in parts:
            left = key.endswith('l')
            doors.append({'name': parts[key].name, 'side': 'left' if left else 'right', 'front': key[5] == 'f', 'open': -1 if left else 1, 'at': game(parts[key].matrix_world.translation)})
    L = abs(wheels['rl']['at'][0] - wheels['fl']['at'][0]) if 'rl' in wheels and 'fl' in wheels else 2.5
    plan[name] = {
        'wheels': wheels,
        'doors': doors,
        'trunk': parts['trunk'].name if 'trunk' in parts else None,
        'steer': parts['steer'].name if 'steer' in parts else None,
        'needles': [parts[k].name for k in ('speedo', 'rpm') if k in parts],
        'wipers': [parts[k].name for k in ('wiper_l', 'wiper_r') if k in parts],
        'driver': game(driver),
        'size': [round(hi.y - lo.y, 2), round(hi.z - lo.z, 2), round(hi.x - lo.x, 2)],
        'wheelbase': round(L, 3),
    }
    # Facing +X: a quarter turn about the upright.
    top.rotation_euler = (0, 0, math.pi / 2)
    print(name, plan[name]['size'], 'wheels', len(wheels), 'doors', len(doors), 'meshes', len([o for o in top.children_recursive if o.type == 'MESH']))

# Only the cars (the rest of the scene left out).
for o in list(bpy.data.objects):
    t = o
    while t.parent:
        t = t.parent
    if not t.name.startswith('car_'):
        bpy.data.objects.remove(o)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=92, export_apply=True)
with open(PLAN_OUT, 'w') as f:
    json.dump(plan, f, indent=1)
print('EXPORTED', OUT, os.path.getsize(OUT))
