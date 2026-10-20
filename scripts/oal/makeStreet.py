# One Africa Life: a piece of a real Monrovia street in 3D, from OpenStreetMap, to judge the look.
#
#   blender -b --factory-startup --python scripts/oal/makeStreet.py -- <osm.json> <out dir>
#
# The map (OpenStreetMap, © OpenStreetMap contributors, ODbL) gives where every road and building
# really is. What a map does not say is drawn here from how Sinkor looks: houses of one or two
# storeys in painted plaster, faded by sun and rain with red dust splashed up their foot, windows
# behind iron bars, hipped roofs of corrugated zinc gone to rust, air-conditioners on the walls;
# bigger blocks in concrete with flat roofs and water tanks; compound walls with steel gates along
# every street; zinc kiosks with rusty shutters and painted names on the boulevard's red-earth
# shoulder, a generator by them, white plastic chairs; a woman selling bananas under an umbrella;
# yellow taxis and kekehs, cars driving on the right; people standing, phoning, sitting, walking;
# coconut palms; wooden poles carrying the wires. Built from scripts/oal/scenekit.py.
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

args = sys.argv[sys.argv.index('--') + 1:]
OSM, OUT = args[0], os.path.expanduser(args[1])
# STREET_EXPORT=<path>.glb: the game's copy instead of pictures (and <path>.json, its plan: the
# solid shapes to walk against and the places to stop at, in metres east and north of the
# junction).
EXPORT = os.environ.get('STREET_EXPORT')
kit.REAL_MODELS = not EXPORT
SOLIDS = []   # polygons [[x, y], ...]
PLACES = {}   # what: {x, y, face: [dx, dy]}


# Props from Poly Haven: in pictures, all; in the game's copy only the light ones (an air
# conditioner alone is 100,000 triangles).
LIGHT_PROPS = {'painted_wooden_bench'}
# The owner's models whose front is not their -Y side: turned this much more (found by looking).
FRONT_TURN = {'veg_stand': math.pi}


def prop(name, *args, **kwargs):
    if EXPORT and (name[0] if isinstance(name, tuple) else name) not in LIGHT_PROPS:
        return None
    return kit.place(kit.model(name[0] if isinstance(name, tuple) else name), *args, **kwargs)


def solid_box(centre, along, across, yaw):
    c, s_ = math.cos(yaw), math.sin(yaw)
    SOLIDS.append([[round(centre.x + x * c - y * s_, 2), round(centre.y + x * s_ + y * c, 2)] for x, y in ((-along / 2, -across / 2), (along / 2, -across / 2), (along / 2, across / 2), (-along / 2, across / 2))])
def ring(p, r, sides=8):
    return [[round(p.x + r * math.cos(k * 2 * math.pi / sides), 2), round(p.y + r * math.sin(k * 2 * math.pi / sides), 2)] for k in range(sides)]


os.makedirs(OUT, exist_ok=True)
random.seed(4)
RADIUS = 170  # metres around the centre that are built

data = json.load(open(OSM))
nodes = {e['id']: e for e in data['elements'] if e['type'] == 'node'}
ways = [e for e in data['elements'] if e['type'] == 'way']
roads = [w for w in ways if 'highway' in w.get('tags', {}) and w['tags']['highway'] not in ('path', 'footway', 'steps')]
buildings = [w for w in ways if 'building' in w.get('tags', {})]

# The centre: where Tubman Boulevard meets 16th Street.
tubman = [w for w in roads if w['tags'].get('name') == 'Tubman Boulevard']
sixteenth = [w for w in roads if w['tags'].get('name') == '16th Street']
shared = {n for w in tubman for n in w['nodes']} & {n for w in sixteenth for n in w['nodes']}
centre = nodes[next(iter(shared))] if shared else nodes[tubman[0]['nodes'][len(tubman[0]['nodes']) // 2]]
LAT0, LON0 = centre['lat'], centre['lon']
M_LAT = 111_320.0
M_LON = 111_320.0 * math.cos(math.radians(LAT0))


def xy(node_id):
    n = nodes[node_id]
    return Vector(((n['lon'] - LON0) * M_LON, (n['lat'] - LAT0) * M_LAT))


def road_width(w):
    kind = w['tags']['highway']
    lanes = w['tags'].get('lanes', '')
    if kind == 'trunk':
        return 3.4 * (int(lanes) if lanes.isdigit() else 4)
    return {'primary': 9.0, 'secondary': 8.0, 'tertiary': 7.0, 'residential': 5.5, 'unclassified': 5.5, 'service': 3.6}.get(kind, 3.0)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- Materials ---------------------------------------------------------------------------------

# The colours houses in Sinkor are painted: sun-faded creams, yellows, pale greens and blues, a
# pink, a salmon; some left grey in bare cement render.
PAINTS = ['#e9dcb8', '#e8c97a', '#cfdcb8', '#a9c8d6', '#e8b8a8', '#d99a7a', '#f2ece0', '#b8d4b0', '#e6d39a', '#9fb8d8']
wall_mats = [photo(f'wall_{p}', random.choice(['painted_plaster_wall', 'white_stucco']), scale=2.5, tint=srgb(p), tint_amount=0.9, dust=0.8) for p in PAINTS]
wall_mats.append(photo('wall_bare', 'white_stucco', scale=3.0, tint=srgb('#b4afa6'), tint_amount=1.0, dust=0.7))
m_compound = [photo(f'compound_{p}', 'white_stucco', scale=2.5, tint=srgb(p), tint_amount=0.9, dust=0.95) for p in ('#d8d0c0', '#e8c97a', '#f2ece0', '#c0c8b8')]
m_zinc_rust = photo('zinc_rust', 'rusty_corrugated_iron', scale=2.0, metallic=0.3, streaks=0)
m_zinc = photo('zinc', 'corrugated_iron_02', scale=2.0, metallic=0.7, rough_mul=0.9, streaks=0)
m_flatroof = photo('flatroof', 'white_stucco', scale=4.0, tint=srgb('#8f8a82'), tint_amount=1.0)
m_asphalt = photo('asphalt', 'road_damaged_clean', scale=4.0, mul=(0.5, 0.5, 0.52), streaks=0)
m_side = photo('side_road', 'road_damaged_clean', scale=3.0, mul=(0.62, 0.6, 0.58), streaks=0)
m_earth = photo('earth', 'red_laterite_soil_stones', scale=3.0, mul=(1.0, 0.78, 0.62), streaks=0)
m_dirt = photo('dirt_road', 'red_dirt_mud_01', scale=3.0, mul=(1.0, 0.8, 0.66), streaks=0)
m_shutter = photo('shutter', 'rusty_metal_shutter', scale=2.2, metallic=0.4, streaks=0)
m_curb = flat('curb', (0.25, 0.24, 0.22), 0.9)
m_glass = flat('glass', (0.02, 0.025, 0.03), 0.15)
m_bars = flat('bars', (0.03, 0.03, 0.03), 0.5, 0.6)
m_frame = flat('frame', (0.55, 0.52, 0.48), 0.8)
m_doors = [flat(f'door{i}', srgb(c), 0.6, 0.3) for i, c in enumerate(['#3a2a20', '#1f3a4a', '#5a2a1c', '#2a4a2a', '#3a3a3a'])]
m_gate = [flat(f'gate{i}', srgb(c), 0.55, 0.5) for i, c in enumerate(['#2a3f6a', '#1a1a1a', '#6a1f1f', '#2a5a3a', '#7a6a2a'])]
KIOSK_COLOURS = ['#2f6fb8', '#e2b62a', '#2f8a4a', '#c43a2a', '#e8e0d0', '#6a3a8a']
m_kiosk = [flat(f'kiosk{i}', srgb(c), 0.7) for i, c in enumerate(KIOSK_COLOURS)]
m_wood = flat('pole', (0.15, 0.11, 0.08), 0.9)
m_wire = flat('wire', (0.01, 0.01, 0.01), 0.5)
m_paint = flat('paint', (0.55, 0.53, 0.48), 0.9)

# ---- Where things are: a grid of what is road and what is building --------------------------

CELL = 1.0


def cell(p):
    return int((p.x + RADIUS * 1.3) / CELL), int((p.y + RADIUS * 1.3) / CELL)


occupied = set()


def mark_disk(p, r):
    cx, cy = cell(p)
    k = int(r / CELL) + 1
    for dx in range(-k, k + 1):
        for dy in range(-k, k + 1):
            if (dx * dx + dy * dy) * CELL * CELL <= r * r:
                occupied.add((cx + dx, cy + dy))


def free(p):
    return cell(p) not in occupied


# ---- The ground and the roads ------------------------------------------------------------------

bm = bmesh.new()
uv = bm.loops.layers.uv.new()
g = RADIUS * 1.3
f = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in ((-g, -g), (g, -g), (g, g), (-g, g))])
for loop in f.loops:
    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
