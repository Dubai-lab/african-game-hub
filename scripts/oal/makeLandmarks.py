# One Africa Life: Monrovia's landmarks, each its own file (public/oal/landmarks/<name>.v1.glb),
# standing on its real footprint in the city (src/games/oal/city/landmarks.ts):
#   capitol     the Capitol Building (Hyper3D Rodin, from the owner's photos)
#   providence  Providence Baptist Church (Rodin, from the owner's photos)
#   mansion     the Executive Mansion: six storeys of fins and glass, its entrance tower with the
#               seal, the plaza with the flag in its paving, the colonnade before it
#   ducor       the Ducor Hotel as it stands: the grey slab's floors cantilevered, empty, the
#               stair tower, the curved wing on its columns
#   jfk         the Liberian-Japanese Friendship Maternity Hospital at JFK: two cream storeys,
#               red accents, its balconies, the canopy with its name
#
#   blender -b --factory-startup --python scripts/oal/makeLandmarks.py -- <rodin dir> <out dir>
#
# Each centred on the origin, its front toward -Y, standing on z = 0, in metres.
import math
import os
import sys

import bmesh
import bpy
import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenekit as kit  # noqa: E402
from scenekit import box, cylinder, flat, srgb  # noqa: E402

RODIN, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(OUT, exist_ok=True)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(name):
    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, max(1, int(1024 * img.size[1] / img.size[0])))
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='WEBP', export_image_quality=78, export_apply=True)
    print('EXPORTED', path, os.path.getsize(path))


class Part:
    """One mesh of several materials, built of boxes."""

    def __init__(self, name, mats):
        self.name = name
        self.mats = list(mats)
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new()

    def box(self, c, size, mat=0, yaw=0.0):
        box(self.bm, self.uv, c, size, yaw, mat)

    def post(self, c, r, h, mat=0, seg=12):
        cylinder(self.bm, (c[0], c[1], c[2] + h / 2), r, h, 0, seg, mat=mat)

    def done(self):
        return kit.new_object(self.name, self.bm, self.mats)


def rodin(name, target_w, target_d, max_h):
    """A Rodin model: joined, its feet on the ground, scaled to its footprint, no taller than
    the real one."""
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(RODIN, f'{name}.glb'))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    lo = mathutils.Vector((1e9,) * 3)
    hi = -lo
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    size = hi - lo
    s = min(target_w / size.x, target_d / size.y)
    sz = min(s, max_h / size.z)
    centre = (lo + hi) / 2
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        if o.parent is None:
            o.parent = root
    root.location = (-centre.x * s, -centre.y * s, -lo.z * sz)
    root.scale = (s, s, sz)
    print(name, 'size', round(size.x * s, 1), round(size.y * s, 1), round(size.z * sz, 1))
    export(name)


# ---- The Executive Mansion -------------------------------------------------------------------


