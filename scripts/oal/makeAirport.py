# One Africa Life: Roberts International Airport (RIA), Liberia, in 3D, outside and in, to judge
# the look.
#
#   blender -b --factory-startup --python scripts/oal/makeAirport.py -- <osm.json> <out dir>
#
# From OpenStreetMap (© OpenStreetMap contributors, ODbL): where the terminal stands and its shape
# (a long hall, about 103 by 41 metres), its two jet bridges, the apron, the taxiways, the runway
# (04/22, 3,353 m by 46 m), the roads and car parks, the older buildings beside it. The rest is
# drawn from how the new terminal is built: two levels (arrivals below, departures above, the jet
# bridges at the upper level), glass along both long sides between white-clad ends, a flat roof
# reaching out over the kerb on slender columns, the airport's name along its edge.
#
# Inside, below (arrivals): the corridor from the planes, "Welcome to Liberia", the queue for
# immigration and its booths (an officer at a desk), the baggage hall with two carousels.
# Above (departures): check-in counters, passport control and security, the gate lounge looking
# out at the planes. Everything is placed in the terminal's own frame: u along the hall from its
# south-west end, v across it from the landside (0) to the airside (41.3).
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
from scenekit import box, cylinder, flat, photo, srgb  # noqa: E402

kit.REAL_MODELS = not os.environ.get('RIA_EXPORT')

args = sys.argv[sys.argv.index('--') + 1:]
OSM, OUT = args[0], os.path.expanduser(args[1])
os.makedirs(OUT, exist_ok=True)
random.seed(7)

data = json.load(open(OSM))
nodes = {e['id']: e for e in data['elements'] if e['type'] == 'node'}
ways = {e['id']: e for e in data['elements'] if e['type'] == 'way'}
TERMINAL, BRIDGES, APRON = 775857813, (1203832656, 1203832657), 296821319
origin = nodes[ways[BRIDGES[0]]['nodes'][0]]
LAT0, LON0 = origin['lat'], origin['lon']
M_LON = 111_320.0 * math.cos(math.radians(LAT0))


def xy(node_id):
    n = nodes[node_id]
    return Vector(((n['lon'] - LON0) * M_LON, (n['lat'] - LAT0) * 111_320.0))


# The terminal's frame, from its footprint: the long landside edge gives u, the inward normal v.
foot = [xy(n) for n in ways[TERMINAL]['nodes'][:-1]]
corner_a, corner_b = min(foot, key=lambda p: p.y), max(foot, key=lambda p: p.x)
U = (corner_b - corner_a).normalized()
V = Vector((-U.y, U.x))
LEN = (corner_b - corner_a).length
WID = max((p - corner_a).dot(V) for p in foot)
O = corner_a
YAW_T = math.atan2(U.y, U.x)
print('TERMINAL', round(LEN, 1), 'by', round(WID, 1))


def W(u, v):
    return O + U * u + V * v


def local_of(p):
    q = p - O
    return q.dot(U), q.dot(V)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
root = bpy.data.objects.new('terminal', None)
root.location = (O.x, O.y, 0)
root.rotation_euler = (0, 0, YAW_T)
scene.collection.objects.link(root)


def inside(obj):
    """Puts something made in the terminal's frame (u, v) into that frame."""
    obj.parent = root
    return obj


def mesh(name, mats):
    bm = bmesh.new()
    return bm, bm.loops.layers.uv.new(), lambda: inside(kit.new_object(name, bm, mats))


def put(col, u, v, yaw=0.0, z=0.0, scale=1.0):
    return inside(kit.place(col, (u, v), yaw, z, scale))


def sign(body, u, v, facing, size, colour, z, depth=0.0):
    return inside(kit.text(body, (u, v), kit.facing(facing), size, colour, z, depth))


# ---- Materials -----------------------------------------------------------------------------

# The owner's photographed lawn, a little dry, as airport grass is.
m_grass = kit.lawn('grass', 3.0, (0.92, 0.95, 0.78))
m_apron = photo('apron', 'brushed_concrete', scale=6.0, mul=(0.85, 0.85, 0.84), streaks=0)
m_asphalt = photo('asphalt', 'road_damaged_clean', scale=4.0, mul=(0.5, 0.5, 0.52), streaks=0)
m_paving = photo('paving', 'brushed_concrete', scale=2.0, mul=(0.95, 0.93, 0.9), streaks=0)
m_clad = photo('clad', 'rectangular_facade_tiles', scale=3.0, tint=srgb('#eef0f2'), tint_amount=0.85, streaks=0.15)
m_old = photo('old_wall', 'white_stucco', scale=3.0, tint=srgb('#e8e2d2'), tint_amount=0.9, dust=0.6)
m_terrazzo = photo('terrazzo', 'terrazzo_tiles', scale=2.0, rough_mul=0.35, streaks=0)
m_granite = photo('granite', 'granite_tile', scale=1.6, rough_mul=0.3, streaks=0)
m_ceiling = photo('ceiling', 'ceiling_interior', scale=2.4, streaks=0)
m_roof = photo('roof', 'metal_plate', scale=4.0, mul=(0.7, 0.72, 0.75), metallic=0.6, streaks=0)
m_steelplate = photo('steelplate', 'metal_plate', scale=1.0, metallic=0.8, streaks=0)
m_belt = photo('belt', 'rubber_tiles', scale=0.6, mul=(0.25, 0.25, 0.25), streaks=0)
m_glass = flat('glass', (0.55, 0.7, 0.72), 0.04, 0.0, alpha=0.18)
m_alu = flat('alu', (0.7, 0.71, 0.73), 0.3, 0.9)
m_white = flat('white', (0.88, 0.88, 0.88), 0.5)
m_blue = flat('lib_blue', srgb('#002868'), 0.5)
m_red = flat('lib_red', srgb('#bf0a30'), 0.5)
m_dark = flat('dark', (0.04, 0.04, 0.045), 0.4)
m_wood = flat('wood', srgb('#6b4a2e'), 0.6)
m_screen = flat('screen', (0.25, 0.45, 0.8), 0.2, emission=2.0)
m_light = flat('light_panel', (1.0, 0.97, 0.92), 0.5, emission=6.0)
m_sign = flat('sign_box', srgb('#0a2a5c'), 0.4)
m_yellow = flat('apron_yellow', srgb('#e8b41c'), 0.7)
m_belt_black = flat('belt_black', (0.02, 0.02, 0.02), 0.6)
m_pillar = flat('pillar', (0.75, 0.76, 0.78), 0.35, 0.7)