kit.new_object('ground', bm, [m_earth])

road_lines = []
for w in roads:
    pts = [xy(n) for n in w['nodes']]
    if all(p.length > RADIUS * 1.2 for p in pts):
        continue
    width = road_width(w)
    surface = w['tags'].get('surface', '')
    trunk = w['tags']['highway'] == 'trunk'
    # Many of Sinkor's side streets are paved, some are red earth (OSM tags say which when known).
    mat = m_asphalt if trunk else (m_dirt if surface in ('unpaved', 'dirt', 'ground', 'gravel', 'compacted') or (not surface and w['tags']['highway'] == 'service') else m_side)
    road_lines.append((pts, width, trunk))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rows = []
    along = 0.0
    for i, p in enumerate(pts):
        d = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        n = Vector((-d.y, d.x))
        if i:
            along += (p - pts[i - 1]).length
        lift = 0.03 if trunk else 0.02
        rows.append((bm.verts.new((*(p + n * width / 2), lift)), bm.verts.new((*(p - n * width / 2), lift)), along))
        if i + 1 < len(pts):
            seg = pts[i + 1] - p
            for s in range(0, int(seg.length) + 1):
                mark_disk(p + seg.normalized() * s, width / 2 + 1.5)
    for (l0, r0, a0), (l1, r1, a1) in zip(rows, rows[1:]):
        face = bm.faces.new((l0, r0, r1, l1))
        for loop, (u, v) in zip(face.loops, ((width, a0), (0, a0), (0, a1), (width, a1))):
            loop[uv].uv = (u, v)
    kit.new_object('road', bm, [mat])
    if trunk:
        # Faded lane markings: a solid line in the middle, dashes between the lanes.
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        for off, dash in ((0.0, False), (width / 4, True), (-width / 4, True)):
            walked = 0.0
            for a, b in zip(pts, pts[1:]):
                seg = b - a
                ln = seg.length
                if ln < 0.1:
                    continue
                d = seg.normalized()
                n = Vector((-d.y, d.x))
                t = 0.0
                while t < ln:
                    step = 3.0 if dash else min(4.0, ln - t)
                    on = not dash or int((walked + t) / 3.0) % 3 == 0
                    if on and random.random() > 0.25:
                        p0, p1 = a + d * t + n * off, a + d * min(ln, t + step) + n * off
                        bm.faces.new([bm.verts.new((*(p + n * s), 0.035)) for p, s in ((p0, 0.07), (p0, -0.07), (p1, -0.07), (p1, 0.07))])
                    t += step
                walked += ln
        kit.new_object('lines', bm, [m_paint])
        # A low concrete kerb along both edges.
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        for side in (1, -1):
            for a, b in zip(pts, pts[1:]):
                seg = b - a
                if seg.length < 0.1:
                    continue
                d = seg.normalized()
                n = Vector((-d.y, d.x)) * side
                mid = (a + b) / 2 + n * (width / 2 + 0.15)
                box(bm, uv, (mid.x, mid.y, 0), (seg.length + 0.05, 0.3, 0.16), math.atan2(seg.y, seg.x))
        kit.new_object('kerb', bm, [m_curb])

# ---- Buildings ---------------------------------------------------------------------------------


def area(points):
    return 0.5 * sum(points[i].x * points[(i + 1) % len(points)].y - points[(i + 1) % len(points)].x * points[i].y for i in range(len(points)))


def inside(p, poly):
    hit = False
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if (a.y > p.y) != (b.y > p.y) and p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x:
            hit = not hit
    return hit


def nearest_road(p):
    best = (1e9, None)
    for pts, width, trunk in road_lines:
        for a, b in zip(pts, pts[1:]):
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
            dist = (a + ab * t - p).length
            if dist < best[0]:
                best = (dist, (a + ab * t))
    return best


