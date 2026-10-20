# One Africa Life: Voinjama, the capital of Lofa County, in 3D, from OpenStreetMap.
#
#   blender -b --factory-startup --python scripts/oal/makeVoinjama.py -- <osm.json> <out dir>
#   VOINJAMA_EXPORT=<path>.glb ...: the game's copy (and <path>.json, its plan) instead of pictures
#
# The map (© OpenStreetMap contributors, ODbL) gives the main road through town and the streets
# off it, every building's outline, the clinics. What a map does not say is drawn from how
# Voinjama is: a hilly up-country town of single-storey houses of cement or plastered mud brick
# under zinc, laterite streets (the main road paved through town), palms, mango trees and banana
# plants in every yard; the market along the main road, its tables of produce, cloth and
# basins; money changers by it (Guinea is twenty kilometres away: francs as well as dollars);
# a cookshop; a phone and SIM kiosk; the motorbike and kekeh stop; the clinic; the central
# mosque with its minaret. Built from scenekit.py, town.py and market.py.
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
from market import KINDS, Market, shoulder  # noqa: E402
from scenekit import box, flat, photo, srgb  # noqa: E402
from town import Town  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OSM, OUT = args[0], os.path.expanduser(args[1])
EXPORT = os.environ.get('VOINJAMA_EXPORT')
kit.REAL_MODELS = not EXPORT
os.makedirs(OUT, exist_ok=True)
random.seed(21)
RADIUS = 130
REACH = 100.0

data = json.load(open(OSM))
probe = Town(data, 8.4219, -9.7478, RADIUS)
# The centre: where the houses are thickest (the map's streets there are few; its main road
# passes to one side), on the street that runs most through them, which is the market street.
houses = [sum(probe.way_points(w), Vector((0, 0))) / max(1, len(w['nodes'])) for w in probe.ways if 'building' in w.get('tags', {})]
dense = max(houses, key=lambda c: sum(1 for p in houses if (p - c).length < 130))
streets = [w for w in probe.ways if w.get('tags', {}).get('highway') in ('secondary', 'tertiary', 'residential', 'unclassified')]
main = max(streets, key=lambda w: sum(1 for p in probe.way_points(w) if (p - dense).length < 150))
centre_id = min(main['nodes'], key=lambda n: (probe.xy(n) - dense).length)
c = probe.nodes[centre_id]
town = Town(data, c['lat'], c['lon'], RADIUS)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
m = town.materials()
mk = Market(town)
LIGHT_PROPS = {'painted_wooden_bench', 'wooden_stool_01'}


def prop(name, *a, **k):
    if EXPORT and name not in LIGHT_PROPS:
        return None
    return kit.place(kit.model(name), *a, **k)


# ---- Ground and streets: laterite everywhere, the main road paved -----------------------------

town.ground(m['earth'])
# Up-country streets are earth; only the main road is paved through town.
m['side'] = m['dirt']
town.roads(clear=0.8)
main_pts = town.way_points(main)
width = town.road_width(main)

# ---- Houses -------------------------------------------------------------------------------------


def storeys_for(tags, area, big):
    levels = tags.get('building:levels', '')
    if levels.replace('.', '').isdigit():
        return max(1, min(4, int(float(levels))))
    return random.choices([1, 2], [0.85, 0.15])[0] if not big else random.choices([1, 2], [0.5, 0.5])[0]


town.buildings(storeys_for)
print('BUILT', len(town.footprints), 'buildings')

# ---- The clinic: the map's clinic nearest the centre, its sign on the street side -----------------

clinics = [w for w in town.ways if w.get('tags', {}).get('amenity') in ('clinic', 'hospital')]
clinic_pts = None
for w in sorted(clinics, key=lambda w: (sum(town.way_points(w), Vector((0, 0))) / max(1, len(w['nodes']))).length):
    pts = town.way_points(w)
    if len(pts) > 3 and (sum(pts, Vector((0, 0))) / len(pts)).length < REACH - 10:
        clinic_pts = pts[:-1]
        break
if clinic_pts is None:
    # A clinic as a building: the biggest house within 60 m of the main road, near the centre.
    best = max((fp for fp in town.footprints if (sum(fp[0], Vector((0, 0))) / len(fp[0])).length < 70), key=lambda fp: abs(town.area(fp[0])), default=None)
    clinic_pts = best[0] if best else None
