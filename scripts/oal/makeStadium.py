# One Africa Life: the Samuel Kanyon Doe Sports Complex, Paynesville, Monrovia, in 3D, from
# OpenStreetMap.
#
#   blender -b --factory-startup --python scripts/oal/makeStadium.py -- <osm.json> <out dir>
#   STADIUM_EXPORT=<path>.glb ...: the game's copy (and <path>.json, its plan) instead of pictures
#
# The map (© OpenStreetMap contributors, ODbL) gives the stadium's outline, its pitch, the
# training pitch, tennis courts and pools of the complex, the ring road round it, ELWA Road and
# the streets and houses outside. What a map does not say is drawn from how SKD is: an oval bowl
# of concrete terraces, painted in the flag's red, white and blue, rising from an athletics track
# round the pitch; a covered main stand on the west side; four floodlight towers; tunnels
# through the stands onto the pitch; the gate on the ring road, its name over it. Built from
# scenekit.py and town.py.
import json
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
from town import Town  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OSM, OUT = args[0], os.path.expanduser(args[1])
EXPORT = os.environ.get('STADIUM_EXPORT')
kit.REAL_MODELS = not EXPORT
os.makedirs(OUT, exist_ok=True)
random.seed(31)
RADIUS = 200
REACH = 170.0

data = json.load(open(OSM))
probe = Town(data, 6.2570378, -10.7020772, RADIUS)
stadium_way = next(w for w in probe.ways if w.get('tags', {}).get('leisure') == 'stadium')
c = sum(probe.way_points(stadium_way), Vector((0, 0))) / len(stadium_way['nodes'])
lat0 = 6.2570378 + c.y / 111_320.0
lon0 = -10.7020772 + c.x / probe.m_lon
town = Town(data, lat0, lon0, RADIUS)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
m = town.materials()
m_lawn = kit.lawn('pitch_grass', 2.5, (0.62, 0.78, 0.46))
m_lawn_dark = kit.lawn('pitch_grass_dark', 2.5, (0.5, 0.66, 0.38))
m_track = flat('track', srgb('#9a3a2a'), 0.9)
m_line = flat('line_white', (0.92, 0.92, 0.9), 0.6)
m_concrete = photo('terrace', 'brushed_concrete', scale=3.0, mul=(0.78, 0.77, 0.74), streaks=0.6)
SEATS = [flat('seat_red', srgb('#bf0a30'), 0.6), flat('seat_white', (0.9, 0.9, 0.9), 0.6), flat('seat_blue', srgb('#002868'), 0.6)]
m_steel = flat('stadium_steel', (0.55, 0.56, 0.58), 0.4, 0.8)
m_roof = photo('stand_roof', 'corrugated_iron_02', scale=3.0, metallic=0.5, mul=(1.3, 1.3, 1.32), streaks=0)
m_dark = flat('tunnel', (0.03, 0.03, 0.03), 0.9)
m_lamp = flat('floodlight', (1.0, 0.98, 0.9), 0.3, emission=2.0)
m_pool = kit.water('pool_water', (0.1, 0.45, 0.6), scale=2.0)
m_court = flat('tennis_court', srgb('#2f6a4a'), 0.8)


def way_pts(w):
    pts = town.way_points(w)
    return pts[:-1] if len(pts) > 2 and (pts[0] - pts[-1]).length < 0.1 else pts


def flat_poly(name, pts, mat, z):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    f = bm.faces.new([bm.verts.new((p.x, p.y, z)) for p in pts])
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
    return kit.new_object(name, bm, [mat])


# ---- Ground, roads, the houses outside -----------------------------------------------------------

town.ground(m['earth'])
complex_way = next((w for w in town.ways if w.get('tags', {}).get('name') == 'Samuel Kanyon Doe Sports Complex' and 'highway' not in w.get('tags', {})), None)
if complex_way:
    flat_poly('complex_grass', way_pts(complex_way), m_lawn_dark, 0.015)
town.roads(clear=0.8)
stadium = way_pts(next(w for w in town.ways if w.get('tags', {}).get('leisure') == 'stadium'))
pitches = [w for w in town.ways if w.get('tags', {}).get('leisure') == 'pitch']
main_pitch = min(pitches, key=lambda w: (sum(way_pts(w), Vector((0, 0))) / len(way_pts(w))).length)

