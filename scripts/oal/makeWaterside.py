# One Africa Life: Waterside Market, Monrovia, in 3D, from OpenStreetMap.
#
#   blender -b --factory-startup --python scripts/oal/makeWaterside.py -- <osm.json> <out dir>
#   WATERSIDE_EXPORT=<path>.glb ...: the game's copy (and <path>.json, its plan) instead of pictures
#
# The map (© OpenStreetMap contributors, ODbL) gives Water Street, Front Street and the streets
# behind, every building's outline, the Mesurado River with Providence Island in it, and the
# Gabriel Johnson Tucker Bridge. What a map does not say is drawn from how Waterside is: the
# biggest market in Monrovia along Water Street, between the shops on the ground floor of two- and
# three-storey blocks and the river; tables under zinc and tarpaulin shades, close together on
# both sides of the street: tomatoes, peppers, onions and bitter balls in heaps, enamel and
# plastic basins, bales of lappa cloth, second-hand clothes hung up, shoes, buckets; money
# changers at small tables under big umbrellas with their bundles of notes; a cookshop's pots;
# porters with wheelbarrows; rubbish where the drains meet the river; canoes pulled up on the
# bank; taxis and kekehs pushing through. Built from scenekit.py and town.py.
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
from market import KINDS, Market, shoulder  # noqa: E402
from town import Town  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OSM, OUT = args[0], os.path.expanduser(args[1])
EXPORT = os.environ.get('WATERSIDE_EXPORT')
kit.REAL_MODELS = not EXPORT
os.makedirs(OUT, exist_ok=True)
random.seed(11)
RADIUS = 120
REACH = 95.0

data = json.load(open(OSM))
# The centre: the point of Water Street nearest the river, where the market is thickest.
probe = Town(data, 6.3166, -10.8032, RADIUS)
water_rel = next(e for e in data['elements'] if e['type'] == 'relation' and e.get('tags', {}).get('natural') == 'water')
river = [p for ring in probe.rings(water_rel)[0] for p in ring]
water_street = probe.named('Water Street')[0]
centre_id = min(water_street['nodes'], key=lambda n: min((probe.xy(n) - q).length for q in river))
c = probe.nodes[centre_id]
town = Town(data, c['lat'], c['lon'], RADIUS)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
m = town.materials()
m_bank = photo('bank', 'brushed_concrete', scale=2.0, mul=(0.55, 0.5, 0.42), streaks=0.6)
m_water = kit.water('water', (0.07, 0.08, 0.05))
mk = Market(town)
m_timber = mk.timber
m_steel = flat('steel', (0.5, 0.5, 0.52), 0.5, 0.7)

LIGHT_PROPS = {'painted_wooden_bench', 'wooden_stool_01'}


def prop(name, *a, **k):
    if EXPORT and name not in LIGHT_PROPS:
        return None
    return kit.place(kit.model(name), *a, **k)


# ---- Ground, river, roads ---------------------------------------------------------------------

m_ground = photo('market_ground', 'concrete_floor_02', scale=3.0, mul=(0.62, 0.55, 0.47), streaks=0)
water, islands = town.ground_and_water(water_rel, m_ground, m_water, m_bank)
bridge = next(w for w in town.ways if w.get('tags', {}).get('bridge') == 'yes')
town.roads(skip=lambda w: w is bridge, clear=0.4)
water_pts = [town.way_points(w) for w in town.ways if w.get('tags', {}).get('name') == 'Water Street' and 'highway' in w.get('tags', {})]
print('CENTRE', c['lat'], c['lon'], 'river rings', len(water), 'islands', len(islands))

# ---- The bridge: its deck rising from the land on concrete piers, railings ----------------------