FLOOR1 = 5.0      # the upper (departures) floor's level
CEIL0 = 4.5       # the arrivals hall's ceiling
CEIL1 = 12.0      # the departures hall's ceiling
ROOF = 12.8       # the roof slab's underside
CANOPY = 11.0     # how far the roof reaches out over the kerb

# ---- Ground, apron, taxiways, runway, roads, car parks ------------------------------------

bm = bmesh.new()
uv = bm.loops.layers.uv.new()
G = 900
f = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in ((-G, -G), (G, -G), (G, G), (-G, G))])
for loop in f.loops:
    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
kit.new_object('grass', bm, [m_grass])


def area_face(pts, mat, z, name):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    face = bm.faces.new([bm.verts.new((p.x, p.y, z)) for p in pts])
    for loop in face.loops:
        loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
    return kit.new_object(name, bm, [mat])


def strip(pts, width, mat, z, name):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rows, along = [], 0.0
    for i, p in enumerate(pts):
        d = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        n = Vector((-d.y, d.x))
        if i:
            along += (p - pts[i - 1]).length
        rows.append((bm.verts.new((*(p + n * width / 2), z)), bm.verts.new((*(p - n * width / 2), z)), along))
    for (l0, r0, a0), (l1, r1, a1) in zip(rows, rows[1:]):
        face = bm.faces.new((l0, r0, r1, l1))
        for loop, (u_, v_) in zip(face.loops, ((width, a0), (0, a0), (0, a1), (width, a1))):
            loop[uv].uv = (u_, v_)
    return kit.new_object(name, bm, [mat])


for w in ways.values():
    t = w.get('tags', {})
    pts = [xy(n) for n in w['nodes']]
    closed = w['nodes'][0] == w['nodes'][-1] and len(pts) > 3
    if min(p.length for p in pts) > 1500:
        continue
    if t.get('aeroway') == 'apron' or (t.get('aeroway') == 'taxiway' and closed):
        area_face(pts[:-1], m_apron, 0.02, 'apron')
    elif t.get('aeroway') == 'taxiway':
        strip(pts, 23, m_apron, 0.02, 'taxiway')
    elif t.get('aeroway') == 'runway' and 'width' in t:
        strip(pts, float(t['width']), m_asphalt, 0.025, 'runway')
    elif t.get('amenity') == 'parking' and closed:
        area_face(pts[:-1], m_asphalt, 0.03, 'car_park')
    elif t.get('highway') in ('service', 'tertiary', 'primary', 'residential', 'unclassified', 'primary_link'):
        strip(pts, {'service': 6.0, 'tertiary': 7.5}.get(t['highway'], 7.0), m_asphalt, 0.03, 'road')

# The older airport buildings beside the new terminal: low, plastered, flat roofs.
for wid, w in ways.items():
    t = w.get('tags', {})
    if wid == TERMINAL or not ('building' in t or t.get('aeroway') == 'terminal'):
        continue
    pts = [xy(n) for n in w['nodes'][:-1]]
    c = sum(pts, Vector((0, 0))) / len(pts)
    if c.length > 600 or len(pts) < 3:
        continue
    h = 7.0 if t.get('aeroway') == 'terminal' else (9.0 if t.get('building') == 'hangar' else random.choice([3.2, 3.5, 6.4]))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    base = [bm.verts.new((p.x, p.y, 0)) for p in pts]
    top = [bm.verts.new((p.x, p.y, h)) for p in pts]
    along = 0.0
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        ln = (pts[j] - pts[i]).length
        face = bm.faces.new((base[i], base[j], top[j], top[i]))
        for loop, (u_, v_) in zip(face.loops, ((along, 0), (along + ln, 0), (along + ln, h), (along, h))):
            loop[uv].uv = (u_, v_)
        along += ln
    bm.faces.new(top).material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.new_object('old_building', bm, [m_old, m_roof])

# ---- The terminal: floors, roof, glass, ends ------------------------------------------------

