# One Africa Life: Furniture City on Tubman Boulevard (public/oal/furniture-city.v1.glb and
# src/games/oal/furnitureCity.json), as Monrovia's furniture stores are (the owner's photograph):
# three storeys of cream plaster; on the ground floor the shop behind glass, orange folding
# shutters open at every bay; above it, the canopy, the display windows and the black
# FURNITURE CITY banner; the top floor set back behind balconies with black railings, burglar bars
# on its windows, air conditioners on the walls; on the roof the columns left for a floor to come,
# their steel bars sticking up, a water tank. Inside: tiled floors, white ceilings and their
# lights, the cashier's counter, the stairs up to each floor and their railings.
#
# Its frame: x across its front (-W/2..W/2), y from its front (0) to its back (D), z up; its
# forecourt (where cars park) before it, y < 0. The game puts each floor's things where the
# plan says (the furniture on display is the game's own items, not in this file).
#
#   blender -b --factory-startup --python scripts/oal/makeFurnitureCity.py -- <out.glb> <plan.json>
import json
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenekit as kit  # noqa: E402
from scenekit import box, cylinder, flat, photo, srgb  # noqa: E402

OUT, PLAN = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)

W, D = 24.0, 18.0
L = [0.3, 4.65, 8.85, 12.6]   # each floor's top (the roof the last)
SLAB = 0.25
COLS = [-12.0, -7.2, -2.4, 2.4, 7.2, 12.0]
WALL = 0.25
DOORS = [(-4.8, 2.2), (4.8, 2.2)]  # the shop's glass doors: middle x, width (open)

def painted(name, stem, rgb, scale=2.5):
    """A photo material in a paint of its own, the paint in the picture itself (the game's file
    carries a picture, not a mix of colours over it): its light and dark kept, its colour the paint's."""
    import numpy as np
    src = bpy.data.images.load(os.path.join(kit.TEX, f'{stem}_diff.jpg'), check_existing=True)
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lum = px[:, :3] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    lum = lum / max(1e-3, float(lum.mean()))
    out = np.empty_like(px)
    out[:, :3] = np.clip(lum[:, None] * np.array(rgb, dtype=np.float32)[None, :], 0, 1)
    out[:, 3] = 1
    img = bpy.data.images.new(f'{name}_paint', w, h)
    img.pixels.foreach_set(out.ravel())
    img.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    uv = nt.nodes.new('ShaderNodeUVMap')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / scale, 1 / scale, 1)
    nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    nt.links.new(mapping.outputs['Vector'], t.inputs['Vector'])
    b = nt.nodes['Principled BSDF']
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85
    return m


