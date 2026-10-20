# One Africa Life: home, inside, in 3D (public/oal/home.v1.glb and its plan): where a life
# sleeps, cooks and eats.
#
#   blender -b --factory-startup --python scripts/oal/makeHome.py -- <out.glb>
#
# Two homes, each a root object, centred on the origin, seen from above (no ceiling, walls a
# storey high):
#   house   a family's cement house as Monrovia builds them: a parlour (a sofa and plastic
#           chairs, a television on its stand, curtains), a bedroom (a foam mattress on a wooden
#           bed, a lappa cloth over it, a mosquito net hung above), a corridor to the back door,
#           and behind, the yard kitchen (a coal pot, pots, a water drum, jerrycans) under a zinc
#           lean-to.
#   room    a single rented room: a bed, a small table and a chair, a box for clothes, its own
#           coal pot on the veranda outside the door.
# The plan (<out>.json): for each home its solids (walls and furniture, as rectangles in metres,
# x east, y north) and its places: bed (lying down: where and which way), kitchen, table, door.
import json
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenekit as kit  # noqa: E402
from scenekit import box, cylinder, flat, photo, srgb  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

m_wall = photo('home_wall', 'painted_plaster_wall', scale=2.0, tint=srgb('#e6d8b4'), tint_amount=0.85, dust=0.4, streaks=0.1)
m_wall2 = photo('home_wall_blue', 'painted_plaster_wall', scale=2.0, tint=srgb('#a9c8d6'), tint_amount=0.85, dust=0.3, streaks=0.1)
m_floor = photo('home_floor', 'concrete_floor_02', scale=2.0, mul=(0.75, 0.7, 0.64), streaks=0)
m_tiles = photo('home_tiles', 'terrazzo_tiles', scale=1.5, rough_mul=0.5, streaks=0)
m_yard = photo('home_yard', 'red_laterite_soil_stones', scale=3.0, mul=(1.0, 0.78, 0.62), streaks=0)
m_zinc = photo('home_zinc', 'rusty_corrugated_iron', scale=2.0, metallic=0.3, streaks=0)
m_wood = flat('home_wood', srgb('#6b4a2e'), 0.7)
m_dark_wood = flat('home_dark_wood', srgb('#3a2a1c'), 0.6)
m_foam = flat('home_foam', srgb('#e8e2d4'), 0.9)
m_lappa = flat('home_lappa', srgb('#c8281e'), 0.85)
m_lappa2 = flat('home_lappa2', srgb('#1f4fa8'), 0.85)
m_net = flat('mosquito_net', (0.95, 0.95, 0.95), 0.9, alpha=0.25)
m_sofa = flat('home_sofa', srgb('#5a2a1c'), 0.85)
m_plastic = flat('home_plastic_chair', (0.92, 0.92, 0.9), 0.5)
m_black = flat('home_black', (0.03, 0.03, 0.03), 0.4)
m_screen = flat('home_tv_screen', (0.02, 0.02, 0.03), 0.15)
m_curtain = flat('home_curtain', srgb('#e2b62a'), 0.9)
m_coal = flat('home_coal', (0.05, 0.05, 0.05), 0.95)
m_steel = flat('home_steel', (0.6, 0.6, 0.62), 0.35, 0.8)
m_blue = flat('home_drum', srgb('#2a5aa8'), 0.5)
m_door = flat('home_door', srgb('#5a2a1c'), 0.6)
m_window = flat('home_window', (0.6, 0.75, 0.85), 0.1, alpha=0.5)
m_bars = flat('home_bars', (0.03, 0.03, 0.03), 0.5, 0.6)

H = 2.8      # wall height
T = 0.15     # wall thickness
PLAN = {}


class Home:
    def __init__(self, name):
        self.name = name
        self.root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(self.root)
        self.solids = []
        self.places = {}

    def add(self, obj):
        obj.parent = self.root
        return obj

    def solid(self, x0, y0, x1, y1):
        self.solids.append([round(min(x0, x1), 2), round(min(y0, y1), 2), round(max(x0, x1), 2), round(max(y0, y1), 2)])

    def wall(self, bm, uv, x0, y0, x1, y1, mat=0, gaps=()):
        """A wall from (x0, y0) to (x1, y1) along x or y, with gaps (from, to) along it for doors."""
        horizontal = abs(y1 - y0) < 1e-6
        a, b = (x0, x1) if horizontal else (y0, y1)
        lo, hi = min(a, b), max(a, b)
        cuts = sorted(gaps)
        start = lo
        for g0, g1 in cuts + [(hi, hi)]:
            if g0 > start:
                mid = (start + g0) / 2
                ln = g0 - start
                if horizontal:
                    box(bm, uv, (mid, y0, 0), (ln, T, H), mat=mat)
                    self.solid(start, y0 - T / 2, g0, y0 + T / 2)
                else:
                    box(bm, uv, (x0, mid, 0), (T, ln, H), mat=mat)
                    self.solid(x0 - T / 2, start, x0 + T / 2, g0)
            start = max(start, g1)

    def place(self, name, x, y, face, **extra):
        self.places[name] = {'x': round(x, 2), 'y': round(y, 2), 'face': [round(face[0], 3), round(face[1], 3)], **extra}


