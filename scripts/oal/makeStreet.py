# One Africa Life: a piece of a real Monrovia street in 3D, from OpenStreetMap, to judge the look.
#
#   blender -b --factory-startup --python scripts/oal/makeStreet.py -- <osm.json> <textures dir> <out dir>
#
# The map (OpenStreetMap, © OpenStreetMap contributors, ODbL) gives where every road and building
# really is. What a map does not say is drawn here from how Sinkor looks: houses of one or two
# storeys in painted plaster, faded by sun and rain with red dust splashed up their foot, windows
# behind iron bars, hipped roofs of corrugated zinc gone to rust; bigger blocks in concrete with
# flat roofs; compound walls with steel gates along every street; zinc kiosks with rusty shutters
# on the boulevard's red-earth shoulder; coconut palms; wooden poles carrying the wires.
# The surfaces are photographs from Poly Haven (CC0), tinted here in the colours Sinkor is painted.
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OSM, TEX, OUT = args[0], args[1], os.path.expanduser(args[2])
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


def photo(name, stem, scale=1.0, tint=None, tint_amount=0.0, dust=0.0, metallic=0.0, rough_mul=1.0, mul=None):
    """A Poly Haven photo material on world-sized UVs; optionally tinted, and dusted red at the foot."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    uv = nt.nodes.new('ShaderNodeUVMap')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / scale, 1 / scale, 1)
    nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])

    def tex(suffix, colour=True):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TEX, f'{stem}_{suffix}.jpg'), check_existing=True)
        if not colour:
            t.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mapping.outputs['Vector'], t.inputs['Vector'])
        return t

    colour = tex('diff').outputs['Color']
    if tint is not None:
        # Painted: the photo's light and dark kept, its colour replaced by the paint.
        bw = nt.nodes.new('ShaderNodeRGBToBW')
        nt.links.new(colour, bw.inputs['Color'])
        paint = nt.nodes.new('ShaderNodeMix')
        paint.data_type = 'RGBA'
        paint.blend_type = 'MULTIPLY'
        paint.inputs['Factor'].default_value = 1.0
        nt.links.new(bw.outputs['Val'], paint.inputs['A'])
        paint.inputs['B'].default_value = (*[c * 2.2 for c in tint], 1)
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs['Factor'].default_value = tint_amount
        nt.links.new(colour, mix.inputs['A'])
        nt.links.new(paint.outputs['Result'], mix.inputs['B'])
        colour = mix.outputs['Result']
    if dust:
        # Red laterite splashed up the bottom half metre, uneven; rain streaks darker from the top.
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo.outputs['Position'], sep.inputs['Vector'])
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 3.0
        nt.links.new(geo.outputs['Position'], n.inputs['Vector'])
        add = nt.nodes.new('ShaderNodeMath')
        add.operation = 'MULTIPLY_ADD'
        nt.links.new(n.outputs['Fac'], add.inputs[0])
        add.inputs[1].default_value = 0.5
        nt.links.new(sep.outputs['Z'], add.inputs[2])
        ramp = nt.nodes.new('ShaderNodeMapRange')
        nt.links.new(add.outputs['Value'], ramp.inputs['Value'])
        ramp.inputs['From Min'].default_value = 0.25
        ramp.inputs['From Max'].default_value = 0.85
        ramp.inputs['To Min'].default_value = dust
        ramp.inputs['To Max'].default_value = 0.0
        dmix = nt.nodes.new('ShaderNodeMix')
        dmix.data_type = 'RGBA'
        nt.links.new(ramp.outputs['Result'], dmix.inputs['Factor'])
        nt.links.new(colour, dmix.inputs['A'])
        dmix.inputs['B'].default_value = (0.36, 0.13, 0.06, 1)
        streak = nt.nodes.new('ShaderNodeTexNoise')
        streak.inputs['Scale'].default_value = 1.0
        streak.inputs['Detail'].default_value = 4
        stretch = nt.nodes.new('ShaderNodeMapping')
        stretch.inputs['Scale'].default_value = (4.0, 4.0, 0.25)
        nt.links.new(geo.outputs['Position'], stretch.inputs['Vector'])
        nt.links.new(stretch.outputs['Vector'], streak.inputs['Vector'])
        sramp = nt.nodes.new('ShaderNodeMapRange')
        nt.links.new(streak.outputs['Fac'], sramp.inputs['Value'])
        sramp.inputs['From Min'].default_value = 0.45
        sramp.inputs['From Max'].default_value = 0.75
        sramp.inputs['To Min'].default_value = 1.0
        sramp.inputs['To Max'].default_value = 0.6
        dark = nt.nodes.new('ShaderNodeMix')
        dark.data_type = 'RGBA'
        dark.blend_type = 'MULTIPLY'
        dark.inputs['Factor'].default_value = 1.0
        nt.links.new(dmix.outputs['Result'], dark.inputs['A'])
        comb = nt.nodes.new('ShaderNodeCombineXYZ')
        for k in ('X', 'Y', 'Z'):
            nt.links.new(sramp.outputs['Result'], comb.inputs[k])
        nt.links.new(comb.outputs['Vector'], dark.inputs['B'])
        colour = dark.outputs['Result']
    if mul is not None:
        # A colour cast: asphalt darker, the earth redder.
        cast = nt.nodes.new('ShaderNodeMix')
        cast.data_type = 'RGBA'
        cast.blend_type = 'MULTIPLY'
        cast.inputs['Factor'].default_value = 1.0
        nt.links.new(colour, cast.inputs['A'])
        cast.inputs['B'].default_value = (*mul, 1)
        colour = cast.outputs['Result']
    nt.links.new(colour, bsdf.inputs['Base Color'])
    rough = tex('rough', False)
    if rough_mul != 1.0:
        mul = nt.nodes.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = rough_mul
        nt.links.new(rough.outputs['Color'], mul.inputs[0])
        nt.links.new(mul.outputs['Value'], bsdf.inputs['Roughness'])
    else:
        nt.links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex('nor', False).outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = metallic
    return m


def flat(name, rgb, roughness=0.8, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metallic
    return m


def srgb(h):
    c = [int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# The colours houses in Sinkor are painted: sun-faded creams, yellows, pale greens and blues, a
# pink, a salmon; some left grey in bare cement render.
PAINTS = ['#e9dcb8', '#e8c97a', '#cfdcb8', '#a9c8d6', '#e8b8a8', '#d99a7a', '#f2ece0', '#b8d4b0', '#e6d39a', '#9fb8d8']
wall_mats = [photo(f'wall_{p}', random.choice(['painted_plaster_wall', 'white_stucco']), scale=2.5, tint=srgb(p), tint_amount=0.9, dust=0.75) for p in PAINTS]
wall_mats.append(photo('wall_bare', 'white_stucco', scale=3.0, tint=srgb('#b4afa6'), tint_amount=1.0, dust=0.7))
m_compound = [photo(f'compound_{p}', 'white_stucco', scale=2.5, tint=srgb(p), tint_amount=0.9, dust=0.95) for p in ('#d8d0c0', '#e8c97a', '#f2ece0', '#c0c8b8')]
m_zinc_rust = photo('zinc_rust', 'rusty_corrugated_iron', scale=2.0, metallic=0.3)
m_zinc = photo('zinc', 'corrugated_iron_02', scale=2.0, metallic=0.7, rough_mul=0.9)
m_flatroof = photo('flatroof', 'white_stucco', scale=4.0, tint=srgb('#8f8a82'), tint_amount=1.0)
m_asphalt = photo('asphalt', 'road_damaged_clean', scale=4.0, mul=(0.5, 0.5, 0.52))
m_side = photo('side_road', 'road_damaged_clean', scale=3.0, mul=(0.62, 0.6, 0.58))
m_earth = photo('earth', 'red_laterite_soil_stones', scale=3.0, mul=(1.0, 0.78, 0.62))
m_dirt = photo('dirt_road', 'red_dirt_mud_01', scale=3.0, mul=(1.0, 0.8, 0.66))
m_shutter = photo('shutter', 'rusty_metal_shutter', scale=2.2, metallic=0.4)
m_curb = flat('curb', (0.25, 0.24, 0.22), 0.9)
m_glass = flat('glass', (0.02, 0.025, 0.03), 0.15)
m_bars = flat('bars', (0.03, 0.03, 0.03), 0.5, 0.6)
m_frame = flat('frame', (0.55, 0.52, 0.48), 0.8)
m_doors = [flat(f'door{i}', srgb(c), 0.6, 0.3) for i, c in enumerate(['#3a2a20', '#1f3a4a', '#5a2a1c', '#2a4a2a', '#3a3a3a'])]
m_gate = [flat(f'gate{i}', srgb(c), 0.55, 0.5) for i, c in enumerate(['#2a3f6a', '#1a1a1a', '#6a1f1f', '#2a5a3a', '#7a6a2a'])]
m_kiosk = [flat(f'kiosk{i}', srgb(c), 0.7) for i, c in enumerate(['#2f6fb8', '#e2b62a', '#2f8a4a', '#c43a2a', '#e8e0d0'])]
m_trunk = flat('trunk', (0.20, 0.16, 0.12), 0.9)
m_frond = flat('frond', (0.10, 0.20, 0.05), 0.7)
m_frond_dry = flat('frond_dry', (0.32, 0.24, 0.10), 0.8)
m_wood = flat('pole', (0.15, 0.11, 0.08), 0.9)
m_wire = flat('wire', (0.01, 0.01, 0.01), 0.5)


def new_object(name, bm, mats):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    for m in mats:
        obj.data.materials.append(m)
    for p in mesh.polygons:
        p.use_smooth = False
    return obj


def box(bm, uv, centre, size, yaw=0.0, mat=0, uv_scale=1.0):
    """A box in a bmesh: centre (x, y, z bottom), size (along, across, high), turned by yaw."""
    c, s = math.cos(yaw), math.sin(yaw)
    a, b, h = size[0] / 2, size[1] / 2, size[2]
    corners = [(-a, -b), (a, -b), (a, b), (-a, b)]
    lo = [bm.verts.new((centre[0] + x * c - y * s, centre[1] + x * s + y * c, centre[2])) for x, y in corners]
    hi = [bm.verts.new((v.co.x, v.co.y, centre[2] + h)) for v in lo]
    faces = [bm.faces.new(hi)]
    for i in range(4):
        j = (i + 1) % 4
        faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    for f in faces:
        f.material_index = mat
        n = f.normal
        for loop in f.loops:
            p = loop.vert.co
            loop[uv].uv = ((p.x if abs(n.x) < 0.7 else p.y) / uv_scale, (p.z if abs(n.z) < 0.7 else p.y) / uv_scale)
    return faces


# ---- Where things are: a grid of what is road and what is building --------------------------

CELL = 1.0


def cell(p):
    return int((p.x + RADIUS * 1.3) / CELL), int((p.y + RADIUS * 1.3) / CELL)


occupied = set()  # cells taken by a road (with its edge) or a building


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
new_object('ground', bm, [m_earth])

road_lines = []
m_paint = flat('paint', (0.55, 0.53, 0.48), 0.9)
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
    new_object('road', bm, [mat])
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
                        q = [bm.verts.new((*(p + n * s), 0.035)) for p, s in ((p0, 0.07), (p0, -0.07), (p1, -0.07), (p1, 0.07))]
                        bm.faces.new(q)
                    t += step
                walked += ln
        new_object('lines', bm, [m_paint])
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
        new_object('kerb', bm, [m_curb])

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
        # Each eave vertex goes to the nearer ridge end.
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
    # The fascia under the eaves.
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
        # A parapet round the flat roof, and a water tank on it.
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
    building = new_object('building', bm, [wall, roof])

    # Windows (glass behind iron bars, in a plain surround) and a door on the side facing the road.
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
    new_object('openings', bm, [m_glass, m_bars, m_frame, random.choice(m_doors)])
    return building


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
    # Fill the building's cells, so walls and palms keep out.
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

# ---- Compound walls with gates, and kiosks on the boulevard ----------------------------------

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
                    # A steel gate, then the wall goes on.
                    gw = random.choice([1.2, 3.2])
                    gp = run[-1][0] + d * gw / 2
                    box(gates, gates_uv, (gp.x, gp.y, 0), (gw, 0.08, 2.0), math.atan2(d.y, d.x), mat=random.randrange(len(m_gate)))
                    flush(run)
                    t += gw
                    continue
                if ok:
                    run.append((p, d))
                else:
                    flush(run)
                t += 1.0
        flush(run)
new_object('compound_walls', walls_bm, m_compound)
new_object('gates', gates, m_gate)
print('WALLS', walls_made)

kiosks = 0
for w in tubman:
    pts = [xy(n) for n in w['nodes']]
    width = road_width(w)
    for a, b in zip(pts, pts[1:]):
        seg = b - a
        if seg.length < 0.1:
            continue
        d = seg.normalized()
        t = random.uniform(2, 10)
        while t < seg.length:
            side = random.choice((1, -1))
            n = Vector((-d.y, d.x)) * side
            p = a + d * t + n * (width / 2 + 2.6)
            yaw = math.atan2(d.y, d.x)
            if p.length < RADIUS and free(p + n * 1.0) and random.random() < 0.55:
                # A zinc kiosk: painted boards, its rusty shutter rolled half up to the road,
                # a lean-to roof sticking out to give shade, a plain sign board.
                k = bmesh.new()
                kuv = k.loops.layers.uv.new()
                wide = random.uniform(2.2, 3.4)
                c = p + n * 1.0
                box(k, kuv, (c.x, c.y, 0), (wide, 2.0, 2.4), yaw, mat=0)
                f0 = p - n * 0.01
                box(k, kuv, (f0.x, f0.y, 1.2), (wide - 0.3, 0.06, 1.1), yaw, mat=1)
                box(k, kuv, (f0.x, f0.y, 0), (wide - 0.3, 0.04, 1.2), yaw, mat=3)
                r = p + n * 0.4
                box(k, kuv, (r.x, r.y, 2.45), (wide + 0.6, 3.2, 0.05), yaw, mat=2)
                s = p - n * 0.05
                box(k, kuv, (s.x, s.y, 2.5), (wide - 0.2, 0.05, 0.55), yaw, mat=4)
                new_object('kiosk', k, [random.choice(m_kiosk), m_shutter, m_zinc_rust, m_glass, random.choice(m_kiosk)])
                mark_disk(c, 2.0)
                kiosks += 1
            t += random.uniform(6, 22)
print('KIOSKS', kiosks)

# ---- Palms, poles and wires ----------------------------------------------------------------


def palm(at):
    height = random.uniform(8, 14)
    lean = Vector((random.uniform(-1, 1), random.uniform(-1, 1))).normalized() * random.uniform(0.4, 1.8)
    tip = Vector((at.x + lean.x, at.y + lean.y, height))
    bm = bmesh.new()
    # The trunk: rings of 8, thinning upward, bending with the lean.
    rings = []
    for k in range(9):
        t = k / 8
        c = Vector((at.x, at.y, 0)).lerp(tip, t) + Vector((lean.x, lean.y, 0)) * (-0.25 * math.sin(t * math.pi))
        r = 0.2 - 0.06 * t + (0.06 if k == 0 else 0)
        rings.append([bm.verts.new(c + Vector((math.cos(j / 8 * 2 * math.pi) * r, math.sin(j / 8 * 2 * math.pi) * r, 0))) for j in range(8)])
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(8):
            bm.faces.new((r0[j], r0[(j + 1) % 8], r1[(j + 1) % 8], r1[j]))
    # Fronds: a stem with leaflets hanging either side, drooping; a few dry and brown below.
    for k in range(14):
        ang = k / 14 * 2 * math.pi + random.uniform(-0.2, 0.2)
        dry = k % 5 == 0
        droop = random.uniform(0.6, 1.1) + (0.8 if dry else 0)
        length = random.uniform(3.5, 4.8)
        out = Vector((math.cos(ang), math.sin(ang), 0))
        across = Vector((-math.sin(ang), math.cos(ang), 0))
        prev = None
        for s in range(1, 13):
            t = s / 12
            p = tip + out * length * t + Vector((0, 0, math.sin(t * 2.2) * 0.9 - droop * t * t * 2.2))
            if prev is not None:
                span = 0.55 * math.sin(math.pi * min(1, t * 1.1))
                for side in (1, -1):
                    hang = Vector((0, 0, -0.35 * span))
                    q = [bm.verts.new(v) for v in (prev, p, p + across * side * span + hang, prev + across * side * span * 0.9 + hang)]
                    face = bm.faces.new(q)
                    face.material_index = 2 if dry else 1
            prev = p
    new_object('palm', bm, [m_trunk, m_frond, m_frond_dry])


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
            box(bm, uv, (p.x, p.y, 8.6), (0.1, 1.8, 0.1), yaw)
    new_object('poles', bm, [m_wood])
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
placed = 0
for _ in range(4000):
    p = Vector((random.uniform(-RADIUS, RADIUS), random.uniform(-RADIUS, RADIUS)))
    if placed >= 90:
        break
    if p.length > RADIUS or not free(p):
        continue
    dist, _near = nearest_road(p)
    # Palms stand mostly in yards and along the roadside.
    if random.random() < (0.5 if dist < 14 else 0.12):
        palm(p)
        mark_disk(p, 3)
        placed += 1
print('PALMS', placed)

# ---- Light, sky, cameras -----------------------------------------------------------------------

world = bpy.data.worlds.new('sky')
world.use_nodes = True
sky = world.node_tree.nodes.new('ShaderNodeTexSky')
for attr, value in (('sky_type', 'NISHITA'), ('sun_elevation', math.radians(40)), ('sun_rotation', math.radians(235)), ('air_density', 3.0), ('dust_density', 5.0), ('ozone_density', 1.0)):
    try:
        setattr(sky, attr, value)
    except Exception:
        pass
world.node_tree.links.new(sky.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
scene.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 4.0
sun.data.angle = math.radians(1.5)
sun.data.color = (1.0, 0.95, 0.86)
sun.rotation_euler = (math.radians(50), 0, math.radians(235))
scene.collection.objects.link(sun)
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.taa_render_samples = 48
for attr, value in (('use_shadows', True), ('use_raytracing', True), ('volumetric_end', 250.0)):
    try:
        setattr(scene.eevee, attr, value)
    except Exception:
        pass
scene.view_settings.view_transform = 'AgX'
scene.view_settings.exposure = -0.5
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.render.image_settings.file_format = 'PNG'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
aim = bpy.data.objects.new('aim', None)
scene.collection.objects.link(aim)
cam.constraints.new('TRACK_TO').target = aim
cam.data.clip_end = 600

# On the boulevard's shoulder at eye height, both ways; down a side street; and from above.
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
views = {
    'boulevard': (mid + side * (tw / 2 + 1.0) - d * 10, 1.65, mid + d * 70 + side * (tw / 2 - 2), 2.2, 26),
    'boulevard_back': (mid - side * (tw / 2 + 1.0) + d * 10, 1.65, mid - d * 70 - side * (tw / 2 - 2), 2.2, 26),
    'above': (mid + side * 55 - d * 45, 32, mid + d * 15, 0, 30),
}
if street:
    pts, width = street
    a, b = pts[0], pts[-1]
    sd = (b - a).normalized()
    views['side_street'] = (a + sd * 6 + Vector((-sd.y, sd.x)) * (width / 2 - 0.8), 1.65, a + sd * 50, 2.0, 26)
for name, (at, h, look, lh, lens) in views.items():
    cam.location = (at.x, at.y, h)
    aim.location = (look.x, look.y, lh)
    cam.data.lens = lens
    scene.render.filepath = os.path.join(OUT, f'sinkor_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('VIEW', name)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'sinkor.blend'))
