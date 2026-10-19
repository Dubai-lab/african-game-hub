# One Africa Life: Kotoka International Airport, Accra: the international arrivals hall of
# Terminal 3, in 3D, to judge the look and for the game.
#
#   blender -b --factory-startup --python scripts/oal/makeKotoka.py -- <osm.json> <out dir>
#   KOTOKA_EXPORT=<path>.glb ...   the game's copy of the hall (and <path>.json, its plan)
#
# From OpenStreetMap (© OpenStreetMap contributors, ODbL): where Terminal 3's International
# Arrivals block stands and its size (about 81 by 57 metres), so the hall faces the right way,
# the landside forecourt on one side and the apron on the other. Inside is drawn from how the
# hall works: the corridor from the planes; "Akwaaba, welcome to Ghana"; queue lanes for
# Ghanaians, ECOWAS nationals and other nationalities; ten booths with officers' desks and,
# beside them, e-gates where Ghanaians scan their passport; the barrier across the hall with a
# gate by each booth; three baggage carousels; the way out to the forecourt. A kente band runs
# along the walls; Ghana's flag stands by the booths. Same frame as the Roberts hall (see
# makeAirport.py): u along the hall, v across it from the landside (0) to the airside.
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenekit as kit  # noqa: E402
from scenekit import box, cylinder, flat, photo, srgb  # noqa: E402

kit.REAL_MODELS = not os.environ.get('KOTOKA_EXPORT')

args = sys.argv[sys.argv.index('--') + 1:]
OSM, OUT = args[0], os.path.expanduser(args[1])
EXPORT = os.environ.get('KOTOKA_EXPORT')
os.makedirs(OUT, exist_ok=True)
random.seed(11)

data = json.load(open(OSM))
nodes = {e['id']: e for e in data['elements'] if e['type'] == 'node'}
ways = {e['id']: e for e in data['elements'] if e['type'] == 'way'}
ARRIVALS = 1210036876
BRIDGES = [w for w in ways.values() if w.get('tags', {}).get('aeroway') == 'jet_bridge']
foot0 = nodes[ways[ARRIVALS]['nodes'][0]]
LAT0, LON0 = foot0['lat'], foot0['lon']
M_LON = 111_320.0 * math.cos(math.radians(LAT0))


def xy(node_id):
    n = nodes[node_id]
    return Vector(((n['lon'] - LON0) * M_LON, (n['lat'] - LAT0) * 111_320.0))


# The hall's frame from its footprint: the longest side gives u; v points from the landside to
# the airside (toward the jet bridges).
foot = [xy(n) for n in ways[ARRIVALS]['nodes'][:-1]]
edges = [(foot[i], foot[(i + 1) % len(foot)]) for i in range(len(foot))]
a, b = max(edges, key=lambda e: (e[1] - e[0]).length)
U = (b - a).normalized()
V = Vector((-U.y, U.x))
bridges_at = sum((xy(w['nodes'][0]) for w in BRIDGES), Vector((0, 0))) / max(1, len(BRIDGES))
centre = sum(foot, Vector((0, 0))) / len(foot)
if (bridges_at - centre).dot(V) < 0:
    U, V = -U, -V
us = [(p - centre).dot(U) for p in foot]
vs = [(p - centre).dot(V) for p in foot]
LEN, WID = max(us) - min(us), max(vs) - min(vs)
O = centre + U * min(us) + V * min(vs)
YAW_T = math.atan2(U.y, U.x)
print('HALL', round(LEN, 1), 'by', round(WID, 1))


def W(u, v):
    return O + U * u + V * v


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
root = bpy.data.objects.new('terminal', None)
root.location = (O.x, O.y, 0)
root.rotation_euler = (0, 0, YAW_T)
scene.collection.objects.link(root)


def inside(obj):
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