def bed(home, x, y, yaw, lappa):
    """A wooden bed, a foam mattress, a pillow, a lappa over it, a mosquito net above; x, y its
    middle, yaw the way the head lies."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    L, W = 2.0, 1.4
    box(bm, uv, (x, y, 0.0), (L, W, 0.35), yaw, mat=0)
    box(bm, uv, (x, y, 0.35), (L - 0.06, W - 0.06, 0.18), yaw, mat=1)
    c, s = math.cos(yaw), math.sin(yaw)
    hx, hy = x + c * (L / 2 - 0.25), y + s * (L / 2 - 0.25)
    box(bm, uv, (hx, hy, 0.53), (0.35, W - 0.3, 0.12), yaw, mat=1)
    fx, fy = x - c * 0.35, y - s * 0.35
    box(bm, uv, (fx, fy, 0.53), (L * 0.55, W - 0.04, 0.03), yaw, mat=2)
    box(bm, uv, (x + c * (L / 2 + 0.03), y + s * (L / 2 + 0.03), 0.0), (0.06, W, 1.0), yaw, mat=0)
    obj = home.add(kit.new_object(f'{home.name}_bed', bm, [m_wood, m_foam, lappa]))
    # The mosquito net, a tent of gauze from a point above.
    bm = bmesh.new()
    bm.loops.layers.uv.new()
    top = bm.verts.new((x, y, 2.4))
    ring = [bm.verts.new((x + math.cos(k / 8 * 2 * math.pi) * 1.2, y + math.sin(k / 8 * 2 * math.pi) * 0.95, 0.4)) for k in range(8)]
    for k in range(8):
        bm.faces.new((top, ring[k], ring[(k + 1) % 8]))
    home.add(kit.new_object(f'{home.name}_net', bm, [m_net]))
    home.solid(x - (abs(c) * L + abs(s) * W) / 2, y - (abs(s) * L + abs(c) * W) / 2, x + (abs(c) * L + abs(s) * W) / 2, y + (abs(s) * L + abs(c) * W) / 2)
    # Lying in it: on the mattress, head toward yaw.
    home.place('bed', x, y, (c, s), z=0.55, side=[round(x - s * (W / 2 + 0.6), 2), round(y + c * (W / 2 + 0.6), 2)])
    return obj


def coal_pot_kitchen(home, x, y, zinc=True):
    """A coal pot with a pot on it, a second pot, a water drum, jerrycans; a zinc lean-to over."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    cylinder(bm, (x, y, 0), 0.22, 0.3, mat=0)
    cylinder(bm, (x, y, 0.3), 0.26, 0.28, mat=1)
    cylinder(bm, (x + 0.7, y, 0), 0.24, 0.3, mat=1)
    cylinder(bm, (x - 1.0, y + 0.3, 0), 0.32, 0.9, mat=2)
    for k in range(2):
        box(bm, uv, (x - 0.4 + k * 0.32, y + 0.7, 0), (0.25, 0.15, 0.4), mat=3)
    if zinc:
        box(bm, uv, (x, y + 0.3, 2.2), (3.0, 2.2, 0.05), mat=4, pitch=0.15)
        for px, py in ((x - 1.4, y - 0.7), (x + 1.4, y - 0.7)):
            box(bm, uv, (px, py, 0), (0.08, 0.08, 2.2), mat=5)
    home.add(kit.new_object(f'{home.name}_kitchen', bm, [m_coal, m_steel, m_blue, flat('jerrycan_yellow', srgb('#e2b62a'), 0.5), m_zinc, m_wood]))
    home.solid(x - 1.35, y - 0.3, x + 1.0, y + 0.85)
    home.place('kitchen', x, y - 0.8, (0, 1))


def plastic_chair(bm, uv, x, y, yaw, mat):
    box(bm, uv, (x, y, 0.42), (0.45, 0.45, 0.05), yaw, mat=mat)
    c, s = math.cos(yaw), math.sin(yaw)
    box(bm, uv, (x - c * 0.21, y - s * 0.21, 0.42), (0.05, 0.45, 0.45), yaw, mat=mat)
    for dx, dy in ((-0.18, -0.18), (0.18, -0.18), (-0.18, 0.18), (0.18, 0.18)):
        box(bm, uv, (x + dx, y + dy, 0), (0.04, 0.04, 0.42), mat=mat)


# ---- The family house: a cement bungalow on its own plot -----------------------------------------
#
# 12 by 10 m, its front (y = -5) to the street. Inside: the living room (front left), the kitchen
# and dining room (front right, through an arch), the corridor, the bathroom and two bedrooms
# behind. Floors of porcelain tiles; POP ceilings (a dropped border with a light cove, a moulded
# medallion and a lamp in the middle); windows with burglar bars and curtains; doors that swing
# (separate objects, hinged, for the game to open). Outside: a porch with columns, the yard
# (grass, a cement path, a palm, banana plants, a water tank), the compound wall and its iron
# gate, and the street with the neighbours' houses across it.