def mansion():
    clear()
    concrete = flat('mansion_concrete', srgb('#e8e6e0'), 0.7)
    glass = flat('mansion_glass', srgb('#3a4a3c'), 0.15, 0.4)
    fin = flat('mansion_fin', srgb('#c8c6c0'), 0.5, 0.2)
    paving = flat('mansion_paving', srgb('#c9c8c2'), 0.85)
    red = flat('flag_red', srgb('#bf0a30'), 0.6)
    white = flat('flag_white', srgb('#f2f2f2'), 0.6)
    blue = flat('flag_blue', srgb('#002868'), 0.6)
    dark = flat('mansion_dark', srgb('#2a2e30'), 0.6)
    green = flat('mansion_hedge', srgb('#3f6a2e'), 0.9)
    p = Part('mansion', [concrete, glass, fin, paving, red, white, blue, dark, green])
    W, D0, D1 = 92.0, 0.0, 20.0
    floors, fh = 6, 3.6
    # The plaza, the hedge round it.
    p.box((0, -10, 0), (110, 40, 0.15), 3)
    for x in (-54.5, 54.5):
        p.box((x, -10, 0.15), (1.0, 40, 0.8), 8)
    # The flag in the paving: eleven stripes, the blue square and its star.
    fw, fd = 16.0, 9.0
    for i in range(11):
        p.box((0, -20 - fd / 2 + fd * (i + 0.5) / 11, 0.15), (fw, fd / 11, 0.03), 4 if i % 2 == 0 else 5)
    p.box((-fw / 2 + fd * 5 / 11 / 2 + 0.1, -20 + fd / 2 - fd * 5 / 11 / 2, 0.16), (fd * 5 / 11, fd * 5 / 11, 0.03), 6)
    # The building: its core of glass, a slab at each floor, the fins up its face.
    p.box((0, (D0 + D1) / 2, 0.15), (W - 1, D1 - D0 - 1, floors * fh), 1)
    for f in range(floors + 1):
        p.box((0, (D0 + D1) / 2, 0.15 + f * fh - 0.3), (W, D1 - D0, 0.4), 0)
    for i in range(int(W / 2.4) + 1):
        x = -W / 2 + i * W / int(W / 2.4)
        for y in (D0 - 0.4, D1 + 0.4):
            p.box((x, y, 0.15), (0.25, 0.8, floors * fh), 2)
    for y in (D0, D1):
        pass
    for x in (-W / 2, W / 2):
        p.box((x, (D0 + D1) / 2, 0.15), (1.2, D1 - D0 + 1.2, floors * fh + 0.4), 0)
    # The top storey set back, its roof.
    p.box((0, (D0 + D1) / 2 + 2, 0.15 + floors * fh), (W * 0.7, D1 - D0 - 6, 3.2), 1)
    p.box((0, (D0 + D1) / 2 + 2, 0.15 + floors * fh + 3.2), (W * 0.7 + 2, D1 - D0 - 4, 0.6), 0)
    for i in range(18):
        x = -W * 0.35 + i * W * 0.7 / 17
        p.box((x, D0 + 3 - 0.3, 0.15 + floors * fh), (0.25, 0.5, 3.2), 2)
    # The entrance tower before it: its white frame, dark inside, the seal.
    tw = 12.0
    p.box((0, -3.5, 0.15), (tw, 7, floors * fh + 3.6), 0)
    p.box((0, -7.05, 3.2), (tw - 2.4, 0.2, floors * fh - 1), 7)
    for x in (-tw / 4, 0, tw / 4):
        p.box((x, -7.2, 3.2), (0.35, 0.3, floors * fh - 1), 0)
    cylinder(p.bm, (0, -7.4, floors * fh - 3.2), 1.5, 0.2, 0, 32, mat=6, lying=True)
    cylinder(p.bm, (0, -7.5, floors * fh - 3.2), 1.1, 0.2, 0, 32, mat=5, lying=True)
    # The colonnade before the building: its canopy on round columns, the steps up the middle.
    p.box((0, -9, 3.6), (W + 8, 4, 0.5), 0)
    for i in range(17):
        x = -(W + 6) / 2 + i * (W + 6) / 16
        if abs(x) > 5:
            p.post((x, -9.5, 0.15), 0.3, 3.45, 0)
    for k in range(5):
        p.box((0, -12 + k * 0.4, 0.15), (8, 3.0 - k * 0.4, 0.18 * (k + 1)), 0)
    p.done()
    kit.liberian_flag((-14, -24), 0, 12, 3)
    export('mansion')


# ---- The Ducor Hotel ---------------------------------------------------------------------------