pts = town.way_points(bridge)
if pts[0].length > pts[-1].length:
    pts.reverse()
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
deck_w = 12.0
walked = 0.0
total = sum((b - a).length for a, b in zip(pts, pts[1:]))
for a, b in zip(pts, pts[1:]):
    seg = b - a
    d = seg.normalized()
    n = Vector((-d.y, d.x))
    step = 4.0
    t = 0.0
    while t < seg.length:
        p0, p1 = a + d * t, a + d * min(seg.length, t + step)
        h0 = min(7.0, (walked + t) / 40 * 7.0)
        h1 = min(7.0, (walked + min(seg.length, t + step)) / 40 * 7.0)
        mid = (p0 + p1) / 2
        if mid.length < RADIUS * 1.25:
            hm = (h0 + h1) / 2
            box(bm, uv, (mid.x, mid.y, hm - 0.6), ((p1 - p0).length + 0.05, deck_w, 0.6), math.atan2(d.y, d.x), pitch=math.atan2(h1 - h0, (p1 - p0).length))
            for side in (1, -1):
                q = mid + n * side * (deck_w / 2 - 0.1)
                box(bm, uv, (q.x, q.y, hm), ((p1 - p0).length + 0.05, 0.2, 1.0), math.atan2(d.y, d.x), mat=1, pitch=math.atan2(h1 - h0, (p1 - p0).length))
            if int((walked + t) / step) % 6 == 3 and walked + t > 30:
                for side in (1, -1):
                    q = mid + n * side * (deck_w / 2 - 1.5)
                    box(bm, uv, (q.x, q.y, -1.5), (1.4, 1.4, hm - 0.6 + 1.5), math.atan2(d.y, d.x), mat=1)
            if hm < 2.2:
                town.take_rect(mid, (p1 - p0).length, deck_w, math.atan2(d.y, d.x), margin=0.3)
        t += step
    walked += seg.length
kit.new_object('bridge', bm, [photo('bridge_deck', 'brushed_concrete', scale=4.0, mul=(0.62, 0.62, 0.6), streaks=0.5), photo('bridge_side', 'brushed_concrete', scale=3.0, mul=(0.75, 0.74, 0.7), streaks=0.8)])

# ---- Buildings, their ground floors shops facing the street --------------------------------------

SHOPS = ['ALHAJI BAH & SONS\nGENERAL MERCHANDISE', 'MAMA FATU\nLAPPA STORE', "GOD'S TIME IS THE BEST\nELECTRONICS", 'NIMBA BOYS\nSHOE CENTER', 'BLESSING\nBUILDING MATERIALS',
         'CHEAP PRICE STORE', 'UNITY WHOLESALE', 'SHEKINA\nCOSMETICS', 'LONE STAR\nPHONE & ACCESSORIES', 'GRACE & MERCY\nSUPERMARKET', 'GBARNGA BOYS\nHARDWARE', 'TRUST IN GOD\nTEXTILES']
random.shuffle(SHOPS)
m_shop_dark = flat('shop_dark', (0.03, 0.03, 0.03), 0.9)
SIGN_COLOURS = ['#2f6fb8', '#e2b62a', '#2f8a4a', '#c43a2a', '#f2ece0', '#6a3a8a']
m_signs = [flat(f'sign{i}', srgb(cl), 0.7) for i, cl in enumerate(SIGN_COLOURS)]
shops_made = [0]