M = {
    # The photograph's cream (srgb #e9dcbc, linear), weathered; inside, a paler cream.
    'plaster': painted('fc_plaster', 'painted_plaster_wall', (0.86, 0.8, 0.62)),
    'plaster_in': painted('fc_plaster_in', 'painted_plaster_wall', (0.86, 0.82, 0.7)),
    'tiles': photo('fc_tiles', 'large_grey_tiles', scale=1.6, mul=(1.05, 1.03, 1.0), rough_mul=0.35, streaks=0),
    'granite': photo('fc_granite', 'granite_tile', scale=1.2, rough_mul=0.4, streaks=0),
    'forecourt': photo('fc_forecourt', 'brushed_concrete', scale=3.0, mul=(0.78, 0.74, 0.7), streaks=0.1),
    'concrete': photo('fc_concrete', 'concrete_wall_003', scale=2.0, mul=(0.85, 0.83, 0.8), streaks=0.3),
    'ceiling': flat('fc_ceiling', (0.93, 0.93, 0.91), 0.85),
    'lamp': flat('fc_lamp', (1.0, 0.98, 0.94), 0.4, emission=5.0),
    'glass': flat('fc_glass', (0.55, 0.66, 0.72), 0.04, alpha=0.3),
    'frame': flat('fc_frame', (0.06, 0.06, 0.07), 0.35, 0.7),
    'orange': flat('fc_orange', srgb('#e2571a'), 0.55),
    'orange_dark': flat('fc_orange_dark', srgb('#b8410f'), 0.6),
    'rail': flat('fc_rail', (0.04, 0.04, 0.045), 0.35, 0.8),
    'rebar': flat('fc_rebar', srgb('#5a3b28'), 0.6, 0.6),
    'banner': flat('fc_banner', (0.02, 0.02, 0.03), 0.6),
    'banner_blue': flat('fc_banner_blue', srgb('#2a78c8'), 0.5, emission=0.4),
    'poster': flat('fc_poster', srgb('#cfe0ea'), 0.6),
    **{f'poster_{i}': None for i in range(5)},
    'ac': flat('fc_ac', (0.9, 0.9, 0.88), 0.45),
    'tank': flat('fc_tank', srgb('#1c1c1f'), 0.5),
    'counter': flat('fc_counter', srgb('#3a2a1c'), 0.5),
    'counter_top': flat('fc_counter_top', srgb('#e8e2d6'), 0.3),
    'tread': photo('fc_tread', 'granite_tile', scale=0.8, rough_mul=0.4, streaks=0),
}
# The display windows' pictures: the store's own things (pictures of them, made by makeItems.py's
# photographs; a pale board where there is none).
PHOTOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art-src', 'one-africa-life', 'items', 'photos')
for i, item in enumerate(['sofa_set', 'corner_sofa', 'double_bed', 'kitchen_counter', 'bathtub']):
    path = os.path.join(PHOTOS, f'{item}.png')
    if os.path.exists(path):
        m = bpy.data.materials.new(f'fc_poster_{item}')
        m.use_nodes = True
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(path)
        b = m.node_tree.nodes['Principled BSDF']
        m.node_tree.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.5
        M[f'poster_{i}'] = m
    else:
        M[f'poster_{i}'] = M['poster']
MATS = list(M.values())
IDX = {k: i for i, k in enumerate(M)}


def group(name):
    bm = bmesh.new()
    return bm, bm.loops.layers.uv.new()


def cube(g, x0, y0, z0, x1, y1, z1, mat, uv=1.0):
    bm, uvl = g
    box(bm, uvl, ((x0 + x1) / 2, (y0 + y1) / 2, z0), (x1 - x0, y1 - y0, z1 - z0), 0.0, IDX[mat], uv)


def wall_x(g, x0, x1, y, z0, z1, mat, holes=(), t=WALL):
    """A wall along x at y (its thickness inward, +y), with openings (x0, x1, z0, z1)."""
    xs = sorted({x0, x1, *[h[0] for h in holes], *[h[1] for h in holes]})
    for a, b in zip(xs, xs[1:]):
        mid = (a + b) / 2
        cut = [h for h in holes if h[0] <= mid <= h[1]]
        if not cut:
            cube(g, a, y, z0, b, y + t, z1, mat)
            continue
        h = cut[0]
        if h[2] > z0:
            cube(g, a, y, z0, b, y + t, h[2], mat)
        if h[3] < z1:
            cube(g, a, y, h[3], b, y + t, z1, mat)


def wall_y(g, y0, y1, x, z0, z1, mat, holes=(), t=WALL):
    ys = sorted({y0, y1, *[h[0] for h in holes], *[h[1] for h in holes]})
    for a, b in zip(ys, ys[1:]):
        mid = (a + b) / 2
        cut = [h for h in holes if h[0] <= mid <= h[1]]
        if not cut:
            cube(g, x, a, z0, x + t, b, z1, mat)
            continue
        h = cut[0]
        if h[2] > z0:
            cube(g, x, a, z0, x + t, b, h[2], mat)
        if h[3] < z1:
            cube(g, x, a, h[3], x + t, b, z1, mat)


def pane(g, x0, y0, x1, y1, z0, z1):
    """Glass in a window, its frame round it."""
    cube(g, x0, y0, z0, x1, y1, z1, 'glass')
    t = 0.05
    if x1 - x0 > y1 - y0:
        for x in (x0, x1 - t):
            cube(g, x, y0 - 0.02, z0, x + t, y1 + 0.02, z1, 'frame')
        for z in (z0, z1 - t):
            cube(g, x0, y0 - 0.02, z, x1, y1 + 0.02, z + t, 'frame')
    else:
        for y in (y0, y1 - t):
            cube(g, x0 - 0.02, y, z0, x1 + 0.02, y + t, z1, 'frame')
        for z in (z0, z1 - t):
            cube(g, x0 - 0.02, y0, z, x1 + 0.02, y1, z + t, 'frame')


