# One Africa Life: the insides of the town's places, one for each kind (public/oal/interiors.v1.glb
# and src/games/oal/interiorsPlan.json), walked into from any building of that kind (its own name
# on the chip): as Monrovia's are.
#
#   blender -b --factory-startup --python scripts/oal/makeInteriors.py -- <out.glb>
#
# Each a root object, centred on the origin, its door in the front wall (y = -D/2) onto a strip of
# pavement and the street; its plan: solids (rectangles, metres, x east y north), places (door,
# counter: where what the place does is done), lights, the inside, the ceiling's height, the
# staff at their work (attendants), customers waiting (waiting) and seats one may sit on (seats).
#   provisions  shelves of goods, the fridge, crates of soft drinks, rice bags, the counter
#   restaurant  tables and plastic chairs, the serving counter with its pots, the menu board
#   bar         the bar and its stools, bottles behind, tables, the dance floor, speakers
#   salon       chairs before mirrors, hood dryers, a bench for those waiting (salons and barbers)
#   pharmacy    the glass counter, shelves of medicines, the green cross
#   clinic      reception, benches, the consulting room behind its curtain, the bed
#   bank        tellers behind glass, the queue's posts, an ATM, chairs, the guard
#   office      a government office: reception, benches, counters
#   classroom   the blackboard, the teacher's desk, rows of desk-benches
#   church      pews either side of the aisle, the altar and pulpit on their platform, the cross
#   mosque      the carpeted prayer hall, the mihrab, the minbar, the shoe rack
#   hotel       the reception desk and its key board, sofas, plants
#   market      a covered market hall: rows of tables piled with goods, its traders
#   hardware    cement bags, zinc sheets, iron rods, paint tins on shelves, the counter
#   boutique    racks of clothes, a mirror, the tailor's sewing machines (boutiques and tailors)
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

M = {
    'floor_tile': photo('in_floor_tiles', 'large_grey_tiles', scale=1.4, mul=(1.0, 0.97, 0.92), rough_mul=0.45, streaks=0),
    'terrazzo': photo('in_terrazzo', 'terrazzo_tiles', scale=1.5, rough_mul=0.5, streaks=0),
    'concrete': photo('in_concrete', 'concrete_floor_02', scale=2.0, mul=(0.75, 0.7, 0.64), streaks=0),
    'pavement': photo('in_pavement', 'brushed_concrete', scale=2.0, mul=(0.8, 0.79, 0.76), streaks=0),
    'street': photo('in_street', 'road_damaged_clean', scale=4.0, mul=(0.55, 0.55, 0.56), streaks=0),
    'zinc': photo('in_zinc', 'rusty_corrugated_iron', scale=2.0, metallic=0.3, streaks=0),
    'ceiling': flat('in_ceiling', (0.94, 0.94, 0.92), 0.85),
    'lamp': flat('in_lamp', (1.0, 0.97, 0.9), 0.4, emission=6.0),
    'wood': flat('in_wood', srgb('#7a5434'), 0.7),
    'dark_wood': flat('in_dark_wood', srgb('#3a2a1c'), 0.6),
    'metal': flat('in_metal', (0.62, 0.63, 0.65), 0.35, 0.8),
    'glass': flat('in_glass', (0.7, 0.82, 0.9), 0.05, alpha=0.28),
    'black': flat('in_black', (0.03, 0.03, 0.035), 0.4),
    'white': flat('in_white', (0.93, 0.93, 0.92), 0.5),
    'plastic': flat('in_plastic_chair', (0.92, 0.92, 0.9), 0.5),
    'red': flat('in_red', srgb('#c8281e'), 0.6),
    'green': flat('in_green', srgb('#2f8a4a'), 0.6),
    'blue': flat('in_blue', srgb('#2a5aa8'), 0.6),
    'yellow': flat('in_yellow', srgb('#e2b62a'), 0.6),
    'orange': flat('in_orange', srgb('#e86a1c'), 0.6),
    'purple': flat('in_purple', srgb('#7a3a8a'), 0.6),
    'pink': flat('in_pink', srgb('#e8a0b8'), 0.6),
    'brown': flat('in_brown', srgb('#8a6a4a'), 0.85),
    'sack': flat('in_sack', srgb('#d8ccb0'), 0.95),
    'cement': flat('in_cement_bag', srgb('#9a9890'), 0.95),
    'board': flat('in_blackboard', srgb('#1f3a2a'), 0.8),
    'carpet': flat('in_carpet', srgb('#7a1f2a'), 0.95),
    'carpet2': flat('in_carpet2', srgb('#1f5a3a'), 0.95),
    'mirror': flat('in_mirror', (0.75, 0.8, 0.85), 0.02, 1.0),
    'fabric': flat('in_fabric', srgb('#3a4a6a'), 0.9),
    'leather': flat('in_leather', srgb('#1c1a1a'), 0.5),
    'dance': flat('in_dance_floor', srgb('#3a2a6a'), 0.3, emission=0.4),
    'screen': flat('in_screen', (0.2, 0.4, 0.8), 0.2, emission=1.2),
    'plant': flat('in_plant', srgb('#3a7a3a'), 0.8),
}
WALLS = {}


