# One Africa Life: a market's things, for every town scene that has one (makeWaterside.py,
# makeVoinjama.py): traders' tables under zinc or tarpaulin shades with their goods (heaps of
# produce, enamel basins, bales of lappa cloth, second-hand clothes hung up), big umbrellas, the
# wax-print cloth itself (made here), and points along a street to set them at.
import math
import random

import bmesh
import bpy
from mathutils import Vector

import scenekit as kit
from scenekit import box, flat, srgb

PRODUCE = [srgb(cl) for cl in ('#c8281e', '#d8401c', '#e8b41c', '#7a3a8a', '#4a8a2a', '#e8d8b8', '#8a5a2a', '#2a6a2a')]
KINDS = ['produce', 'produce', 'produce', 'basins', 'cloth', 'clothes']


def lappa_material(i):
    """A wax-print cloth: bold rings and stripes in two colours on a third, made here."""
    import numpy as np
    rng = np.random.default_rng(i)
    pal = [np.array(srgb(cl)) for cl in rng.choice(['#e8b41c', '#c8281e', '#1f4fa8', '#2a8a4a', '#f2ece0', '#6a2a7a', '#e86a1c', '#141414'], 3, replace=False)]
    n = 128
    y, x = np.mgrid[0:n, 0:n] / n
    r = np.hypot((x * 4) % 1 - 0.5, (y * 4) % 1 - 0.5)
    ring = (np.sin(r * 30) > 0.2)
    band = (np.sin(x * 2 * np.pi * 6) > 0.6)
    col = np.where(ring[..., None], pal[0], np.where(band[..., None], pal[1], pal[2]))
    img = bpy.data.images.new(f'lappa{i}', n, n)
    img.pixels.foreach_set(np.concatenate([col, np.ones((n, n, 1))], axis=-1).astype(np.float32).ravel())
    img.pack()
    mat = bpy.data.materials.new(f'lappa{i}')
    mat.use_nodes = True
    t = mat.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    mat.node_tree.links.new(t.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    return mat


class Market:
    """A town's market things, drawn with the town's materials (town.Town) and these of its own."""

    def __init__(self, town):
        self.town = town
        self.timber = flat('timber', srgb('#6b4a2e'), 0.85)
        self.timber_old = flat('timber_old', srgb('#4a3a2c'), 0.9)
        self.tarps = [flat(f'tarp{i}', srgb(cl), 0.8) for i, cl in enumerate(['#1f5fa8', '#d2552a', '#2f8a4a', '#c8c2b0', '#b0262c'])]
        self.produce = [flat(f'produce{i}', cl, 0.6) for i, cl in enumerate(PRODUCE)]
        self.enamel = [flat(f'enamel{i}', srgb(cl), 0.35) for i, cl in enumerate(['#e8e4dc', '#c8281e', '#2a5aa8', '#e8b41c', '#2a8a5a'])]
        self.lappa = [lappa_material(i) for i in range(5)]

    def stall(self, at, d, n, kind):
        """A trader's table under a shade, its goods on it; returns its depth across the street."""
        yaw = math.atan2(d.y, d.x)
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        w, deep = 2.2, 1.1
        box(bm, uv, (at.x, at.y, 0.72), (w, deep, 0.06), yaw, mat=0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                q = at + d * sx * (w / 2 - 0.05) + n * sy * (deep / 2 - 0.05)
                box(bm, uv, (q.x, q.y, 0), (0.06, 0.06, 0.72), yaw, mat=0)
        # The shade: zinc on four poles, or a tarpaulin.
        zinc = random.random() < 0.5
        for sx in (-1, 1):
            q = at + d * sx * (w / 2) - n * (deep / 2 + 0.3)
            box(bm, uv, (q.x, q.y, 0), (0.06, 0.06, 2.3), yaw, mat=0)
            q = at + d * sx * (w / 2) + n * (deep / 2)
            box(bm, uv, (q.x, q.y, 0), (0.06, 0.06, 2.1), yaw, mat=0)
        roof = at - n * 0.15
        box(bm, uv, (roof.x, roof.y, 2.15), (w + 0.4, deep + 1.2, 0.04), yaw, mat=1, pitch=0.0)
        mats = [random.choice([self.timber, self.timber_old]), self.town.mats['zinc_rust'] if zinc else random.choice(self.tarps)]
        # The goods.
        if kind == 'produce':
            for k in range(random.randint(4, 7)):
                q = at + d * random.uniform(-0.9, 0.9) + n * random.uniform(-0.35, 0.35)
                heap = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=random.uniform(0.11, 0.17))
                for v in heap['verts']:
                    v.co = Vector((v.co.x + q.x, v.co.y + q.y, max(0.0, v.co.z) * 0.8 + 0.76))
                for f in {f for v in heap['verts'] for f in v.link_faces}:
                    f.material_index = 2 + random.randrange(len(self.produce))
            mats += self.produce
        elif kind == 'basins':
            for k in range(4):
                q = at + d * (-0.75 + k * 0.5)
                cyl = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.17, radius2=0.24, depth=0.12 * random.randint(1, 4))
                for v in cyl['verts']:
                    v.co += Vector((q.x, q.y, 0.76 + 0.06 * random.randint(1, 4)))
                for f in {f for v in cyl['verts'] for f in v.link_faces}:
                    f.material_index = 2 + k % len(self.enamel)
            mats += self.enamel
        elif kind == 'cloth':
            for k in range(5):
                q = at + d * (-0.85 + k * 0.42)
                box(bm, uv, (q.x, q.y, 0.76), (0.36, 0.5, 0.12 * random.randint(2, 4)), yaw, mat=2 + k)
            mats += self.lappa
        else:  # second-hand clothes hung on a line under the shade, folded ones on the table
            for k in range(6):
                q = at + d * (-0.95 + k * 0.38) - n * 0.55
                box(bm, uv, (q.x, q.y, 1.25), (0.34, 0.03, 0.75), yaw, mat=2 + k % len(self.lappa))
            for k in range(3):
                q = at + d * (-0.6 + k * 0.6)
                box(bm, uv, (q.x, q.y, 0.76), (0.45, 0.4, 0.1), yaw, mat=2 + (k + 2) % len(self.lappa))
            mats += self.lappa
        kit.new_object('stall', bm, mats)
        self.town.solid_box(at, w + 0.1, deep + 0.1, yaw)
        return deep


    def umbrella(self, p, colours=('#d23a2a', '#f2e6c8')):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new()
        top = Vector((p.x, p.y, 2.5))
        box(bm, uv, (p.x, p.y, 0), (0.04, 0.04, 2.5))
        for k in range(8):
            a0, a1 = k / 8 * 2 * math.pi, (k + 1) / 8 * 2 * math.pi
            face = bm.faces.new((bm.verts.new(top), bm.verts.new((p.x + math.cos(a0) * 1.4, p.y + math.sin(a0) * 1.4, 2.05)), bm.verts.new((p.x + math.cos(a1) * 1.4, p.y + math.sin(a1) * 1.4, 2.05))))
            face.material_index = 1 + k % 2
        kit.new_object('umbrella', bm, [self.town.mats['wood'], flat('umb_' + colours[0], srgb(colours[0]), 0.8), flat('umb_' + colours[1], srgb(colours[1]), 0.8)])


def shoulder(pts, offset, every, start=0.0):
    for a, b in zip(pts, pts[1:]):
        seg = b - a
        if seg.length < 0.1:
            continue
        d = seg.normalized()
        n = Vector((-d.y, d.x))
        t = start
        while t < seg.length:
            yield a + d * t + n * offset, d, n
            t += every