def finish(name, g):
    bm, _ = g
    return kit.new_object(name, bm, MATS)


# The stairs: up the right side from the ground floor to the first (toward the back), and beside
# them from the first to the second (toward the front). Each floor open over the flight below it.
STAIRS = [
    {'x0': 9.2, 'x1': 11.6, 'y0': 6.0, 'y1': 14.0, 'from': 0, 'to': 1, 'up': 1},
    {'x0': 6.4, 'x1': 8.8, 'y0': 6.0, 'y1': 14.0, 'from': 1, 'to': 2, 'up': -1},
]


def stair(g, s):
    """A flight of steps (treads of granite on a concrete stringer), rising along its up."""
    rise = L[s['to']] - L[s['from']]
    n = int(round(rise / 0.17))
    run = (s['y1'] - s['y0']) / n
    for i in range(n):
        z = L[s['from']] + rise * (i + 1) / n
        if s['up'] > 0:
            a, b = s['y0'] + run * i, s['y0'] + run * (i + 1)
        else:
            a, b = s['y1'] - run * (i + 1), s['y1'] - run * i
        cube(g, s['x0'], a, z - 0.17, s['x1'], b + 0.03, z, 'tread', 0.6)
    # Its underside: a sloping slab, under the treads.
    bm, uvl = g
    zb = L[s['from']] - 0.05
    zt = L[s['to']] - 0.2
    yb, yt = (s['y0'], s['y1']) if s['up'] > 0 else (s['y1'], s['y0'])
    vs = [bm.verts.new(p) for p in ((s['x0'], yb, zb), (s['x1'], yb, zb), (s['x1'], yt, zt), (s['x0'], yt, zt))]
    f = bm.faces.new(list(reversed(vs)))
    f.material_index = IDX['concrete']


def railing(g, x0, y0, x1, y1, z, h=1.0):
    """A railing (posts, a top rail, two bars) along a line."""
    length = math.hypot(x1 - x0, y1 - y0)
    n = max(1, int(length / 1.2))
    for i in range(n + 1):
        t = i / n
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        cube(g, x - 0.025, y - 0.025, z, x + 0.025, y + 0.025, z + h, 'rail')
    for zz in (z + h - 0.04, z + h * 0.55, z + h * 0.15):
        if abs(x1 - x0) > abs(y1 - y0):
            cube(g, min(x0, x1), y0 - 0.02, zz, max(x0, x1), y0 + 0.02, zz + 0.04, 'rail')
        else:
            cube(g, x0 - 0.02, min(y0, y1), zz, x0 + 0.02, max(y0, y1), zz + 0.04, 'rail')


plan = {'W': W, 'D': D, 'levels': L[:3], 'ceilings': [L[1] - SLAB, L[2] - SLAB, L[3] - SLAB], 'solids': {'0': [], '1': [], '2': []}, 'stairs': STAIRS, 'holes': {'1': [], '2': []}}


def solid(level, x0, y0, x1, y1):
    plan['solids'][str(level)].append([round(min(x0, x1), 3), round(min(y0, y1), 3), round(max(x0, x1), 3), round(max(y0, y1), 3)])