def shopfront(pts, edge, storeys):
    """The side facing the street: shops one after another, their steel shutters rolled up over a
    dark doorway, a painted board over each with its name."""
    a, b = pts[edge], pts[(edge + 1) % len(pts)]
    seg = b - a
    if seg.length < 3.5:
        return
    d = seg.normalized()
    out = Vector((d.y, -d.x))
    yaw = math.atan2(d.y, d.x)
    count = max(1, int(seg.length / 3.6))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    for k in range(count):
        p = a + d * ((k + 0.5) * seg.length / count)
        w_ = seg.length / count - 0.5
        q = p + out * 0.03
        box(bm, uv, (q.x, q.y, 0), (w_, 0.05, 2.5), yaw, mat=0)
        q = p + out * 0.06
        box(bm, uv, (q.x, q.y, 2.5), (w_ + 0.2, 0.12, 0.45), yaw, mat=1)
        board = random.randrange(len(m_signs))
        q = p + out * 0.12
        box(bm, uv, (q.x, q.y, 2.95), (w_, 0.06, 0.7), yaw, mat=2 + board)
        if k == count // 2:
            name = SHOPS[shops_made[0] % len(SHOPS)]
            shops_made[0] += 1
            ink = '#1a1a1a' if SIGN_COLOURS[board] in ('#e2b62a', '#f2ece0') else '#f4efe2'
            kit.text(name, p + out * 0.17, kit.facing(out), 0.2 if '\n' in name else 0.24, ink, 3.33)
    kit.new_object('shopfront', bm, [m_shop_dark, m['shutter']] + m_signs)


def storeys_for(tags, area, big):
    levels = tags.get('building:levels', '')
    if levels.replace('.', '').isdigit():
        return max(1, min(8, int(float(levels))))
    return random.choices([2, 3, 4], [0.4, 0.4, 0.2])[0] if big else random.choices([1, 2], [0.4, 0.6])[0]


def facing_market(tags, cen):
    return True


town.buildings(storeys_for, shopfront)
print('BUILT', len(town.footprints), 'buildings')

# ---- The market along Water Street ----------------------------------------------------------------

STANDING = ['man_phone', 'man_idle', 'man_talk', 'man_argue', 'woman_idle', 'woman_phone', 'woman_looking']
WALKING = ['man_walk', 'woman_walk', 'man_carry']
width = 7.0  # Water Street's, for what goes on it
specials = ['stall', 'changer', 'cookshop']
stalls = 0
market_streets = [(town.way_points(w), town.road_width(w)) for w in town.ways if w.get('tags', {}).get('name') in ('Water Street', 'Front Street', 'Center Street') and 'highway' in w.get('tags', {})]
rows = [(pts, w_, side, row) for pts, w_ in market_streets for side in (1, -1) for row in (0, 1)]
for pts, width, side, row in rows:
    for p, d, n in shoulder(pts, side * (width / 2 + 1.05 + row * 2.9), 2.45, start=random.uniform(0, 1.2)):
            n_out = n * side
            if p.length > REACH - 5 or not town.rect_free(p, 2.3, 1.2, math.atan2(d.y, d.x), 0.15):
                continue
            # The places in the game, near the centre: the trader's own table, a money changer,
            # a cookshop.
            apart = all((p - Vector((v['x'], v['y']))).length > 7 for v in town.places.values())
            special = specials[0] if specials and row == 0 and p.length < 40 and apart and random.random() < 0.35 else None
            if special:
                specials.pop(0)
            yaw = math.atan2(d.y, d.x)
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
                kit.new_object('changer_table', bm, [m_timber, flat('notes', srgb('#6a8a5a'), 0.8)])
                mk.umbrella(p + n_out * 0.3, ('#2a6ab8', '#f2e6c8'))
                prop('wooden_stool_01', p + n_out * 0.7, yaw)
                kit.place(kit.person('man_sit'), p + n_out * 0.7, kit.facing(-n_out))
                kit.text('MONEY EXCHANGE\nUSD  LRD', p + d * 0.0 - n_out * 0.31, kit.facing(-n_out), 0.09, '#141414', 0.62)
                town.solid_box(p, 1.0, 0.7, yaw)
                town.take_rect(p, 1.6, 1.4, yaw, 0.1, solid=False)
                town.place('changer', p - n_out * 1.3, n_out)
                continue
            if special == 'cookshop':
                bm = bmesh.new()
                uv = bm.loops.layers.uv.new()
                for k in range(2):
                    q = p + d * (-0.5 + k)
                    pot = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.28, radius2=0.3, depth=0.4)
                    for v in pot['verts']:
                        v.co += Vector((q.x, q.y, 0.5))
                    stove = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.25, radius2=0.22, depth=0.3)
                    for v in stove['verts']:
                        v.co += Vector((q.x, q.y, 0.15))
                        if v.co.z > 0.2:
                            pass
                    for f in {f for v in stove['verts'] for f in v.link_faces}:
                        f.material_index = 1
                kit.new_object('cookshop_pots', bm, [m_steel, flat('coal_pot', (0.05, 0.05, 0.05), 0.9)])
                mk.umbrella(p, ('#e8b41c', '#2a8a4a'))
                prop('painted_wooden_bench', p - n_out * 1.2, yaw)
                kit.place(kit.person('woman_idle'), p + n_out * 0.6, kit.facing(-n_out))
                kit.text("MA KEBBEH'S\nCOOKSHOP", p + n_out * 0.1, kit.facing(-n_out), 0.14, '#141414', 1.0)
                town.solid_box(p, 2.0, 0.9, yaw)
                town.take_rect(p, 2.6, 2.6, yaw, 0.1, solid=False)
                town.place('cookshop', p - n_out * 1.6, n_out)
                continue
            kind = random.choice(KINDS)
            deep = mk.stall(p, d, n_out, kind if special != 'stall' else 'produce')
            town.take_rect(p, 2.3, 1.2, yaw, 0.15, solid=False)
            if special == 'stall':
                kit.text('TABLE 14 · DUES PAID', p - n_out * (deep / 2 + 0.02), kit.facing(-n_out), 0.1, '#141414', 0.5)
                town.place('stall', p - n_out * (deep / 2 + 0.9), n_out)
            elif random.random() < 0.6:
                who = random.choice(['woman_idle', 'woman_looking', 'man_idle', 'woman_phone'])
                kit.place(kit.person(who), p + n_out * (deep / 2 + 0.5), kit.facing(-n_out))
            # Buyers in front of the tables (in pictures; the game draws its own people).
            if not EXPORT and random.random() < 0.55:
                kit.place(kit.person(random.choice(STANDING + WALKING)), p - n_out * (deep / 2 + random.uniform(0.6, 1.4)) + d * random.uniform(-0.8, 0.8), kit.facing(n_out.lerp(d, random.uniform(-0.7, 0.7))))
            stalls += 1