HH = 3.0     # the house's ceiling
WT = 0.2     # its walls' thickness
m_ext = photo('house_ext', 'painted_plaster_wall', scale=2.5, tint=srgb('#e8d6a6'), tint_amount=0.85, dust=0.7, streaks=0.3)
m_in = {
    'living': photo('wall_living', 'painted_plaster_wall', scale=2.0, tint=srgb('#f1e7d0'), tint_amount=0.85, streaks=0),
    'kitchen': photo('wall_kitchen', 'white_stucco', scale=2.0, tint=srgb('#f4efe4'), tint_amount=0.9, streaks=0),
    'bed1': photo('wall_bed1', 'painted_plaster_wall', scale=2.0, tint=srgb('#cfe0ea'), tint_amount=0.85, streaks=0),
    'bed2': photo('wall_bed2', 'painted_plaster_wall', scale=2.0, tint=srgb('#e9d2dc'), tint_amount=0.85, streaks=0),
    'bath': photo('wall_bath', 'large_grey_tiles', scale=0.8, rough_mul=0.35, streaks=0),
    'hall': photo('wall_hall', 'painted_plaster_wall', scale=2.0, tint=srgb('#efe6d2'), tint_amount=0.85, streaks=0),
}
m_floor_tile = photo('floor_tiles', 'large_grey_tiles', scale=1.4, mul=(1.0, 0.97, 0.92), rough_mul=0.45, streaks=0)
m_pop = flat('pop_ceiling', (0.95, 0.95, 0.93), 0.85)
m_pop_trim = flat('pop_trim', srgb('#d9c7a2'), 0.6)
m_cove = flat('pop_cove_light', (1.0, 0.9, 0.7), 0.5, emission=3.0)
m_lamp = flat('ceiling_lamp', (1.0, 0.97, 0.9), 0.4, emission=7.0)
m_win = flat('window_glass', (0.6, 0.72, 0.8), 0.05, alpha=0.22)
m_roof = photo('roof_long_span', 'corrugated_iron_02', scale=2.5, tint=srgb('#8a2a1c'), tint_amount=0.75, metallic=0.4, streaks=0)
m_cwall = photo('compound_wall', 'white_stucco', scale=2.5, tint=srgb('#d8d0c0'), tint_amount=0.9, dust=0.9)
m_path = photo('yard_path', 'brushed_concrete', scale=2.0, mul=(0.8, 0.79, 0.76), streaks=0)
m_lawn = kit.lawn('yard_grass', 2.5, (0.6, 0.72, 0.45))
m_street = photo('house_street', 'road_damaged_clean', scale=4.0, mul=(0.55, 0.55, 0.56), streaks=0)
m_earth = photo('house_earth', 'red_laterite_soil_stones', scale=3.0, mul=(1.0, 0.78, 0.62), streaks=0)
m_iron = flat('iron_gate', srgb('#1f3a5a'), 0.5, 0.6)
m_white = flat('fixture_white', (0.94, 0.94, 0.93), 0.25)
m_chrome = flat('fixture_chrome', (0.8, 0.8, 0.82), 0.2, 0.9)
m_counter = flat('counter_top', srgb('#3a3a3c'), 0.3)
m_cabinet = flat('kitchen_cabinet', srgb('#8a5a32'), 0.6)
m_rug = flat('rug', srgb('#7a2a2a'), 0.95)
m_fabric = flat('sofa_fabric', srgb('#3a4a6a'), 0.9)
m_cushion = flat('cushion', srgb('#e2b62a'), 0.9)
m_tv = flat('tv_black', (0.02, 0.02, 0.025), 0.2)
m_bedding = flat('bedding', srgb('#f2ece0'), 0.9)
m_cover = flat('bed_cover', srgb('#1f4fa8'), 0.85)
m_curtain2 = flat('curtain_wine', srgb('#7a1f2a'), 0.9)

house = Home('house')
house.doors, house.lights = [], []
inside_rects = []


def slab(name, x0, y0, x1, y1, z, mat, home=house, down=False):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    pts = ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))
    f = bm.faces.new([bm.verts.new(v) for v in (pts[::-1] if down else pts)])
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
    return home.add(kit.new_object(name, bm, [mat]))


def wall(x0, y0, x1, y1, inner, outer=None, openings=(), solid=True):
    """A wall from (x0, y0) to (x1, y1) along x or y, WT thick: its two faces in their rooms'
    paints (inner: the side of lower x or y, outer: the side of higher). Openings (from, to, 'door' | 'window' |
    'arch') along it from its lower end: a door's gap to 2.1 m, a window's from 0.95 to 2.05 with
    glass and bars, an arch's to 2.4. Solid to walk against but for doors and arches."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    horizontal = abs(y1 - y0) < 1e-6
    lo, hi = (min(x0, x1), max(x0, x1)) if horizontal else (min(y0, y1), max(y0, y1))
    fixed = y0 if horizontal else x0

    def piece(a, b, z0, z1, mat):
        ln, mid = b - a, (a + b) / 2
        for side, m in ((-1, 0), (1, 1)):
            off = side * WT / 4
            if horizontal:
                box(bm, uv, (mid, fixed + off, z0), (ln, WT / 2, z1 - z0), mat=m)
            else:
                box(bm, uv, (fixed + off, mid, z0), (WT / 2, ln, z1 - z0), mat=m)

    def solid_span(a, b):
        if not solid or b - a < 0.01:
            return
        if horizontal:
            house.solid(a, fixed - WT / 2, b, fixed + WT / 2)
        else:
            house.solid(fixed - WT / 2, a, fixed + WT / 2, b)

    t = lo
    for o0, o1, kind in sorted(openings) + [(hi, hi, 'end')]:
        if o0 > t:
            piece(t, o0, 0, HH, None)
            solid_span(t, o0)
        if kind == 'end':
            break
        top = {'door': 2.1, 'window': 2.05, 'arch': 2.4}[kind]
        piece(o0, o1, top, HH, None)
        if kind == 'window':
            piece(o0, o1, 0, 0.95, None)
            solid_span(o0, o1)
            gb = bmesh.new()
            guv = gb.loops.layers.uv.new()
            mid = (o0 + o1) / 2
            if horizontal:
                box(gb, guv, (mid, fixed, 0.95), (o1 - o0, 0.02, 1.1), mat=0)
                for k in range(int((o1 - o0) / 0.15) + 1):
                    box(gb, guv, (o0 + k * 0.15, fixed - WT / 2 - 0.02, 0.95), (0.02, 0.02, 1.1), mat=1)
            else:
                box(gb, guv, (fixed, mid, 0.95), (0.02, o1 - o0, 1.1), mat=0)
                for k in range(int((o1 - o0) / 0.15) + 1):
                    box(gb, guv, (fixed - WT / 2 - 0.02, o0 + k * 0.15, 0.95), (0.02, 0.02, 1.1), mat=1)
            house.add(kit.new_object('window', gb, [m_win, m_bars]))
        t = o1
    # Which face is which: the box's -side face got material 0, its +side 1; the wall's object
    # carries both paints in that order.
    obj = house.add(kit.new_object('wall', bm, [inner, outer or inner]))
    # Faces of each half: the half nearer -side takes material 0 (inner), the other 1 (outer).
    for poly in obj.data.polygons:
        c = poly.center
        poly.material_index = 0 if ((c.y if horizontal else c.x) < fixed) else 1
    return obj


def door(name, hx, hy, along, swing):
    """A door leaf on its hinge at (hx, hy), 0.9 m along `along` (+x, -x, +y, -y) when shut,
    opening by `swing` radians; the game turns it."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    box(bm, uv, (0.45, 0, 0), (0.88, 0.05, 2.05), mat=0)
    box(bm, uv, (0.8, 0.05, 1.0), (0.05, 0.04, 0.12), mat=1)
    obj = house.add(kit.new_object(f'door_{name}', bm, [m_door, m_chrome]))
    yaw = {'+x': 0.0, '-x': math.pi, '+y': math.pi / 2, '-y': -math.pi / 2}[along]
    obj.location = (hx, hy, 0)
    obj.rotation_euler = (0, 0, yaw)
    house.doors.append({'name': f'door_{name}', 'x': hx, 'y': hy, 'yaw': round(yaw, 4), 'swing': swing,
                        'cx': round(hx + math.cos(yaw) * 0.45, 2), 'cy': round(hy + math.sin(yaw) * 0.45, 2)})