# The bowl: the main pitch's long axis, its size; the stadium's outline as its outer edge.
pp = way_pts(main_pitch)
pc = sum(pp, Vector((0, 0))) / len(pp)
edges = [(pp[(i + 1) % len(pp)] - pp[i]) for i in range(len(pp))]
long_edge = max(edges, key=lambda e: e.length)
AX = long_edge.normalized()
AY = Vector((-AX.y, AX.x))
half_l = max(abs((p - pc).dot(AX)) for p in pp)
half_w = max(abs((p - pc).dot(AY)) for p in pp)
yaw_pitch = math.atan2(AX.y, AX.x)
print('PITCH', round(half_l * 2, 1), 'by', round(half_w * 2, 1), 'yaw', round(math.degrees(yaw_pitch)))


def to_world(u, v):
    return pc + AX * u + AY * v


# Keep everything else off the bowl.
outer_r = max((p - pc).length for p in stadium)
for p in stadium:
    town.mark_disk(p, 2)
for u in range(-int(outer_r), int(outer_r) + 1, 2):
    for v in range(-int(outer_r), int(outer_r) + 1, 2):
        q = pc + Vector((u, v))
        if town.inside(q, stadium):
            town.mark_disk(q, 1.5)


def stadium_radius(dirn):
    """How far the stadium's outline is from the pitch's centre along a direction."""
    best = 0.0
    for i in range(len(stadium)):
        a, b = stadium[i] - pc, stadium[(i + 1) % len(stadium)] - pc
        # Ray from the origin along dirn against segment a-b.
        e = b - a
        den = dirn.x * e.y - dirn.y * e.x
        if abs(den) < 1e-9:
            continue
        t = (a.x * e.y - a.y * e.x) / den
        s = (a.x * dirn.y - a.y * dirn.x) / den
        if t > 0 and 0 <= s <= 1:
            best = max(best, t)
    return best or outer_r


# ---- The pitch: mown in stripes, its markings, the goals; the track round it ----------------------

PL, PW = half_l, half_w
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
stripes = 12
for k in range(stripes):
    u0 = -PL + 2 * PL * k / stripes
    u1 = -PL + 2 * PL * (k + 1) / stripes
    f = bm.faces.new([bm.verts.new((*to_world(u, v), 0.03)) for u, v in ((u0, -PW), (u1, -PW), (u1, PW), (u0, PW))])
    f.material_index = k % 2
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
kit.new_object('pitch', bm, [m_lawn, m_lawn_dark])
# Markings: touchlines, goal lines, the halfway line, the centre circle, the boxes.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()


def line(u0, v0, u1, v1, w=0.12):
    a, b = to_world(u0, v0), to_world(u1, v1)
    d = b - a
    mid = (a + b) / 2
    box(bm, uv, (mid.x, mid.y, 0.035), (d.length + w, w, 0.01), math.atan2(d.y, d.x))


IL, IW = PL - 2.0, PW - 2.0
for v in (-IW, IW):
    line(-IL, v, IL, v)
for u in (-IL, IL, 0):
    line(u, -IW, u, IW)
for k in range(32):
    a0, a1 = k / 32 * 2 * math.pi, (k + 1) / 32 * 2 * math.pi
    line(math.cos(a0) * 9.15, math.sin(a0) * 9.15, math.cos(a1) * 9.15, math.sin(a1) * 9.15)
for side in (-1, 1):
    for depth, half in ((16.5, 20.15), (5.5, 9.16)):
        line(side * IL, -half, side * (IL - depth), -half)
        line(side * IL, half, side * (IL - depth), half)
        line(side * (IL - depth), -half, side * (IL - depth), half)
kit.new_object('markings', bm, [m_line])
# The goals.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for side in (-1, 1):
    for v in (-3.66, 3.66):
        q = to_world(side * IL, v)
        box(bm, uv, (q.x, q.y, 0), (0.12, 0.12, 2.44), yaw_pitch)
    q = to_world(side * IL, 0)
    box(bm, uv, (q.x, q.y, 2.38), (0.12, 7.44, 0.12), yaw_pitch)