bm, uv, done = mesh('floors', [m_granite, m_terrazzo, m_ceiling, m_clad])
box(bm, uv, (LEN / 2, WID / 2, 0), (LEN, WID, 0.12), mat=0)
f_mid = box(bm, uv, (LEN / 2, WID / 2, CEIL0), (LEN, WID, FLOOR1 - CEIL0), mat=1)
for f in f_mid:
    f.normal_update()
    if f.normal.z < -0.5:
        f.material_index = 2
    elif abs(f.normal.z) < 0.5:
        f.material_index = 3
# The departures hall's ceiling (a suspended one, below the roof).
box(bm, uv, (LEN / 2, WID / 2, CEIL1), (LEN, WID, 0.05), mat=2)
done()

bm, uv, done = mesh('roof', [m_roof, m_white, m_clad])
roof_faces = box(bm, uv, (LEN / 2, (WID + 1.5 - CANOPY) / 2, ROOF), (LEN + 3, WID + 1.5 + CANOPY, 0.9), mat=0)
for f in roof_faces:
    f.normal_update()
    if f.normal.z < -0.5:
        f.material_index = 1
    elif abs(f.normal.z) < 0.5:
        f.material_index = 2
# The fascia along the landside edge, deeper, where the name is.
box(bm, uv, (LEN / 2, -CANOPY - 0.3, ROOF - 0.9), (LEN + 3, 0.6, 2.4), mat=2)
done()
sign('ROBERTS INTERNATIONAL AIRPORT', LEN / 2, -CANOPY - 0.62, (0, -1), 1.35, '#0a2a5c', ROOF + 0.3, depth=0.06)
# The canopy's columns.
bm, uv, done = mesh('columns', [m_pillar])
u = 6.0
while u < LEN:
    cylinder(bm, (u, -CANOPY + 1.5, ROOF / 2), 0.28, ROOF, 0, 16)
    u += 12.0
done()

# The ends: white cladding.
bm, uv, done = mesh('ends', [m_clad])
for u in (0.0, LEN):
    box(bm, uv, (u, WID / 2, 0), (0.4, WID, ROOF), mat=0)
done()


def curtain_wall(v, gaps=()):
    """Glass from floor to roof along one long side, aluminium mullions every 1.6 m, transoms at
    the doors' height, the upper floor's edge and above; the glass casts no shadow (daylight in)."""
    bm, uv, done = mesh('mullions', [m_alu])
    u = 0.0
    while u <= LEN:
        box(bm, uv, (u, v, 0), (0.08, 0.2, ROOF), mat=0)
        u += 1.6
    for z in (0.0, 2.6, CEIL0, FLOOR1, 8.6, ROOF - 0.15):
        box(bm, uv, (LEN / 2, v, z), (LEN, 0.22, 0.12 if z not in (CEIL0,) else FLOOR1 - CEIL0), mat=0)
    done()
    bm, uv, done = mesh('glass', [m_glass])
    for (z0, z1) in ((0.0, CEIL0), (FLOOR1, ROOF)):
        # The jet bridges go in at the upper floor: openings there only.
        u0 = 0.0
        for g0, g1 in sorted(gaps if z0 > 0 else []) + [(LEN, LEN)]:
            if g0 > u0:
                box(bm, uv, ((u0 + g0) / 2, v, z0), (g0 - u0, 0.02, z1 - z0), mat=0)
            u0 = g1
    obj = done()
    obj.visible_shadow = False


bridge_u = sorted(local_of(xy(ways[b]['nodes'][0]))[0] for b in BRIDGES)
curtain_wall(0.0)
curtain_wall(WID, gaps=[(u - 1.4, u + 1.4) for u in bridge_u])

# Light inside: panels in the ceilings, and lights over each hall.
bm, uv, done = mesh('light_panels', [m_light])
for z in (CEIL0 - 0.02, CEIL1 - 0.02):
    for u in range(6, int(LEN) - 3, 6):
        for v in range(5, int(WID) - 2, 6):
            box(bm, uv, (u, v, z - 0.02), (2.4, 0.6, 0.02))
done()
for z, energy in ((CEIL0 - 0.3, 900), (CEIL1 - 0.4, 1800)):
    for u in range(10, int(LEN), 16):
        for v in (8, 20, 33):
            light = bpy.data.objects.new('hall_light', bpy.data.lights.new('hall_light', 'AREA'))
            light.data.energy = energy
            light.data.size = 6.0
            light.data.use_shadow = False
            light.data.color = (1.0, 0.97, 0.92)
            light.location = (u, v, z)
            scene.collection.objects.link(light)
            inside(light)

# ---- Arrivals (the ground floor) ------------------------------------------------------------

STAND = ['man_phone', 'man_idle', 'man_talk', 'woman_idle', 'woman_phone', 'woman_looking', 'man_argue']
SIT = ['man_sit', 'woman_sit']