def ceiling(name, x0, y0, x1, y1, home=None):
    """A POP ceiling: the flat ceiling, a border dropped 15 cm with a light cove along its inner
    edge, a moulded ring and a lamp in the middle; a light for the game there."""
    home = home or house
    slab(f'{name}_ceiling', x0, y0, x1, y1, HH, m_pop, home=home, down=True)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    b = min(0.55, (x1 - x0) / 5, (y1 - y0) / 5)
    for (a0, a1, c0, c1) in ((x0, x1, y0, y0 + b), (x0, x1, y1 - b, y1), (x0, x0 + b, y0 + b, y1 - b), (x1 - b, x1, y0 + b, y1 - b)):
        box(bm, uv, ((a0 + a1) / 2, (c0 + c1) / 2, HH - 0.15), (a1 - a0, c1 - c0, 0.15), mat=0)
    # The cove: a thin glowing strip inside the border.
    for (a0, a1, c0, c1) in ((x0 + b, x1 - b, y0 + b, y0 + b + 0.04), (x0 + b, x1 - b, y1 - b - 0.04, y1 - b), (x0 + b, x0 + b + 0.04, y0 + b, y1 - b), (x1 - b - 0.04, x1 - b, y0 + b, y1 - b)):
        box(bm, uv, ((a0 + a1) / 2, (c0 + c1) / 2, HH - 0.17), (a1 - a0, c1 - c0, 0.03), mat=2)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = min(0.7, (x1 - x0) / 4, (y1 - y0) / 4)
    cylinder(bm, (cx, cy, HH - 0.05), r, 0.05, segments=24, mat=1)
    cylinder(bm, (cx, cy, HH - 0.12), r * 0.35, 0.07, segments=16, mat=3)
    home.add(kit.new_object(f'{name}_pop', bm, [m_pop_trim, m_pop, m_cove, m_lamp]))
    home.lights.append({'x': round(cx, 2), 'y': round(cy, 2), 'z': HH - 0.3})
    if home is house:
        inside_rects.append([x0, y0, x1, y1])


# The plot and the street.
slab('plot_grass', -12, -14, 12, 8, 0.0, m_lawn)
slab('street', -40, -22, 40, -14.2, 0.01, m_street)
slab('verge', -40, -30, 40, -22, 0.0, m_earth)
slab('path', -0.8, -14.2, 0.8, -6.6, 0.015, m_path)
slab('porch', -3.2, -6.6, 3.2, -5.0, 0.02, m_path)
slab('house_floor', -6, -5, 6, 5, 0.015, m_floor_tile)
# The house's walls: the outside, and the rooms' partitions.
wall(-6, -5, 6, -5, m_ext, m_in['living'], [(-5.2, -3.8, 'window'), (-2.9, -2.0, 'door'), (2.0, 3.4, 'window'), (4.2, 5.4, 'window')])
wall(-6, 5, 6, 5, m_in['bed1'], m_ext, [(-4.4, -3.0, 'window'), (-0.2, 0.6, 'window'), (3.0, 4.4, 'window')])
wall(-6, -5, -6, 5, m_ext, m_in['living'], [(-3.5, -2.1, 'window'), (2.0, 3.4, 'window')])
wall(6, -5, 6, 5, m_in['kitchen'], m_ext, [(-3.2, -1.8, 'window'), (2.0, 3.4, 'window')])
wall(-6, 0.5, 6, 0.5, m_in['living'], m_in['hall'], [(-0.9, 0.0, 'door')])
wall(1.0, -5, 1.0, 0.5, m_in['living'], m_in['kitchen'], [(-2.6, -0.8, 'arch')])
wall(-1.2, 0.5, -1.2, 5, m_in['bed1'], m_in['hall'], [(1.0, 1.9, 'door')])
wall(1.4, 0.5, 1.4, 5, m_in['hall'], m_in['bed2'], [(1.0, 1.9, 'door')])
wall(-1.2, 3.0, 1.4, 3.0, m_in['hall'], m_in['bath'], [(-0.6, 0.3, 'door')])
door('front', -2.9, -5.0, '+x', -1.5)
door('hall', -0.9, 0.5, '+x', 1.5)
door('bed1', -1.2, 1.0, '+y', 1.5)
door('bed2', 1.4, 1.0, '+y', -1.5)
door('bath', -0.6, 3.0, '+x', 1.5)
for name, rect in (('living', (-6, -5, 1, 0.5)), ('kitchen', (1, -5, 6, 0.5)), ('hall', (-1.2, 0.5, 1.4, 3.0)), ('bath', (-1.2, 3.0, 1.4, 5)), ('bed1', (-6, 0.5, -1.2, 5)), ('bed2', (1.4, 0.5, 6, 5))):
    ceiling(name, *rect)