# ---- The forecourt and the ground floor ------------------------------------------------------
g = group('fc_ground')
# (A little over the town's ground, which rises and falls under it.)
cube(g, -W / 2 - 2, -10, -0.05, W / 2 + 2, 0, 0.12, 'forecourt', 3)
# A step up from the forecourt to the shop.
cube(g, -W / 2, -0.6, 0.0, W / 2, 0, 0.2, 'granite')
cube(g, -W / 2, 0, 0.0, W / 2, D, L[0], 'tiles')
# Its glass front between the columns, the doors open; the orange shutters folded back at each column.
for a, b in zip(COLS, COLS[1:]):
    mid = (a + b) / 2
    door = [d for d in DOORS if abs(d[0] - mid) < 0.1]
    x0, x1 = a + 0.3, b - 0.3
    if door:
        dx, dw = door[0]
        for p, q in ((x0, dx - dw / 2), (dx + dw / 2, x1)):
            cube(g, p, 0.2, L[0], q, 0.24, L[1] - SLAB - 0.4, 'glass')
            cube(g, p, 0.18, L[0], q, 0.26, L[0] + 0.08, 'frame')
            solid(0, p, 0.1, q, 0.34)
        cube(g, dx - dw / 2, 0.18, L[1] - SLAB - 1.4, dx + dw / 2, 0.26, L[1] - SLAB - 0.4, 'glass')
    else:
        cube(g, x0, 0.2, L[0], x1, 0.24, L[1] - SLAB - 0.4, 'glass')
        solid(0, x0, 0.1, x1, 0.34)
    cube(g, x0, 0.18, L[1] - SLAB - 0.45, x1, 0.26, L[1] - SLAB - 0.35, 'frame')
    for x in (x0, x1):
        cube(g, x - 0.03, 0.18, L[0], x + 0.03, 0.26, L[1] - SLAB - 0.35, 'frame')
for c in COLS:
    cube(g, c - 0.25, -0.1, 0.0, c + 0.25, 0.4, L[1] - SLAB, 'plaster')
    solid(0, c - 0.25, -0.1, c + 0.25, 0.4)
    # The shutters: a pair of tall leaves each side of the pier, opened out from it (orange, a
    # pattern of small squares pressed into them), as the photograph has them.
    bm, uvl = g
    for side in (-1, 1):
        if (c == COLS[0] and side < 0) or (c == COLS[-1] and side > 0):
            continue
        hinge = c + side * 0.25
        for k, open_angle in enumerate((0.55, 0.8)):
            yaw = -side * open_angle
            # Leaf: hinged at the pier, swung out toward the street.
            ux, uy = math.cos(yaw) * side, math.sin(yaw) * side
            hx, hy = hinge + side * 0.04 * k, -0.05 - 0.07 * k
            cx, cy = hx + ux * 0.32, hy + uy * 0.32
            box(bm, uvl, (cx, cy, L[0]), (0.62, 0.05, 3.35), math.atan2(uy, ux), IDX['orange'])
            for row in range(10):
                for col in range(3):
                    t = -0.2 + col * 0.2
                    px, py = cx + ux * t + (-uy) * 0.03 * -side, cy + uy * t + ux * 0.03 * -side
                    box(bm, uvl, (px, py, L[0] + 0.3 + row * 0.3), (0.09, 0.012, 0.09), math.atan2(uy, ux), IDX['orange_dark'])
# The orange band along the top of the shop's front.
cube(g, -W / 2, -0.12, L[1] - SLAB - 0.6, W / 2, 0.3, L[1] - SLAB - 0.15, 'orange')
# The ground floor's other walls (sides, back), inside cream.
wall_y(g, 0, D, -W / 2, L[0], L[1] - SLAB, 'plaster')
wall_y(g, 0, D, W / 2 - WALL, L[0], L[1] - SLAB, 'plaster')
wall_x(g, -W / 2, W / 2, D - WALL, L[0], L[1] - SLAB, 'plaster', holes=[(-8, -5, L[0] + 1.2, L[0] + 2.4), (-1, 1, L[0], L[0] + 2.2)])
pane(g, -8, D - 0.16, -5, D - 0.1, L[0] + 1.2, L[0] + 2.4)
cube(g, -1, D - 0.18, L[0], 1, D - 0.08, L[0] + 2.2, 'counter')
solid(0, -W / 2, 0, -W / 2 + WALL, D)
solid(0, W / 2 - WALL, 0, W / 2, D)
solid(0, -W / 2, D - WALL, W / 2, D)
# The cashier's counter, by the door, facing it.
cube(g, -10.4, 3.0, L[0], -6.6, 3.7, L[0] + 1.0, 'counter')
cube(g, -10.5, 2.95, L[0] + 1.0, -6.5, 3.75, L[0] + 1.06, 'counter_top')
solid(0, -10.4, 3.0, -6.6, 3.7)
plan['counter'] = {'level': 0, 'x': -8.5, 'y': 2.4, 'face': [0, 1]}
plan['staff'] = [{'level': 0, 'x': -8.5, 'y': 4.3, 'face': [0, -1]}]
stair(g, STAIRS[0])
# (The flight's sides: its wall, its rail.)
solid(0, 8.9, STAIRS[0]['y0'], 9.2, STAIRS[0]['y1'])
finish('fc_shell_0', g)