# The immigration booths, across the hall, with their officers; the queue lines before them.
BOOTH_V = 24.0
booths_u = [30 + i * 5.6 for i in range(8)]
bm, uv, done = mesh('booths', [m_white, m_blue, m_glass, m_wood, m_dark])
for i, u in enumerate(booths_u):
    box(bm, uv, (u, BOOTH_V, 0.12), (2.2, 1.5, 1.05), mat=0)
    box(bm, uv, (u, BOOTH_V + 0.76, 0.75), (2.2, 0.04, 0.12), mat=1)
    box(bm, uv, (u, BOOTH_V + 0.5, 1.17), (2.0, 0.06, 0.55), mat=2)
    box(bm, uv, (u, BOOTH_V, 1.17), (2.2, 1.5, 0.04), mat=3)
    box(bm, uv, (u + 1.15, BOOTH_V - 0.2, 0.12), (0.08, 2.0, 2.0), mat=0)
    box(bm, uv, (u, BOOTH_V - 0.6, 1.2), (0.45, 0.06, 0.35), mat=4)
    # The booth's number, lit, above.
    box(bm, uv, (u, BOOTH_V + 0.2, 2.4), (0.8, 0.08, 0.45), mat=1)
done()
for i, u in enumerate(booths_u):
    sign(str(i + 1), u, BOOTH_V + 0.26, (0, 1), 0.32, '#f4efe2', 2.62)
    if i in (1, 2, 4, 6):
        put(kit.person('officer_desk'), u, BOOTH_V - 1.0, kit.facing((0, 1)), z=0.12)
put(kit.person('officer_stand'), booths_u[-1] + 3, BOOTH_V + 2.0, kit.facing((-1, 0.3)), z=0.12)

# The line across the hall at the booths: glass panels from wall to wall, broken only by the
# booths and, beside each, a gate an officer opens for the traveller they admit.
GATE_W = 1.0
barrier = []   # (u0, u1) of each glass panel run
gates = []     # (u0, u1) of each booth's gate
u0 = 0.2
for u in booths_u:
    barrier.append((u0, u - 1.1))
    gates.append((u + 1.15, u + 1.15 + GATE_W))
    u0 = u + 1.15 + GATE_W
barrier.append((u0, LEN - 0.2))
bm, uv, done = mesh('barrier', [m_glass, m_alu])
for b0, b1 in barrier:
    box(bm, uv, ((b0 + b1) / 2, BOOTH_V, 0.12), (b1 - b0, 0.04, 2.2), mat=0)
    box(bm, uv, ((b0 + b1) / 2, BOOTH_V, 2.32), (b1 - b0, 0.08, 0.06), mat=1)
done().visible_shadow = False
# Each gate its own object (gate1, gate2...), hinged at its booth's side, so the game can swing
# open the one whose officer admits the traveller.
for i, (g0, g1) in enumerate(gates):
    bm, uv, done = mesh(f'gate{i + 1}', [m_blue])
    box(bm, uv, ((g1 - g0) / 2, 0, 0), (g1 - g0 - 0.06, 0.05, 1.0), mat=0)
    done().location = (g0, BOOTH_V, 0.12)

# The sign hanging over the queue, and the welcome.
bm, uv, done = mesh('arrival_signs', [m_sign, m_white])
box(bm, uv, (51, BOOTH_V + 1.5, 3.3), (34, 0.12, 0.9), mat=0)
box(bm, uv, (51, 34.5, 2.9), (16, 0.15, 1.4), mat=1)
box(bm, uv, (51, 34.45, 2.92), (16.2, 0.12, 0.08), mat=0)
done()
sign('IMMIGRATION  ·  PASSPORT CONTROL', 51, BOOTH_V + 1.58, (0, 1), 0.48, '#f4efe2', 3.75)
sign('WELCOME TO LIBERIA', 51, 34.62, (0, 1), 0.85, '#0a2a5c', 3.75)
sign('Visitors · Liberian citizens · ECOWAS', 51, 34.62, (0, 1), 0.34, '#bf0a30', 3.15)
inside(kit.liberian_flag((booths_u[0] - 3.2, BOOTH_V + 0.6), 0, 3.4, 1.2)).location.z = 0.12

# Queue lines: posts with belts, three lanes before the booths; passengers in them. The belts
# are unhooked in the middle (a quiet day), so a traveller can walk straight to the booths.
QUEUE_GAP = (49.0, 52.0)
bm, uv, done = mesh('stanchions', [m_alu, m_blue])
for lane in range(4):
    v = BOOTH_V + 2.6 + lane * 1.4
    for u in [u for u in range(28, 76, 3)] + list(QUEUE_GAP):
        cylinder(bm, (u, v, 0.12 + 0.48), 0.03, 0.96, 0, 8, mat=0)
        cylinder(bm, (u, v, 0.13), 0.16, 0.02, 0, 12, mat=0)
    for u in range(28, 73, 3):
        a0, a1 = u, u + 3
        for g0, g1 in ((28, QUEUE_GAP[0]), (QUEUE_GAP[1], 73)):
            s0, s1 = max(a0, g0), min(a1, g1)
            if s1 > s0:
                box(bm, uv, ((s0 + s1) / 2, v, 0.95), (s1 - s0, 0.01, 0.05), mat=1)
done()
for k in range(14):
    lane = k % 3
    u = 32 + (k * 3.1) % 40
    if QUEUE_GAP[0] - 0.8 < u < QUEUE_GAP[1] + 0.8:
        u += 4.0
    v = BOOTH_V + 3.3 + lane * 1.4
    who = random.choice(STAND)
    put(kit.person(who), u, v, kit.facing((random.uniform(-0.3, 0.3), -1)), z=0.12)
    if random.random() < 0.5:
        put(kit.model('vintage_suitcase'), u + 0.5, v + 0.2, random.uniform(-0.3, 0.3), z=0.12)