def hip_roof(bm, uv, pts, z, overhang, pitch):
    """A hipped roof: on four-sided footprints a ridge along the long side, otherwise a pyramid."""
    c = sum(pts, Vector((0, 0))) / len(pts)
    ring = [p + (p - c).normalized() * overhang for p in pts]
    lo = [bm.verts.new((p.x, p.y, z - 0.05)) for p in ring]
    if len(pts) == 4:
        e0, e1 = (ring[1] - ring[0]), (ring[2] - ring[1])
        long_axis, short = (e0, e1.length) if e0.length >= e1.length else (e1, e0.length)
        rise = short / 2 * pitch
        half = max(0.0, long_axis.length / 2 - short / 2)
        d = long_axis.normalized()
        r0 = bm.verts.new((*(c - d * half), z + rise))
        r1 = bm.verts.new((*(c + d * half), z + rise))
        ends = [r0 if (p - c).dot(d) < 0 else r1 for p in ring]
        faces = []
        for i in range(4):
            j = (i + 1) % 4
            if ends[i] is ends[j]:
                faces.append(bm.faces.new((lo[i], lo[j], ends[i])))
            else:
                faces.append(bm.faces.new((lo[i], lo[j], ends[j], ends[i])))
    else:
        rise = min(1.8, 0.25 * math.sqrt(abs(area(pts)))) * pitch * 2
        top = bm.verts.new((c.x, c.y, z + rise))
        faces = [bm.faces.new((lo[i], lo[(i + 1) % len(lo)], top)) for i in range(len(lo))]
    for face in faces:
        face.material_index = 1
        # The corrugations run down the slope.
        face.normal_update()
        n = face.normal
        flatn = Vector((n.x, n.y))
        down = flatn.normalized() if flatn.length > 1e-6 else Vector((1, 0))
        across = Vector((-down.y, down.x))
        for loop in face.loops:
            p = loop.vert.co.xy
            loop[uv].uv = (p.dot(across), p.dot(down) * 1.1)
    for i in range(len(ring)):
        j = (i + 1) % len(ring)
        a, b = ring[i], ring[j]
        face = bm.faces.new((bm.verts.new((a.x, a.y, z - 0.25)), bm.verts.new((b.x, b.y, z - 0.25)), lo[j], lo[i]))
        face.material_index = 0


def build(pts, storeys, big, road_point):
    floor_h = 3.0
    height = storeys * floor_h + (0.6 if big else 0.3)
    wall = random.choice(wall_mats[:-1] if not big or random.random() < 0.5 else wall_mats[-1:])
    roof = m_flatroof if big else (m_zinc_rust if random.random() < 0.7 else m_zinc)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    base = [bm.verts.new((p.x, p.y, 0)) for p in pts]
    top = [bm.verts.new((p.x, p.y, height)) for p in pts]
    along = 0.0
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        ln = (pts[j] - pts[i]).length
        face = bm.faces.new((base[i], base[j], top[j], top[i]))
        for loop, (u, v) in zip(face.loops, ((along, 0), (along + ln, 0), (along + ln, height), (along, height))):
            loop[uv].uv = (u, v)
        along += ln
    lid = bm.faces.new(top)
    lid.material_index = 1
    for loop in lid.loops:
        loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
    if big:
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            seg = b - a
            if seg.length < 0.1:
                continue
            mid = (a + b) / 2 + Vector((-seg.y, seg.x)).normalized() * 0.1
            box(bm, uv, (mid.x, mid.y, height), (seg.length, 0.2, 0.7), math.atan2(seg.y, seg.x))
        c = sum(pts, Vector((0, 0))) / len(pts)
        tank = bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.8, radius2=0.8, depth=1.6)
        for v in tank['verts']:
            v.co += Vector((c.x, c.y, height + 0.8))
    else:
        hip_roof(bm, uv, pts, height, 0.55, random.uniform(0.35, 0.5))
    kit.new_object('building', bm, [wall, roof])

    # Windows (glass behind iron bars, in a plain surround), a door on the side facing the road,
    # and air-conditioners hung on the wall here and there.
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    door_edge = min(range(len(pts)), key=lambda i: (((pts[i] + pts[(i + 1) % len(pts)]) / 2) - road_point).length - 0.3 * (pts[(i + 1) % len(pts)] - pts[i]).length)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        seg = b - a
        ln = seg.length
        if ln < 2.2:
            continue
        d = seg.normalized()
        out = Vector((d.y, -d.x))
        yaw = math.atan2(d.y, d.x)
        spacing = random.uniform(2.8, 4.2) if not big else random.uniform(2.4, 3.0)
        count = max(1, int((ln - 1.0) / spacing))
        start = (ln - (count - 1) * spacing) / 2
        door_at = random.randrange(count) if i == door_edge else -1
        for s in range(storeys):
            for k in range(count):
                t = start + k * spacing + random.uniform(-0.25, 0.25)
                p = a + d * t
                if s == 0 and k == door_at:
                    q = p + out * 0.02
                    box(bm, uv, (q.x, q.y, 0), (1.25, 0.06, 2.3), yaw, mat=2)
                    q = p + out * 0.05
                    box(bm, uv, (q.x, q.y, 0), (1.0, 0.06, 2.15), yaw, mat=3)
                    continue
                if random.random() < (0.12 if big else 0.25):
                    continue
                w_, h_ = (1.2, 1.3) if not big else (1.5, 1.5)
                z = s * floor_h + 0.9
                q = p + out * 0.02
                box(bm, uv, (q.x, q.y, z - 0.1), (w_ + 0.24, 0.06, h_ + 0.2), yaw, mat=2)
                q = p + out * 0.05
                box(bm, uv, (q.x, q.y, z), (w_, 0.04, h_), yaw, mat=0)
                if not big or s == 0:
                    for bx in range(5):
                        q = p + out * 0.1 + d * (-w_ / 2 + (bx + 0.5) * w_ / 5)
                        box(bm, uv, (q.x, q.y, z), (0.025, 0.025, h_), yaw, mat=1)
                    for bz in (0.33, 0.66):
                        q = p + out * 0.1
                        box(bm, uv, (q.x, q.y, z + h_ * bz), (w_, 0.025, 0.025), yaw, mat=1)
                if random.random() < (0.25 if big else 0.12):
                    q = p + d * (w_ / 2 + 0.6) + out * 0.05
                    prop('exterior_aircon_unit', q, yaw, z=z + 0.2)
    kit.new_object('openings', bm, [m_glass, m_bars, m_frame, random.choice(m_doors)])