def storey(level, front_y, holes_front):
    """A floor (its slab, its ceiling and lights below), its outer walls."""
    g = group(f'fc_storey_{level}')
    z0, z1 = L[level], L[level + 1] - SLAB
    # The slab under it (open over the stairs below it), the ceiling and lights of the floor below.
    below = STAIRS[level - 1]
    hole = (below['x0'] - 0.2, below['y0'], below['x1'] + 0.1, below['y1'])
    plan['holes'][str(level)].append([round(h, 3) for h in hole])
    xs = [-W / 2, hole[0], hole[2], W / 2]
    ys = [0 if level == 1 else -1.4, hole[1], hole[3], D]
    for i in range(3):
        for j in range(3):
            if i == 1 and j == 1:
                continue
            # (The slab plastered at its edges, tiled on top.)
            cube(g, xs[i], ys[j], z0 - SLAB, xs[i + 1], ys[j + 1], z0 - 0.02, 'plaster')
            cube(g, xs[i], ys[j], z0 - 0.02, xs[i + 1], ys[j + 1], z0, 'tiles')
            cube(g, xs[i], ys[j], z0 - SLAB - 0.02, xs[i + 1], ys[j + 1], z0 - SLAB, 'ceiling')
    # Lights in the ceiling below it, in rows.
    for x in (-8.0, -3.0, 2.0):
        for y in (3.5, 8.5, 13.5):
            cube(g, x - 1.2, y - 0.25, z0 - SLAB - 0.05, x + 1.2, y + 0.25, z0 - SLAB - 0.02, 'lamp')
    # Railings round the opening, open where the flight below arrives.
    top_end = hole[3] if below['up'] > 0 else hole[1]
    railing(g, hole[0], hole[1], hole[0], hole[3], z0)
    railing(g, hole[2], hole[1], hole[2], hole[3], z0)
    other = hole[1] if below['up'] > 0 else hole[3]
    railing(g, hole[0], other, hole[2], other, z0)
    solid(level, hole[0] - 0.05, hole[1], hole[0] + 0.05, hole[3])
    solid(level, hole[2] - 0.05, hole[1], hole[2] + 0.05, hole[3])
    solid(level, hole[0], other - 0.05, hole[2], other + 0.05)
    plan.setdefault('arrive', {})[str(level)] = round(top_end, 3)
    # Its walls.
    wall_y(g, front_y, D, -W / 2, z0, z1, 'plaster', holes=[(5, 7, z0 + 1.0, z0 + 2.4), (11, 13, z0 + 1.0, z0 + 2.4)])
    wall_y(g, front_y, D, W / 2 - WALL, z0, z1, 'plaster', holes=[(3, 5, z0 + 1.0, z0 + 2.4)])
    wall_x(g, -W / 2, W / 2, D - WALL, z0, z1, 'plaster', holes=[(-8, -5, z0 + 1.0, z0 + 2.4), (2, 5, z0 + 1.0, z0 + 2.4)])
    for a, b in ((5, 7), (11, 13)):
        pane(g, -W / 2 + 0.08, a, -W / 2 + 0.14, b, z0 + 1.0, z0 + 2.4)
    pane(g, W / 2 - 0.16, 3, W / 2 - 0.1, 5, z0 + 1.0, z0 + 2.4)
    for a, b in ((-8, -5), (2, 5)):
        pane(g, a, D - 0.16, b, D - 0.1, z0 + 1.0, z0 + 2.4)
    wall_x(g, -W / 2, W / 2, front_y, z0, z1, 'plaster', holes=holes_front)
    solid(level, -W / 2, front_y, -W / 2 + WALL, D)
    solid(level, W / 2 - WALL, front_y, W / 2, D)
    solid(level, -W / 2, D - WALL, W / 2, D)
    solid(level, -W / 2, front_y, W / 2, front_y + WALL)
    return g