if clinic_pts:
    cen = sum(clinic_pts, Vector((0, 0))) / len(clinic_pts)
    _dist, _d, near, _w, _big = town.road_at(cen)
    i = min(range(len(clinic_pts)), key=lambda k: ((clinic_pts[k] + clinic_pts[(k + 1) % len(clinic_pts)]) / 2 - near).length)
    a, b = clinic_pts[i], clinic_pts[(i + 1) % len(clinic_pts)]
    d = (b - a).normalized()
    out = Vector((d.y, -d.x))
    if (((a + b) / 2) + out - cen).length < (((a + b) / 2) - cen).length:
        out = -out
    mid = (a + b) / 2
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    q = mid + out * 0.12
    box(bm, uv, (q.x, q.y, 2.6), (4.0, 0.1, 0.8), math.atan2(d.y, d.x))
    kit.new_object('clinic_sign', bm, [flat('clinic_white', (0.9, 0.9, 0.9), 0.5)])
    kit.text('VOINJAMA COMMUNITY CLINIC', mid + out * 0.2, kit.facing(out), 0.22, '#1a5a9a', 3.0)
    town.place('clinic', mid + out * 1.6, -out)

# ---- The central mosque: white, green trimmed, a dome and a minaret -------------------------------

m_white = flat('mosque_white', (0.9, 0.9, 0.87), 0.6)
m_green = flat('mosque_green', srgb('#1f7a4a'), 0.5)
lot = town.find_lot(16.0, 12.0, 25, REACH - 15, 2.0)
if lot:
    at, yaw = lot
    d = Vector((math.cos(yaw), math.sin(yaw)))
    n = Vector((-math.sin(yaw), math.cos(yaw)))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    box(bm, uv, (at.x, at.y, 0), (16.0, 12.0, 5.5), yaw, mat=0)
    box(bm, uv, (at.x, at.y, 5.5), (16.6, 12.6, 0.4), yaw, mat=1)
    dome = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=3.4)
    for v in dome['verts']:
        v.co = Vector((v.co.x + at.x, v.co.y + at.y, max(0.0, v.co.z) + 5.9))
    for f in {f for v in dome['verts'] for f in v.link_faces}:
        f.material_index = 1
    tower = at + d * 9.5 - n * 4.5
    box(bm, uv, (tower.x, tower.y, 0), (2.2, 2.2, 16.0), yaw, mat=0)
    box(bm, uv, (tower.x, tower.y, 16.0), (2.8, 2.8, 0.5), yaw, mat=1)
    cone = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=1.2, radius2=0.05, depth=3.0)
    for v in cone['verts']:
        v.co += Vector((tower.x, tower.y, 18.0))
    for f in {f for v in cone['verts'] for f in v.link_faces}:
        f.material_index = 1
    # Arched doorways along the front: dark.
    for k in range(-2, 3):
        q = at + d * (k * 2.8) - n * 6.03
        box(bm, uv, (q.x, q.y, 0), (1.4, 0.05, 3.0), yaw, mat=2)
    kit.new_object('mosque', bm, [m_white, m_green, flat('mosque_door', (0.05, 0.05, 0.05), 0.9)])
    town.solid_box(tower, 2.4, 2.4, yaw)
    print('MOSQUE at', [round(v, 1) for v in at])

# ---- The market along the main road ---------------------------------------------------------------