footprints = []
for w in buildings:
    pts = [xy(n) for n in w['nodes'][:-1]]
    if len(pts) < 3 or (sum(pts, Vector((0, 0))) / len(pts)).length > RADIUS:
        continue
    if area(pts) < 0:
        pts.reverse()
    footprints.append((pts, w['tags']))

for pts, tags in footprints:
    a = abs(area(pts))
    big = tags.get('building') in ('commercial', 'retail', 'office', 'clinic', 'hospital', 'public', 'school') or a > 450
    levels = tags.get('building:levels', '')
    if levels.replace('.', '').isdigit():
        storeys = max(1, min(8, int(float(levels))))
    elif big:
        storeys = random.choices([2, 3, 4], [0.5, 0.35, 0.15])[0]
    else:
        storeys = random.choices([1, 2], [0.7, 0.3])[0]
    c = sum(pts, Vector((0, 0))) / len(pts)
    dist, near = nearest_road(c)
    build(pts, storeys, big, near if near is not None else c)
    SOLIDS.append([[round(q.x, 2), round(q.y, 2)] for q in pts])
    for p in pts:
        mark_disk(p, 1.2)
    xs, ys = [p.x for p in pts], [p.y for p in pts]
    x = min(xs)
    while x <= max(xs):
        y = min(ys)
        while y <= max(ys):
            if inside(Vector((x, y)), pts):
                mark_disk(Vector((x, y)), 1.2)
            y += CELL
        x += CELL
print('BUILT', len(footprints), 'buildings')

# ---- Compound walls with gates -------------------------------------------------------------

walls_bm = bmesh.new()
walls_uv = walls_bm.loops.layers.uv.new()
gates = bmesh.new()
gates_uv = gates.loops.layers.uv.new()
walls_made = 0


def flush(run):
    global walls_made
    if len(run) >= 4:
        colour = random.randrange(len(m_compound))
        for (p0, _d0), (p1, _d1) in zip(run, run[1:]):
            seg = p1 - p0
            mid = (p0 + p1) / 2
            box(walls_bm, walls_uv, (mid.x, mid.y, 0), (seg.length + 0.02, 0.22, 2.2), math.atan2(seg.y, seg.x), mat=colour)
            solid_box(mid, seg.length + 0.02, 0.3, math.atan2(seg.y, seg.x))
        for p, _d in run:
            mark_disk(p, 0.7)
        walls_made += 1
    run.clear()


for pts, width, trunk in road_lines:
    for side in (1, -1):
        setback = width / 2 + (random.uniform(4.5, 7.0) if trunk else random.uniform(1.6, 2.6))
        run = []
        for a, b in zip(pts, pts[1:]):
            seg = b - a
            if seg.length < 0.1:
                continue
            d = seg.normalized()
            n = Vector((-d.y, d.x)) * side
            t = 0.0
            while t < seg.length:
                p = a + d * t + n * setback
                ok = p.length < RADIUS and free(p) and free(p - n * 0.8)
                if ok and run and random.random() < 0.035:
                    gw = random.choice([1.2, 3.2])
                    gp = run[-1][0] + d * gw / 2
                    box(gates, gates_uv, (gp.x, gp.y, 0), (gw, 0.08, 2.0), math.atan2(d.y, d.x), mat=random.randrange(len(m_gate)))
                    solid_box(gp, gw, 0.2, math.atan2(d.y, d.x))
                    flush(run)
                    t += gw
                    continue
                if ok:
                    run.append((p, d))
                else:
                    flush(run)
                t += 1.0
        flush(run)
kit.new_object('compound_walls', walls_bm, m_compound)
kit.new_object('gates', gates, m_gate)
print('WALLS', walls_made)

# ---- Life on the boulevard -----------------------------------------------------------------

# Kiosk names, invented, in the way Monrovia names its small businesses.
SIGNS = ['MA HAWA COOKSHOP', 'BLESSED HANDS\nPHONES & SIM CARDS', 'GOD IS ABLE\nENTERPRISE', 'PEACE & LOVE\nPROVISION SHOP', 'FAITH BARBING SALOON',
         'JAH GUIDE\nSPARE PARTS', 'DAILY BREAD', 'MOBILE MONEY\nHERE', 'SWEET MOTHER\nCOOKSHOP', 'NO CONDITION\nIS PERMANENT', 'TOP UP\nSCRATCH CARD',
         'ONE LOVE\nTAILORING', 'GOOD LUCK\nPHARMACY', 'COLD WATER\nSOLD HERE']
STANDING = ['man_phone', 'man_idle', 'man_talk', 'man_argue', 'woman_idle', 'woman_phone', 'woman_looking']
WALKING = ['man_walk', 'woman_walk', 'man_carry']
signs = list(SIGNS)
random.shuffle(signs)


def shoulder_spots(w, offset, every):
    """Points along a road, at an offset from its centre (+ left of travel, - right)."""
    pts = [xy(n) for n in w['nodes']]
    for a, b in zip(pts, pts[1:]):
        seg = b - a
        if seg.length < 0.1:
            continue
        d = seg.normalized()
        n = Vector((-d.y, d.x))
        t = random.uniform(0, every)
        while t < seg.length:
            yield a + d * t + n * offset, d, n
            t += random.uniform(every * 0.6, every * 1.4)