# The roof: a hip of long-span sheets over the whole house, overhanging.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
ring = [(-6.6, -5.6), (6.6, -5.6), (6.6, 5.6), (-6.6, 5.6)]
lo = [bm.verts.new((x, y, HH + 0.25)) for x, y in ring]
r0, r1 = bm.verts.new((-1.2, 0, HH + 2.6)), bm.verts.new((1.2, 0, HH + 2.6))
for f in ((lo[0], lo[1], r1, r0), (lo[1], lo[2], r1), (lo[2], lo[3], r0, r1), (lo[3], lo[0], r0)):
    face = bm.faces.new(f)
    for loop in face.loops:
        loop[uv].uv = (loop.vert.co.x + loop.vert.co.z, loop.vert.co.y + loop.vert.co.z)
house.add(kit.new_object('roof', bm, [m_roof]))
# The fascia under the roof's edge, so the roof sits on the walls.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for (cx, cy, sx, sy) in ((0, -5.6, 13.2, 0.1), (0, 5.6, 13.2, 0.1), (-6.6, 0, 0.1, 11.2), (6.6, 0, 0.1, 11.2)):
    box(bm, uv, (cx, cy, HH), (sx, sy, 0.3))
box(bm, uv, (0, 0, HH), (12.2, 10.2, 0.25))
house.add(kit.new_object('fascia', bm, [m_ext]))
# The porch: two columns, a step's edge.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for x in (-2.9, 2.9):
    box(bm, uv, (x, -6.4, 0), (0.3, 0.3, HH), mat=0)
    house.solid(x - 0.18, -6.58, x + 0.18, -6.22)
box(bm, uv, (0, -6.6, 0), (6.4, 0.2, 0.08), mat=1)
house.add(kit.new_object('porch_columns', bm, [m_ext, m_path]))

# ---- The rooms' furniture ----

bm = bmesh.new()
uv = bm.loops.layers.uv.new()
# Living room: a three-seater along the west wall, two armchairs, a centre table on a rug, the
# television on its stand by the arch, a potted palm.
box(bm, uv, (-5.45, -2.8, 0), (0.85, 2.3, 0.45), mat=0)
box(bm, uv, (-5.8, -2.8, 0.45), (0.2, 2.3, 0.45), mat=0)
for y in (-3.6, -2.8, -2.0):
    box(bm, uv, (-5.3, y, 0.45), (0.5, 0.6, 0.12), mat=1)
for (x, y, yaw) in ((-3.0, -4.2, math.pi / 2), (-3.0, -1.2, -math.pi / 2)):
    box(bm, uv, (x, y, 0), (0.8, 0.8, 0.42), yaw, mat=0)
    c, s_ = math.cos(yaw), math.sin(yaw)
    box(bm, uv, (x - s_ * -0.32, y + c * -0.32, 0.42), (0.8, 0.16, 0.42), yaw, mat=0)
box(bm, uv, (-3.6, -2.7, 0), (2.6, 1.8, 0.02), mat=2)
box(bm, uv, (-3.6, -2.7, 0), (1.1, 0.6, 0.42), mat=3)
box(bm, uv, (0.55, -4.0, 0), (0.45, 1.6, 0.55), mat=3)
box(bm, uv, (0.7, -4.0, 0.9), (0.05, 1.3, 0.75), mat=4)
house.add(kit.new_object('living_furniture', bm, [m_fabric, m_cushion, m_rug, m_dark_wood, m_tv]))
house.solid(-5.95, -3.98, -4.98, -1.62)
house.solid(-3.45, -4.65, -2.55, -3.75)
house.solid(-3.45, -1.65, -2.55, -0.75)
house.solid(-4.2, -3.05, -3.0, -2.35)
house.solid(0.3, -4.85, 0.85, -3.15)
house.add(kit.thing('potted_palm', (-5.4, -0.2), 0.4))
# Curtains at the living room's windows.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for x0, x1 in ((-5.4, -3.6),):
    box(bm, uv, (x0 + 0.15, -4.85, 0.8), (0.3, 0.06, 1.5), mat=0)
    box(bm, uv, (x1 - 0.15, -4.85, 0.8), (0.3, 0.06, 1.5), mat=0)
for y0, y1 in ((-3.7, -1.9),):
    box(bm, uv, (-5.85, y0 + 0.15, 0.8), (0.06, 0.3, 1.5), mat=0)
    box(bm, uv, (-5.85, y1 - 0.15, 0.8), (0.06, 0.3, 1.5), mat=0)