STANDING = ['man_phone', 'man_idle', 'man_talk', 'man_argue', 'woman_idle', 'woman_phone', 'woman_looking']
WALKING = ['man_walk', 'woman_walk', 'man_carry']
specials = ['stall', 'changer', 'cookshop', 'phone']
stalls = 0
for side in (1, -1):
    for row in (0, 1):
        for p, d, n in shoulder(main_pts, side * (width / 2 + 1.2 + row * 2.9), 2.6, start=random.uniform(0, 1.2)):
            n_out = n * side
            yaw = math.atan2(d.y, d.x)
            if p.length > 70 or not town.rect_free(p, 2.3, 1.2, yaw, 0.15):
                continue
            apart = all((p - Vector((v['x'], v['y']))).length > 7 for v in town.places.values())
            special = specials[0] if specials and row == 0 and p.length < 45 and apart and random.random() < 0.4 else None
            if special:
                specials.pop(0)
            if special == 'changer':
                bm = bmesh.new()
                uv = bm.loops.layers.uv.new()
                box(bm, uv, (p.x, p.y, 0.7), (0.9, 0.6, 0.05), yaw, mat=0)
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        q = p + d * sx * 0.4 + n * sy * 0.25
                        box(bm, uv, (q.x, q.y, 0), (0.04, 0.04, 0.7), yaw, mat=0)
                for k in range(5):
                    q = p + d * (-0.3 + k * 0.15)
                    box(bm, uv, (q.x, q.y, 0.75), (0.13, 0.07, 0.04 + 0.02 * k), yaw + random.uniform(-0.3, 0.3), mat=1)
                kit.new_object('changer_table', bm, [mk.timber, flat('notes', srgb('#6a8a5a'), 0.8)])
                mk.umbrella(p + n_out * 0.3, ('#2a6ab8', '#f2e6c8'))
                prop('wooden_stool_01', p + n_out * 0.7, yaw)
                kit.text('USD  LRD  GNF', p - n_out * 0.31, kit.facing(-n_out), 0.09, '#141414', 0.62)
                town.solid_box(p, 1.0, 0.7, yaw)
                town.take_rect(p, 1.6, 1.4, yaw, 0.1, solid=False)
                town.place('changer', p - n_out * 1.3, n_out)
                continue
            if special == 'cookshop':
                bm = bmesh.new()
                bm.loops.layers.uv.new()
                for k in range(2):
                    q = p + d * (-0.5 + k)
                    pot = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.28, radius2=0.3, depth=0.4)
                    for v in pot['verts']:
                        v.co += Vector((q.x, q.y, 0.5))
                kit.new_object('cookshop_pots', bm, [flat('steel', (0.5, 0.5, 0.52), 0.5, 0.7)])
                mk.umbrella(p, ('#e8b41c', '#2a8a4a'))
                prop('painted_wooden_bench', p - n_out * 1.2, yaw)
                kit.text("MAMA KORTU'S\nCOOKSHOP", p + n_out * 0.1, kit.facing(-n_out), 0.14, '#141414', 1.0)
                town.solid_box(p, 2.0, 0.9, yaw)
                town.take_rect(p, 2.6, 2.6, yaw, 0.1, solid=False)
                town.place('cookshop', p - n_out * 1.6, n_out)
                continue
            if special == 'phone':
                # A zinc kiosk: SIM cards, scratch cards, phones charged.
                bm = bmesh.new()
                uv = bm.loops.layers.uv.new()
                back = p + n_out * 0.6
                box(bm, uv, (back.x, back.y, 0), (2.4, 1.8, 2.4), yaw, mat=0)
                box(bm, uv, (p.x, p.y, 2.45), (3.0, 3.0, 0.05), yaw, mat=1)
                kit.new_object('kiosk', bm, [flat('kiosk_blue', srgb('#2f6fb8'), 0.7), m['zinc_rust']])
                kit.text('SIM CARDS\nPHONE CHARGING', p - n_out * 0.33, kit.facing(-n_out), 0.16, '#f4efe2', 1.9)
                town.solid_box(back, 2.4, 1.8, yaw)
                town.take_rect(back, 3.0, 2.6, yaw, 0.1, solid=False)
                town.place('phone', p - n_out * 1.1, n_out)
                continue
            deep = mk.stall(p, d, n_out, random.choice(KINDS) if special != 'stall' else 'produce')
            town.take_rect(p, 2.3, 1.2, yaw, 0.15, solid=False)
            if special == 'stall':
                kit.text('TABLE 6 · DUES PAID', p - n_out * (deep / 2 + 0.02), kit.facing(-n_out), 0.1, '#141414', 0.5)
                town.place('stall', p - n_out * (deep / 2 + 0.9), n_out)
            elif random.random() < 0.6:
                kit.place(kit.person(random.choice(['woman_idle', 'woman_looking', 'man_idle'])), p + n_out * (deep / 2 + 0.5), kit.facing(-n_out))
            stalls += 1
print('STALLS', stalls, 'places', sorted(town.places))

# The motorbike and kekeh stop: kekehs waiting by the road near the centre.
stop = 0
for p, d, n in shoulder(main_pts, -(width / 2 + 1.0), 3.4):
    if 10 < p.length < 45 and stop < 4 and town.rect_free(p, 2.8, 1.4, math.atan2(d.y, d.x), 0.1):
        kit.kekeh(p, math.atan2(d.y, d.x) + random.uniform(-0.15, 0.15), random.choice(['#e8b41c', '#2a6ab8']))
        town.take_rect(p, 2.8, 1.4, math.atan2(d.y, d.x), 0.1)
        if 'kekeh' not in town.places:
            town.place('kekeh', p - n * 1.8, n)
        stop += 1

# Water tanks, a skip, bins.
for pts, tags in town.footprints:
    if random.random() > 0.2:
        continue
    cen = sum(pts, Vector((0, 0))) / len(pts)
    corner = random.choice(pts)
    q = corner + (corner - cen).normalized() * 1.9
    if town.free(q) and q.length < RADIUS:
        kit.thing('water_tank', q, random.uniform(0, 6.3), name='water_tank')
        town.solid_box(q, 1.4, 1.4, 0.0)
        town.mark_disk(q, 1.0)