kiosks = 0
SPECIAL = {'MA HAWA COOKSHOP': 'cookshop', 'BLESSED HANDS\nPHONES & SIM CARDS': 'phone', 'MOBILE MONEY\nHERE': 'changer'}
used_specials = set()
others = [x for x in signs if x not in SPECIAL]
for w in tubman:
    width = road_width(w)
    for side in (1, -1):
        for p, d, n in shoulder_spots(w, side * (width / 2 + 2.6), 14):
            n = n * side
            yaw = math.atan2(d.y, d.x)
            back = p + n * 1.0
            if p.length > RADIUS or not free(back) or random.random() > 0.6:
                continue
            # A zinc kiosk: painted boards, its rusty shutter rolled half up to the road, a lean-to
            # roof giving shade, a painted sign board with its name.
            k = bmesh.new()
            kuv = k.loops.layers.uv.new()
            wide = random.uniform(2.4, 3.4)
            box(k, kuv, (back.x, back.y, 0), (wide, 2.0, 2.4), yaw, mat=0)
            f0 = p - n * 0.01
            box(k, kuv, (f0.x, f0.y, 1.25), (wide - 0.3, 0.06, 1.05), yaw, mat=1)
            box(k, kuv, (f0.x, f0.y, 0), (wide - 0.3, 0.04, 0.95), yaw, mat=3)
            r = p + n * 0.4
            box(k, kuv, (r.x, r.y, 2.45), (wide + 0.8, 3.2, 0.05), yaw, mat=2, pitch=0.0)
            s = p - n * 0.06
            box(k, kuv, (s.x, s.y, 2.5), (wide - 0.1, 0.05, 0.6), yaw, mat=4)
            colour = random.randrange(len(m_kiosk))
            board = (colour + 3) % len(m_kiosk)
            kit.new_object('kiosk', k, [m_kiosk[colour], m_shutter, m_zinc_rust, m_glass, m_kiosk[board]])
            ink = '#1a1a1a' if KIOSK_COLOURS[board] in ('#e2b62a', '#e8e0d0') else '#f4efe2'
            # The kiosks that are places in the game stand near the junction.
            special = next((x for x in SPECIAL if x not in used_specials), None) if p.length < 60 else None
            if special:
                used_specials.add(special)
                name = special
                front_at = p - n * 1.3
                PLACES[SPECIAL[special]] = {'x': round(front_at.x, 2), 'y': round(front_at.y, 2), 'face': [round(n.x, 3), round(n.y, 3)]}
            else:
                name = others[kiosks % len(others)]
            solid_box(back, wide, 2.0, yaw)
            kit.text(name, p - n * 0.1, kit.facing(-n), 0.2 if '\n' in name else 0.24, ink, 2.8)
            mark_disk(back, 2.2)
            # In front: white plastic chairs, someone sitting, a generator, jerrycans, crates.
            front = p - n * 1.2
            if random.random() < 0.7:
                prop('plastic_monobloc_chair_01', front + d * 0.9, yaw + random.uniform(-0.6, 0.6) + (math.pi if side == 1 else 0))
                if random.random() < 0.6:
                    sitter = random.choice(['man_sit', 'woman_sit'])
                    kit.place(kit.person(sitter), front + d * 0.9, kit.facing(-n) + random.uniform(-0.4, 0.4), z=0.0)
            if random.random() < 0.5:
                prop('portable_generator', back + d * (wide / 2 + 0.6), yaw)
            if random.random() < 0.18:
                at = front + d * (wide / 2 + 0.4)
                kit.thing('wheelbarrow', at, yaw + random.uniform(-0.5, 0.5), name='wheelbarrow')
                solid_box(at, 1.5, 0.7, yaw)
            for _ in range(random.randint(0, 3)):
                prop(random.choice(['plastic_jerrycan', 'metal_jerrycan_green', 'plastic_crate_01', 'cardboard_box_01']), front - d * random.uniform(0.6, 1.4) + n * random.uniform(-0.3, 0.6), random.uniform(0, 6.3))
            if random.random() < 0.55:
                who = random.choice(STANDING)
                kit.place(kit.person(who), front - d * random.uniform(0.2, 1.2) - n * random.uniform(0, 0.8), kit.facing(-n.lerp(d, random.uniform(-0.6, 0.6))))
            kiosks += 1
print('KIOSKS', kiosks)

# A woman selling bananas under a big umbrella, near the junction.
for w in tubman[:1]:
    width = road_width(w)
    for p, d, n in list(shoulder_spots(w, -(width / 2 + 1.6), 30))[:2]:
        if not free(p) or p.length > 60:
            continue
        yaw = math.atan2(d.y, d.x)
        prop('painted_wooden_bench', p, yaw)
        prop('bananas', p + d * 0.3, yaw, z=0.45)
        prop('bananas', p - d * 0.3, yaw + 1.2, z=0.45)
        prop('wicker_basket_01', p - n * 0.8, yaw)
        kit.place(kit.person('woman_idle'), p - n * 0.9, kit.facing(n))
        # The umbrella: eight coloured panels on a pole.
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        top = Vector((p.x, p.y, 2.5))
        box(bm, uv, (p.x, p.y, 0), (0.04, 0.04, 2.5))
        for k in range(8):
            a0, a1 = k / 8 * 2 * math.pi, (k + 1) / 8 * 2 * math.pi
            face = bm.faces.new((bm.verts.new(top), bm.verts.new((p.x + math.cos(a0) * 1.4, p.y + math.sin(a0) * 1.4, 2.05)), bm.verts.new((p.x + math.cos(a1) * 1.4, p.y + math.sin(a1) * 1.4, 2.05))))
            face.material_index = 1 + k % 2
        kit.new_object('umbrella', bm, [m_wood, flat('umb_a', srgb('#d23a2a'), 0.8), flat('umb_b', srgb('#f2e6c8'), 0.8)])
        mark_disk(p, 2)
        break

# Rubbish and old tyres on the shoulder; people walking along it.
for w in tubman:
    width = road_width(w)
    for side in (1, -1):
        for p, d, n in shoulder_spots(w, side * (width / 2 + random.uniform(0.6, 1.4)), 9):
            if p.length > RADIUS * 0.8 or not free(p + n * side * 0.5):
                continue
            r = random.random()
            if r < 0.25:
                prop(random.choice(['trashbag', 'old_tyre', 'cardboard_box_01']), p, random.uniform(0, 6.3))
            elif r < 0.31:
                kit.thing('waste_bin', p, random.uniform(0, 6.3), name='bin')
                SOLIDS.append(ring(p, 0.4, 6))
                mark_disk(p, 0.8)
            elif r < 0.6:
                kit.place(kit.person(random.choice(WALKING)), p, kit.facing(d if random.random() < 0.5 else -d))