kit.new_object('goals', bm, [m_line])
# The athletics track round the pitch (8 lanes, 1.22 m each, its bends round the pitch's ends).
TRACK_IN = (PW + 1.5, PL + 1.5)
lanes_w = 8 * 1.22
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
ring_in, ring_out = [], []
steps = 72
for k in range(steps):
    a = k / steps * 2 * math.pi
    d = Vector((math.cos(a), math.sin(a)))
    # A rounded rectangle: the straight sides along the pitch, round ends.
    u = (PL + 1.5) * d.x
    v = (PW + 1.5) * d.y
    ring_in.append(to_world(u, v))
    ring_out.append(to_world(u + d.x * lanes_w, v + d.y * lanes_w))
vi = [bm.verts.new((*p, 0.025)) for p in ring_in]
vo = [bm.verts.new((*p, 0.025)) for p in ring_out]
for k in range(steps):
    j = (k + 1) % steps
    f = bm.faces.new((vi[k], vi[j], vo[j], vo[k]))
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
kit.new_object('track', bm, [m_track])

# ---- The stands: terraces from the track's edge to the stadium's outline, tunnels on the axes -----

TIERS = 14
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
seat_bm = bmesh.new()
seat_uv = seat_bm.loops.layers.uv.new()
STAND_STEPS = 96
inner_pts, outer_pts = [], []
for k in range(STAND_STEPS):
    a = k / STAND_STEPS * 2 * math.pi
    d = Vector((math.cos(a), math.sin(a)))
    u = (PL + 1.5 + lanes_w + 1.0) * d.x
    v = (PW + 1.5 + lanes_w + 1.0) * d.y
    inner = to_world(u, v)
    dirn = (inner - pc).normalized()
    outer = pc + dirn * max(stadium_radius(dirn), (inner - pc).length + 12)
    inner_pts.append(inner)
    outer_pts.append(outer)


def tunnel(k):
    """The tunnels: through the stands on the pitch's two axes (four ways in)."""
    return any(abs(((k - q) + STAND_STEPS / 2) % STAND_STEPS - STAND_STEPS / 2) < 1.2 for q in (0, STAND_STEPS / 4, STAND_STEPS / 2, 3 * STAND_STEPS / 4))


for k in range(STAND_STEPS):
    j = (k + 1) % STAND_STEPS
    if tunnel(k):
        continue
    for t in range(TIERS):
        f0, f1 = t / TIERS, (t + 1) / TIERS
        z0, z1 = 0.6 + t * 0.55, 0.6 + (t + 1) * 0.55
        a0 = inner_pts[k].lerp(outer_pts[k], f0)
        b0 = inner_pts[j].lerp(outer_pts[j], f0)
        a1 = inner_pts[k].lerp(outer_pts[k], f1)
        b1 = inner_pts[j].lerp(outer_pts[j], f1)
        # The step's tread and riser.
        tread = bm.faces.new([bm.verts.new(v) for v in ((*a0, z1), (*b0, z1), (*b1, z1), (*a1, z1))])
        riser = bm.faces.new([bm.verts.new(v) for v in ((*a0, z0), (*b0, z0), (*b0, z1), (*a0, z1))])
        for f in (tread, riser):
            for loop in f.loops:
                loop[uv].uv = (loop.vert.co.x + loop.vert.co.z, loop.vert.co.y + loop.vert.co.z)
        # A row of seats along the tread's front, the flag's colours in blocks.
        colour = (k // 8) % 3
        mid = (a0.lerp(a1, 0.35) + b0.lerp(b1, 0.35)) / 2
        along = b0 - a0
        sf = seat_bm.faces.new([seat_bm.verts.new(v) for v in ((*(mid - along * 0.48 + (a1 - a0) * 0.0), z1 + 0.42), (*(mid + along * 0.48), z1 + 0.42), (*(mid + along * 0.48 + (a1 - a0).normalized() * 0.4), z1 + 0.42), (*(mid - along * 0.48 + (a1 - a0).normalized() * 0.4), z1 + 0.42))])
        sf.material_index = colour
    # The back wall of the stand.
    top = 0.6 + TIERS * 0.55
    f = bm.faces.new([bm.verts.new(v) for v in ((*outer_pts[k], 0), (*outer_pts[j], 0), (*outer_pts[j], top + 1.2), (*outer_pts[k], top + 1.2))])
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x + loop.vert.co.y, loop.vert.co.z)
    # The front wall, the track's edge.
    f = bm.faces.new([bm.verts.new(v) for v in ((*inner_pts[k], 0), (*inner_pts[j], 0), (*inner_pts[j], 0.6 + 0.55), (*inner_pts[k], 0.6 + 0.55))])
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x + loop.vert.co.y, loop.vert.co.z)
    # Solid, to walk against: the stand's footprint between inner and outer edges.
    town.solids.append([[round(p.x, 2), round(p.y, 2)] for p in (inner_pts[k], inner_pts[j], outer_pts[j], outer_pts[k])])