def wall_paint(name, colour):
    if name not in WALLS:
        WALLS[name] = photo(f'in_wall_{name}', 'painted_plaster_wall', scale=2.0, tint=srgb(colour), tint_amount=0.85, streaks=0)
    return WALLS[name]


PLAN = {}


class Room:
    """One kind of place's inside: its box of a room, its fittings (boxes in one mesh), its plan."""

    def __init__(self, name, w, d, h=3.2, wall='#efe6d2', floor='floor_tile', glass_front=False, roof=None):
        self.name, self.w, self.d, self.h = name, w, d, h
        self.root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(self.root)
        self.solids, self.places, self.lights = [], {}, []
        self.attendants, self.waiting, self.seats = [], [], []
        self.mats = [wall_paint(name, wall)]
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new()
        W, D = w / 2, d / 2
        # The floor; the pavement and the street outside the door.
        self.slab(f'{name}_floor', -W, -D, W, D, 0.015, M[floor])
        self.slab(f'{name}_pavement', -W - 6, -D - 5, W + 6, -D, 0.01, M['pavement'])
        self.slab(f'{name}_street', -40, -D - 20, 40, -D - 5, 0.0, M['street'])
        # The walls: back and sides; the front with its door (and a glass shopfront for a shop).
        for (cx, cy, sx, sy) in ((0, D, w + 0.2, 0.2), (-W, 0, 0.2, d + 0.2), (W, 0, 0.2, d + 0.2)):
            self.part(cx, cy, 0, sx, sy, h, 'wall')
            self.solid(cx - sx / 2, cy - sy / 2, cx + sx / 2, cy + sy / 2)
        for x0, x1 in ((-W, -0.9), (0.9, W)):
            if glass_front:
                self.part((x0 + x1) / 2, -D, 0, x1 - x0, 0.2, 0.9, 'wall')
                self.part((x0 + x1) / 2, -D, 0.9, x1 - x0, 0.06, 1.6, 'glass')
                self.part((x0 + x1) / 2, -D, 2.5, x1 - x0, 0.2, h - 2.5, 'wall')
            else:
                self.part((x0 + x1) / 2, -D, 0, x1 - x0, 0.2, h, 'wall')
                # Windows with burglar bars either side of the door.
                for xw in (x0 + (x1 - x0) * 0.35, x0 + (x1 - x0) * 0.7):
                    if abs(xw) > 2 and x1 - x0 > 3:
                        self.part(xw, -D - 0.11, 1.0, 1.2, 0.03, 1.1, 'glass')
                        for k in range(5):
                            self.part(xw - 0.5 + k * 0.25, -D - 0.13, 1.0, 0.025, 0.025, 1.1, 'black')
            self.solid(x0, -D - 0.1, x1, -D + 0.1)
        self.part(0, -D, 2.3, 1.8, 0.2, h - 2.3, 'wall')
        # The ceiling (or a zinc roof on its beams), its lamps.
        if roof == 'zinc':
            self.slab(f'{name}_roof', -W, -D, W, D, h, M['zinc'], down=True)
            for k in range(int(d / 3)):
                self.part(0, -D + 1.5 + k * 3, h - 0.25, w, 0.15, 0.2, 'dark_wood')
        else:
            self.slab(f'{name}_ceiling', -W, -D, W, D, h, M['ceiling'], down=True)
        nx = max(1, round(w / 5))
        ny = max(1, round(d / 5))
        for i in range(nx):
            for j in range(ny):
                x = -W + (i + 0.5) * w / nx
                y = -D + (j + 0.5) * d / ny
                self.part(x, y, h - 0.06, 0.9, 0.3, 0.05, 'lamp')
                self.lights.append({'x': round(x, 2), 'y': round(y, 2), 'z': round(h - 0.3, 2)})
        self.places['door'] = {'x': 0.0, 'y': round(-D + 0.8, 2), 'face': [0, 1]}

    def mat(self, key):
        m = M[key] if key != 'wall' else self.mats[0]
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def part(self, x, y, z, sx, sy, sz, key, yaw=0.0):
        box(self.bm, self.uv, (x, y, z), (sx, sy, sz), yaw, mat=self.mat(key))

    def solid(self, x0, y0, x1, y1):
        self.solids.append([round(min(x0, x1), 2), round(min(y0, y1), 2), round(max(x0, x1), 2), round(max(y0, y1), 2)])

    def slab(self, name, x0, y0, x1, y1, z, mat, down=False):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        pts = ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))
        f = bm.faces.new([bm.verts.new(v) for v in (pts[::-1] if down else pts)])
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
        o = kit.new_object(name, bm, [mat])
        o.parent = self.root

    def sign(self, body, x, y, z, size, colour='#141414'):
        """Letters on the back wall (read from the room)."""
        o = kit.text(body, (x, y), 0, size, colour, z)
        o.parent = self.root

    def chair(self, x, y, yaw, key='plastic', seat=True):
        """A plastic chair (its back away from where it faces: yaw, map radians of the facing)."""
        c, s = math.cos(yaw), math.sin(yaw)
        self.part(x, y, 0.42, 0.44, 0.44, 0.05, key, yaw)
        self.part(x - c * 0.21, y - s * 0.21, 0.47, 0.05, 0.44, 0.45, key, yaw)
        for dx, dy in ((-0.17, -0.17), (0.17, -0.17), (-0.17, 0.17), (0.17, 0.17)):
            self.part(x + dx, y + dy, 0, 0.04, 0.04, 0.42, key)
        if seat:
            self.seats.append({'x': round(x, 2), 'y': round(y, 2), 'face': [round(c, 3), round(s, 3)], 'z': 0.0, 'tight': True})

    def bench(self, x, y, length, face_y=1, key='wood', back=True):
        """A wooden bench along x, facing +y or -y; its seats."""
        self.part(x, y, 0.42, length, 0.42, 0.05, key)
        if back:
            self.part(x, y - face_y * 0.2, 0.47, length, 0.05, 0.42, key)
        for k in range(3):
            self.part(x - length / 2 + 0.25 + k * (length - 0.5) / 2, y, 0, 0.06, 0.36, 0.42, key)
        self.solid(x - length / 2, y - 0.26, x + length / 2, y + 0.24)
        for k in range(max(1, int(length / 0.7))):
            self.seats.append({'x': round(x - length / 2 + 0.35 + k * 0.7, 2), 'y': round(y, 2), 'face': [0, face_y], 'z': 0.0})

    def table(self, x, y, sx, sy, key='wood', z=0.75):
        self.part(x, y, z - 0.04, sx, sy, 0.04, key)
        for dx in (-sx / 2 + 0.05, sx / 2 - 0.05):
            for dy in (-sy / 2 + 0.05, sy / 2 - 0.05):
                self.part(x + dx, y + dy, 0, 0.05, 0.05, z - 0.04, key)
        self.solid(x - sx / 2, y - sy / 2, x + sx / 2, y + sy / 2)

    def shelves(self, x, y, length, depth, yaw_x, rows=4, goods=('red', 'yellow', 'blue', 'green', 'orange', 'white')):
        """A shelf unit along a wall (along x if yaw_x else along y), its rows of goods."""
        sx, sy = (length, depth) if yaw_x else (depth, length)
        self.part(x, y, 0, sx, sy, 2.1, 'wood')
        n = int(length / 0.35)
        for r in range(rows):
            z = 0.3 + r * 0.45
            for k in range(n):
                g = goods[(k * 7 + r * 3) % len(goods)]
                if yaw_x:
                    self.part(x - length / 2 + 0.2 + k * 0.35, y, z, 0.28, depth * 0.8, 0.3, g)
                else:
                    self.part(x, y - length / 2 + 0.2 + k * 0.35, z, depth * 0.8, 0.28, 0.3, g)
        self.solid(x - sx / 2, y - sy / 2, x + sx / 2, y + sy / 2)

    def counter(self, x, y, length, key='wood', top='black'):
        self.part(x, y, 0, length, 0.7, 1.0, key)
        self.part(x, y, 1.0, length + 0.1, 0.8, 0.05, top)
        self.solid(x - length / 2, y - 0.4, x + length / 2, y + 0.4)
        self.places['counter'] = {'x': round(x, 2), 'y': round(y - 1.0, 2), 'face': [0, 1]}
        self.places.setdefault('bed', self.places['counter'])
        self.attendants.append({'x': round(x, 2), 'y': round(y + 0.8, 2), 'face': [0, -1]})

    def done(self):
        o = kit.new_object(f'{self.name}_fittings', self.bm, self.mats)
        o.parent = self.root
        PLAN[self.name] = {'solids': self.solids, 'places': self.places, 'doors': [], 'lights': self.lights, 'inside': [[-self.w / 2, -self.d / 2, self.w / 2, self.d / 2]],
                           'ceiling': self.h, 'attendants': self.attendants, 'waiting': self.waiting, 'seats': self.seats}


