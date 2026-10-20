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


# ---- The family house -------------------------------------------------------------------------

house = Home('house')
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
# 10 by 8 m: the parlour (x -5..0) and bedroom (x 0..5) on the south, the corridor along the
# north, the back door to the yard (y 4..9) with the kitchen.
f = bm.faces.new([bm.verts.new(v) for v in ((-5, -4, 0), (5, -4, 0), (5, 4, 0), (-5, 4, 0))])
for loop in f.loops:
    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
f = bm.faces.new([bm.verts.new(v) for v in ((-5, 4, -0.02), (5, 4, -0.02), (5, 9, -0.02), (-5, 9, -0.02))])
f.material_index = 1
for loop in f.loops:
    loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
house.add(kit.new_object('house_floor', bm, [m_tiles, m_yard]))
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
house.wall(bm, uv, -5, -4, 5, -4, gaps=[(-3.0, -2.0)])            # the front, its door into the parlour
house.wall(bm, uv, -5, 4, 5, 4, gaps=[(3.4, 4.4)])                # the back, its door to the yard
house.wall(bm, uv, -5, -4, -5, 4)
house.wall(bm, uv, 5, -4, 5, 4)
house.wall(bm, uv, 0, -4, 0, 1.6, gaps=[(0.2, 1.1)], mat=1)        # between parlour and bedroom
house.wall(bm, uv, -5, 1.6, 5, 1.6, gaps=[(-1.8, -0.8), (3.4, 4.4)])  # the corridor's side
house.add(kit.new_object('house_walls', bm, [m_wall, m_wall2]))
house.solid(-5.2, 4.0, 5.2, 9.2) if False else None
# Windows (glass behind bars) on the front and sides; curtains.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
for wx in (-4.0, 2.5):
    box(bm, uv, (wx, -4.0, 1.0), (1.2, 0.18, 1.2), mat=0)
    for k in range(5):
        box(bm, uv, (wx - 0.5 + k * 0.25, -4.1, 1.0), (0.025, 0.025, 1.2), mat=1)
    box(bm, uv, (wx, -3.85, 0.9), (1.5, 0.05, 1.5), mat=2)
house.add(kit.new_object('house_windows', bm, [m_window, m_bars, m_curtain]))
# The parlour: a sofa against the side wall, two plastic chairs, a low table, the television.
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
box(bm, uv, (-4.5, -1.0, 0), (0.8, 2.2, 0.45), mat=0)
box(bm, uv, (-4.85, -1.0, 0.45), (0.2, 2.2, 0.5), mat=0)
plastic_chair(bm, uv, -2.2, 0.6, -math.pi / 2, 1)
plastic_chair(bm, uv, -1.2, 0.6, -math.pi / 2, 1)
box(bm, uv, (-2.4, -1.2, 0), (1.0, 0.6, 0.45), mat=2)
box(bm, uv, (-0.6, -1.2, 0), (0.5, 1.4, 0.6), mat=2)
box(bm, uv, (-0.6, -1.2, 0.6), (0.08, 1.0, 0.6), mat=3)
house.add(kit.new_object('house_parlour', bm, [m_sofa, m_plastic, m_dark_wood, m_screen]))
house.solid(-4.95, -2.1, -4.05, 0.1)
house.solid(-2.9, -1.5, -1.9, -0.9)
house.solid(-0.85, -1.9, -0.35, -0.5)
house.place('table', -2.4, -0.6, (0, -1))
# The bedroom: the bed along the east wall, a wardrobe box.
bed(house, 3.6, -1.5, math.pi / 2, m_lappa)
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
box(bm, uv, (0.6, -3.5, 0), (1.0, 0.6, 1.8), mat=0)
house.add(kit.new_object('house_wardrobe', bm, [m_dark_wood]))
house.solid(0.1, -3.8, 1.1, -3.2)
# The yard kitchen, behind the back door.
coal_pot_kitchen(house, 0.0, 7.0)
house.place('door', -2.5, -4.8, (0, 1))

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

# ---- Out -----------------------------------------------------------------------------------------

for h in (house, room):
    PLAN[h.name] = {'solids': h.solids, 'places': h.places}
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=80, export_apply=True)
with open(OUT.replace('.glb', '.json'), 'w') as f:
    json.dump(PLAN, f, indent=1)
print('EXPORTED', OUT, os.path.getsize(OUT), {k: sorted(v['places']) for k, v in PLAN.items()})