kit.new_object('stands', bm, [m_concrete])
kit.new_object('seats', seat_bm, SEATS)

# The covered main stand: a steel roof over the west side's middle (the side away from the sun).
west = min(range(STAND_STEPS), key=lambda k: (outer_pts[k] - pc).dot(AY) if True else 0)
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
span = 12
for dk in range(-span, span):
    k = (west + dk) % STAND_STEPS
    j = (k + 1) % STAND_STEPS
    top = 0.6 + TIERS * 0.55
    a_out, b_out = outer_pts[k], outer_pts[j]
    a_in, b_in = inner_pts[k].lerp(outer_pts[k], 0.15), inner_pts[j].lerp(outer_pts[j], 0.15)
    f = bm.faces.new([bm.verts.new(v) for v in ((*a_out, top + 6.5), (*b_out, top + 6.5), (*b_in, top + 4.0), (*a_in, top + 4.0))])
    f.material_index = 0
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
    if dk % 3 == 0:
        box(bm, uv, (a_out.x, a_out.y, 0), (0.4, 0.4, top + 6.5), mat=1)
kit.new_object('main_stand_roof', bm, [m_roof, m_steel])

# Four floodlight towers, at the bowl's corners.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for su in (-1, 1):
    for sv in (-1, 1):
        dirn = (AX * su * PL + AY * sv * PW).normalized()
        q = pc + dirn * (stadium_radius(dirn) + 6)
        box(bm, uv, (q.x, q.y, 0), (1.2, 1.2, 34.0), mat=0)
        box(bm, uv, (q.x, q.y, 34.0), (5.0, 1.0, 3.0), math.atan2(dirn.y, dirn.x) + math.pi / 2, mat=1)
        town.solid_box(q, 1.4, 1.4, 0.0)
        town.mark_disk(q, 3)
kit.new_object('floodlights', bm, [m_steel, m_lamp])

# ---- The rest of the complex: the training pitch, tennis courts, pools ----------------------------

for w in pitches:
    if w is main_pitch:
        continue
    pts = way_pts(w)
    flat_poly('court' if w.get('tags', {}).get('sport') == 'tennis' else 'training_pitch', pts, m_court if w.get('tags', {}).get('sport') == 'tennis' else m_lawn, 0.03)
for w in town.ways:
    if w.get('tags', {}).get('leisure') == 'swimming_pool':
        pts = way_pts(w)
        flat_poly('pool', pts, m_pool, -0.2)
        town.solids.append([[round(p.x, 2), round(p.y, 2)] for p in pts])

town.buildings(lambda tags, area, big: random.choices([1, 2], [0.8, 0.2])[0], keep=lambda tags, cen: not town.inside(cen, stadium))

# ---- The gate on the ring road, its name over it; the ticket window -------------------------------

east_tunnel = 0
gate_dir = AX if (to_world(PL, 0) - pc).dot(AX) > 0 else -AX
gate = pc + gate_dir * (stadium_radius(gate_dir) + 14)
yaw_g = math.atan2(gate_dir.y, gate_dir.x) + math.pi / 2
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
side = Vector((-gate_dir.y, gate_dir.x))
for s in (-1, 1):
    q = gate + side * s * 5.5
    box(bm, uv, (q.x, q.y, 0), (1.2, 1.2, 6.0), yaw_g, mat=0)