house.add(kit.new_object('curtains', bm, [m_curtain2]))

# Kitchen and dining room: counters along the east wall and the back wall with cabinets above,
# the gas cooker, the sink under the window, the fridge; the dining table with six chairs.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
box(bm, uv, (5.6, -2.2, 0), (0.6, 4.6, 0.86), mat=0)
box(bm, uv, (5.6, -2.2, 0.86), (0.64, 4.6, 0.04), mat=1)
box(bm, uv, (4.2, 0.1, 0), (2.8, 0.6, 0.86), mat=0)
box(bm, uv, (4.2, 0.1, 0.86), (2.8, 0.64, 0.04), mat=1)
box(bm, uv, (5.75, -1.0, 1.55), (0.35, 2.0, 0.7), mat=0)
box(bm, uv, (4.2, 0.3, 1.55), (2.8, 0.35, 0.7), mat=0)
box(bm, uv, (5.6, -3.9, 0.9), (0.55, 0.6, 0.06), mat=3)
for dx in (-0.14, 0.14):
    for dy in (-0.14, 0.14):
        cylinder(bm, (5.6 + dx, -3.9 + dy, 0.96), 0.07, 0.02, segments=10, mat=2)
box(bm, uv, (5.6, -2.5, 0.88), (0.45, 0.6, 0.03), mat=4)
box(bm, uv, (1.45, 0.1, 0), (0.7, 0.7, 1.8), mat=5)
box(bm, uv, (3.4, -3.0, 0.72), (1.6, 0.9, 0.05), mat=6)
for dx in (-0.6, 0.6):
    for dy in (-0.35, 0.35):
        box(bm, uv, (3.4 + dx, -3.0 + dy, 0), (0.05, 0.05, 0.72), mat=6)
for k, (x, y, yaw) in enumerate(((2.9, -3.65, 0), (3.9, -3.65, 0), (2.9, -2.35, math.pi), (3.9, -2.35, math.pi), (2.35, -3.0, math.pi / 2), (4.45, -3.0, -math.pi / 2))):
    box(bm, uv, (x, y, 0.45), (0.42, 0.42, 0.04), yaw, mat=6)
    for dx in (-0.18, 0.18):
        for dy in (-0.18, 0.18):
            box(bm, uv, (x + dx, y + dy, 0), (0.03, 0.03, 0.45), mat=6)
house.add(kit.new_object('kitchen_dining', bm, [m_cabinet, m_counter, m_black, m_steel, m_chrome, m_white, m_dark_wood]))
house.solid(5.25, -4.55, 5.95, 0.15)
house.solid(2.75, -0.25, 5.95, 0.45)
house.solid(1.05, -0.3, 1.85, 0.45)
house.solid(2.55, -3.5, 4.25, -2.5)

# Bathroom: tiled, the toilet, the basin with a mirror, the shower behind glass.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
box(bm, uv, (-0.75, 4.45, 0), (0.4, 0.55, 0.42), mat=0)
box(bm, uv, (-0.75, 4.78, 0.42), (0.42, 0.18, 0.4), mat=0)
box(bm, uv, (0.95, 3.35, 0), (0.18, 0.18, 0.8), mat=0)
box(bm, uv, (0.95, 3.35, 0.8), (0.55, 0.45, 0.12), mat=0)
box(bm, uv, (1.28, 3.35, 1.2), (0.03, 0.55, 0.7), mat=1)
box(bm, uv, (0.75, 4.25, 0), (0.04, 1.4, 2.0), mat=2)
box(bm, uv, (1.1, 4.85, 1.9), (0.1, 0.1, 0.1), mat=1)
house.add(kit.new_object('bathroom', bm, [m_white, m_chrome, m_window]))
house.solid(-0.98, 4.15, -0.52, 4.95)
house.solid(0.65, 3.08, 1.25, 3.62)
house.solid(0.72, 3.55, 1.3, 4.95)

# The bedrooms: beds, wardrobes, side tables; a desk in the second.
bed(house, -3.6, 3.6, 0.0, m_cover)
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
box(bm, uv, (-5.6, 1.4, 0), (0.6, 1.6, 2.1), mat=0)
box(bm, uv, (-2.2, 4.6, 0), (0.45, 0.45, 0.55), mat=0)
box(bm, uv, (4.8, 3.9, 0), (1.9, 1.3, 0.45), mat=1)
box(bm, uv, (4.8, 3.9, 0.45), (1.86, 1.26, 0.15), mat=2)
box(bm, uv, (5.7, 3.9, 0), (0.06, 1.3, 1.0), mat=1)
box(bm, uv, (2.0, 4.6, 0), (1.1, 0.6, 2.0), mat=0)
box(bm, uv, (2.0, 1.2, 0.72), (1.0, 0.55, 0.04), mat=0)
house.add(kit.new_object('bedroom_furniture', bm, [m_dark_wood, m_wood, m_bedding]))
house.solid(-5.92, 0.58, -5.28, 2.22)
house.solid(-2.45, 4.35, -1.95, 4.85)
house.solid(3.85, 3.25, 5.75, 4.55)
house.solid(1.45, 4.3, 2.55, 4.95)
house.solid(1.5, 0.92, 2.5, 1.48)
# The master bed's own place is 'bed' (from bed()); the second bed is a guest's.

# ---- The yard, the compound wall and gate, the street ----

bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for (cx, cy, sx, sy) in ((0, 8, 24, 0.25), (-12, -3, 0.25, 22), (12, -3, 0.25, 22), (-6.75, -14, 10.5, 0.25), (6.75, -14, 10.5, 0.25)):
    box(bm, uv, (cx, cy, 0), (sx, sy, 2.3))
    house.solid(cx - sx / 2 - 0.05, cy - sy / 2 - 0.05, cx + sx / 2 + 0.05, cy + sy / 2 + 0.05)
house.add(kit.new_object('compound_wall', bm, [m_cwall]))
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for side in (-1, 1):
    # The iron gate's two leaves, swung open into the yard.
    hx = side * 1.5
    for k in range(8):
        box(bm, uv, (hx - side * 0.05, -14 + 0.12 + k * 0.18, 0), (0.05, 0.04, 2.0))
    box(bm, uv, (hx - side * 0.05, -13.3, 1.9), (0.06, 1.5, 0.08))
house.add(kit.new_object('gate', bm, [m_iron]))
house.add(kit.thing('coconut_palm', (-8.5, -9.5), 0.6, 0.85, name='palm'))
house.add(kit.thing('banana_clump', (8.5, 5.5), 1.2, 0.9, name='banana'))
house.add(kit.thing('water_tank', (9.8, -2.0), 0.0, name='water_tank'))
house.solid(-8.85, -9.85, -8.15, -9.15)
house.solid(7.4, 4.4, 9.6, 6.6)
house.solid(9.1, -2.7, 10.5, -1.3)
# The neighbours across the street: compound walls and the houses behind them, roofs of zinc.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for k, x in enumerate((-30, -16, -2, 12, 26)):
    box(bm, uv, (x, -24.5, 0), (12.5, 0.25, 2.3), mat=0)
    box(bm, uv, (x, -30, 0), (8.5, 7, 3.2), mat=1 + k % 2)
    box(bm, uv, (x, -30, 3.2), (9.2, 7.7, 0.3), mat=3)
for x in (-24, 24):
    box(bm, uv, (x, -3, 0), (0.25, 22, 2.3), mat=0)
    box(bm, uv, (x + (6 if x > 0 else -6), -3, 0), (8, 9, 3.2), mat=1)
house.add(kit.new_object('neighbours', bm, [m_cwall, m_ext, m_in['bed1'], m_roof]))
# Where the game's light is: the rooms (for the lamps), the yard (for the sun).
house.places['door'] = {'x': 0.0, 'y': -13.2, 'face': [0, 1]}
house.places['kitchen'] = {'x': 4.9, 'y': -3.9, 'face': [1, 0]}
house.places['table'] = {'x': 3.4, 'y': -4.0, 'face': [0, 1]}
house.places['bath'] = {'x': 0.2, 'y': 3.6, 'face': [0, 1]}
PLAN_EXTRA = {'house': {'doors': house.doors, 'lights': house.lights, 'inside': inside_rects, 'ceiling': HH}}

# ---- The single room ------------------------------------------------------------------------------

room = Home('room')
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
f = bm.faces.new([bm.verts.new(v) for v in ((-2, -1.75, 0), (2, -1.75, 0), (2, 1.75, 0), (-2, 1.75, 0))])
for loop in f.loops:
    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
f = bm.faces.new([bm.verts.new(v) for v in ((-2, -4.0, -0.02), (2, -4.0, -0.02), (2, -1.75, -0.02), (-2, -1.75, -0.02))])
f.material_index = 1
for loop in f.loops:
    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
room.add(kit.new_object('room_floor', bm, [m_floor, m_yard]))
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
room.wall(bm, uv, -2, -1.75, 2, -1.75, gaps=[(-1.5, -0.6)])
room.wall(bm, uv, -2, 1.75, 2, 1.75)
room.wall(bm, uv, -2, -1.75, -2, 1.75)
room.wall(bm, uv, 2, -1.75, 2, 1.75)
room.add(kit.new_object('room_walls', bm, [m_wall2]))
bed(room, 0.9, 0.7, 0.0, m_lappa2)
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
box(bm, uv, (-1.4, 1.2, 0), (0.9, 0.6, 0.75), mat=0)
plastic_chair(bm, uv, -1.4, 0.5, math.pi / 2, 1)
box(bm, uv, (1.5, -1.3, 0), (0.7, 0.5, 0.5), mat=0)
room.add(kit.new_object('room_things', bm, [m_wood, m_plastic]))
room.solid(-1.85, 0.9, -0.95, 1.5)
room.solid(1.15, -1.55, 1.85, -1.05)
room.place('table', -1.4, 0.3, (0, 1))
coal_pot_kitchen(room, 1.0, -3.2, zinc=False)
room.place('door', -1.05, -2.6, (0, 1))

# ---- The phone shop: Blessed Hands, Tubman Boulevard ------------------------------------------------
#
# 9 by 7 m behind a glass front (y = -3.5) to the street: tiled, white walls with a band of the
# networks' colours, glass counters with phones in them, shelves of boxed phones on the walls,
# the networks' posters, the counter at the back where the attendant sells phones, SIM cards and
# airtime and registers SIMs, a POP ceiling with its lamps.