# Traffic, driving on the right: taxis (yellow), cars and SUVs in the lanes, kekehs waiting at
# the junction with 16th Street, a few parked on the shoulder.
CAR_COLOURS = ['#f0f0ee', '#c8c8c8', '#202020', '#1f2f5a', '#7a1a1a', '#d0c8b0']
vehicles = 0
for w in tubman:
    width = road_width(w)
    for lane in (-1, 1):
        # Heading along the way (lane 1) keeps to its right, heading back (lane -1) to the other side.
        for p, d, n in shoulder_spots(w, -lane * width / 4, 22):
            if p.length > RADIUS * 0.85 or random.random() > 0.7:
                continue
            heading = d if lane == 1 else -d
            p = p + n * random.uniform(-0.4, 0.4)
            yaw = math.atan2(heading.y, heading.x)
            if EXPORT:
                # The game drives its own traffic along the lanes (the plan's "lanes"): nothing
                # stands in them here, but the same chances are taken, so all after stays put.
                if random.random() >= 0.7:
                    random.choice(CAR_COLOURS)
                    random.choice(['saloon', 'saloon', 'suv'])
                continue
            solid_box(p, 4.8, 2.0, yaw)
            r = random.random()
            if r < 0.42:
                kit.car(p, yaw, '#e9b51c', 'saloon', taxi=True)
            elif r < 0.62:
                kit.kekeh(p, yaw)
            elif r < 0.7:
                if EXPORT:
                    kit.car(p, yaw, '#2f6fb8', 'suv')
                else:
                    kit.vehicle(random.choice(['bus', 'toy_bus']), p, yaw + kit.FRONT['bus'])
            else:
                kit.car(p, yaw, random.choice(CAR_COLOURS), random.choice(['saloon', 'saloon', 'suv']))
            vehicles += 1
# The kekeh stop: four or so kekehs waiting at the roadside near the junction.
stop = 0
for w in tubman:
    width = road_width(w)
    for i, (p, d, n) in enumerate(shoulder_spots(w, -(width / 2 - 1.0), 3.2)):
        if p.length < 40 and stop < 5:
            stop += 1
            kit.kekeh(p, math.atan2(d.y, d.x) + random.uniform(-0.15, 0.15), random.choice(['#e8b41c', '#e8b41c', '#2a6ab8']))
            solid_box(p, 2.8, 1.4, math.atan2(d.y, d.x))
            if 'kekeh' not in PLACES:
                side_at = p - n * 1.8
                PLACES['kekeh'] = {'x': round(side_at.x, 2), 'y': round(side_at.y, 2), 'face': [round(n.x, 3), round(n.y, 3)]}
            vehicles += 1
# A police car parked on the shoulder near the junction.
for w in tubman[:1]:
    width = road_width(w)
    for p, d, n in list(shoulder_spots(w, width / 2 + 1.4, 12))[:6]:
        if 12 < p.length < 45 and free(p):
            if EXPORT:
                kit.car(p, math.atan2(d.y, d.x), '#1d2b55', 'saloon')
            else:
                kit.vehicle('police_car', p, math.atan2(d.y, d.x) + kit.FRONT['police_car'])
            solid_box(p, 4.9, 1.9, math.atan2(d.y, d.x))
            mark_disk(p, 3)
            vehicles += 1
            break
print('VEHICLES', vehicles)

# ---- Lots, tanks and grass -----------------------------------------------------------------


def road_at(p):
    """The nearest road to p: (distance, direction along it, nearest point, width, trunk)."""
    best = (1e9, None, None, 0.0, False)
    for pts, width, trunk in road_lines:
        for a, b in zip(pts, pts[1:]):
            ab = b - a
            if ab.length < 0.1:
                continue
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            q = a + ab * t
            if (q - p).length < best[0]:
                best = ((q - p).length, ab.normalized(), q, width, trunk)
    return best


def rect_cells(c, along, across, yaw, margin):
    d, n = Vector((math.cos(yaw), math.sin(yaw))), Vector((-math.sin(yaw), math.cos(yaw)))
    x = -along / 2 - margin
    while x <= along / 2 + margin:
        y = -across / 2 - margin
        while y <= across / 2 + margin:
            yield c + d * x + n * y
            y += CELL * 0.8
        x += CELL * 0.8


def find_lot(along, across, near, far, gap, trunk_only=False):
    """A free piece of ground along across metres, its long side gap metres back from a road's
    edge and parallel to it, between near and far metres from the junction. Turned so the
    model's -Y side (its front, for these models) faces the road."""
    for _ in range(1500):
        a, r = random.uniform(0, 2 * math.pi), random.uniform(near, far)
        p = Vector((math.cos(a) * r, math.sin(a) * r))
        dist, d, q, width, trunk = road_at(p)
        if d is None or (trunk_only and not trunk) or dist < 0.5:
            continue
        n = (p - q).normalized()
        if Vector((-d.y, d.x)).dot(n) < 0:
            d = -d
        yaw = math.atan2(d.y, d.x)
        # Past the strip kept clear along every road (1.5 m) and the lot's own margin, then
        # from the shoulder back into the compounds: the first place it fits.
        for back in range(0, 13):
            c = q + n * (width / 2 + 2.2 + gap + back + across / 2)
            if near < c.length < far and all(free(x) for x in rect_cells(c, along, across, yaw, 0.6)):
                for x in rect_cells(c, along, across, yaw, 0.6):
                    occupied.add(cell(x))
                solid_box(c, along, across, yaw)
                return c, yaw
    return None


# A petrol station on the boulevard (most of Tubman's junctions have one), a market woman's
# vegetable stand near the junction, zinc store sheds and a rubbish skip and bins off the side
# streets.
LOTS = [('petrol_station', 20.0, 19.0, 30, 115, 0.5, True), ('veg_stand', 6.9, 1.8, 8, 70, 0.0, True),
        ('zinc_shed', 13.4, 5.4, 25, 110, 3.0, False), ('zinc_shed', 13.4, 5.4, 25, 110, 3.0, False),
        ('skip', 3.7, 2.5, 20, 100, 0.0, False), ('dumpsters', 4.0, 2.0, 20, 100, 0.0, False)]
for what, along, across, near, far_, gap, trunk_only in LOTS:
    lot = find_lot(along, across, near, far_, gap, trunk_only)
    print('LOT', what, 'at', [round(v, 1) for v in lot[0]] if lot else None)
    # The vegetable stand is 50,000 triangles of photo scan: in pictures only for now (its lot is
    # kept in the game's copy too, so everything else stands where the pictures show it).
    if lot and not (EXPORT and what == 'veg_stand'):
        kit.thing(what, lot[0], lot[1] + FRONT_TURN.get(what, 0.0), name=what)