# ---- The first floor: the canopy, the display windows, the banner ------------------------------
wins = [(c - 1.5, c + 1.5, L[1] + 0.6, L[1] + 2.8) for c in (-9.6, -4.8, 0.0, 4.8, 9.6)]
g = storey(1, 0.0, wins)
# The ledge over the shop: the slab out over the front, deep, its white underside and its small lights.
cube(g, -W / 2, -1.4, L[1] - SLAB - 0.25, W / 2, 0.0, L[1] + 0.1, 'plaster')
cube(g, -W / 2, -1.4, L[1] - SLAB - 0.27, W / 2, 0.0, L[1] - SLAB - 0.25, 'ceiling')
bm, uvl = g
for x in [-11 + 2.4 * i for i in range(10)]:
    cylinder(bm, (x, -0.7, L[1] - SLAB - 0.3), 0.07, 0.04, segments=12, mat=IDX['lamp'])
# The display windows: black frames, a red title on white across the top of each, a picture of
# the store's rooms in each (its own things).
for i, ((a, b, z0, z1), label) in enumerate(zip(wins, ['Living Room', 'Furniture City', 'Dining Room', 'Furniture City', 'Bed Room'])):
    cube(g, a, 0.08, z0, b, 0.12, z1, 'glass')
    bm, uvl = g
    vs = [bm.verts.new(p) for p in ((a + 0.05, 0.15, z0 + 0.05), (b - 0.05, 0.15, z0 + 0.05), (b - 0.05, 0.15, z1 - 0.32), (a + 0.05, 0.15, z1 - 0.32))]
    f = bm.faces.new(vs)
    f.material_index = IDX[f'poster_{i}']
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    cube(g, a + 0.05, 0.16, z1 - 0.32, b - 0.05, 0.18, z1 - 0.05, 'counter_top')
    for x in (a, b):
        cube(g, x - 0.05, 0.0, z0, x + 0.05, 0.2, z1, 'frame')
    for z in (z0, z1):
        cube(g, a, 0.0, z - 0.05, b, 0.2, z + 0.05, 'frame')
    kit.text(label, ((a + b) / 2, 0.11), 0, 0.17, '#b0201a', z1 - 0.26)
# The second ledge over the windows, its lights; the banner hanging from it, in the middle.
cube(g, -W / 2, -1.4, L[2] - SLAB - 0.25, W / 2, 0.0, L[2] + 0.1, 'plaster')
cube(g, -W / 2, -1.4, L[2] - SLAB - 0.27, W / 2, 0.0, L[2] - SLAB - 0.25, 'ceiling')
bm, uvl = g
for x in [-11 + 2.4 * i for i in range(10)]:
    cylinder(bm, (x, -0.7, L[2] - SLAB - 0.3), 0.07, 0.04, segments=12, mat=IDX['lamp'])
bz = L[2] - SLAB - 0.27
cube(g, -2.7, -1.47, bz - 1.15, 2.7, -1.42, bz, 'banner')
cube(g, 1.75, -1.49, bz - 1.1, 1.85, -1.46, bz - 0.05, 'banner_blue')
kit.text('FURNITURE CITY', (-0.3, -1.5), 0, 0.42, '#ffffff', bz - 0.68)
for j, line in enumerate(['Office Furniture', 'Home Furniture', 'Living Room Set', 'Dining Room Set', 'Bed Room Set']):
    kit.text(line, (-2.15, -1.5), 0, 0.075, '#e0e0e0', bz - 0.25 - j * 0.17)
kit.text('Home Appliances\nElectronics', (2.3, -1.5), 0, 0.075, '#e0e0e0', bz - 0.55)
finish('fc_shell_1', g)

# ---- The second floor: set back behind balconies, its side bays out to the edge ----------------
g = storey(2, 1.0, [(-5.6, -4.0, L[2], L[2] + 2.3), (-0.8, 0.8, L[2], L[2] + 2.3), (4.0, 5.6, L[2], L[2] + 2.3)])
# Glass doors onto the balconies.
for a, b in ((-5.6, -4.0), (-0.8, 0.8), (4.0, 5.6)):
    pane(g, a, 1.05, b, 1.11, L[2], L[2] + 2.3)