shop = Home('phoneshop')
shop.doors, shop.lights = [], []
m_shop_wall = photo('shop_wall', 'white_stucco', scale=2.0, tint=srgb('#f4f2ee'), tint_amount=0.9, streaks=0)
m_band = [flat('band_starline', srgb('#e86a1c'), 0.5), flat('band_citrus', srgb('#2f8a4a'), 0.5)]
m_case = flat('display_glass', (0.7, 0.82, 0.9), 0.05, alpha=0.3)
m_phone = flat('display_phone', (0.03, 0.03, 0.04), 0.2)
m_screen_on = flat('display_screen', (0.3, 0.5, 0.9), 0.2, emission=1.5)
m_boxes = [flat(f'phone_box{i}', srgb(c), 0.6) for i, c in enumerate(['#f2ece0', '#1f4fa8', '#141414', '#e86a1c'])]
m_poster = [flat('poster_starline', srgb('#e86a1c'), 0.6, emission=0.3), flat('poster_citrus', srgb('#2f8a4a'), 0.6, emission=0.3)]
slab('shop_floor', -4.5, -3.5, 4.5, 3.5, 0.015, m_floor_tile, home=shop)
slab('shop_pavement', -12, -9, 12, -3.5, 0.01, m_path, home=shop)
slab('shop_street', -30, -20, 30, -9, 0.0, m_street, home=shop)
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for (cx, cy, sx, sy) in ((0, 3.5, 9.2, 0.2), (-4.5, 0, 0.2, 7.2), (4.5, 0, 0.2, 7.2)):
    box(bm, uv, (cx, cy, 0), (sx, sy, HH), mat=0)
    shop.solid(cx - sx / 2, cy - sy / 2, cx + sx / 2, cy + sy / 2)
# The glass front, its door in the middle (open, the doorway to the street).
for x0, x1 in ((-4.5, -0.6), (0.6, 4.5)):
    box(bm, uv, ((x0 + x1) / 2, -3.5, 0), (x1 - x0, 0.06, HH), mat=1)
    shop.solid(x0, -3.6, x1, -3.4)
box(bm, uv, (0, -3.5, 2.3), (1.2, 0.08, HH - 2.3), mat=0)
# The networks' colours in a band round the walls; the sign over the front.
for (cx, cy, sx, sy, k) in ((0, 3.38, 9.0, 0.04, 0), (-4.38, 0, 0.04, 7.0, 1), (4.38, 0, 0.04, 7.0, 0)):
    box(bm, uv, (cx, cy, 2.2), (sx, sy, 0.35), mat=2 + k)
box(bm, uv, (0, -3.62, HH - 0.6), (6.0, 0.08, 0.7), mat=2)
shop.add(kit.new_object('shop_walls', bm, [m_shop_wall, m_case] + m_band))
shop.add(kit.text('BLESSED HANDS PHONES & SIM CARDS', (0, -3.68), math.pi, 0.32, '#f4efe2', HH - 0.5))
# Glass counters down both sides with phones on show; shelves of boxed phones above.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for side in (-1, 1):
    x = side * 3.6
    box(bm, uv, (x, -0.6, 0), (0.9, 4.0, 0.85), mat=0)
    box(bm, uv, (x, -0.6, 0.85), (0.9, 4.0, 0.25), mat=1)
    shop.solid(x - 0.45, -2.6, x + 0.45, 1.4)
    for k in range(8):
        y = -2.3 + k * 0.48
        box(bm, uv, (x + side * -0.1, y, 0.9), (0.09, 0.18, 0.012), mat=2)
        box(bm, uv, (x + side * -0.1, y, 0.912), (0.08, 0.16, 0.004), mat=3)
    for row in range(3):
        for k in range(10):
            y = -2.6 + k * 0.5
            box(bm, uv, (side * 4.25, y, 1.25 + row * 0.42), (0.25, 0.32, 0.32), mat=4 + (k + row) % 4)
    box(bm, uv, (side * 4.3, -0.6, 1.2), (0.3, 5.4, 0.04), mat=0)
# The counter at the back, a till and a fingerprint reader on it.
box(bm, uv, (0, 2.3, 0), (4.0, 0.7, 1.05), mat=0)
box(bm, uv, (0, 2.3, 1.05), (4.1, 0.75, 0.04), mat=8)
box(bm, uv, (-1.0, 2.3, 1.09), (0.4, 0.3, 0.25), mat=2)
box(bm, uv, (0.6, 2.2, 1.09), (0.14, 0.18, 0.06), mat=3)
shop.solid(-2.05, 1.9, 2.05, 2.7)
# Posters of the two networks on the back wall.
box(bm, uv, (-2.6, 3.37, 1.3), (1.4, 0.03, 1.0), mat=9)
box(bm, uv, (2.6, 3.37, 1.3), (1.4, 0.03, 1.0), mat=10)
shop.add(kit.new_object('shop_fittings', bm, [m_cabinet, m_case, m_phone, m_screen_on] + m_boxes + [m_counter] + m_poster))
ceiling('shop', -4.5, -3.5, 4.5, 3.5, home=shop)
shop.places['door'] = {'x': 0.0, 'y': -2.7, 'face': [0, 1]}
shop.places['counter'] = {'x': 0.0, 'y': 1.4, 'face': [0, 1]}
shop.places['bed'] = {'x': 0.0, 'y': 1.4, 'face': [0, 1]}
PLAN_EXTRA['phoneshop'] = {'doors': [], 'lights': shop.lights, 'inside': [[-4.5, -3.5, 4.5, 3.5]], 'ceiling': HH, 'attendant': {'x': 0.0, 'y': 3.0, 'face': [0, -1]}}

# ---- Out -----------------------------------------------------------------------------------------

for h in (house, room, shop):
    PLAN[h.name] = {'solids': h.solids, 'places': h.places, **PLAN_EXTRA.get(h.name, {})}
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=80, export_apply=True)
with open(OUT.replace('.glb', '.json'), 'w') as f:
    json.dump(PLAN, f, indent=1)
print('EXPORTED', OUT, os.path.getsize(OUT), {k: sorted(v['places']) for k, v in PLAN.items()})