box(bm, uv, (gate.x, gate.y, 6.0), (12.4, 1.2, 1.6), yaw_g, mat=1)
booth = gate + side * 8.5
box(bm, uv, (booth.x, booth.y, 0), (3.0, 2.5, 2.8), yaw_g, mat=2)
kit.new_object('gate', bm, [m_concrete, flat('gate_blue', srgb('#002868'), 0.6), flat('booth_red', srgb('#bf0a30'), 0.6)])
kit.text('SAMUEL KANYON DOE SPORTS COMPLEX', gate - gate_dir * 0.63, kit.facing(-gate_dir), 0.55, '#f4efe2', 6.45)
kit.text('TICKETS', booth - gate_dir * 1.28, kit.facing(-gate_dir), 0.3, '#f4efe2', 2.2)
for s in (-1, 1):
    town.solid_box(gate + side * s * 5.5, 1.3, 1.3, yaw_g)
town.solid_box(booth, 3.1, 2.6, yaw_g)
town.place('tickets', booth + gate_dir * 2.0, -gate_dir)
# In the stands: a seat on the main side, looking at the pitch; on the pitch, by the halfway line.
seat_k = (west + 2) % STAND_STEPS
seat_at = inner_pts[seat_k].lerp(outer_pts[seat_k], 0.3)
town.place('stand', seat_at, (pc - seat_at).normalized())
town.place('pitch', to_world(0, -PW + 3), AY)

trees = town.trees(45, near_road=10, mix=(0.6, 0.15, 0.25), keep=lambda p: not town.inside(p, stadium) and (p - pc).length > outer_r + 4)
patches = town.grass(120, keep=lambda p: not town.inside(p, stadium))
print('TREES', trees, 'GRASS', patches, 'places', sorted(town.places))

# Where the game starts: by the gate, facing it.
spawn = gate + gate_dir * 10

if EXPORT:
    root = bpy.data.objects.new('stadium', None)
    scene.collection.objects.link(root)

    def far(o):
        if o.type not in ('MESH', 'FONT'):
            return False
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        cx = sum(c.x for c in cs) / 8
        cy = sum(c.y for c in cs) / 8
        span_ = max(max(c.x for c in cs) - min(c.x for c in cs), max(c.y for c in cs) - min(c.y for c in cs))
        return span_ < 60 and math.hypot(cx, cy) > REACH + 15

    kit.game_export(root, None, far, EXPORT, os.path.join(OUT, 'stadium_game.blend'), merge=True)
    plan = {
        'frame': 'x east, y north, metres from the middle of the Samuel Kanyon Doe stadium',
        'centre': [lat0, lon0],
        'reach': REACH,
        'pitch': {'x': round(pc.x, 2), 'y': round(pc.y, 2), 'axis': [round(AX.x, 3), round(AX.y, 3)], 'half': [round(PL, 2), round(PW, 2)]},
        'spawn': {'x': round(spawn.x, 2), 'y': round(spawn.y, 2), 'face': [round(-gate_dir.x, 3), round(-gate_dir.y, 3)]},
        'places': town.places,
        'solids': [poly for poly in town.solids if min(math.hypot(x, y) for x, y in poly) < REACH + 5],
    }
    with open(EXPORT.replace('.glb', '.json'), 'w') as f:
        json.dump(plan, f, separators=(',', ':'))
    print('EXPORTED', EXPORT, os.path.getsize(EXPORT), 'solids', len(plan['solids']), 'places', sorted(town.places))
    sys.exit(0)

# ---- Light and pictures -------------------------------------------------------------------------

kit.daylight(sun_elevation=45, sun_heading=230)
cam, aim = kit.render_setup(samples=48)


def v3(p, z):
    return (p.x, p.y, z)


views = {
    'skd_above': (v3(pc - AY * 260 - AX * 120, 120), v3(pc, 0), 30),
    'skd_stand': (v3(seat_at, 0.6 + TIERS * 0.55 * 0.3 + 1.6), v3(pc + AX * 10, 0.5), 30),
    'skd_gate': (v3(gate + gate_dir * 30, 1.7), v3(gate, 4), 30),
}
ONLY = os.environ.get('STADIUM_VIEWS', '').split(',') if os.environ.get('STADIUM_VIEWS') else None
for name, (at, look, lens) in views.items():
    if ONLY and name not in ONLY:
        continue
    kit.shoot(cam, aim, OUT, name, at, look, lens)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'skd.blend'))