for p, d, n in shoulder(main_pts, width / 2 + 0.7, 11.0, 4.0):
    if p.length < REACH - 5 and town.free(p) and random.random() < 0.35:
        kit.thing('waste_bin', p, random.uniform(0, 6.3), name='bin')
        town.solid_ring(p, 0.4, 6)
        town.mark_disk(p, 0.8)

# Up-country: trees in every yard, grass where nothing stands.
trees = town.trees(60, near_road=9, mix=(0.5, 0.3, 0.2))
patches = town.grass(260)
print('TREES', trees, 'GRASS', patches)

# Traffic lanes on the main road (driving on the right).
lanes = []
if sum((b - a).length for a, b in zip(main_pts, main_pts[1:])) > 60:
    for direction in (main_pts, main_pts[::-1]):
        lane = []
        for i, p in enumerate(direction):
            dd = (direction[min(len(direction) - 1, i + 1)] - direction[max(0, i - 1)]).normalized()
            q = p + Vector((dd.y, -dd.x)) * width / 4
            lane.append([round(q.x, 2), round(q.y, 2)])
        lanes.append(lane)

# Where the game starts: on the main road by the market.
mid = min(main_pts, key=lambda p: p.length)
k = main_pts.index(mid)
ahead = (main_pts[min(len(main_pts) - 1, k + 1)] - main_pts[max(0, k - 1)]).normalized()
spot = sum((Vector((v['x'], v['y'])) for v in town.places.values()), Vector((0, 0))) / max(1, len(town.places))
if spot.dot(ahead) < 0:
    ahead = -ahead
spawn = mid + Vector((-ahead.y, ahead.x)) * (width / 2 + 1.5)

if EXPORT:
    root = bpy.data.objects.new('voinjama', None)
    scene.collection.objects.link(root)

    def far(o):
        if o.type not in ('MESH', 'FONT'):
            return False
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        cx = sum(c.x for c in cs) / 8
        cy = sum(c.y for c in cs) / 8
        span = max(max(c.x for c in cs) - min(c.x for c in cs), max(c.y for c in cs) - min(c.y for c in cs))
        return span < 60 and math.hypot(cx, cy) > REACH + 15

    kit.game_export(root, None, far, EXPORT, os.path.join(OUT, 'voinjama_game.blend'), merge=True)
    plan = {
        'frame': 'x east, y north, metres from the main road at the middle of Voinjama',
        'centre': [c['lat'], c['lon']],
        'reach': REACH,
        'lanes': lanes,
        'spawn': {'x': round(spawn.x, 2), 'y': round(spawn.y, 2), 'face': [round(ahead.x, 3), round(ahead.y, 3)]},
        'places': town.places,
        'solids': [poly for poly in town.solids if min(math.hypot(x, y) for x, y in poly) < REACH + 5],
    }
    with open(EXPORT.replace('.glb', '.json'), 'w') as f:
        json.dump(plan, f, separators=(',', ':'))
    print('EXPORTED', EXPORT, os.path.getsize(EXPORT), 'solids', len(plan['solids']), 'places', sorted(town.places))
    sys.exit(0)

# ---- Light and pictures -------------------------------------------------------------------------

kit.daylight(sun_elevation=50, sun_heading=220)
cam, aim = kit.render_setup(samples=48)
side_v = Vector((-ahead.y, ahead.x))


def v3(p, z):
    return (p.x, p.y, z)


views = {
    'voinjama_main_road': (v3(mid - ahead * 25 + side_v * (width / 2 + 0.5), 1.65), v3(mid + ahead * 30, 1.8), 26),
    'voinjama_above': (v3(mid - side_v * 55 - ahead * 45, 35), v3(mid + ahead * 10, 0), 30),
}
for (eye, look, lens) in list(views.values()):
    e, l_ = Vector(eye[:2]), Vector(look[:2])
    if eye[2] > 5:
        continue
    for k in range(10):
        t = random.uniform(5, 28)
        q = e + (l_ - e).normalized() * t + Vector((-(l_ - e).y, (l_ - e).x)).normalized() * random.uniform(-3, 3)
        if town.free(q):
            kit.place(kit.person(random.choice(STANDING + WALKING)), q, kit.facing((random.uniform(-1, 1), random.uniform(-1, 1))))
            town.mark_disk(q, 0.8)
ONLY = os.environ.get('VOINJAMA_VIEWS', '').split(',') if os.environ.get('VOINJAMA_VIEWS') else None
for name, (at, look, lens) in views.items():
    if ONLY and name not in ONLY:
        continue
    kit.shoot(cam, aim, OUT, name, at, look, lens)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'voinjama.blend'))
