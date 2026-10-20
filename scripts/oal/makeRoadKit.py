# One Africa Life: the road up-country, for the game to drive along (public/oal/road-kit.v1.glb).
# Three stretches of a laterite road, each 120 m along X, its ends matching, so the game lays
# them one after another and moves them past the car: red earth, puddled and rutted, its
# shoulders grassy, bush and palms behind, banana plants and the odd house of mud brick and
# zinc by the road, a power pole here and there. Each stretch is one object named stretch_<n>
# (its one-off meshes merged; the palms and trees shared), centred on X = 0.
#
#   blender -b --factory-startup --python scripts/oal/makeRoadKit.py -- <out.glb>
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenekit as kit  # noqa: E402
from scenekit import box, flat, photo, srgb  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]
LENGTH = 120.0
ROAD = 7.0
kit.REAL_MODELS = False

bpy.ops.wm.read_factory_settings(use_empty=True)
m_road = photo('laterite_road', 'red_dirt_mud_01', scale=3.0, mul=(1.0, 0.8, 0.66), streaks=0)
m_bank = photo('laterite_bank', 'red_laterite_soil_stones', scale=3.0, mul=(0.95, 0.75, 0.6), streaks=0)
m_grass = kit.lawn('bush_grass', 2.0, (0.5, 0.62, 0.36))
m_grass_dry = kit.lawn('bush_grass_dry', 2.0, (0.66, 0.62, 0.38))
m_mud = photo('mud_wall', 'red_dirt_mud_01', scale=2.0, mul=(0.85, 0.65, 0.5), streaks=0.3)
m_zinc = photo('zinc_rust', 'rusty_corrugated_iron', scale=2.0, metallic=0.3, streaks=0)
m_wood = flat('pole_wood', (0.15, 0.11, 0.08), 0.9)
m_dark = flat('doorway', (0.04, 0.035, 0.03), 0.9)
m_puddle = flat('puddle', (0.12, 0.1, 0.08), 0.08)


def strip(name, y0, y1, mat, z0=0.0, z1=0.0, steps=24, wobble=0.0, rng=random):
    """A band along the stretch from y0 to y1 across, sloping from z0 to z1, a little uneven."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rows = []
    for k in range(steps + 1):
        x = -LENGTH / 2 + LENGTH * k / steps
        # The ends are left straight, so stretches meet.
        w = 0 if k in (0, steps) else rng.uniform(-wobble, wobble)
        rows.append((bm.verts.new((x, y0 + w, z0)), bm.verts.new((x, y1 + w, z1))))
    for (a0, b0), (a1, b1) in zip(rows, rows[1:]):
        f = bm.faces.new((a0, a1, b1, b0))
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
    return kit.new_object(name, bm, [mat])


def house(at, yaw):
    """A small house of mud brick under a zinc roof, a dark doorway to the road."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    w, d, h = random.uniform(5, 7), random.uniform(4, 5), 2.6
    box(bm, uv, (at.x, at.y, 0), (w, d, h), yaw, mat=0)
    box(bm, uv, (at.x, at.y, h), (w + 0.8, d + 0.8, 0.08), yaw, mat=1, pitch=0.18)
    c, s = math.cos(yaw), math.sin(yaw)
    door = Vector((at.x - s * (d / 2 + 0.02), at.y + c * (d / 2 + 0.02)))
    box(bm, uv, (door.x, door.y, 0), (1.0, 0.05, 2.0), yaw, mat=2)
    return kit.new_object('house', bm, [m_mud, m_zinc, m_dark])