def ducor():
    clear()
    concrete = flat('ducor_concrete', srgb('#8f8b80'), 0.95)
    slab = flat('ducor_slab', srgb('#aca898'), 0.95)
    dark = flat('ducor_dark', srgb('#1c1c1a'), 1.0)
    stain = flat('ducor_stain', srgb('#5f5c52'), 1.0)
    fence = flat('ducor_fence', srgb('#6a6c6a'), 0.5, 0.6)
    p = Part('ducor', [concrete, slab, dark, stain, fence])
    W, y0, y1 = 58.0, 2.0, 16.0
    floors, fh = 8, 3.2
    H = floors * fh
    # The empty inside (dark through every opening), the floors cantilevered out front and back.
    p.box((0, (y0 + y1) / 2, 0), (W - 2, y1 - y0 - 1, H), 2)
    for f in range(1, floors + 1):
        z = f * fh - 0.35
        p.box((0, (y0 + y1) / 2 - 0.8, z), (W, y1 - y0 + 3.6, 0.35), 1)
        # The parapet along each floor's edge, half broken.
        p.box((0, y0 - 2.4, z + 0.35), (W - 0.5, 0.15, 0.9), 0)
    for i in range(int(W / 4) + 1):
        x = -W / 2 + i * W / int(W / 4)
        p.box((x, y0 - 0.2, 0), (0.4, 0.4, H), 0)
    # The end walls, raking: thicker at the foot (steps of concrete), stained.
    for x in (-W / 2 - 0.6, W / 2 + 0.6):
        for k in range(4):
            p.box((x + (0.5 * k if x < 0 else -0.5 * k) * 0, (y0 + y1) / 2, k * H / 4), (1.6 - k * 0.3, y1 - y0 + 4 - k * 1.0, H / 4), 0)
        p.box((x + (0.81 if x < 0 else -0.81), (y0 + y1) / 2, H * 0.3), (0.02, y1 - y0, H * 0.6), 3)
    # The roof, the stair tower above it at one end.
    p.box((0, (y0 + y1) / 2, H), (W + 1, y1 - y0 + 1, 0.6), 0)
    p.box((W / 2 - 6, (y0 + y1) / 2 + 2, H), (8, 6, 7), 0)
    p.box((W / 2 - 6, (y0 + y1) / 2 - 1.05, H + 2), (0.02, 0.1, 4), 3)
    p.box((-W / 2 + 10, (y0 + y1) / 2, H), (5, 5, 3.5), 0)
    # The curved wing on its columns before the slab: a ring's arc, two floors, open between.
    cx, cy, r0, r1 = -6.0, -6.0, 9.0, 17.0
    n = 18
    for i in range(n):
        a0 = math.pi * (0.1 + 0.8 * i / n)
        a1 = math.pi * (0.1 + 0.8 * (i + 1) / n)
        am = (a0 + a1) / 2
        rm = (r0 + r1) / 2
        seg = 2 * r1 * math.sin((a1 - a0) / 2) + 0.05
        yaw = am + math.pi / 2
        for z, t in ((3.6, 0.45), (7.2, 0.6)):
            p.box((cx + math.cos(am) * rm, cy - math.sin(am) * rm, z), (seg, r1 - r0, t), 1, yaw)
        p.box((cx + math.cos(am) * (r1 - 0.2), cy - math.sin(am) * (r1 - 0.2), 7.8), (seg, 0.2, 1.0), 0, yaw)
        for rr in (r0 + 0.5, r1 - 0.5):
            p.post((cx + math.cos(a0) * rr, cy - math.sin(a0) * rr, 0), 0.25, 7.2, 0, 8)
    # The fence the guards put round it.
    for x in range(-30, 31, 3):
        p.box((x, -24, 0), (3, 0.05, 2.2), 4)
    p.done()
    export('ducor')


# ---- The Liberian-Japanese Friendship Maternity Hospital --------------------------------------