# The baggage hall: two carousels, steel round a rubber belt; passengers waiting.
for cu in (36.0, 68.0):
    bm, uv, done = mesh('carousel', [m_steelplate, m_belt, m_alu])
    # A stadium shape: two half circles joined by straights; the belt round it, a steel lip
    # outside, a skirt down to the floor, an island in the middle.
    seg, half, ry = 48, 3.2, 2.6

    def ring(a, r):
        sx = half if math.cos(a) > 0 else -half
        return (cu + sx + math.cos(a) * r, 10.5 + math.sin(a) * r)

    for k in range(seg):
        a0, a1 = k / seg * 2 * math.pi, (k + 1) / seg * 2 * math.pi
        for r_in, r_out, z, mat in ((ry - 0.1, ry + 0.8, 0.6, 1), (ry + 0.8, ry + 1.05, 0.62, 0)):
            pts = [(*ring(a0, r_in), z), (*ring(a1, r_in), z), (*ring(a1, r_out), z), (*ring(a0, r_out), z)]
            bm.faces.new([bm.verts.new(p) for p in pts]).material_index = mat
        pts = [(*ring(a0, ry + 1.05), 0.12), (*ring(a1, ry + 1.05), 0.12), (*ring(a1, ry + 1.05), 0.62), (*ring(a0, ry + 1.05), 0.62)]
        bm.faces.new([bm.verts.new(p) for p in pts]).material_index = 0
    box(bm, uv, (cu, 10.5, 0.12), (2 * half + 1.6, ry * 1.2, 0.75), mat=2)
    rx = 2 * half + 2.6
    done()
    # The bags going round.
    for k in range(7):
        a = random.uniform(0, 2 * math.pi)
        q = ring(a, ry + 0.35)
        put(kit.model('vintage_suitcase'), q[0], q[1], a, z=0.62)
    for k in range(4):
        a = random.uniform(0, 2 * math.pi)
        p = Vector(ring(a, ry + 2.0))
        c = Vector(ring(a, 0))
        put(kit.person(random.choice(STAND)), p.x, p.y, kit.facing(c - p), z=0.12)
sign('BAGGAGE CLAIM  1', 36, 3.0, (0, -1), 0.5, '#0a2a5c', 3.6)
sign('BAGGAGE CLAIM  2', 68, 3.0, (0, -1), 0.5, '#0a2a5c', 3.6)
sign('EXIT  ·  TAXI  ·  CAR PARK', 51, 1.0, (0, 1), 0.42, '#0a2a5c', 3.4)

# ---- Departures (the upper floor) ---------------------------------------------------------

Z1 = FLOOR1
# Check-in: twelve counters along the hall, a lit number over each, the wall behind.
CHECK_V = 10.0
counters = [22 + i * 5.0 for i in range(12)]
bm, uv, done = mesh('checkin', [m_white, m_granite, m_blue, m_belt_black, m_dark, m_screen, m_sign])
box(bm, uv, (51, CHECK_V + 1.6, Z1), (64, 0.3, 3.2), mat=0)
box(bm, uv, (51, CHECK_V + 1.44, Z1 + 2.4), (64, 0.04, 0.35), mat=2)
for u in counters:
    box(bm, uv, (u - 0.6, CHECK_V, Z1), (1.7, 0.8, 1.05), mat=0)
    box(bm, uv, (u - 0.6, CHECK_V - 0.03, Z1 + 1.05), (1.8, 0.86, 0.04), mat=1)
    box(bm, uv, (u - 0.6, CHECK_V - 0.41, Z1 + 0.45), (1.7, 0.02, 0.12), mat=2)
    box(bm, uv, (u + 0.95, CHECK_V, Z1), (1.2, 1.0, 0.45), mat=3)
    box(bm, uv, (u - 0.6, CHECK_V + 0.1, Z1 + 1.09), (0.45, 0.05, 0.32), mat=4)
    box(bm, uv, (u - 0.6, CHECK_V + 0.07, Z1 + 1.12), (0.4, 0.02, 0.26), mat=5)
    box(bm, uv, (u, CHECK_V + 0.6, Z1 + 3.4), (1.6, 0.12, 0.6), mat=6)
done()
for i, u in enumerate(counters):
    sign(str(i + 1), u, CHECK_V + 0.53, (0, -1), 0.4, '#f4efe2', Z1 + 3.7)
    if i % 2 == 0:
        put(kit.person('officer_stand'), u - 0.6, CHECK_V + 0.85, kit.facing((0, -1)), z=Z1)
sign('CHECK-IN', 51, CHECK_V + 1.42, (0, -1), 0.3, '#f4efe2', Z1 + 2.57)
for k in range(16):
    u = random.choice(counters) - 0.6 + random.uniform(-1.0, 1.0)
    v = CHECK_V - 1.2 - random.uniform(0, 4.5)
    put(kit.person(random.choice(STAND)), u, v, kit.facing((random.uniform(-0.3, 0.3), 1)), z=Z1)
    put(kit.model('vintage_suitcase'), u + 0.5, v + 0.2, random.uniform(0, 6), z=Z1)