# Black and blue water tanks by a quarter of the houses (town water comes and goes).
tanks = 0
for pts, tags in footprints:
    if abs(area(pts)) > 450 or random.random() > 0.25:
        continue
    c = sum(pts, Vector((0, 0))) / len(pts)
    corner = random.choice(pts)
    q = corner + (corner - c).normalized() * 1.9
    if free(q) and q.length < RADIUS:
        kit.thing('water_tank', q, random.uniform(0, 6.3), name='water_tank')
        solid_box(q, 1.4, 1.4, 0.0)
        mark_disk(q, 1.0)
        tanks += 1
print('TANKS', tanks)

# Grass where nothing is built or trodden: patches in the yards and on the verges, some lush
# (October, the rains' end), some going dry.
grass_mats = [kit.lawn('verge', 3.0, (0.62, 0.72, 0.48)), kit.lawn('verge_dry', 3.0, (0.78, 0.72, 0.45))]
patches = 0
for kind in (0, 1):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    for _ in range(2500):
        if patches >= (260 if kind == 0 else 380):
            break
        p = Vector((random.uniform(-RADIUS, RADIUS), random.uniform(-RADIUS, RADIUS)))
        r = random.uniform(2.0, 6.5)
        if p.length > RADIUS or not free(p) or not all(free(p + Vector((math.cos(a), math.sin(a))) * r) for a in range(0, 7)):
            continue
        ring_ = [bm.verts.new((p.x + math.cos(k / 14 * 2 * math.pi) * r * random.uniform(0.7, 1.15), p.y + math.sin(k / 14 * 2 * math.pi) * r * random.uniform(0.7, 1.15), 0.02)) for k in range(14)]
        face = bm.faces.new(ring_)
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
        patches += 1
    kit.new_object('grass', bm, [grass_mats[kind]])
print('GRASS', patches)

# ---- Palms, poles and wires ----------------------------------------------------------------


def pole_line(points, offset):
    """Wooden poles every 40 m along a road's edge, with three wires sagging between them."""
    poles = []
    walked, next_at = 0.0, 0.0
    for a, b in zip(points, points[1:]):
        seg = b - a
        ln = seg.length
        if ln < 0.1:
            continue
        n = Vector((-seg.y, seg.x)).normalized()
        while next_at <= walked + ln:
            p = a + seg * ((next_at - walked) / ln) + n * offset
            poles.append((p, math.atan2(seg.y, seg.x)) if p.length < RADIUS else None)
            next_at += 40
        walked += ln
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    for pole in poles:
        if pole:
            p, yaw = pole
            box(bm, uv, (p.x, p.y, 0), (0.24, 0.24, 9.5), yaw)
            solid_box(p, 0.3, 0.3, yaw)
            box(bm, uv, (p.x, p.y, 8.6), (0.1, 1.8, 0.1), yaw)
            if random.random() < 0.4:
                prop('security_light', p, yaw, z=7.5)
    kit.new_object('poles', bm, [m_wood])
    for p0, p1 in zip(poles, poles[1:]):
        if not p0 or not p1:
            continue
        for off in (-0.8, 0.0, 0.8):
            d = p1[0] - p0[0]
            n = Vector((-d.y, d.x)).normalized() * off
            curve = bpy.data.curves.new('wire', 'CURVE')
            curve.dimensions = '3D'
            curve.bevel_depth = 0.012
            sp = curve.splines.new('POLY')
            sp.points.add(10)
            for k in range(11):
                t = k / 10
                q = p0[0] + d * t + n
                sp.points[k].co = (q.x, q.y, 8.7 - math.sin(t * math.pi) * 0.7, 1)
            o = bpy.data.objects.new('wire', curve)
            scene.collection.objects.link(o)
            curve.materials.append(m_wire)


for w in tubman:
    pole_line([xy(n) for n in w['nodes']], road_width(w) / 2 + 1.2)
# Coconut palms along the roads; in the yards behind the walls, palms, banana clumps and a few
# big shade trees (mango, almond), as Sinkor's compounds have.
trees = {'palm': 0, 'banana': 0, 'tree': 0}
for _ in range(6000):
    if sum(trees.values()) >= 80:
        break
    p = Vector((random.uniform(-RADIUS, RADIUS), random.uniform(-RADIUS, RADIUS)))
    if p.length > RADIUS or not free(p):
        continue
    dist, _near = nearest_road(p)
    if random.random() > (0.5 if dist < 14 else 0.16):
        continue
    kind = 'palm' if dist < 14 else random.choices(['palm', 'banana', 'tree'], [0.45, 0.35, 0.2])[0]
    if kind == 'tree' and not all(free(p + Vector((math.cos(a), math.sin(a))) * 4.5) for a in range(0, 7)):
        kind = 'banana'
    if kind == 'banana' and not all(free(p + Vector((math.cos(a), math.sin(a))) * 2.0) for a in range(0, 7)):
        continue
    if kind == 'palm':
        kit.palm(p)
        SOLIDS.append(ring(p, 0.35))
        mark_disk(p, 3)
    elif kind == 'banana':
        kit.thing('banana_clump', p, random.uniform(0, 6.3), random.uniform(0.8, 1.1), name='banana')
        SOLIDS.append(ring(p, 1.1))
        mark_disk(p, 2.6)
    else:
        kit.thing('shade_tree', p, random.uniform(0, 6.3), random.uniform(0.85, 1.15), name='tree')
        SOLIDS.append(ring(p, 0.5))
        mark_disk(p, 5)
    trees[kind] += 1
print('TREES', trees)

# The clinic: the nearest sizeable building to the junction, with its sign over the door side.
best = None
for pts, tags in footprints:
    c = sum(pts, Vector((0, 0))) / len(pts)
    if abs(area(pts)) > 120 and c.length < 70 and (best is None or c.length < best[0]):
        best = (c.length, pts)