# ---- The provision shop -------------------------------------------------------------------------
r = Room('provisions', 9, 8, wall='#f2e8c8', glass_front=True)
r.shelves(-4.2, 0, 7, 0.5, False)
r.shelves(4.2, 0.5, 6, 0.5, False, goods=('white', 'red', 'yellow', 'brown'))
r.shelves(0, 3.6, 5, 0.5, True, goods=('yellow', 'green', 'orange', 'red', 'blue'))
r.counter(1.8, 1.6, 3.0)
r.part(-1.2, 1.4, 0, 0.8, 0.7, 1.9, 'white')
r.part(-1.2, 1.04, 0.2, 0.7, 0.02, 1.5, 'glass')
r.solid(-1.6, 1.05, -0.8, 1.75)
for k in range(4):
    r.part(-2.6 + (k % 2) * 0.45, -2.6 + (k // 2) * 0.35, 0, 0.42, 0.32, 0.3 * (1 + k % 2), 'red' if k % 2 else 'yellow')
r.part(2.8, -2.6, 0, 1.2, 0.6, 0.5, 'sack')
r.part(2.8, -2.6, 0.5, 1.1, 0.55, 0.45, 'sack')
r.solid(2.2, -2.9, 3.4, -2.3)
r.sign('PROVISIONS · SOFT DRINKS · RICE', 0, 3.3, 2.55, 0.22)
r.waiting.append({'x': -2.0, 'y': -1.0, 'face': [-1, 0]})
r.done()

# ---- The cookshop / restaurant ------------------------------------------------------------------
r = Room('restaurant', 11, 9, wall='#f4d9b0', floor='terrazzo')
r.counter(2.5, 3.2, 4.5, key='white', top='metal')
for k, x in enumerate((1.0, 2.0, 3.2, 4.0)):
    cylinder(r.bm, (x, 3.2, 1.05), 0.22, 0.3, segments=12, mat=r.mat('metal' if k % 2 else 'black'))
r.part(-3.0, 4.38, 1.6, 2.6, 0.04, 1.2, 'board')
r.sign('MENU: JOLLOF RICE · PALM BUTTER · CASSAVA LEAF · FUFU', -3.0, 4.33, 2.2, 0.11, '#f4efe2')
for i, (x, y) in enumerate(((-3.5, 1.2), (-0.6, 1.2), (-3.5, -1.8), (-0.6, -1.8), (2.4, -0.6), (2.4, -2.9))):
    r.table(x, y, 1.1, 0.8, key='white', z=0.74)
    r.chair(x - 0.85, y, 0.0)
    r.chair(x + 0.85, y, math.pi)
r.waiting.append({'x': -4.35, 'y': 1.2, 'face': [1, 0]})
r.waiting.append({'x': 1.55, 'y': -0.6, 'face': [1, 0]})
r.done()

# ---- The bar / club -----------------------------------------------------------------------------
r = Room('bar', 12, 10, wall='#3a2a4a', floor='terrazzo', h=3.4)
r.counter(-2.0, 3.5, 6.0, key='dark_wood', top='black')
r.part(-2.0, 4.85, 0.9, 6.0, 0.25, 0.05, 'wood')
for k in range(20):
    cylinder(r.bm, (-4.8 + k * 0.3, 4.85, 0.95), 0.04, 0.3, segments=6, mat=r.mat(('green', 'orange', 'white', 'red')[k % 4]))
for k in range(5):
    x = -4.5 + k * 1.25
    cylinder(r.bm, (x, 2.6, 0), 0.05, 0.75, segments=6, mat=r.mat('metal'))
    cylinder(r.bm, (x, 2.6, 0.75), 0.2, 0.06, segments=12, mat=r.mat('leather'))
    r.seats.append({'x': round(x, 2), 'y': 2.6, 'face': [0, 1], 'z': 0.33, 'tight': True})
r.part(3.0, 0.0, 0.01, 5.0, 5.0, 0.02, 'dance')
for x in (0.7, 5.5):
    r.part(x, 3.8, 0, 0.6, 0.5, 1.4, 'black')
    r.solid(x - 0.3, 3.55, x + 0.3, 4.05)
r.part(3.0, 4.3, 0, 1.6, 0.6, 0.9, 'black')
r.solid(2.2, 4.0, 3.8, 4.6)
for x, y in ((-4.0, -1.0), (-1.5, -1.0), (-4.0, -3.4)):
    r.table(x, y, 0.8, 0.8, key='dark_wood')
    r.chair(x - 0.7, y, 0.0, key='leather')
    r.chair(x + 0.7, y, math.pi, key='leather')
r.sign('GOOD TIME ENTERTAINMENT', -2.0, 4.78, 2.5, 0.26, '#ff4fa0')
r.waiting.append({'x': -3.3, 'y': -1.0, 'face': [1, 0]})
r.done()
PLAN['bar']['colourLights'] = [{'x': 3.0, 'y': 0.0, 'z': 3.0, 'colour': '#ff3fa0'}, {'x': 1.0, 'y': -2.0, 'z': 3.0, 'colour': '#3f8fff'}]

# ---- The beauty salon / barber ------------------------------------------------------------------
r = Room('salon', 9, 8, wall='#f0d8e4', glass_front=True)
for k, x in enumerate((-2.8, -0.6, 1.6)):
    r.part(x, 3.75, 0.9, 1.4, 0.04, 1.4, 'mirror')
    r.part(x, 3.55, 0.8, 1.6, 0.4, 0.06, 'white')
    cylinder(r.bm, (x, 2.6, 0), 0.25, 0.5, segments=12, mat=r.mat('metal'))
    r.part(x, 2.6, 0.5, 0.6, 0.6, 0.12, 'leather')
    r.part(x, 2.9, 0.62, 0.6, 0.08, 0.7, 'leather')
    r.seats.append({'x': round(x, 2), 'y': 2.6, 'face': [0, -1], 'z': 0.1, 'tight': True})
    r.solid(x - 0.35, 2.25, x + 0.35, 2.95)
for x in (-3.5, -2.3):
    cylinder(r.bm, (x, -0.5, 0), 0.08, 1.1, segments=8, mat=r.mat('metal'))
    cylinder(r.bm, (x, -0.5, 1.15), 0.3, 0.35, segments=14, mat=r.mat('pink'))
r.bench(1.5, -2.4, 3.0, face_y=1, key='leather')
r.shelves(4.2, 0, 4, 0.4, False, rows=3, goods=('pink', 'purple', 'white', 'yellow'))
r.places['counter'] = {'x': -0.6, 'y': 1.6, 'face': [0, 1]}
r.places['bed'] = r.places['counter']
r.attendants.extend([{'x': -2.8, 'y': 2.0, 'face': [0, 1]}, {'x': 1.6, 'y': 2.0, 'face': [0, 1]}])
r.waiting.append({'x': -2.8, 'y': 2.6, 'face': [0, -1]})
r.sign('BEAUTY · BRAIDS · WEAVE · CUTS', -0.6, 3.72, 2.6, 0.2, '#7a1f5a')
r.done()

# ---- The pharmacy -------------------------------------------------------------------------------
r = Room('pharmacy', 8, 7, wall='#e6f2ea', glass_front=True)
r.counter(0, 1.8, 5.0, key='white', top='glass')
r.shelves(0, 3.2, 7, 0.4, True, rows=4, goods=('white', 'green', 'blue', 'white', 'red'))
r.part(0, 3.35, 2.4, 0.5, 0.04, 0.16, 'green')
r.part(0, 3.35, 2.23, 0.16, 0.04, 0.5, 'green')
r.bench(-2.0, -2.2, 2.6, face_y=1)
r.sign('PHARMACY · MEDICINES', 0, 3.33, 2.85, 0.2, '#1f6a3a')
r.done()

# ---- The clinic ---------------------------------------------------------------------------------
r = Room('clinic', 12, 10, wall='#eef4f2', floor='terrazzo')
r.counter(-3.5, 0.5, 3.0, key='white', top='white')
r.bench(1.2, -2.5, 3.6, face_y=1)
r.bench(1.2, -0.8, 3.6, face_y=1)
# The consulting room behind its curtain: the doctor's desk, the bed.
r.part(1.0, 2.5, 0, 0.1, 5.0, 2.2, 'blue')
r.solid(0.95, 0.0, 1.05, 5.0)
r.table(3.0, 4.2, 1.4, 0.7, key='white')
r.part(4.5, 2.0, 0.55, 1.9, 0.8, 0.12, 'white')
r.part(4.5, 2.0, 0, 1.9, 0.8, 0.55, 'metal')
r.solid(3.55, 1.6, 5.45, 2.4)
r.part(-5.85, 0, 1.0, 0.04, 2.0, 1.2, 'white')
r.attendants.append({'x': 3.0, 'y': 4.9, 'face': [0, -1]})
r.sign('OPD · REGISTRATION', -3.5, 4.88, 2.5, 0.24, '#1f4fa8')
r.waiting.extend([{'x': 0.0, 'y': -2.5, 'face': [0, 1]}, {'x': 2.1, 'y': -0.8, 'face': [0, 1]}])
r.done()

# ---- The bank -----------------------------------------------------------------------------------
r = Room('bank', 13, 10, wall='#e8e2d4', floor='terrazzo', h=3.6)
r.part(0, 3.0, 0, 10.0, 0.7, 1.05, 'dark_wood')
r.part(0, 3.0, 1.05, 10.1, 0.75, 0.04, 'black')
r.part(0, 2.68, 1.09, 10.0, 0.03, 1.2, 'glass')
r.solid(-5.05, 2.6, 5.05, 3.4)
for x in (-3.5, 0.0, 3.5):
    r.attendants.append({'x': x, 'y': 3.8, 'face': [0, -1]})
    r.part(x, 3.1, 1.09, 0.45, 0.35, 0.3, 'black')
r.places['counter'] = {'x': 0.0, 'y': 2.0, 'face': [0, 1]}
r.places['bed'] = r.places['counter']
for k in range(6):
    cylinder(r.bm, (-2.5 + k, 0.6, 0), 0.05, 0.95, segments=8, mat=r.mat('metal'))
r.part(5.9, -3.0, 0, 0.8, 0.6, 1.7, 'metal')
r.part(5.58, -3.0, 1.1, 0.04, 0.4, 0.3, 'screen')
r.solid(5.5, -3.3, 6.3, -2.7)
r.bench(-3.5, -2.6, 3.0, face_y=1, key='leather')
r.attendants.append({'x': 1.6, 'y': -4.2, 'face': [0, 1]})
r.sign('WELCOME · CUSTOMER SERVICE · TELLERS', 0, 4.88, 2.8, 0.26, '#13306a')
r.done()

# ---- The government office ----------------------------------------------------------------------
r = Room('office', 13, 10, wall='#efe4c8', floor='terrazzo')
r.part(0, 4.88, 0, 13, 0.04, 1.1, 'green')
r.counter(-3.5, 3.0, 4.0, key='wood', top='black')
r.part(2.5, 3.0, 0, 4.0, 0.7, 1.05, 'wood')
r.solid(0.5, 2.6, 4.5, 3.4)
r.attendants.append({'x': 2.5, 'y': 3.8, 'face': [0, -1]})
for y in (-2.6, -1.0, 0.6):
    r.bench(-3.2, y, 3.4, face_y=1)
    r.bench(2.8, y, 3.4, face_y=1)
r.sign('REPUBLIC OF LIBERIA · PUBLIC SERVICE', 0, 4.84, 2.5, 0.26, '#1f5a3a')
r.waiting.extend([{'x': -3.9, 'y': -2.6, 'face': [0, 1]}, {'x': 2.1, 'y': -1.0, 'face': [0, 1]}])
r.done()

# ---- The classroom ------------------------------------------------------------------------------
r = Room('classroom', 10, 9, wall='#f0e0a8', floor='concrete')
r.part(0, 4.38, 0.9, 5.0, 0.04, 1.4, 'board')
r.table(0, 3.2, 1.6, 0.8, key='dark_wood')
r.places['counter'] = {'x': 0.0, 'y': 2.2, 'face': [0, 1]}
r.places['bed'] = r.places['counter']
r.attendants.append({'x': 0.0, 'y': 3.9, 'face': [0, -1]})
for row in range(4):
    for col in (-3.0, -0.9, 1.2, 3.3):
        y = 1.6 - row * 1.4
        r.part(col, y + 0.35, 0.72, 1.6, 0.45, 0.04, 'wood')
        r.part(col, y + 0.35, 0, 1.5, 0.05, 0.72, 'wood')
        r.bench(col, y - 0.05, 1.6, face_y=1, back=False)
r.sign('WELCOME TO CLASS', 0, 4.33, 2.5, 0.18, '#f4efe2')
r.waiting.extend([{'x': -3.35, 'y': 1.55, 'face': [0, 1]}, {'x': 0.85, 'y': 0.15, 'face': [0, 1]}, {'x': 3.65, 'y': -1.25, 'face': [0, 1]}])
r.done()

# ---- The church ---------------------------------------------------------------------------------
r = Room('church', 13, 18, wall='#f4f2ec', floor='terrazzo', h=6.0)
r.part(0, 7.5, 0, 9.0, 3.0, 0.5, 'wood')
r.solid(-4.5, 6.0, 4.5, 9.0)
r.part(0, 8.86, 2.0, 0.25, 0.06, 2.6, 'dark_wood')
r.part(0, 8.86, 3.4, 1.4, 0.06, 0.25, 'dark_wood')
r.part(0, 6.6, 0.5, 1.6, 0.6, 1.0, 'dark_wood')
r.solid(-0.8, 6.3, 0.8, 6.9)
r.part(-3.0, 7.5, 0.5, 1.4, 0.6, 0.8, 'black')
r.places['counter'] = {'x': 0.0, 'y': 5.0, 'face': [0, 1]}
r.places['bed'] = r.places['counter']
r.attendants.append({'x': 0.0, 'y': 7.4, 'face': [0, -1]})
for k in range(9):
    y = 4.0 - k * 1.25
    r.bench(-3.2, y, 4.2, face_y=1)
    r.bench(3.2, y, 4.2, face_y=1)
r.sign('JESUS IS LORD', 0, 8.8, 4.8, 0.45, '#3a2a6a')
r.waiting.extend([{'x': -4.0, 'y': 2.75, 'face': [0, 1]}, {'x': 2.5, 'y': 1.5, 'face': [0, 1]}, {'x': -2.6, 'y': 0.25, 'face': [0, 1]}, {'x': 4.0, 'y': -1.0, 'face': [0, 1]}])
r.done()

# ---- The mosque ---------------------------------------------------------------------------------
r = Room('mosque', 14, 14, wall='#eef2ea', floor='terrazzo', h=5.0)
r.part(0, 1.0, 0.012, 13.6, 11.5, 0.015, 'carpet')
for k in range(6):
    r.part(0, -3.5 + k * 2.0, 0.03, 13.6, 0.08, 0.004, 'carpet2')
r.part(0, 6.9, 0, 1.6, 0.2, 3.0, 'carpet2')
r.part(0, 6.75, 2.9, 1.6, 0.1, 0.25, 'green')
r.part(2.5, 6.3, 0, 1.0, 1.0, 1.4, 'dark_wood')
r.solid(2.0, 5.8, 3.0, 6.8)
r.part(-5.5, -6.2, 0, 2.5, 0.4, 1.2, 'wood')
r.solid(-6.75, -6.45, -4.25, -5.95)
r.places['counter'] = {'x': 0.0, 'y': 4.5, 'face': [0, 1]}
r.places['bed'] = r.places['counter']
r.attendants.append({'x': 0.0, 'y': 6.0, 'face': [0, -1]})
r.done()

# ---- The hotel lobby ----------------------------------------------------------------------------
r = Room('hotel', 13, 11, wall='#e9e0c6', floor='terrazzo', h=3.8, glass_front=True)
r.counter(0, 3.6, 4.5, key='dark_wood', top='black')
r.part(0, 5.35, 1.4, 2.0, 0.05, 0.8, 'wood')
for k in range(8):
    r.part(-0.8 + (k % 4) * 0.5, 5.31, 1.5 + (k // 4) * 0.35, 0.06, 0.02, 0.12, 'yellow')
for x, y, yaw in ((-4.0, 0.0, 0.0), (-4.0, -2.2, 0.0), (4.2, -1.0, math.pi)):
    r.part(x, y, 0, 0.9, 1.9, 0.42, 'fabric')
    r.part(x - math.cos(yaw) * 0.38, y, 0.42, 0.18, 1.9, 0.45, 'fabric')
    r.solid(x - 0.45, y - 0.95, x + 0.45, y + 0.95)
    for k in (-0.55, 0.0, 0.55):
        r.seats.append({'x': round(x, 2), 'y': round(y + k, 2), 'face': [round(math.cos(yaw), 3), 0], 'z': 0.0, 'tight': True})
for x in (-5.8, 5.8):
    r.part(x, 4.5, 0, 0.5, 0.5, 0.5, 'brown')
    r.part(x, 4.5, 0.5, 0.8, 0.8, 1.1, 'plant')
r.sign('RECEPTION', 0, 5.33, 3.0, 0.3, '#c8a030')
r.done()

# ---- The market hall ----------------------------------------------------------------------------
r = Room('market', 22, 18, wall='#d8d0c0', floor='concrete', h=6.0, roof='zinc')
goods = ('orange', 'red', 'green', 'yellow', 'brown', 'sack')
k = 0
for row in range(3):
    for col in range(4):
        x = -7.5 + col * 5.0
        y = 4.5 - row * 5.0
        r.table(x, y, 3.2, 1.4, key='wood', z=0.85)
        for p in range(6):
            cylinder(r.bm, (x - 1.2 + p * 0.48, y, 0.85), 0.18, 0.18, segments=8, mat=r.mat(goods[(k + p) % len(goods)]))
        r.attendants.append({'x': round(x, 2), 'y': round(y + 1.1, 2), 'face': [0, -1]})
        r.part(x, y + 1.9, 0, 0.6, 0.6, 0.35, 'plastic')
        k += 1
r.places['counter'] = {'x': -2.5, 'y': -2.0, 'face': [0, 1]}
r.places['bed'] = r.places['counter']
r.done()

# ---- The hardware / building materials store ----------------------------------------------------
r = Room('hardware', 12, 10, wall='#d8d0c0', floor='concrete', h=4.0)
r.counter(3.5, 2.6, 4.0, key='wood', top='metal')
r.shelves(5.7, -1.0, 5.0, 0.6, False, rows=4, goods=('white', 'blue', 'red', 'metal', 'yellow'))
for k in range(4):
    for j in range(3):
        r.part(-4.0 + j * 0.65, 3.6 - k * 0.0, 0.25 * k, 0.6, 0.4, 0.25, 'cement')
r.solid(-4.4, 3.35, -2.3, 3.85)
for k in range(10):
    r.part(-4.0, 0.5, 0.05 + k * 0.04, 2.4, 0.9, 0.03, 'zinc')
r.solid(-5.2, 0.05, -2.8, 0.95)
for k in range(12):
    r.part(-5.75, -2.5 + k * 0.12, 0, 0.03, 0.03, 3.2, 'metal', yaw=0.1)
r.solid(-5.9, -2.6, -5.6, -1.1)
r.sign('CEMENT · ZINC · IRON ROD · PAINT · PLUMBING', 0, 4.88, 3.2, 0.22, '#141414')
r.waiting.append({'x': 1.5, 'y': 1.0, 'face': [1, 1]})
r.done()

# ---- The boutique / tailor ----------------------------------------------------------------------
r = Room('boutique', 9, 8, wall='#f4e8f0', glass_front=True)
for x in (-3.0, 0.0):
    r.part(x, 1.0, 1.6, 2.4, 0.04, 0.04, 'metal')
    for k in range(9):
        r.part(x - 1.1 + k * 0.27, 1.0, 0.7, 0.05, 0.45, 0.85, ('red', 'blue', 'yellow', 'green', 'purple', 'orange', 'pink', 'white', 'black')[k])
    r.solid(x - 1.25, 0.7, x + 1.25, 1.3)
r.part(4.38, 1.0, 0.3, 0.04, 1.0, 1.8, 'mirror')
for x in (2.0, 3.3):
    r.table(x, 3.2, 1.0, 0.6, key='white')
    r.part(x, 3.2, 0.75, 0.45, 0.2, 0.3, 'black')
r.attendants.append({'x': 2.0, 'y': 3.8, 'face': [0, -1]})
r.places['counter'] = {'x': 2.6, 'y': 2.3, 'face': [0, 1]}
r.places['bed'] = r.places['counter']
r.sign('FASHION · LAPPA · TAILORING', -1.5, 3.88, 2.5, 0.22, '#5a1a3a')
r.done()

# ---- Out ----------------------------------------------------------------------------------------
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=80, export_apply=True)
with open(OUT.replace('.glb', '.json'), 'w') as f:
    json.dump(PLAN, f, indent=1)
print('EXPORTED', OUT, os.path.getsize(OUT), sorted(PLAN))