def bush_picture(path, seed):
    """The bush as a picture (an impostor): a thick band of trees, palms and bananas rendered
    side on, against nothing, cut out by its alpha. Lined along the road as walls of bush, it
    looks like forest for the cost of a few flat faces."""
    if os.path.exists(path):
        return
    scene = bpy.context.scene
    before = set(bpy.data.objects)
    rng = random.Random(seed)
    for _ in range(70):
        x, y = rng.uniform(-28, 28), rng.uniform(0, 12)
        r = rng.random()
        if r < 0.35:
            kit.palm((x, y), rng)
        elif r < 0.75:
            kit.thing('shade_tree', (x, y), rng.uniform(0, 6.3), rng.uniform(0.7, 1.4), name='tree')
        else:
            kit.thing('banana_clump', (x, y), rng.uniform(0, 6.3), rng.uniform(0.9, 1.5), name='banana')
    kit.daylight(sun_elevation=50, sun_heading=200)
    cam_data = bpy.data.cameras.new('bush_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 60
    cam = bpy.data.objects.new('bush_cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -60, 7.5)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = 2048, 512
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = path
    # Brighter than a picture would be: the game lights the walls again, and the bush should read
    # as green, not as shadow.
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.exposure = 1.3
    bpy.ops.render.render(write_still=True)
    scene.view_settings.exposure = 0.0
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o)
    scene.render.film_transparent = False


BUSH = [os.path.join(kit.TEX, f'roadside_bush_{k}.png') for k in range(2)]
for k, p in enumerate(BUSH):
    bush_picture(p, 40 + k)
m_bush = []
for k, p in enumerate(BUSH):
    m = bpy.data.materials.new(f'bush_wall_{k}')
    m.use_nodes = True
    nt = m.node_tree
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(p)
    b = nt.nodes['Principled BSDF']
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    rnd = nt.nodes.new('ShaderNodeMath')
    rnd.operation = 'ROUND'
    nt.links.new(t.outputs['Alpha'], rnd.inputs[0])
    nt.links.new(rnd.outputs['Value'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.9
    m.surface_render_method = 'DITHERED'
    m_bush.append(m)


def bush_wall(y, height, k, shift):
    """A wall of the bush picture along the stretch at y, 60 m a picture (two to a stretch)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    for i in range(2):
        x0 = -LENGTH / 2 + i * 60
        f = bm.faces.new([bm.verts.new(v) for v in ((x0, y, 0), (x0 + 60, y, 0), (x0 + 60, y, height), (x0, y, height))])
        for loop, (u, v) in zip(f.loops, ((shift, 0), (shift + 1, 0), (shift + 1, 1), (shift, 1))):
            loop[uv].uv = (u, v)
    return kit.new_object('bush_wall', bm, [m_bush[k]])


def stretch(n):
    random.seed(100 + n)
    made_before = set(bpy.data.objects)
    strip('road', -ROAD / 2, ROAD / 2, m_road, 0.0, 0.0)
    for side in (1, -1):
        # The road's raised edge, then grass to the bush.
        strip('bank', side * ROAD / 2, side * (ROAD / 2 + 1.2), m_bank, 0.0, 0.08, wobble=0.3)
        strip('verge', side * (ROAD / 2 + 1.2), side * 40.0, random.choice([m_grass, m_grass_dry]), 0.08, 0.1, wobble=0.6)
    # Puddles in the ruts.
    bm = bmesh.new()
    bm.loops.layers.uv.new()
    for _ in range(random.randint(2, 5)):
        x, y = random.uniform(-55, 55), random.uniform(-2.5, 2.5)
        r = random.uniform(0.6, 1.8)
        ring = [bm.verts.new((x + math.cos(a / 10 * 2 * math.pi) * r * random.uniform(0.6, 1.1), y + math.sin(a / 10 * 2 * math.pi) * r * 0.5, 0.012)) for a in range(10)]
        bm.faces.new(ring)
    kit.new_object('puddles', bm, [m_puddle])
    # The bush: walls of it behind (pictures), trees and palms in front of them (models); a
    # house or two near the road.
    for side in (1, -1):
        for depth, height, k in ((14, 15, n % 2), (22, 17, (n + 1) % 2), (32, 19, n % 2)):
            bush_wall(side * (depth + random.uniform(-1, 1)), height, k, 0.0)
    for _ in range(18):
        x = random.uniform(-LENGTH / 2 + 2, LENGTH / 2 - 2)
        side = random.choice([1, -1])
        y = side * random.uniform(ROAD / 2 + 3, 13)
        r = random.random()
        if r < 0.45:
            kit.palm((x, y))
        elif r < 0.7:
            kit.thing('shade_tree', (x, y), random.uniform(0, 6.3), random.uniform(0.8, 1.2), name='tree')
        else:
            kit.thing('banana_clump', (x, y), random.uniform(0, 6.3), random.uniform(0.8, 1.2), name='banana')
    for _ in range(random.randint(0, 2)):
        side = random.choice([1, -1])
        at = Vector((random.uniform(-45, 45), side * random.uniform(ROAD / 2 + 6, ROAD / 2 + 9)))
        house(at, 0.0 if side < 0 else math.pi)
    # A wooden power pole at the roadside.
    if random.random() < 0.6:
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        x = random.uniform(-50, 50)
        box(bm, uv, (x, ROAD / 2 + 2.0, 0), (0.24, 0.24, 9.0))
        box(bm, uv, (x, ROAD / 2 + 2.0, 8.2), (0.1, 1.6, 0.1))
        kit.new_object('pole', bm, [m_wood])
    objs = set(bpy.data.objects) - made_before
    root = bpy.data.objects.new(f'stretch_{n}', None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o.type in ('MESH', 'EMPTY') and o.parent is None:
            o.parent = root
    return root


roots = [stretch(n) for n in range(3)]
# The library of hidden originals goes; one-off meshes in each stretch are merged.
lib = bpy.data.collections.get('library')
if lib:
    for c in list(lib.children_recursive) + [lib]:
        for o in list(c.objects):
            if o.users_collection == (c,) and not any(o.data is x.data for x in bpy.context.scene.objects if x.parent in roots):
                bpy.data.objects.remove(o)
        bpy.data.collections.remove(c)
for root in roots:
    alone = [o for o in root.children if o.type == 'MESH' and o.data.users == 1]
    if len(alone) > 1:
        for o in bpy.context.scene.objects:
            o.select_set(o in alone)
        bpy.context.view_layer.objects.active = alone[0]
        bpy.ops.object.join()
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=78, export_apply=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