if best:
    pts = best[1]
    dist, near = nearest_road(sum(pts, Vector((0, 0))) / len(pts))
    i = min(range(len(pts)), key=lambda k: ((pts[k] + pts[(k + 1) % len(pts)]) / 2 - near).length)
    a, b = pts[i], pts[(i + 1) % len(pts)]
    d = (b - a).normalized()
    out = Vector((d.y, -d.x))
    mid = (a + b) / 2
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    q = mid + out * 0.12
    box(bm, uv, (q.x, q.y, 3.2), (4.2, 0.1, 0.9), math.atan2(d.y, d.x))
    kit.new_object('clinic_sign', bm, [flat('clinic_white', (0.9, 0.9, 0.9), 0.5)])
    kit.text('SINKOR COMMUNITY CLINIC', mid + out * 0.2, kit.facing(out), 0.26, '#b0101c', 3.65)
    door = mid + out * 1.6
    PLACES['clinic'] = {'x': round(door.x, 2), 'y': round(door.y, 2), 'face': [round(-out.x, 3), round(-out.y, 3)]}

def lanes_of(ways, width):
    """A road's two lanes for the game's traffic, driving on the right: its ways joined end to
    end, each direction a quarter of the width to the right of the middle, as points."""
    chains = []
    for w in ways:
        ids = list(w['nodes'])
        for c in chains:
            if c[-1] == ids[0]:
                c += ids[1:]
                break
            if c[0] == ids[-1]:
                c[:0] = ids[:-1]
                break
        else:
            chains.append(ids)
    lanes = []
    for c in chains:
        pts = [xy(n) for n in c]
        if sum((b - a).length for a, b in zip(pts, pts[1:])) < 60:
            continue
        for direction in (pts, pts[::-1]):
            lane = []
            for i, p in enumerate(direction):
                d = (direction[min(len(direction) - 1, i + 1)] - direction[max(0, i - 1)]).normalized()
                right = Vector((d.y, -d.x))
                q = p + right * width / 4
                lane.append([round(q.x, 2), round(q.y, 2)])
            lanes.append(lane)
    return lanes


if EXPORT:
    import json as _json
    REACH = 120.0
    root = bpy.data.objects.new('street', None)
    scene.collection.objects.link(root)

    def far(o):
        if o.type not in ('MESH', 'FONT'):
            return False
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        cx = sum(c.x for c in cs) / 8
        cy = sum(c.y for c in cs) / 8
        span = max(max(c.x for c in cs) - min(c.x for c in cs), max(c.y for c in cs) - min(c.y for c in cs))
        return span < 60 and math.hypot(cx, cy) > REACH

    kit.game_export(root, None, far, EXPORT, os.path.join(OUT, 'sinkor_game.blend'))
    near_solids = [poly for poly in SOLIDS if min(math.hypot(x, y) for x, y in poly) < REACH + 5]
    line = []
    for w in tubman:
        line += [xy(n) for n in w['nodes']]
    mid = min(line, key=lambda p: p.length)
    along = next((p for p in line if 20 < (p - mid).length < 80), line[-1]) - mid
    along.normalize()
    side = Vector((-along.y, along.x))
    spawn = mid + side * (road_width(tubman[0]) / 2 + 2.0)
    plan = {
        'frame': 'x east, y north, metres from the junction of Tubman Boulevard and 16th Street',
        'reach': REACH,
        'lanes': lanes_of(tubman, road_width(tubman[0])),
        'spawn': {'x': round(spawn.x, 2), 'y': round(spawn.y, 2), 'face': [round(along.x, 3), round(along.y, 3)]},
        'places': PLACES,
        'solids': near_solids,
    }
    with open(EXPORT.replace('.glb', '.json'), 'w') as f:
        _json.dump(plan, f, separators=(',', ':'))
    print('EXPORTED', EXPORT, os.path.getsize(EXPORT), 'solids', len(near_solids), 'places', sorted(PLACES))
    sys.exit(0)

# ---- Light and cameras ---------------------------------------------------------------------

kit.daylight(sun_elevation=48, sun_heading=235)
cam, aim = kit.render_setup(samples=48)

line = []
for w in tubman:
    line += [xy(n) for n in w['nodes']]
mid = min(line, key=lambda p: p.length)
far = [p for p in line if 40 < (p - mid).length < 140]
d = ((far[0] if far else line[-1]) - mid).normalized()
side = Vector((-d.y, d.x))
tw = road_width(tubman[0])
street = None
for pts, width, trunk in road_lines:
    if not trunk and width >= 5.5 and len(pts) >= 2:
        c = pts[len(pts) // 2]
        if 30 < c.length < 110 and (pts[-1] - pts[0]).length > 50:
            street = (pts, width)
            break


def v3(p, z):
    return (p.x, p.y, z)


views = {
    'sinkor_boulevard': (v3(mid + side * (tw / 2 + 1.0) - d * 10, 1.65), v3(mid + d * 70 + side * (tw / 2 - 2), 2.2), 26),
    'sinkor_boulevard_back': (v3(mid - side * (tw / 2 + 1.0) + d * 10, 1.65), v3(mid - d * 70 - side * (tw / 2 - 2), 2.2), 26),
    'sinkor_kiosks': (v3(mid - side * (tw / 2 + 0.5) - d * 25, 1.6), v3(mid - side * (tw / 2 + 3.5) + d * 5, 1.4), 30),
    'sinkor_above': (v3(mid + side * 55 - d * 45, 32), v3(mid + d * 15, 0), 30),
}
if street:
    pts, width = street
    a, b = pts[0], pts[-1]
    sd = (b - a).normalized()
    views['sinkor_side_street'] = (v3(a + sd * 6 + Vector((-sd.y, sd.x)) * (width / 2 - 0.8), 1.65), v3(a + sd * 50, 2.0), 26)
# People close to where the cameras stand, so the street is seen with its life.
for (eye, look, lens) in list(views.values()):
    e, l = Vector(eye[:2]), Vector(look[:2])
    if eye[2] > 5:
        continue
    for k in range(6):
        t = random.uniform(6, 30)
        q = e + (l - e).normalized() * t + Vector((-(l - e).y, (l - e).x)).normalized() * random.uniform(-3.5, 3.5)
        if free(q):
            who = random.choice(STANDING + WALKING)
            kit.place(kit.person(who), q, kit.facing((random.uniform(-1, 1), random.uniform(-1, 1))))
            mark_disk(q, 0.8)
for name, (at, look, lens) in views.items():
    kit.shoot(cam, aim, OUT, name, at, look, lens)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'sinkor.blend'))