print('STALLS', stalls, 'places', sorted(town.places))

# The vegetable stand (the owner's scan, baked light) and its neighbours, by the shops.
for k in range(3):
    lot = town.find_lot(6.9, 1.8, 15, REACH - 10, 0.0)
    if lot:
        kit.thing('veg_stand_light', lot[0], lot[1] + math.pi, z=-0.08, name='veg_stand')

# Porters with wheelbarrows, rubbish, a skip, bins.
for pts in water_pts:
    for p, d, n in shoulder(pts, random.choice([-1, 1]) * (width / 2 - 0.8), 9.0, random.uniform(0, 5)):
        if p.length > REACH - 5 or random.random() > 0.45 or not town.free(p):
            continue
        r = random.random()
        yaw = math.atan2(d.y, d.x)
        if r < 0.4:
            kit.thing('wheelbarrow', p, yaw + random.uniform(-0.4, 0.4), name='wheelbarrow')
            town.solid_box(p, 1.5, 0.7, yaw)
            kit.place(kit.person('man_carry'), p - d * 1.1, kit.facing(d))
        elif r < 0.55:
            kit.thing('waste_bin', p, random.uniform(0, 6.3), name='bin')
            town.solid_ring(p, 0.4, 6)
        else:
            kit.place(kit.person(random.choice(WALKING + STANDING)), p, kit.facing(d if random.random() < 0.5 else -d))
        town.mark_disk(p, 1.0)
for what, along, across in (('skip', 3.7, 2.5), ('dumpsters', 4.0, 2.0)):
    lot = town.find_lot(along, across, 20, REACH - 5, 0.0)
    if lot:
        kit.thing(what, lot[0], lot[1], name=what)