# Passport control and security, between check-in and the gates.
CONTROL_V = 20.0
bm, uv, done = mesh('departure_control', [m_white, m_blue, m_glass, m_belt_black, m_dark, m_alu])
for i in range(4):
    u = 40 + i * 5.0
    box(bm, uv, (u, CONTROL_V, Z1), (2.2, 1.5, 1.05), mat=0)
    box(bm, uv, (u, CONTROL_V - 0.76, Z1 + 0.75), (2.2, 0.04, 0.12), mat=1)
    box(bm, uv, (u, CONTROL_V - 0.5, Z1 + 1.05), (2.0, 0.06, 0.55), mat=2)
for u in (66.0, 74.0):
    box(bm, uv, (u, CONTROL_V, Z1), (5.0, 0.9, 0.75), mat=3)
    box(bm, uv, (u, CONTROL_V, Z1 + 0.75), (1.6, 1.0, 1.1), mat=4)
    box(bm, uv, (u + 3.5, CONTROL_V, Z1), (0.12, 0.9, 2.2), mat=5)
    box(bm, uv, (u + 3.5, CONTROL_V - 0.0, Z1 + 2.1), (0.12, 0.9, 0.12), mat=5)
    box(bm, uv, (u + 3.5, CONTROL_V + 0.0, Z1), (0.12, 0.9, 2.2), mat=5)
box(bm, uv, (55, CONTROL_V - 1.2, Z1 + 3.4), (34, 0.12, 0.9), mat=1)
done()
sign('DEPARTURES  ·  PASSPORT CONTROL  ·  SECURITY', 55, CONTROL_V - 1.27, (0, -1), 0.42, '#f4efe2', Z1 + 3.85)
for i in (0, 2):
    put(kit.person('officer_desk'), 40 + i * 5.0, CONTROL_V + 1.0, kit.facing((0, -1)), z=Z1)

# The gate lounge: rows of seats facing the planes, the gates' signs, people waiting.
for u0, gate in ((bridge_u[0], 1), (bridge_u[1], 2)):
    sign(f'GATE {gate}', u0, WID - 1.0, (0, -1), 0.7, '#0a2a5c', Z1 + 3.8)
    box_bm, box_uv, box_done = mesh('gate_sign', [m_white])
    box(box_bm, box_uv, (u0, WID - 0.9, Z1 + 3.3), (4, 0.12, 1.1))
    box_done()
for row in range(5):
    v = 26.0 + row * 2.6
    for block in range(10):
        u = 8 + block * 9.5
        if abs(u - 51) < 3:
            continue
        inside(kit.beam_seats((u, v, Z1), kit.facing((0, 1)), 6))
        if random.random() < 0.35:
            put(kit.person(random.choice(SIT)), u + random.choice([-1.2, 0, 1.2]), v - 0.05, kit.facing((0, 1)), z=Z1)
for k in range(8):
    put(kit.person(random.choice(STAND)), random.uniform(10, 95), random.uniform(37, 40), kit.facing((random.uniform(-0.5, 0.5), 1)), z=Z1)
# A café at the end of the lounge.
bm, uv, done = mesh('cafe', [m_wood, m_granite, m_dark])
box(bm, uv, (95, 32, Z1), (1.0, 7.0, 1.1), mat=0)
box(bm, uv, (95, 32, Z1 + 1.1), (1.1, 7.1, 0.05), mat=1)
box(bm, uv, (98.5, 32, Z1), (0.4, 8, 2.6), mat=2)
done()
sign('CAFÉ', 95, 35.7, (-1, 0), 0.5, '#e8b41c', Z1 + 2.4)
for k in range(5):
    put(kit.model('wooden_stool_01'), 93.6, 29.5 + k * 1.3, 0, z=Z1)

# ---- Outside: the kerb, the forecourt, taxis, flags, palms -------------------------------

bm, uv, done = mesh('forecourt', [m_paving, m_asphalt])
box(bm, uv, (LEN / 2, -CANOPY / 2 - 1.5, 0), (LEN + 20, CANOPY + 3, 0.15), mat=0)
box(bm, uv, (LEN / 2, -CANOPY - 7.0, 0), (LEN + 60, 8.0, 0.04), mat=1)
done()
for k in range(9):
    u = 10 + k * 10 + random.uniform(-2, 2)
    kit.car(W(u, -CANOPY - 5.0), YAW_T + (math.pi if k % 3 == 0 else 0), '#e9b51c' if k % 4 != 3 else random.choice(['#f0f0ee', '#202020']), 'saloon' if k % 4 != 3 else 'suv', taxi=k % 4 != 3)
for k in range(10):
    u = random.uniform(5, LEN - 5)
    v = random.uniform(-CANOPY + 1, -1.5)
    put(kit.person(random.choice(STAND + ['man_walk', 'woman_walk', 'man_carry'])), u, v, kit.facing((random.uniform(-1, 1), random.uniform(-1, 1))), z=0.15)
    if random.random() < 0.6:
        put(kit.model('vintage_suitcase'), u + 0.5, v, random.uniform(0, 6), z=0.15)
for k, u in enumerate((LEN / 2 - 8, LEN / 2, LEN / 2 + 8)):
    kit.liberian_flag(W(u, -CANOPY - 1.6), YAW_T + math.pi, 9.0, 2.2)