def kente():
    """A kente cloth band, woven in code: blocks of gold, green, red and black in strips, the
    warp and weft crossing (the pattern is our own, in kente's colours)."""
    W_, H_ = 512, 128
    gold, green, red, black = (np.array(srgb(c)) for c in ('#e3a812', '#0b6b3a', '#b5121b', '#141414'))
    img = np.zeros((H_, W_, 3))
    strip = 64
    for x in range(W_):
        block = (x // strip) % 4
        warp = [gold, green, gold, red][block]
        for y in range(H_):
            band = (y // 16) % 8
            weft = [black, gold, green, gold, red, gold, black, green][band]
            fine = ((x // 4) + (y // 4)) % 2 == 0
            if block % 2 == 0:
                img[y, x] = warp if fine or band in (1, 3, 5) else weft
            else:
                img[y, x] = weft if (x // 8) % 2 == 0 else warp
    # A little thread texture.
    img *= (0.85 + 0.15 * np.random.default_rng(1).random((H_, W_, 1)))
    image = bpy.data.images.new('kente', W_, H_)
    px = np.ones((H_, W_, 4), dtype=np.float32)
    px[:, :, :3] = img
    image.pixels.foreach_set(px[::-1].ravel())
    image.pack()
    m = bpy.data.materials.new('kente')
    m.use_nodes = True
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = image
    m.node_tree.links.new(t.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85
    return m


# The owner's photographed lawn, a little dry, as airport grass is.
m_grass = kit.lawn('grass', 3.0, (0.92, 0.95, 0.78))
m_apron = photo('apron', 'brushed_concrete', scale=6.0, mul=(0.85, 0.85, 0.84), streaks=0)
m_asphalt = photo('asphalt', 'road_damaged_clean', scale=4.0, mul=(0.45, 0.45, 0.47), streaks=0)
m_paving = photo('paving', 'brushed_concrete', scale=2.0, mul=(0.95, 0.93, 0.9), streaks=0)
m_floor = photo('floor', 'large_grey_tiles', scale=2.4, rough_mul=0.3, streaks=0)
m_ceiling = flat('ceiling', (0.82, 0.82, 0.8), 0.7)
m_slat = flat('slat', srgb('#c9a06a'), 0.6)
m_wall = photo('wall', 'white_stucco', scale=3.0, tint=srgb('#f1efe9'), tint_amount=1.0, streaks=0)
m_steelplate = photo('steelplate', 'metal_plate', scale=1.0, metallic=0.8, streaks=0)
m_belt = photo('belt', 'rubber_tiles', scale=0.6, mul=(0.25, 0.25, 0.25), streaks=0)
m_kente = kente()
m_glass = flat('glass', (0.55, 0.7, 0.72), 0.04, 0.0, alpha=0.18)
m_alu = flat('alu', (0.7, 0.71, 0.73), 0.3, 0.9)
m_white = flat('white', (0.9, 0.9, 0.9), 0.5)
m_green = flat('gh_green', srgb('#0b4f2e'), 0.5)
m_gold = flat('gh_gold', srgb('#e3a812'), 0.5)
m_dark = flat('dark', (0.04, 0.04, 0.045), 0.4)
m_wood = flat('wood', srgb('#6b4a2e'), 0.6)
m_light = flat('light_panel', (1.0, 0.97, 0.92), 0.5, emission=6.0)
m_screen = flat('screen', (0.25, 0.45, 0.8), 0.2, emission=2.0)
m_pillar = flat('pillar', (0.92, 0.92, 0.9), 0.4)

CEIL = 7.0
# Between the baggage hall and the booths.
COLUMNS_V = 12.6

# ---- Outside: ground, apron, forecourt -------------------------------------------------------

bm = bmesh.new()
uv = bm.loops.layers.uv.new()
G = 700
f = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in ((-G, -G), (G, -G), (G, G), (-G, G))])
for loop in f.loops:
    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
kit.new_object('grass', bm, [m_grass])

bm, uv, done = mesh('apron', [m_apron])
box(bm, uv, (LEN / 2, WID + 60, 0), (LEN + 160, 120, 0.03))
done()
bm, uv, done = mesh('forecourt', [m_paving, m_asphalt])
box(bm, uv, (LEN / 2, -5, 0), (LEN + 20, 10, 0.15), mat=0)
box(bm, uv, (LEN / 2, -14, 0), (LEN + 80, 8, 0.04), mat=1)
done()

# ---- The hall: floor, ceiling, walls, glass ------------------------------------------------

bm, uv, done = mesh('floors', [m_floor, m_ceiling, m_wall])
box(bm, uv, (LEN / 2, WID / 2, 0), (LEN, WID, 0.12), mat=0)
lid = box(bm, uv, (LEN / 2, WID / 2, CEIL), (LEN, WID, 0.6), mat=1)
for f in lid:
    f.normal_update()
    if abs(f.normal.z) < 0.5:
        f.material_index = 2
done()
# Warm slats across the ceiling.
bm, uv, done = mesh('slats', [m_slat])
v = 1.0
while v < WID - 0.5:
    box(bm, uv, (LEN / 2, v, CEIL - 0.35), (LEN - 1.0, 0.12, 0.3))
    v += 0.9
done()
# The ends: solid walls, a kente band along them at eye level and above.
bm, uv, done = mesh('ends', [m_wall, m_kente])
for u in (0.0, LEN):
    box(bm, uv, (u, WID / 2, 0), (0.4, WID, CEIL), mat=0)
done()
bm, uv, done = mesh('kente_band', [m_kente])
for u, side in ((0.25, 1), (LEN - 0.25, -1)):
    bm2 = None
    for z0 in (2.7,):
        faces = box(bm, uv, (u, WID / 2, z0), (0.06, WID - 1, 0.7), mat=0)
        for f in faces:
            for loop in f.loops:
                p = loop.vert.co
                loop[uv].uv = (p.y / 4.0, (p.z - z0) / 0.7)
done()


def curtain_wall(v, gaps=()):
    """Glass from floor to ceiling, aluminium mullions every 1.8 m; the glass casts no shadow."""
    bm, uv, done = mesh('mullions', [m_alu])
    u = 0.0
    while u <= LEN:
        box(bm, uv, (u, v, 0), (0.1, 0.22, CEIL), mat=0)
        u += 1.8
    for z in (0.0, 2.8, CEIL - 0.15):
        box(bm, uv, (LEN / 2, v, z), (LEN, 0.24, 0.14), mat=0)
    done()
    bm, uv, done = mesh('glass', [m_glass])
    u0 = 0.0
    for g0, g1 in sorted(gaps) + [(LEN, LEN)]:
        if g0 > u0:
            box(bm, uv, ((u0 + g0) / 2, v, 0), (g0 - u0, 0.02, CEIL), mat=0)
        u0 = g1
    done().visible_shadow = False


curtain_wall(0.0)
# The airside: the corridor from the planes comes in through the middle.
CORRIDOR = (LEN / 2 - 3.0, LEN / 2 + 3.0)
curtain_wall(WID, gaps=[CORRIDOR])
bm, uv, done = mesh('corridor', [m_wall, m_floor])
box(bm, uv, (CORRIDOR[0] - 0.15, WID + 6, 0), (0.3, 12, 3.2), mat=0)
box(bm, uv, (CORRIDOR[1] + 0.15, WID + 6, 0), (0.3, 12, 3.2), mat=0)
box(bm, uv, (LEN / 2, WID + 6, 3.2), (6.6, 12, 0.3), mat=0)
box(bm, uv, (LEN / 2, WID + 12, 0), (6.6, 0.3, 3.2), mat=0)
box(bm, uv, (LEN / 2, WID + 6, 0), (6.0, 12, 0.12), mat=1)
done()

# Columns.
bm, uv, done = mesh('columns', [m_pillar])
for u in np.arange(13.5, LEN - 5, 13.5):
    for v in (COLUMNS_V,):
        cylinder(bm, (float(u), v, CEIL / 2), 0.45, CEIL, 0, 20)
done()

# Light: panels between the slats; lights over the hall (render only).
bm, uv, done = mesh('light_panels', [m_light])
for u in range(6, int(LEN) - 3, 6):
    for v in range(4, int(WID) - 2, 5):
        box(bm, uv, (u, v + 0.45, CEIL - 0.52), (2.6, 0.5, 0.02))
done()
for u in range(8, int(LEN), 14):
    for v in (10, 26, 42):
        light = bpy.data.objects.new('hall_light', bpy.data.lights.new('hall_light', 'AREA'))
        light.data.energy = 1500
        light.data.size = 6.0
        light.data.use_shadow = False
        light.data.color = (1.0, 0.97, 0.92)
        light.location = (u, v, CEIL - 0.7)
        scene.collection.objects.link(light)
        inside(light)

# ---- Immigration -------------------------------------------------------------------------

STAND = ['man_phone', 'man_idle', 'man_talk', 'woman_idle', 'woman_phone', 'woman_looking', 'man_argue']
BOOTH_V = 16.5
booths_u = [12.0 + i * 4.8 for i in range(10)]
EGATES_U = [booths_u[-1] + 5.0 + i * 2.2 for i in range(4)]
bm, uv, done = mesh('booths', [m_white, m_green, m_glass, m_wood, m_dark, m_gold])
for i, u in enumerate(booths_u):
    box(bm, uv, (u, BOOTH_V, 0.12), (2.2, 1.5, 1.05), mat=0)
    box(bm, uv, (u, BOOTH_V + 0.76, 0.75), (2.2, 0.04, 0.12), mat=1)
    box(bm, uv, (u, BOOTH_V + 0.5, 1.17), (2.0, 0.06, 0.55), mat=2)
    box(bm, uv, (u, BOOTH_V, 1.17), (2.2, 1.5, 0.04), mat=3)
    box(bm, uv, (u + 1.15, BOOTH_V - 0.2, 0.12), (0.08, 2.0, 2.0), mat=0)
    box(bm, uv, (u, BOOTH_V - 0.6, 1.2), (0.45, 0.06, 0.35), mat=4)
    box(bm, uv, (u, BOOTH_V + 0.2, 2.5), (0.8, 0.08, 0.45), mat=1)
# The e-gates: pods with a passport reader and glass doors.
for u in EGATES_U:
    for side in (-1, 1):
        box(bm, uv, (u + side * 0.75, BOOTH_V, 0.12), (0.25, 2.0, 1.25), mat=0)
    box(bm, uv, (u + 0.75, BOOTH_V + 0.85, 1.37), (0.3, 0.3, 0.08), mat=4)
    box(bm, uv, (u, BOOTH_V + 1.0, 2.3), (1.8, 0.08, 0.3), mat=5)
done()
for i, u in enumerate(booths_u):
    sign(str(i + 1), u, BOOTH_V + 0.26, (0, 1), 0.32, '#f4efe2', 2.72)
sign('E-GATES · GHANA CARD', sum(EGATES_U) / 4, BOOTH_V + 1.06, (0, 1), 0.24, '#141414', 2.45)
# Four officers on duty: booth 2 (Ghanaians), 5 and 6 (ECOWAS), 9 (others).
STAFFED = (1, 4, 5, 8)

# The line across the hall: glass panels wall to wall, the booths, a gate beside each booth,
# an e-gate's glass doors in each pod.
gates = []
barrier = []
u0 = 0.2
for u in booths_u:
    barrier.append((u0, u - 1.1))
    gates.append((u + 1.15, u + 2.05))
    u0 = u + 2.05
for u in EGATES_U:
    barrier.append((u0, u - 0.88))
    gates.append((u - 0.62, u + 0.62))
    u0 = u + 0.88
barrier.append((u0, LEN - 0.2))
bm, uv, done = mesh('barrier', [m_glass, m_alu])
for b0, b1 in barrier:
    if b1 > b0:
        box(bm, uv, ((b0 + b1) / 2, BOOTH_V, 0.12), (b1 - b0, 0.04, 2.2), mat=0)
        box(bm, uv, ((b0 + b1) / 2, BOOTH_V, 2.32), (b1 - b0, 0.08, 0.06), mat=1)
done().visible_shadow = False
for i, (g0, g1) in enumerate(gates):
    egate = i >= len(booths_u)
    bm, uv, done = mesh(f'gate{i + 1}', [m_glass if egate else m_green])
    box(bm, uv, ((g1 - g0) / 2, 0, 0), (g1 - g0 - 0.06, 0.05, 1.0 if not egate else 1.6), mat=0)
    done().location = (g0, BOOTH_V, 0.12)

# The lanes' signs, the queue lines (unhooked in the middle), passengers.
bm, uv, done = mesh('lane_signs', [m_green, m_white])
for (u0_, u1_), text_ in (((booths_u[0] - 1.5, booths_u[2] + 1.5), 'GHANAIANS'), ((booths_u[3] - 1.5, booths_u[6] + 1.5), 'ECOWAS NATIONALS'), ((booths_u[7] - 1.5, booths_u[9] + 1.5), 'ALL OTHER NATIONALITIES')):
    box(bm, uv, ((u0_ + u1_) / 2, BOOTH_V + 1.6, 3.4), (u1_ - u0_, 0.12, 0.8), mat=0)
done()
for (u0_, u1_), text_ in (((booths_u[0] - 1.5, booths_u[2] + 1.5), 'GHANAIANS'), ((booths_u[3] - 1.5, booths_u[6] + 1.5), 'ECOWAS NATIONALS'), ((booths_u[7] - 1.5, booths_u[9] + 1.5), 'ALL OTHER NATIONALITIES')):
    sign(text_, (u0_ + u1_) / 2, BOOTH_V + 1.68, (0, 1), 0.42, '#f4efe2', 3.8)
QUEUE_GAP = (LEN / 2 - 1.6, LEN / 2 + 1.6)
LANES_U = (booths_u[0] - 2, EGATES_U[-1] + 1)
bm, uv, done = mesh('stanchions', [m_alu, m_green])
for lane in range(4):
    v = BOOTH_V + 2.6 + lane * 1.4
    posts = list(np.arange(LANES_U[0], LANES_U[1], 3.0)) + list(QUEUE_GAP)
    for u in posts:
        cylinder(bm, (float(u), v, 0.12 + 0.48), 0.03, 0.96, 0, 8, mat=0)
        cylinder(bm, (float(u), v, 0.13), 0.16, 0.02, 0, 12, mat=0)
    for g0, g1 in ((LANES_U[0], QUEUE_GAP[0]), (QUEUE_GAP[1], LANES_U[1])):
        box(bm, uv, ((g0 + g1) / 2, v, 0.95), (g1 - g0, 0.01, 0.05), mat=1)
done()
for k in range(16):
    lane = k % 3
    u = LANES_U[0] + 2 + (k * 3.7) % (LANES_U[1] - LANES_U[0] - 4)
    if QUEUE_GAP[0] - 0.8 < u < QUEUE_GAP[1] + 0.8:
        u += 4.0
    put(kit.person(random.choice(STAND)), u, BOOTH_V + 3.3 + lane * 1.4, kit.facing((random.uniform(-0.3, 0.3), -1)), z=0.12)
for i in STAFFED:
    put(kit.person('officer_desk'), booths_u[i], BOOTH_V - 1.0, kit.facing((0, 1)), z=0.12)

# The welcome, hung over the corridor's end: Akwaaba (welcome, in Twi).
bm, uv, done = mesh('welcome', [m_green, m_gold, m_kente])
box(bm, uv, (LEN / 2, 26.5, 3.6), (22, 0.15, 2.2), mat=0)
box(bm, uv, (LEN / 2, 26.5, 3.45), (22.2, 0.17, 0.15), mat=2)
done()
sign('AKWAABA', LEN / 2, 26.6, (0, 1), 1.1, '#e3a812', 4.9)
sign('WELCOME TO GHANA', LEN / 2, 26.6, (0, 1), 0.55, '#f4efe2', 4.1)
inside(kit.flag((booths_u[0] - 3.0, BOOTH_V + 0.8), 0, 'GH', 3.6, 1.3)).location.z = 0.12

# ---- Baggage --------------------------------------------------------------------------------

CAROUSEL_V = 7.5
carousels_u = (LEN / 2 - 21, LEN / 2, LEN / 2 + 21)
for n, cu in enumerate(carousels_u):
    bm, uv, done = mesh('carousel', [m_steelplate, m_belt, m_alu])
    seg, half, ry = 48, 3.6, 2.6

    def ring(a_, r):
        sx = half if math.cos(a_) > 0 else -half
        return (cu + sx + math.cos(a_) * r, CAROUSEL_V + math.sin(a_) * r)

    for k in range(seg):
        a0, a1 = k / seg * 2 * math.pi, (k + 1) / seg * 2 * math.pi
        for r_in, r_out, z, mat in ((ry - 0.1, ry + 0.8, 0.6, 1), (ry + 0.8, ry + 1.05, 0.62, 0)):
            bm.faces.new([bm.verts.new(p) for p in ((*ring(a0, r_in), z), (*ring(a1, r_in), z), (*ring(a1, r_out), z), (*ring(a0, r_out), z))]).material_index = mat
        bm.faces.new([bm.verts.new(p) for p in ((*ring(a0, ry + 1.05), 0.12), (*ring(a1, ry + 1.05), 0.12), (*ring(a1, ry + 1.05), 0.62), (*ring(a0, ry + 1.05), 0.62))]).material_index = 0
    box(bm, uv, (cu, CAROUSEL_V, 0.12), (2 * half + 1.6, ry * 1.2, 0.75), mat=2)
    done()
    for k in range(6):
        a_ = random.uniform(0, 2 * math.pi)
        q = ring(a_, ry + 0.35)
        put(kit.model('vintage_suitcase'), q[0], q[1], a_, z=0.62)
    sign(f'BELT {n + 1}', cu, CAROUSEL_V + 6.0, (0, 1), 0.45, '#0b4f2e', 3.2)
bm, uv, done = mesh('belt_signs', [m_white])
for cu in carousels_u:
    box(bm, uv, (cu, CAROUSEL_V + 5.92, 3.0), (3.0, 0.1, 0.6))
done()
sign('EXIT · TAXI · CAR PARK', LEN / 2, 1.0, (0, 1), 0.45, '#0b4f2e', 3.4)

# ---- Outside: taxis at the kerb, palms, the plane at a bridge -----------------------------

for k in range(8):
    u = 8 + k * 9 + random.uniform(-2, 2)
    # Accra's taxis: yellow corners on a body of any colour; here the yellow cab.
    kit.car(W(u, -12.5), YAW_T + (math.pi if k % 2 else 0), '#e2a71b' if k % 3 else random.choice(['#f0f0ee', '#202020', '#7a1a1a']), 'saloon' if k % 3 else 'suv', taxi=k % 3 != 0)
for k in range(9):
    kit.palm(W(-4 + k * 11.0, -19.5))
for u in (LEN / 2 - 10, LEN / 2 + 10):
    kit.flag(W(u, -8.5), YAW_T + math.pi, 'GH', 9.0, 2.2)
plane_at = W(LEN / 2 + 25, WID + 38)
kit.airliner(plane_at, YAW_T - math.pi / 2, '#0b4f2e', '#e3a812')

# Potted palms along the landside wall, either side of the way out and at the ends.
PLANTS_U = (6.0, LEN / 2 - 11, LEN / 2 + 11, LEN - 6)
for k, u in enumerate(PLANTS_U):
    inside(kit.thing('potted_palm', (u, 1.0), k * 1.3, z=0.12))

# ---- Export, or light and pictures --------------------------------------------------------

if EXPORT:
    kit.game_export(root, ('car', 'flag', 'palm', 'grass', 'airliner'), lambda o: False, EXPORT, os.path.join(OUT, 'kotoka_arrivals_game.blend'))
    solids = []
    wall = 0.25
    solids += [[0, -0.1, LEN, wall], [-0.1, 0, wall, WID], [LEN - wall, 0, LEN + 0.1, WID]]
    solids += [[u - 0.5, 0.5, u + 0.5, 1.5] for u in PLANTS_U]
    # The airside wall, open where the corridor comes in; the corridor's own walls.
    solids += [[0, WID - wall, CORRIDOR[0], WID + 0.1], [CORRIDOR[1], WID - wall, LEN, WID + 0.1]]
    solids += [[CORRIDOR[0] - 0.3, WID, CORRIDOR[0], WID + 12], [CORRIDOR[1], WID, CORRIDOR[1] + 0.3, WID + 12], [CORRIDOR[0], WID + 11.8, CORRIDOR[1], WID + 12.2]]
    for u in booths_u:
        solids.append([u - 1.1, BOOTH_V - 0.75, u + 1.2, BOOTH_V + 0.75])
    for u in EGATES_U:
        for side in (-1, 1):
            solids.append([u + side * 0.75 - 0.13, BOOTH_V - 1.0, u + side * 0.75 + 0.13, BOOTH_V + 1.0])
    for b0, b1 in barrier:
        if b1 > b0:
            solids.append([b0, BOOTH_V - 0.06, b1, BOOTH_V + 0.06])
    for i, (g0, g1) in enumerate(gates):
        solids.append([g0, BOOTH_V - 0.06, g1, BOOTH_V + 0.06, f'gate{i + 1}'])
    for lane in range(4):
        v = BOOTH_V + 2.6 + lane * 1.4
        solids.append([LANES_U[0], v - 0.05, QUEUE_GAP[0], v + 0.05])
        solids.append([QUEUE_GAP[1], v - 0.05, LANES_U[1], v + 0.05])
    for cu in carousels_u:
        solids.append([cu - 3.6 - 3.65, CAROUSEL_V - 3.65, cu + 3.6 + 3.65, CAROUSEL_V + 3.65])
    for u in np.arange(13.5, LEN - 5, 13.5):
        for v in (COLUMNS_V,):
            solids.append([float(u) - 0.45, v - 0.45, float(u) + 0.45, v + 0.45])
    booths = [{'n': i + 1, 'u': u, 'kind': 'booth', 'staffed': i in STAFFED, 'gate': f'gate{i + 1}'} for i, u in enumerate(booths_u)]
    booths += [{'n': len(booths_u) + i + 1, 'u': u, 'kind': 'egate', 'staffed': False, 'gate': f'gate{len(booths_u) + i + 1}'} for i, u in enumerate(EGATES_U)]
    plan = {
        'frame': 'u along the hall, v across from the landside (0) to the airside',
        'length': LEN, 'width': WID, 'boothV': BOOTH_V, 'ceiling': CEIL,
        'booths': booths,
        'spawn': {'u': LEN / 2, 'v': WID + 4.0}, 'exit': {'u0': LEN / 2 - 8, 'u1': LEN / 2 + 8, 'v1': 2.0},
        'solids': solids,
    }
    with open(EXPORT.replace('.glb', '.json'), 'w') as f:
        json.dump(plan, f, indent=1)
    print('EXPORTED', EXPORT, os.path.getsize(EXPORT))
    sys.exit(0)

kit.daylight(sun_elevation=60, sun_heading=120, sky_strength=0.8, sun_energy=3.8)
cam, aim = kit.render_setup(samples=48, exposure=-0.2)


def at(u, v, z):
    p = W(u, v)
    return (p.x, p.y, z)


views = {
    'kotoka_welcome': (at(LEN / 2 - 2, WID + 2.0, 1.7), at(LEN / 2, BOOTH_V, 2.9), 18, True),
    'kotoka_booths': (at(LEN / 2 + 14, BOOTH_V + 9, 1.7), at(LEN / 2 - 6, BOOTH_V, 1.6), 20, True),
    'kotoka_baggage': (at(6, 3.0, 1.75), at(LEN / 2, CAROUSEL_V, 1.0), 20, True),
    'kotoka_landside': (at(LEN / 2 - 15, -24, 1.7), at(LEN / 2, 0, 4.0), 20, False),
}
ONLY = os.environ.get('KOTOKA_VIEWS', '').split(',') if os.environ.get('KOTOKA_VIEWS') else None
for name, (eye, look, lens, cycles) in views.items():
    if ONLY and name not in ONLY:
        continue
    kit.shoot(cam, aim, OUT, name, eye, look, lens, cycles=cycles)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'kotoka.blend'))