# The end sections, out to the ledge's edge, their barred windows under small hoods.
for a, b in ((-W / 2, -7.2), (6.0, W / 2)):
    wall_x(g, a, b, -1.4, L[2], L[3] - SLAB, 'plaster', holes=[((a + b) / 2 - 1.1, (a + b) / 2 + 1.1, L[2] + 1.0, L[2] + 2.3)])
    for x in (a, b - WALL):
        wall_y(g, -1.4, 1.0, x, L[2], L[3] - SLAB, 'plaster')
    m = (a + b) / 2
    for i in range(8):
        x = m - 1.1 + 0.28 * i + 0.14
        cube(g, x - 0.015, -1.48, L[2] + 1.0, x + 0.015, -1.44, L[2] + 2.3, 'rail')
    for z in (L[2] + 1.4, L[2] + 1.9):
        cube(g, m - 1.1, -1.48, z, m + 1.1, -1.44, z + 0.03, 'rail')
    pane(g, m - 1.1, -1.4, m + 1.1, -1.34, L[2] + 1.0, L[2] + 2.3)
    cube(g, m - 1.3, -1.75, L[2] + 2.45, m + 1.3, -1.4, L[2] + 2.55, 'plaster')
    solid(2, a, -1.4, b, -1.15)
# The loggias between them: two columns at the edge, the railing along it, air conditioners inside.
for x in (-2.4, 2.4):
    cube(g, x - 0.22, -1.4, L[2], x + 0.22, -1.0, L[3] - SLAB, 'plaster')
    solid(2, x - 0.22, -1.4, x + 0.22, -1.0)
railing(g, -7.2, -1.32, 6.0, -1.32, L[2], 1.05)
solid(2, -7.2, -1.4, 6.0, -1.25)
for x in (-6.0, 1.6, 4.6):
    cube(g, x - 0.45, 0.72, L[2] + 2.4, x + 0.45, 1.0, L[2] + 3.05, 'ac')
finish('fc_shell_2', g)

# ---- The roof: its slab and parapet, the columns for the next floor, the tank ------------------
g = group('fc_roof')
cube(g, -W / 2, -1.4, L[3] - SLAB, W / 2, D, L[3], 'concrete')
cube(g, -W / 2, -1.4, L[3] - SLAB - 0.02, W / 2, D, L[3] - SLAB, 'ceiling')
# Its thick edge along the front, as the ledges below.
cube(g, -W / 2, -1.45, L[3] - SLAB - 0.3, W / 2, -1.0, L[3] + 0.55, 'plaster')
for x in (-8.0, -3.0, 2.0):
    for y in (3.5, 8.5, 13.5):
        cube(g, x - 1.2, y - 0.25, L[3] - SLAB - 0.05, x + 1.2, y + 0.25, L[3] - SLAB - 0.02, 'lamp')
for (x0, y0, x1, y1) in ((-W / 2, -1.4, W / 2, -1.2), (-W / 2, D - 0.2, W / 2, D), (-W / 2, -1.0, -W / 2 + 0.2, D), (W / 2 - 0.2, -1.0, W / 2, D)):
    cube(g, x0, y0, L[3], x1, y1, L[3] + 0.9, 'plaster')
for x in COLS[:-1] + [COLS[-1] - 0.4]:
    for y in (0.2, 9.0):
        cube(g, x - 0.18, y - 0.18, L[3], x + 0.18, y + 0.18, L[3] + 1.7, 'concrete')
        bm, uvl = g
        for dx in (-0.1, 0.1):
            for dy in (-0.1, 0.1):
                cylinder(bm, (x + dx, y + dy, L[3] + 1.7 + 0.4), 0.012, 0.8, segments=6, mat=IDX['rebar'])
bm, uvl = g
cylinder(bm, (8.0, 15.0, L[3] + 0.7), 0.75, 1.4, segments=24, mat=IDX['tank'])
# A telecom mast at the back corner: a lattice of three legs, braced.
bm, uvl = g
for k in range(3):
    a = k * 2 * math.pi / 3
    cylinder(bm, (-9.5 + 0.35 * math.cos(a), 15.5 + 0.35 * math.sin(a), L[3] + 3.0), 0.03, 6.0, segments=6, mat=IDX['rebar'])