for k in range(12):
    p = W(-6 + k * 10.0, -CANOPY - 13.5)
    kit.palm(p)
    kit.palm(W(-12 - random.uniform(0, 30), random.uniform(-40, 40)))

# The control tower, beside the older buildings.
tower_at = W(LEN + 40, 10)
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
box(bm, uv, (tower_at.x, tower_at.y, 0), (4.5, 4.5, 22), YAW_T, mat=0)
cylinder(bm, (tower_at.x, tower_at.y, 22 + 2.0), 4.2, 4.0, 0, 8, mat=1)
cylinder(bm, (tower_at.x, tower_at.y, 26.3), 4.8, 0.6, 0, 8, mat=0)
cylinder(bm, (tower_at.x, tower_at.y, 21.8), 4.6, 0.5, 0, 8, mat=0)
kit.new_object('tower', bm, [m_white, flat('tower_glass', (0.05, 0.08, 0.1), 0.05, 0.3)])

# ---- The apron: the jet bridges, the planes, lines, ground vehicles ---------------------

m_bridge = flat('bridge', (0.72, 0.73, 0.75), 0.4, 0.6)
m_bridge_glass = flat('bridge_glass', (0.05, 0.07, 0.09), 0.05, 0.3)
planes = []
for b, (belly, cheat) in zip(BRIDGES, (('#1c3f8c', '#c8102e'), ('#0b6b3a', '#f2b705'))):
    p0, p1, p2 = [xy(n) for n in ways[b]['nodes']]
    # The plane: nose in to the terminal, its front door (on the left) at the bridge's end.
    nose = -V
    port = Vector((-nose.y, nose.x))
    along, out, sill = kit.airliner_door()
    centre = p2 - nose * along - port * out
    kit.airliner(centre, math.atan2(nose.y, nose.x), belly, cheat)
    planes.append((centre, nose, port))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    # The fixed link out of the terminal's upper floor, the rotunda, the moving tunnel.
    for (a, b_), z0, z1 in (((p0, p1), FLOOR1 - 0.6, FLOOR1 - 0.6), ((p1, p2), FLOOR1 - 0.6, sill)):
        d = b_ - a
        mid = (a + b_) / 2
        yaw = math.atan2(d.y, d.x)
        pitch = math.atan2(z1 - z0, d.length)
        for k in range(10):
            t0, t1 = k / 10, (k + 1) / 10
            q = a + d * ((t0 + t1) / 2)
            z = z0 + (z1 - z0) * (t0 + t1) / 2
            box(bm, uv, (q.x, q.y, z), (d.length / 10 + 0.05, 2.8, 2.9), yaw, mat=0)
            box(bm, uv, (q.x, q.y, z + 1.1), (d.length / 10 + 0.06, 2.84, 0.9), yaw, mat=1)
    cylinder(bm, (p1.x, p1.y, FLOOR1 - 0.6 + 1.6), 2.1, 3.4, 0, 16, mat=0)
    cylinder(bm, (p1.x, p1.y, (FLOOR1 - 0.6) / 2), 0.45, FLOOR1 - 0.6, 0, 12, mat=0)
    leg = p2 + (p1 - p2).normalized() * 6.0
    for side in (-1, 1):
        n = Vector((-(p1 - p2).normalized().y, (p1 - p2).normalized().x)) * side * 1.1
        box(bm, uv, (leg.x + n.x, leg.y + n.y, 0.5), (0.3, 0.3, 3.0), mat=0)
        cylinder(bm, (leg.x + n.x, leg.y + n.y, 0.45), 0.45, 0.4, math.atan2((p1 - p2).y, (p1 - p2).x), 14, mat=2, lying=True)
    kit.new_object('jet_bridge', bm, [m_bridge, m_bridge_glass, flat('bridge_tyre', (0.02, 0.02, 0.02), 0.85)])
    # The lead-in line on the apron and the stop bar.
    strip([centre + nose * 20, centre - nose * 60], 0.2, m_yellow, 0.035, 'lead_in')
    strip([centre + nose * 19 + port * 3, centre + nose * 19 - port * 3], 0.25, m_yellow, 0.036, 'stop_bar')
    # A baggage tug and its carts by the plane's hold.
    cart_at = centre - nose * 4 - port * 8
    for k in range(3):
        q = cart_at - nose * k * 3.2
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        box(bm, uv, (q.x, q.y, 0.35), (2.6, 1.5, 0.1), math.atan2(nose.y, nose.x), mat=0)
        box(bm, uv, (q.x, q.y, 0.45), (2.4, 1.4, 1.0), math.atan2(nose.y, nose.x), mat=1)
        for cx, cy in ((0.9, 0.6), (0.9, -0.6), (-0.9, 0.6), (-0.9, -0.6)):
            wq = q + nose * cx + port * cy
            cylinder(bm, (wq.x, wq.y, 0.2), 0.2, 0.12, math.atan2(nose.y, nose.x), 10, mat=2, lying=True)
        kit.new_object('cart', bm, [m_dark, flat('cart_blue', srgb('#2a4a8a'), 0.5), flat('cart_tyre', (0.02, 0.02, 0.02), 0.85)])
    for k in range(3):
        put_at = cart_at - nose * (k * 3.2) + port * random.uniform(-0.4, 0.4)
        kit.place(kit.model('vintage_suitcase'), put_at, random.uniform(0, 6), z=1.45)

