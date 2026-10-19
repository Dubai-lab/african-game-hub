# One Africa Life: a piece of a real town in 3D from OpenStreetMap, the parts every town scene
# shares (Waterside Market now; makeStreet.py, the first, still has its own copies): the map read
# and turned into metres around a centre, its roads (asphalt, paved or red earth, with lane
# lines and kerbs on the big ones), its buildings at their real outlines (painted plaster or
# bare cement, barred windows, a door to the road, zinc hipped roofs or flat concrete ones with a
# water tank), a grid of what ground is taken, free lots for the owner's models, palms and trees
# in the open, and grass where nothing stands. What is solid is kept as polygons (SOLIDS) for the
# game to walk against, and the places where something can be done (PLACES).
import math
import random

import bmesh
from mathutils import Vector

import scenekit as kit
from scenekit import box, flat, photo, srgb

CELL = 1.0
M_LAT = 111_320.0

# Sun-faded paints of Monrovia's houses and shops; bare cement render last.
PAINTS = ['#e9dcb8', '#e8c97a', '#cfdcb8', '#a9c8d6', '#e8b8a8', '#d99a7a', '#f2ece0', '#b8d4b0', '#e6d39a', '#9fb8d8']


class Town:
    def __init__(self, data, lat0, lon0, radius):
        self.nodes = {e['id']: e for e in data['elements'] if e['type'] == 'node'}
        self.ways = [e for e in data['elements'] if e['type'] == 'way']
        self.lat0, self.lon0 = lat0, lon0
        self.m_lon = M_LAT * math.cos(math.radians(lat0))
        self.radius = radius
        self.occupied = set()
        self.solids = []
        self.places = {}
        self.road_lines = []
        self.footprints = []
        self.mats = {}

    # ---- Map -------------------------------------------------------------------------------

    def xy(self, node_id):
        n = self.nodes[node_id]
        return Vector(((n['lon'] - self.lon0) * self.m_lon, (n['lat'] - self.lat0) * M_LAT))

    def way_points(self, w):
        return [self.xy(n) for n in w['nodes'] if n in self.nodes]

    def named(self, name):
        return [w for w in self.ways if w.get('tags', {}).get('name') == name]

    # ---- What ground is taken ----------------------------------------------------------------

    def cell(self, p):
        g = self.radius * 1.3
        return int((p.x + g) / CELL), int((p.y + g) / CELL)

    def mark_disk(self, p, r):
        cx, cy = self.cell(p)
        k = int(r / CELL) + 1
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                if (dx * dx + dy * dy) * CELL * CELL <= r * r:
                    self.occupied.add((cx + dx, cy + dy))

    def free(self, p):
        return self.cell(p) not in self.occupied

    def solid_box(self, centre, along, across, yaw):
        c, s_ = math.cos(yaw), math.sin(yaw)
        self.solids.append([[round(centre.x + x * c - y * s_, 2), round(centre.y + x * s_ + y * c, 2)]
                            for x, y in ((-along / 2, -across / 2), (along / 2, -across / 2), (along / 2, across / 2), (-along / 2, across / 2))])

    def solid_ring(self, p, r, sides=8):
        self.solids.append([[round(p.x + r * math.cos(k * 2 * math.pi / sides), 2), round(p.y + r * math.sin(k * 2 * math.pi / sides), 2)] for k in range(sides)])

    def place(self, name, at, face):
        self.places[name] = {'x': round(at.x, 2), 'y': round(at.y, 2), 'face': [round(face.x, 3), round(face.y, 3)]}

    # ---- Materials -----------------------------------------------------------------------------

    def materials(self):
        m = self.mats
        m['walls'] = [photo(f'wall_{p}', random.choice(['painted_plaster_wall', 'white_stucco']), scale=2.5, tint=srgb(p), tint_amount=0.9, dust=0.8) for p in PAINTS]
        m['bare'] = photo('wall_bare', 'white_stucco', scale=3.0, tint=srgb('#b4afa6'), tint_amount=1.0, dust=0.7)
        m['zinc_rust'] = photo('zinc_rust', 'rusty_corrugated_iron', scale=2.0, metallic=0.3, streaks=0)
        m['zinc'] = photo('zinc', 'corrugated_iron_02', scale=2.0, metallic=0.7, rough_mul=0.9, streaks=0)
        m['flatroof'] = photo('flatroof', 'white_stucco', scale=4.0, tint=srgb('#8f8a82'), tint_amount=1.0)
        m['asphalt'] = photo('asphalt', 'road_damaged_clean', scale=4.0, mul=(0.5, 0.5, 0.52), streaks=0)
        m['side'] = photo('side_road', 'road_damaged_clean', scale=3.0, mul=(0.62, 0.6, 0.58), streaks=0)
        m['earth'] = photo('earth', 'red_laterite_soil_stones', scale=3.0, mul=(1.0, 0.78, 0.62), streaks=0)
        m['dirt'] = photo('dirt_road', 'red_dirt_mud_01', scale=3.0, mul=(1.0, 0.8, 0.66), streaks=0)
        m['shutter'] = photo('shutter', 'rusty_metal_shutter', scale=2.2, metallic=0.4, streaks=0)
        m['curb'] = flat('curb', (0.25, 0.24, 0.22), 0.9)
        m['glass'] = flat('glass', (0.02, 0.025, 0.03), 0.15)
        m['bars'] = flat('bars', (0.03, 0.03, 0.03), 0.5, 0.6)
        m['frame'] = flat('frame', (0.55, 0.52, 0.48), 0.8)
        m['doors'] = [flat(f'door{i}', srgb(c), 0.6, 0.3) for i, c in enumerate(['#3a2a20', '#1f3a4a', '#5a2a1c', '#2a4a2a', '#3a3a3a'])]
        m['paint'] = flat('paint', (0.55, 0.53, 0.48), 0.9)
        m['wood'] = flat('pole', (0.15, 0.11, 0.08), 0.9)
        return m

    # ---- Ground and roads --------------------------------------------------------------------

    def ground(self, mat):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        g = self.radius * 1.3
        f = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in ((-g, -g), (g, -g), (g, g), (-g, g))])
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
        kit.new_object('ground', bm, [mat])

    @staticmethod
    def road_width(w):
        kind = w['tags']['highway']
        lanes = w['tags'].get('lanes', '')
        if kind == 'trunk':
            return 3.4 * (int(lanes) if lanes.isdigit() else 4)
        return {'primary': 9.0, 'secondary': 8.0, 'tertiary': 7.0, 'residential': 5.5, 'unclassified': 5.5, 'service': 3.6}.get(kind, 3.0)

    def roads(self, skip=lambda w: False, clear=1.5):
        m = self.mats
        for w in self.ways:
            tags = w.get('tags', {})
            if 'highway' not in tags or tags['highway'] in ('path', 'footway', 'steps') or skip(w):
                continue
            pts = self.way_points(w)
            if len(pts) < 2 or all(p.length > self.radius * 1.2 for p in pts):
                continue
            width = self.road_width(w)
            surface = tags.get('surface', '')
            big = tags['highway'] in ('trunk', 'primary', 'tertiary')
            mat = m['asphalt'] if big else (m['dirt'] if surface in ('unpaved', 'dirt', 'ground', 'gravel', 'compacted') else m['side'])
            self.road_lines.append((pts, width, big))
            bm = bmesh.new()
            uv = bm.loops.layers.uv.new()
            rows = []
            along = 0.0
            for i, p in enumerate(pts):
                d = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
                n = Vector((-d.y, d.x))
                if i:
                    along += (p - pts[i - 1]).length
                lift = 0.03 if big else 0.02
                rows.append((bm.verts.new((*(p + n * width / 2), lift)), bm.verts.new((*(p - n * width / 2), lift)), along))
                if i + 1 < len(pts):
                    seg = pts[i + 1] - p
                    for s in range(0, int(seg.length) + 1):
                        self.mark_disk(p + seg.normalized() * s, width / 2 + clear)
            for (l0, r0, a0), (l1, r1, a1) in zip(rows, rows[1:]):
                face = bm.faces.new((l0, r0, r1, l1))
                for loop, (u, v) in zip(face.loops, ((width, a0), (0, a0), (0, a1), (width, a1))):
                    loop[uv].uv = (u, v)
            kit.new_object('road', bm, [mat])
            if big:
                self._lines_and_kerbs(pts, width)

    def _lines_and_kerbs(self, pts, width):
        bm = bmesh.new()
        bm.loops.layers.uv.new()
        for off, dash in ((0.0, True),):
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
                    step = 3.0
                    if int((walked + t) / 3.0) % 3 == 0 and random.random() > 0.3:
                        p0, p1 = a + d * t + n * off, a + d * min(ln, t + step) + n * off
                        bm.faces.new([bm.verts.new((*(p + n * s), 0.035)) for p, s in ((p0, 0.07), (p0, -0.07), (p1, -0.07), (p1, 0.07))])
                    t += step
                walked += ln
        kit.new_object('lines', bm, [self.mats['paint']])
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
        kit.new_object('kerb', bm, [self.mats['curb']])

    def road_at(self, p):
        """The nearest road to p: (distance, direction along it, nearest point, width, big)."""
        best = (1e9, None, None, 0.0, False)
        for pts, width, big in self.road_lines:
            for a, b in zip(pts, pts[1:]):
                ab = b - a
                if ab.length < 0.1:
                    continue
                t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
                q = a + ab * t
                if (q - p).length < best[0]:
                    best = ((q - p).length, ab.normalized(), q, width, big)
        return best

    # ---- Buildings ---------------------------------------------------------------------------

    @staticmethod
    def area(points):
        return 0.5 * sum(points[i].x * points[(i + 1) % len(points)].y - points[(i + 1) % len(points)].x * points[i].y for i in range(len(points)))

    @staticmethod
    def inside(p, poly):
        hit = False
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            if (a.y > p.y) != (b.y > p.y) and p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x:
                hit = not hit
        return hit

    def buildings(self, storeys_for, shopfront=None, keep=lambda tags, c: True):
        """Every building in reach at its outline. storeys_for(tags, area, big) gives its height;
        shopfront(pts, edge, storeys) may dress the side facing the road (a market's shops)."""
        self._shop_edge = shopfront is not None
        for w in self.ways:
            tags = w.get('tags', {})
            if 'building' not in tags:
                continue
            pts = self.way_points(w)[:-1]
            if len(pts) < 3:
                continue
            c = sum(pts, Vector((0, 0))) / len(pts)
            if c.length > self.radius or not keep(tags, c):
                continue
            if self.area(pts) < 0:
                pts.reverse()
            a = abs(self.area(pts))
            big = tags.get('building') in ('commercial', 'retail', 'office', 'public', 'school') or a > 300
            storeys = storeys_for(tags, a, big)
            _dist, near, *_ = self.road_at(c)
            edge = self._build(pts, storeys, big, near if near is not None else c)
            if shopfront:
                shopfront(pts, edge, storeys)
            self.footprints.append((pts, tags))
            self.solids.append([[round(q.x, 2), round(q.y, 2)] for q in pts])
            for p in pts:
                self.mark_disk(p, 1.2)
            xs, ys = [p.x for p in pts], [p.y for p in pts]
            x = min(xs)
            while x <= max(xs):
                y = min(ys)
                while y <= max(ys):
                    if self.inside(Vector((x, y)), pts):
                        self.mark_disk(Vector((x, y)), 1.2)
                    y += CELL
                x += CELL

    def _hip_roof(self, bm, uv, pts, z, overhang, pitch):
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
                faces.append(bm.faces.new((lo[i], lo[j], ends[i])) if ends[i] is ends[j] else bm.faces.new((lo[i], lo[j], ends[j], ends[i])))
        else:
            rise = min(1.8, 0.25 * math.sqrt(abs(self.area(pts)))) * pitch * 2
            top = bm.verts.new((c.x, c.y, z + rise))
            faces = [bm.faces.new((lo[i], lo[(i + 1) % len(lo)], top)) for i in range(len(lo))]
        for face in faces:
            face.material_index = 1
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

    def _build(self, pts, storeys, big, road_point):
        """One building; returns the index of its edge facing the road."""
        m = self.mats
        floor_h = 3.0
        height = storeys * floor_h + (0.6 if big else 0.3)
        wall = random.choice(m['walls'] if not big or random.random() < 0.5 else [m['bare']])
        roof = m['flatroof'] if big else (m['zinc_rust'] if random.random() < 0.7 else m['zinc'])
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
            self._hip_roof(bm, uv, pts, height, 0.55, random.uniform(0.35, 0.5))
        kit.new_object('building', bm, [wall, roof])

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
                    if s == 0 and (k == door_at or (i == door_edge and self._shop_edge)):
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
            if i == door_edge and not self._shop_edge:
                p = a + d * (start + max(0, door_at) * spacing)
                q = p + out * 0.02
                box(bm, uv, (q.x, q.y, 0), (1.25, 0.06, 2.3), yaw, mat=2)
                q = p + out * 0.05
                box(bm, uv, (q.x, q.y, 0), (1.0, 0.06, 2.15), yaw, mat=3)
        kit.new_object('openings', bm, [m['glass'], m['bars'], m['frame'], random.choice(m['doors'])])
        return door_edge

    _shop_edge = False

    # ---- Free lots, plants, grass --------------------------------------------------------------

    def rect_cells(self, c, along, across, yaw, margin):
        d, n = Vector((math.cos(yaw), math.sin(yaw))), Vector((-math.sin(yaw), math.cos(yaw)))
        x = -along / 2 - margin
        while x <= along / 2 + margin:
            y = -across / 2 - margin
            while y <= across / 2 + margin:
                yield c + d * x + n * y
                y += CELL * 0.8
            x += CELL * 0.8

    def take_rect(self, c, along, across, yaw, margin=0.6, solid=True):
        for x in self.rect_cells(c, along, across, yaw, margin):
            self.occupied.add(self.cell(x))
        if solid:
            self.solid_box(c, along, across, yaw)

    def rect_free(self, c, along, across, yaw, margin=0.6):
        return all(self.free(x) for x in self.rect_cells(c, along, across, yaw, margin))

    def find_lot(self, along, across, near, far, gap, big_only=False, tries=1500):
        """Free ground along x across metres, parallel to a road and back from its edge, between
        near and far metres from the centre; turned so the model's -Y side faces the road."""
        for _ in range(tries):
            a, r = random.uniform(0, 2 * math.pi), random.uniform(near, far)
            p = Vector((math.cos(a) * r, math.sin(a) * r))
            dist, d, q, width, big = self.road_at(p)
            if d is None or (big_only and not big) or dist < 0.5:
                continue
            n = (p - q).normalized()
            if Vector((-d.y, d.x)).dot(n) < 0:
                d = -d
            yaw = math.atan2(d.y, d.x)
            for back in range(0, 13):
                c = q + n * (width / 2 + 2.2 + gap + back + across / 2)
                if near < c.length < far and self.rect_free(c, along, across, yaw):
                    self.take_rect(c, along, across, yaw)
                    return c, yaw
        return None

    def trees(self, count, near_road=14, mix=(0.45, 0.35, 0.2), keep=lambda p: True):
        made = {'palm': 0, 'banana': 0, 'tree': 0}
        for _ in range(count * 60):
            if sum(made.values()) >= count:
                break
            r = self.radius
            p = Vector((random.uniform(-r, r), random.uniform(-r, r)))
            if p.length > r or not self.free(p) or not keep(p):
                continue
            dist = self.road_at(p)[0]
            if random.random() > (0.5 if dist < near_road else 0.16):
                continue
            kind = 'palm' if dist < near_road else random.choices(['palm', 'banana', 'tree'], mix)[0]
            if kind == 'tree' and not all(self.free(p + Vector((math.cos(a), math.sin(a))) * 4.5) for a in range(7)):
                kind = 'banana'
            if kind == 'banana' and not all(self.free(p + Vector((math.cos(a), math.sin(a))) * 2.0) for a in range(7)):
                continue
            if kind == 'palm':
                kit.palm(p)
                self.solid_ring(p, 0.35)
                self.mark_disk(p, 3)
            elif kind == 'banana':
                kit.thing('banana_clump', p, random.uniform(0, 6.3), random.uniform(0.8, 1.1), name='banana')
                self.solid_ring(p, 1.1)
                self.mark_disk(p, 2.6)
            else:
                kit.thing('shade_tree', p, random.uniform(0, 6.3), random.uniform(0.85, 1.15), name='tree')
                self.solid_ring(p, 0.5)
                self.mark_disk(p, 5)
            made[kind] += 1
        return made

    def grass(self, count, keep=lambda p: True):
        mats = [kit.lawn('verge', 3.0, (0.62, 0.72, 0.48)), kit.lawn('verge_dry', 3.0, (0.78, 0.72, 0.45))]
        made = 0
        for kind in (0, 1):
            bm = bmesh.new()
            uv = bm.loops.layers.uv.new()
            for _ in range(count * 10):
                if made >= (count * 0.4 if kind == 0 else count):
                    break
                r0 = self.radius
                p = Vector((random.uniform(-r0, r0), random.uniform(-r0, r0)))
                r = random.uniform(2.0, 6.5)
                if p.length > r0 or not keep(p) or not self.free(p) or not all(self.free(p + Vector((math.cos(a), math.sin(a))) * r) for a in range(7)):
                    continue
                ring = [bm.verts.new((p.x + math.cos(k / 14 * 2 * math.pi) * r * random.uniform(0.7, 1.15), p.y + math.sin(k / 14 * 2 * math.pi) * r * random.uniform(0.7, 1.15), 0.02)) for k in range(14)]
                face = bm.faces.new(ring)
                for loop in face.loops:
                    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
                made += 1
            kit.new_object('grass', bm, [mats[kind]])
        return made

    # ---- Water: a river or lagoon from the map, the ground cut round it, a bank ----------------

    def rings(self, relation):
        """A multipolygon's ways joined end to end into closed rings: (outer rings, inner rings)."""
        ways = {w['id']: w for w in self.ways}
        out = {'outer': [], 'inner': []}
        for role in out:
            pieces = [list(ways[m['ref']]['nodes']) for m in relation['members'] if m['type'] == 'way' and m['role'] == role and m['ref'] in ways]
            while pieces:
                ring = pieces.pop(0)
                while ring[0] != ring[-1]:
                    for i, p in enumerate(pieces):
                        if p[0] == ring[-1]:
                            ring += p[1:]
                        elif p[-1] == ring[-1]:
                            ring += p[::-1][1:]
                        elif p[-1] == ring[0]:
                            ring = p[:-1] + ring
                        elif p[0] == ring[0]:
                            ring = p[::-1][:-1] + ring
                        else:
                            continue
                        pieces.pop(i)
                        break
                    else:
                        break
                pts = [self.xy(n) for n in ring if n in self.nodes]
                if len(pts) > 3:
                    out[role].append(pts[:-1] if ring[0] == ring[-1] else pts)
        return out['outer'], out['inner']

    @staticmethod
    def clip(ring, g):
        """A ring cut to the square |x|, |y| <= g (Sutherland-Hodgman, edge by edge)."""
        def cut(points, inside, cross):
            res = []
            for i, b in enumerate(points):
                a = points[i - 1]
                if inside(b):
                    if not inside(a):
                        res.append(cross(a, b))
                    res.append(b)
                elif inside(a):
                    res.append(cross(a, b))
            return res

        pts = list(ring)
        for axis, sign in ((0, 1), (0, -1), (1, 1), (1, -1)):
            if not pts:
                break
            inside = lambda p, axis=axis, sign=sign: p[axis] * sign <= g
            def cross(a, b, axis=axis, sign=sign):
                t = (sign * g - a[axis]) / (b[axis] - a[axis])
                return a + (b - a) * t
            pts = cut(pts, inside, cross)
        return pts

    def ground_and_water(self, relation, ground_mat, water_mat, bank_mat, depth=0.7):
        """The ground everywhere but the water; the water a little below it, its edge a bank.
        The water is solid to walk against."""
        from mathutils.geometry import tessellate_polygon
        g = self.radius * 1.3
        outer, inner = self.rings(relation)
        water = [r for r in (self.clip(r, g) for r in outer) if len(r) > 2]
        islands = [r for r in (self.clip(r, g) for r in inner) if len(r) > 2]
        # The ground a metre wider than where the water is cut, so the water is a hole strictly
        # inside it (the fill needs that).
        G = g + 1
        square = [Vector((-G, -G)), Vector((G, -G)), Vector((G, G)), Vector((-G, G))]

        def surface(name, loops, z, mat, uv_scale=1.0):
            bm = bmesh.new()
            uv = bm.loops.layers.uv.new()
            flat_loops = [[(p.x, p.y, z) for p in loop] for loop in loops]
            verts = [p for loop in flat_loops for p in loop]
            made = [bm.verts.new(v) for v in verts]
            for tri in tessellate_polygon(flat_loops):
                try:
                    f = bm.faces.new([made[i] for i in tri])
                except ValueError:
                    continue
                for loop in f.loops:
                    loop[uv].uv = (loop.vert.co.x * uv_scale, loop.vert.co.y * uv_scale)
            return kit.new_object(name, bm, [mat])

        surface('ground', [square] + water, 0.0, ground_mat)
        for isl in islands:
            surface('ground', [isl], 0.0, ground_mat)
        surface('water', water + islands, -depth, water_mat)
        # The bank: the ground's edge down to the water, all round.
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        for ring in water + islands:
            for a, b in zip(ring, ring[1:] + ring[:1]):
                if max(abs(a.x), abs(a.y), abs(b.x), abs(b.y)) >= g - 0.01 and (abs(a.x - b.x) < 0.01 or abs(a.y - b.y) < 0.01):
                    continue  # the square's own edge, where the clip cut it
                f = bm.faces.new([bm.verts.new(v) for v in ((a.x, a.y, 0.02), (b.x, b.y, 0.02), (b.x, b.y, -depth - 0.2), (a.x, a.y, -depth - 0.2))])
                ln = (b - a).length
                for loop, (u, v) in zip(f.loops, ((0, 0), (ln, 0), (ln, -depth), (0, -depth))):
                    loop[uv].uv = (u, v)
        kit.new_object('bank', bm, [bank_mat])
        for ring in water:
            self.solids.append([[round(p.x, 2), round(p.y, 2)] for p in ring])
            for k in range(0, len(ring)):
                a, b = ring[k - 1], ring[k]
                for s in range(int((b - a).length) + 1):
                    self.mark_disk(a + (b - a).normalized() * s if (b - a).length > 0 else a, 1.0)
        # Every cell of water taken, so nothing is put on it.
        for x in range(int(-g), int(g), 2):
            for y in range(int(-g), int(g), 2):
                p = Vector((x, y))
                if any(self.inside(p, r) for r in water) and not any(self.inside(p, r) for r in islands):
                    self.mark_disk(p, 1.5)
        return water, islands