for _ in range(25):
    p = Vector((random.uniform(-RADIUS, RADIUS), random.uniform(-RADIUS, RADIUS)))
    if p.length < REACH and town.free(p):
        prop(random.choice(['trashbag', 'old_tyre', 'cardboard_box_01', 'plastic_jerrycan']), p, random.uniform(0, 6.3))

# Canoes pulled up on the bank and lying in the water near it.
m_canoe = [flat('canoe_wood', srgb('#5a3a22'), 0.85), flat('canoe_paint', srgb('#2a6ab8'), 0.7)]
canoes = 0
for ring in water:
    for a, b in zip(ring, ring[1:] + ring[:1]):
        seg = b - a
        if seg.length < 3:
            continue
        d = seg.normalized()
        n = Vector((-d.y, d.x))
        t = random.uniform(2, 8)
        while t < seg.length and canoes < 9:
            e = a + d * t
            t += random.uniform(6, 14)
            if e.length > REACH - 8:
                continue
            into = n if town.inside(e + n * 2.0, ring) else -n
            q = e + into * random.uniform(1.8, 4.5)
            bm = bmesh.new()
            bm.loops.layers.uv.new()
            hull = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=1.0)
            for v in hull['verts']:
                v.co = Vector((v.co.x * 3.6, v.co.y * 0.55, min(0.0, v.co.z) * 0.45))
            for f in {f for v in hull['verts'] for f in v.link_faces}:
                f.material_index = 1 if f.calc_center_median().z > -0.08 else 0
            obj = kit.new_object('canoe', bm, m_canoe)
            obj.location = (q.x, q.y, -0.55)
            obj.rotation_euler = (0, 0, math.atan2(d.y, d.x) + random.uniform(-0.4, 0.4))
            canoes += 1
print('CANOES', canoes)

# Traffic on Water Street: taxis and kekehs edging through, on the right.
for pts in water_pts:
    for lane in (-1, 1):
        for p, d, n in shoulder(pts, -lane * width / 4, 16.0, random.uniform(0, 8)):
            if p.length > REACH - 5 or random.random() > 0.55:
                continue
            heading = d if lane == 1 else -d
            yaw = math.atan2(heading.y, heading.x)
            if EXPORT:
                # The game drives its own traffic along the lanes: the same chance taken, nothing put.
                random.random()
                continue
            if random.random() < 0.6:
                kit.car(p, yaw, '#e9b51c', 'saloon', taxi=True)
                town.solid_box(p, 4.6, 1.9, yaw)
            else:
                kit.kekeh(p, yaw)
                town.solid_box(p, 2.8, 1.4, yaw)

trees = town.trees(18, near_road=10, mix=(0.6, 0.2, 0.2))
patches = town.grass(60)
print('TREES', trees, 'GRASS', patches)

# Where the game starts: on Water Street, at the taxi stop by the bridge end of the market.
line = [p for pts in water_pts for p in pts]
mid = min(line, key=lambda p: p.length)
along = next((p for p in line if 15 < (p - mid).length < 60), line[-1]) - mid
along.normalize()
# Facing the market's places.
ahead = sum((Vector((v['x'], v['y'])) for v in town.places.values()), Vector((0, 0))) / max(1, len(town.places))
if ahead.dot(along) < 0:
    along = -along
spawn = mid + Vector((-along.y, along.x)) * 1.5

# Water Street's two lanes for the game's traffic, driving on the right.
lanes = []
for pts in water_pts:
    if sum((b - a).length for a, b in zip(pts, pts[1:])) < 60:
        continue
    for direction in (pts, pts[::-1]):
        lane = []
        for i, p in enumerate(direction):
            d = (direction[min(len(direction) - 1, i + 1)] - direction[max(0, i - 1)]).normalized()
            q = p + Vector((d.y, -d.x)) * width / 4
            lane.append([round(q.x, 2), round(q.y, 2)])
        lanes.append(lane)