def jfk():
    clear()
    cream = flat('jfk_cream', srgb('#ecdc9e'), 0.85)
    trim = flat('jfk_trim', srgb('#f4ecc8'), 0.8)
    red = flat('jfk_red', srgb('#c42a24'), 0.6)
    glass = flat('jfk_glass', srgb('#2c3a4a'), 0.2, 0.3)
    frame = flat('jfk_frame', srgb('#e8e8e4'), 0.4, 0.2)
    roof = flat('jfk_roof', srgb('#7a8a8c'), 0.5, 0.4)
    sign = flat('jfk_sign', srgb('#f2f2ee'), 0.6)
    dark = flat('jfk_dark', srgb('#3a3a36'), 0.8)
    p = Part('jfk', [cream, trim, red, glass, frame, roof, sign, dark])
    W, D, fh = 72.0, 14.0, 3.8
    H = 2 * fh
    # The two storeys, the band between them, the parapet.
    p.box((0, 0, 0), (W, D, H), 0)
    p.box((0, 0, 0), (W + 0.3, D + 0.3, 0.5), 7)
    p.box((0, 0, fh - 0.2), (W + 0.4, D + 0.4, 0.4), 1)
    p.box((0, 0, H), (W + 0.6, D + 0.6, 1.0), 1)
    # The block behind on the roof (its grey louvres).
    p.box((-6, 2, H), (34, 8, 3.0), 5)
    for i in range(16):
        p.box((-23 + i * 34 / 15, -2.05, H + 0.6), (1.6, 0.1, 1.8), 7)
    # The windows, each floor, front and back: glass in a white frame, red strips here and there,
    # the little red squares under the parapet.
    for f in range(2):
        z = f * fh + 1.0
        for i in range(20):
            x = -W / 2 + 2.2 + i * (W - 4.4) / 19
            if abs(x) < 7:
                continue
            for y, s in ((-D / 2, -1), (D / 2, 1)):
                p.box((x, y + s * 0.05, z), (1.9, 0.12, 1.6), 4)
                p.box((x, y + s * 0.1, z + 0.1), (1.6, 0.12, 1.4), 3)
            if i % 4 == 1:
                p.box((x + 1.7, -D / 2 - 0.1, f * fh), (0.4, 0.2, fh - 0.2), 2)
    for i in range(18):
        p.box((-W / 2 + 2 + i * (W - 4) / 17, -D / 2 - 0.35, H + 0.3), (0.4, 0.1, 0.4), 2)
    # The balconies at both ends of the upper floor: their lattice rails.
    for x in (-W / 2 + 8, W / 2 - 8):
        p.box((x, -D / 2 - 1.2, fh), (12, 2.4, 0.25), 1)
        p.box((x, -D / 2 - 2.35, fh + 0.25), (12, 0.15, 1.1), 1)
        for k in range(24):
            p.box((x - 5.75 + k * 0.5, -D / 2 - 2.45, fh + 0.4), (0.2, 0.05, 0.8), 7)
    # The entrance: the canopy on its posts, the glass doors, the name on its board above.
    p.box((0, -D / 2 - 3, fh - 0.5), (14, 6, 0.5), 1)
    for x in (-6.5, 6.5):
        p.post((x, -D / 2 - 5.6, 0), 0.2, fh - 0.5, 4)
    p.box((0, -D / 2 - 0.05, 0), (8, 0.1, 2.6), 3)
    p.box((0, -D / 2 - 0.4, H + 0.2), (16, 0.2, 1.8), 6)
    p.box((0, -D / 2 - 6.05, fh - 0.5), (10, 0.1, 0.5), 6)
    # The white fence and its gate pillars along the road.
    for x in range(-36, 37, 2):
        if abs(x) > 4:
            p.box((x, -D / 2 - 16, 0), (2, 0.06, 1.1), 4)
    for x in (-4, 4):
        p.box((x, -D / 2 - 16, 0), (0.8, 0.8, 1.9), 0)
    p.done()
    kit.text('LIBERIAN - JAPANESE', (0, -D / 2 - 0.52), 0, 0.55, '#c42a24', H + 1.4, 0.02)
    kit.text('FRIENDSHIP MATERNITY HOSPITAL', (0, -D / 2 - 0.52), 0, 0.42, '#c42a24', H + 0.7, 0.02)
    kit.text('LIBERIAN - JAPANESE FRIENDSHIP MATERNITY HOSPITAL', (0, -D / 2 - 6.12), 0, 0.22, '#c42a24', fh - 0.25, 0.01)
    # The letters as mesh (glTF has no text).
    for o in list(bpy.context.scene.objects):
        if o.type == 'FONT':
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.convert(target='MESH')
            o.select_set(False)
    export('jfk')


rodin('capitol', 104, 84, 32)
rodin('providence', 36, 22, 24)
mansion()
ducor()
jfk()