# ---- Light and cameras ---------------------------------------------------------------------

kit.daylight(sun_elevation=55, sun_heading=200, sky_strength=0.8, sun_energy=3.8)
cam, aim = kit.render_setup(samples=48, exposure=-0.2)


def at(u, v, z):
    p = W(u, v)
    return (p.x, p.y, z)


c2, nose2, port2 = planes[0]
views = {
    'ria_landside': (at(40, -CANOPY - 22, 1.7), at(58, 0, 7.5), 20),
    'ria_forecourt': (at(16, -CANOPY + 2.5, 1.7), at(60, -CANOPY + 4, 3.5), 22),
    'ria_airside': ((c2 + nose2 * 32 - port2 * 26).to_3d() + Vector((0, 0, 1.8)), (c2 + nose2 * 6).to_3d() + Vector((0, 0, 4.5)), 22),
    'ria_above': (at(LEN + 70, WID + 120, 60), at(LEN / 2, WID / 2, 0), 26),
    'ria_arrivals_immigration': (at(44, WID - 0.8, 1.7), at(52, BOOTH_V, 2.6), 18),
    'ria_baggage': (at(16, 2.0, 1.75), at(50, 13, 1.0), 20),
    'ria_checkin': (at(10, 3.0, Z1 + 1.7), at(60, CHECK_V + 1, Z1 + 2.2), 20),
    'ria_gate': (at(62, 27.5, Z1 + 1.65), at(bridge_u[1] + 6, WID + 30, Z1 + 1.2), 20),
}
# Potted palms along the landside wall, either side of the way out and at the ends.
PLANTS_U = (8.0, 40.0, 62.0, 95.0)
for k, u in enumerate(PLANTS_U):
    inside(kit.thing('potted_palm', (u, 1.0), k * 1.3, z=0.12))

EXPORT = os.environ.get('RIA_EXPORT')
if EXPORT:
    # The game's arrivals hall: the ground floor and what is seen through its glass, in the
    # terminal's own frame (glTF: x = u, y = up, z = -v), light enough for budget phones. And
    # the hall's solid parts as rectangles in (u, v), for the game to walk against.
    import json as _json
    upstairs = lambda o: min((o.matrix_world @ Vector(c)).z for c in o.bound_box) >= FLOOR1 - 0.2 if o.type in ('MESH', 'FONT') else (o.matrix_world.translation.z >= FLOOR1 - 0.2)
    kit.game_export(root, ('car', 'flag', 'palm', 'grass', 'apron', 'airliner', 'jet_bridge', 'lead_in', 'stop_bar', 'cart'), upstairs, EXPORT, os.path.join(OUT, 'ria_arrivals_game.blend'))

    # The solid parts, in (u, v) metres: [u0, v0, u1, v1, id?]. The gates are named, so the
    # game can open the one whose officer admitted the traveller.
    solids = []
    wall = 0.25
    solids += [[0, -0.1, LEN, wall], [0, WID - wall, LEN, WID + 0.1], [-0.1, 0, wall, WID], [LEN - wall, 0, LEN + 0.1, WID]]
    solids += [[u - 0.5, 0.5, u + 0.5, 1.5] for u in PLANTS_U]
    for u in booths_u:
        solids.append([u - 1.1, BOOTH_V - 0.75, u + 1.2, BOOTH_V + 0.75])
    for b0, b1 in barrier:
        solids.append([b0, BOOTH_V - 0.06, b1, BOOTH_V + 0.06])
    for i, (g0, g1) in enumerate(gates):
        solids.append([g0, BOOTH_V - 0.06, g1, BOOTH_V + 0.06, f'gate{i + 1}'])
    for lane in range(4):
        v = BOOTH_V + 2.6 + lane * 1.4
        solids.append([28, v - 0.05, QUEUE_GAP[0], v + 0.05])
        solids.append([QUEUE_GAP[1], v - 0.05, 73, v + 0.05])
    for cu in (36.0, 68.0):
        solids.append([cu - 3.2 - 3.65, 10.5 - 3.65, cu + 3.2 + 3.65, 10.5 + 3.65])
    plan = {
        'frame': 'u along the hall from its south-west end, v across from the landside (0) to the airside',
        'length': LEN, 'width': WID, 'boothV': BOOTH_V,
        'booths': [{'n': i + 1, 'u': u, 'staffed': i in (1, 2, 4, 6), 'gate': f'gate{i + 1}'} for i, u in enumerate(booths_u)],
        'spawn': {'u': 51.0, 'v': WID - 2.5}, 'exit': {'u0': 44.0, 'u1': 58.0, 'v1': 2.0},
        'solids': solids,
    }
    with open(EXPORT.replace('.glb', '.json'), 'w') as f:
        _json.dump(plan, f, indent=1)
    print('EXPORTED', EXPORT, os.path.getsize(EXPORT))
    sys.exit(0)

ONLY = os.environ.get('RIA_VIEWS', '').split(',') if os.environ.get('RIA_VIEWS') else None
for name, (eye, look, lens) in views.items():
    if ONLY and name not in ONLY:
        continue
    kit.shoot(cam, aim, OUT, name, eye, look, lens, cycles=name in ('ria_arrivals_immigration', 'ria_baggage', 'ria_checkin', 'ria_gate'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ria.blend'))