if EXPORT:
    root = bpy.data.objects.new('waterside', None)
    scene.collection.objects.link(root)

    def far(o):
        if o.type not in ('MESH', 'FONT'):
            return False
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        cx = sum(c.x for c in cs) / 8
        cy = sum(c.y for c in cs) / 8
        span = max(max(c.x for c in cs) - min(c.x for c in cs), max(c.y for c in cs) - min(c.y for c in cs))
        return span < 60 and math.hypot(cx, cy) > REACH + 15

    kit.game_export(root, None, far, EXPORT, os.path.join(OUT, 'waterside_game.blend'), merge=True)
    plan = {
        'frame': 'x east, y north, metres from Water Street at its nearest to the Mesurado River',
        'reach': REACH,
        'lanes': lanes,
        'spawn': {'x': round(spawn.x, 2), 'y': round(spawn.y, 2), 'face': [round(along.x, 3), round(along.y, 3)]},
        'places': town.places,
        'solids': [poly for poly in town.solids if min(math.hypot(x, y) for x, y in poly) < REACH + 5 or len(poly) > 40],
    }
    with open(EXPORT.replace('.glb', '.json'), 'w') as f:
        json.dump(plan, f, separators=(',', ':'))
    print('EXPORTED', EXPORT, os.path.getsize(EXPORT), 'solids', len(plan['solids']), 'places', sorted(town.places))
    sys.exit(0)

# ---- Light and pictures -------------------------------------------------------------------------

kit.daylight(sun_elevation=52, sun_heading=230)
cam, aim = kit.render_setup(samples=48)
side = Vector((-along.y, along.x))


def v3(p, z):
    return (p.x, p.y, z)


street_line = next(pts for pts in water_pts if mid in pts)
k0 = street_line.index(mid)


def along_street(dist):
    """The point dist metres along Water Street from the centre (back if negative)."""
    k, left, here = k0, abs(dist), mid
    step = 1 if dist > 0 else -1
    while 0 <= k + step < len(street_line):
        nxt = street_line[k + step]
        if (nxt - here).length >= left:
            return here + (nxt - here).normalized() * left
        left -= (nxt - here).length
        here, k = nxt, k + step
    return here


views = {
    'waterside_market': (v3(along_street(-24), 1.65), v3(along_street(10), 1.8), 26),
    'waterside_market_back': (v3(along_street(24), 1.65), v3(along_street(-10), 1.8), 26),
    'waterside_above': (v3(mid - side * 45 - along * 40, 30), v3(mid + along * 10, 0), 30),
}
# From the riverbank toward the bridge.
bank = min((p for ring in water for p in ring if p.length < REACH - 10), key=lambda p: p.length, default=None)
if bank is not None:
    bpts = town.way_points(bridge)
    views['waterside_river'] = (v3(bank + (bank - mid).normalized() * 1.5, 1.9), v3(bpts[len(bpts) // 2], 4.0), 24)
for (eye, look, lens) in list(views.values()):
    e, l_ = Vector(eye[:2]), Vector(look[:2])
    if eye[2] > 5:
        continue
    for k in range(10):
        t = random.uniform(5, 28)
        q = e + (l_ - e).normalized() * t + Vector((-(l_ - e).y, (l_ - e).x)).normalized() * random.uniform(-2.5, 2.5)
        if town.free(q):
            kit.place(kit.person(random.choice(STANDING + WALKING)), q, kit.facing((random.uniform(-1, 1), random.uniform(-1, 1))))
            town.mark_disk(q, 0.8)
ONLY = os.environ.get('WATERSIDE_VIEWS', '').split(',') if os.environ.get('WATERSIDE_VIEWS') else None
for name, (at, look, lens) in views.items():
    if ONLY and name not in ONLY:
        continue
    kit.shoot(cam, aim, OUT, name, at, look, lens)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'waterside.blend'))