for z in range(1, 12):
    cube(g, -9.85, 15.15, L[3] + z * 0.5, -9.15, 15.85, L[3] + z * 0.5 + 0.03, 'rebar')
finish('fc_roof', g)

# ---- The second flight, on the first floor -------------------------------------------------------
g = group('fc_stairs_1')
stair(g, STAIRS[1])
finish('fc_stairs_1', g)
solid(1, 6.1, STAIRS[1]['y0'], 6.4, STAIRS[1]['y1'])

# The displays: each floor's departments (the items, placed by the game).
plan['displays'] = [
    # Ground: living rooms.
    {'item': 'sofa_set', 'level': 0, 'x': -5.5, 'y': 9.0, 'yaw': 0},
    {'item': 'corner_sofa', 'level': 0, 'x': 0.5, 'y': 13.5, 'yaw': 0},
    {'item': 'sofa', 'level': 0, 'x': 4.0, 'y': 6.0, 'yaw': 0},
    {'item': 'sofa', 'level': 0, 'x': -9.5, 'y': 14.5, 'yaw': math.pi / 2},
    {'item': 'chandelier', 'level': 0, 'x': -5.5, 'y': 9.0, 'yaw': 0, 'hang': True},
    # First: bedrooms and bathrooms.
    {'item': 'double_bed', 'level': 1, 'x': -7.5, 'y': 12.5, 'yaw': 0},
    {'item': 'double_bed', 'level': 1, 'x': -2.0, 'y': 12.5, 'yaw': 0},
    {'item': 'modern_bed', 'level': 1, 'x': 2.6, 'y': 10.2, 'yaw': 0},
    {'item': 'bathtub', 'level': 1, 'x': 2.5, 'y': 15.5, 'yaw': math.pi / 2},
    {'item': 'toilet', 'level': 1, 'x': -9.5, 'y': 4.5, 'yaw': math.pi / 2},
    {'item': 'sink', 'level': 1, 'x': -9.5, 'y': 6.5, 'yaw': math.pi / 2},
    {'item': 'chandelier', 'level': 1, 'x': -2.0, 'y': 12.0, 'yaw': 0, 'hang': True},
    # Second: kitchens.
    {'item': 'kitchen_counter', 'level': 2, 'x': -6.0, 'y': 14.5, 'yaw': 0},
    {'item': 'kitchen_counter', 'level': 2, 'x': 0.5, 'y': 14.5, 'yaw': 0},
    {'item': 'sink', 'level': 2, 'x': -9.5, 'y': 6.0, 'yaw': math.pi / 2},
    {'item': 'chandelier', 'level': 2, 'x': -3.0, 'y': 9.0, 'yaw': 0, 'hang': True},
]
plan['door'] = {'x': -4.8, 'y': -1.5}
plan['departments'] = ['living', 'bed_bath', 'kitchen']

# Text as meshes, everything under one root, out.
root = bpy.data.objects.new('furniture_city', None)
bpy.context.scene.collection.objects.link(root)
for o in list(bpy.context.scene.objects):
    if o.type == 'FONT':
        with bpy.context.temp_override(active_object=o, selected_objects=[o], selected_editable_objects=[o], object=o):
            bpy.ops.object.convert(target='MESH')
for o in list(bpy.context.scene.objects):
    if o is not root and o.parent is None:
        if o.name.startswith('sign') or o.type == 'MESH' and not o.name.startswith('fc_'):
            # (Each floor's text with its floor: the banner and the windows' with the first.)
            o.name = 'fc_sign'
            o.parent = bpy.data.objects['fc_shell_1']
        else:
            o.parent = root
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, int(1024 * img.size[1] / img.size[0]))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_image_quality=82, export_apply=True, export_yup=True)
with open(PLAN, 'w') as f:
    json.dump(plan, f, indent=1)
print('GLB', os.path.getsize(OUT), 'solids', {k: len(v) for k, v in plan['solids'].items()})
