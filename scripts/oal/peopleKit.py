# One Africa Life: what Monrovia's people wear and how their hair is done, where MPFB's packs
# have nothing Liberian: a low cut, long box braids, a head-tie with its fan, an ankara dress, a
# lappa and top, slippers. Each made from the body itself (MakeHuman's own fitting shapes: its
# tights, its skirt; the scalp along a hairline; the soles of the feet), so it fits every body
# and follows every slider: for each of the body's shapes the same points are taken and shaped
# the same way, and that is the piece's morph. The prints and the hair are pictures made here.
#
# Used by makeCreatorAssets.py (the game's people). Coordinates: MPFB's (z up, facing -y).
import math

import bpy
import numpy as np
from mathutils import Vector


# ---- The body: its points' weights ---------------------------------------------------------------

def weights(body):
    """Every vertex group's weight at every point of the body, by group name."""
    n = len(body.data.vertices)
    out = {g.name: np.zeros(n, dtype=np.float32) for g in body.vertex_groups}
    names = [g.name for g in body.vertex_groups]
    for v in body.data.vertices:
        for g in v.groups:
            out[names[g.group]][v.index] = g.weight
    return out


def bone(rig, name, tail=False):
    b = rig.data.bones[name]
    return rig.matrix_world @ (b.tail_local if tail else b.head_local)


def summed(W, test):
    total = None
    for name, w in W.items():
        if test(name):
            total = w.copy() if total is None else total + w
    return total if total is not None else np.zeros(len(next(iter(W.values()))), dtype=np.float32)


# ---- Pieces: points of the body, shaped ------------------------------------------------------------

def faces_of(body, idx):
    """The body's faces made only of these points, numbered as they are in idx."""
    at = {int(v): i for i, v in enumerate(idx)}
    return [[at[v] for v in p.vertices] for p in body.data.polygons if all(v in at for v in p.vertices)]


def normals(P, faces):
    N = np.zeros_like(P)
    for f in faces:
        for k in range(1, len(f) - 1):
            a, b, c = P[f[0]], P[f[k]], P[f[k + 1]]
            n = np.cross(b - a, c - a)
            for i in (f[0], f[k], f[k + 1]):
                N[i] += n
    length = np.linalg.norm(N, axis=1, keepdims=True)
    return N / np.maximum(length, 1e-9)


def boundary(faces, count):
    edges = {}
    for f in faces:
        for i in range(len(f)):
            e = tuple(sorted((f[i], f[(i + 1) % len(f)])))
            edges[e] = edges.get(e, 0) + 1
    out = np.zeros(count, dtype=bool)
    for (a, b), n in edges.items():
        if n == 1:
            out[a] = out[b] = True
    return out


def cylinder_uv(P, faces, around=3, tall=0.42, centre=(0.0, 0.0)):
    """A print's place on a piece: round the body (a whole number of repeats, so it meets itself at
    the back) and up it; per corner, so a face across the back seam takes the near repeat."""
    uvs = []
    for f in faces:
        us = [(math.atan2(P[i][0] - centre[0], -(P[i][1] - centre[1])) / (2 * math.pi) + 0.5) * around for i in f]
        if max(us) - min(us) > around / 2:
            us = [u + around if u < around / 2 else u for u in us]
        uvs.append([(u, P[i][2] / tall) for u, i in zip(us, f)])
    return uvs


def make_piece(name, body, rig, idx, faces, shapes, shape_fn, uvs, material, keys=None):
    """A piece of the body's points: shaped (shape_fn) as the average body, and as each of its shapes
    (its morphs); weighted to the skeleton as those points of the body are."""
    base = shape_fn(shapes['__average__'][idx])
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in base], [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    k = 0
    for poly, corners in zip(me.polygons, uvs):
        for li, c in zip(poly.loop_indices, corners):
            uv.data[li].uv = c
        k += 1
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    # Its weights: the body's at the same points.
    names = [g.name for g in body.vertex_groups]
    groups = {}
    for i, v in enumerate(idx):
        for g in body.data.vertices[int(v)].groups:
            if g.weight <= 0.0:
                continue
            gname = names[g.group]
            if gname.startswith('helper') or gname.startswith('joint') or gname in ('body', 'HelperGeometry', 'JointCubes', 'Left', 'Right', 'Mid') or gname.startswith('Delete'):
                continue
            if gname not in groups:
                groups[gname] = obj.vertex_groups.new(name=gname)
            groups[gname].add([i], g.weight, 'REPLACE')
    obj.parent = rig
    obj.modifiers.new('rig', 'ARMATURE').object = rig
    # Its morphs: the same points of each of the body's shapes, shaped the same way.
    if keys:
        obj.shape_key_add(name='Basis')
        for key in keys:
            co = shape_fn(shapes[key][idx])
            obj.shape_key_add(name=key, from_mix=False).data.foreach_set('co', co.astype(np.float32).ravel())
    return obj


def rigid(name, verts, faces, rig, material, uvs=None):
    """A piece that moves with the head alone (braids, a head-tie's fan and knot)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    if uvs:
        for poly, corners in zip(me.polygons, uvs):
            for li, c in zip(poly.loop_indices, corners):
                uv.data[li].uv = c
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.vertex_groups.new(name='mixamorig:Head').add(list(range(len(verts))), 1.0, 'REPLACE')
    obj.parent = rig
    obj.modifiers.new('rig', 'ARMATURE').object = rig
    return obj


def join(objs, name):
    """One object of several (the game shows an outfit or a hairstyle as one)."""
    main = objs[0]
    with bpy.context.temp_override(active_object=main, selected_objects=objs, selected_editable_objects=objs, object=main):
        bpy.ops.object.join()
    main.name = name
    return main


# ---- Pictures --------------------------------------------------------------------------------------

def image(name, rgba):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel())
    img.pack()
    return img


def srgb(c):
    return np.array(c, dtype=np.float32) ** 2.2


PRINTS = {
    # Ankara wax prints: bold bands, big rings over them.
    'ankara': [(0.85, 0.36, 0.08), (0.04, 0.42, 0.48), (0.93, 0.68, 0.06), (0.47, 0.1, 0.38), (0.06, 0.05, 0.06)],
    'lappa': [(0.12, 0.2, 0.58), (0.9, 0.84, 0.72), (0.74, 0.12, 0.14), (0.95, 0.62, 0.12), (0.05, 0.05, 0.07)],
}


def print_image(kind, size=512, seed=3):
    """A wax print's repeat (it meets itself at every edge): wavy bands of three colours, rings
    of two over them, a dot in each."""
    pal = [srgb(c) for c in PRINTS[kind]]
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size] / size
    wave = y + 0.05 * np.sin(2 * np.pi * (x * 2 + 0.3)) + 0.02 * np.sin(2 * np.pi * x * 5)
    band = np.floor(wave * 5).astype(int) % 3
    out = np.zeros((size, size, 4), dtype=np.float32)
    for i in range(3):
        out[band == i, :3] = pal[i]
    cells = 3 if kind == 'ankara' else 4
    best = np.full((size, size), 9.0)
    for cy in range(cells):
        for cx in range(cells):
            px, py = (cx + 0.5 + rng.uniform(-0.2, 0.2)) / cells, (cy + 0.5 + rng.uniform(-0.2, 0.2)) / cells
            dx = np.abs(x - px)
            dy = np.abs(y - py)
            d = np.hypot(np.minimum(dx, 1 - dx), np.minimum(dy, 1 - dy))
            best = np.minimum(best, d)
    r = 0.42 / cells
    ring = best < r
    out[ring, :3] = pal[3]
    out[ring & (np.floor(best / (r / 4)).astype(int) % 2 == 1), :3] = pal[4]
    out[best < r / 5, :3] = pal[1]
    # The cloth's weave, faint.
    out[..., :3] *= (0.92 + 0.08 * rng.random((size, size)))[..., None]
    out[..., 3] = 1
    return image(f'print_{kind}', out)


def hair_image(name, size=512, edge=True, seed=5):
    """Short hair seen close: dark strands and their gaps; with `edge`, thinning to nothing at the
    hairline (the picture's bottom), for a cut that fades into the skin."""
    rng = np.random.default_rng(seed)
    y = (np.mgrid[0:size, 0:size][0] / size)[::-1]
    lum = 0.08 + 0.12 * rng.random((size, size))
    out = np.zeros((size, size, 4), dtype=np.float32)
    out[..., 0] = out[..., 1] = out[..., 2] = lum
    if edge:
        density = np.clip((y - 0.02) / 0.22, 0, 1)
        out[..., 3] = (rng.random((size, size)) < density * 0.95 + 0.03).astype(np.float32)
    else:
        out[..., 3] = 1
    return image(name, out)


def textured(name, img, rough=0.75, alpha=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tex = tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    bsdf = tree.nodes['Principled BSDF']
    tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        try:
            mat.surface_render_method = 'DITHERED'
        except Exception:
            pass
    bsdf.inputs['Roughness'].default_value = rough
    mat.use_backface_culling = False
    return mat


# ---- What is made ------------------------------------------------------------------------------------

class Kit:
    """Makes the pieces for a body (with its fitting shapes still on it) and its skeleton; `shapes`
    the body's points in each of its shapes ('__average__' the average one)."""

    def __init__(self, body, rig, shapes, build_keys, face_keys):
        self.body, self.rig, self.shapes = body, rig, shapes
        self.build_keys, self.face_keys = build_keys, face_keys
        self.W = weights(body)
        self.A = shapes['__average__']
        self.neck = bone(rig, 'mixamorig:Neck').z - 0.035
        self.waist = bone(rig, 'mixamorig:Spine').z + 0.02
        self.hips = bone(rig, 'mixamorig:Hips').z
        self.knee = bone(rig, 'mixamorig:LeftLeg').z
        self.foot = bone(rig, 'mixamorig:LeftFoot').z
        self.shoulder_x = abs(bone(rig, 'mixamorig:LeftArm').x)
        self.head = bone(rig, 'mixamorig:Head')
        self.top = bone(rig, 'mixamorig:Head', tail=True).z
        self.arms_low = summed(self.W, lambda n: 'ForeArm' in n or 'Hand' in n)
        self.arms = summed(self.W, lambda n: n.endswith('Arm') or 'ForeArm' in n or 'Hand' in n)
        self.on_body = self.W['body'] > 0.5

    # -- The hairline, and the scalp inside it.
    def hairline(self, P, lower=0.0):
        a = np.abs(np.arctan2(P[:, 0] - self.head.x, -(P[:, 1] - self.head.y))) / math.pi
        s = a * a * (3 - 2 * a)
        h = self.top - self.head.z
        return self.head.z + h * (0.6 - 0.46 * s) - lower * (0.25 + 0.75 * s)

    def scalp(self, lower=0.0):
        A = self.A
        return np.where(self.on_body & (self.W['mixamorig:Head'] > 0.6) & (A[:, 2] > self.hairline(A, lower)))[0]

    # -- Hair.
    def low_cut(self):
        idx = self.scalp()
        faces = faces_of(self.body, idx)
        P = self.A[idx]
        line = self.hairline(P)
        uvs = [[((math.atan2(P[i][0] - self.head.x, -(P[i][1] - self.head.y)) / (2 * math.pi) + 0.5) * 2, (P[i][2] - line[i]) / max(0.01, self.top - line[i])) for i in f] for f in faces]
        for f in uvs:
            us = [u for u, _ in f]
            if max(us) - min(us) > 1:
                f[:] = [(u + 2 if u < 1 else u, v) for u, v in f]

        def shape(P):
            return P + normals(P, faces) * 0.0012
        mat = textured('hair_lowcut', hair_image('lowcut_hair'), 0.85, alpha=True)
        return make_piece('hair_lowcut', self.body, self.rig, idx, faces, self.shapes, shape, uvs, mat, self.build_keys + self.face_keys)

    def braids(self, rnd):
        """Long box braids: a braided cap and braids from all over the scalp, swept off the face,
        falling past the shoulders."""
        idx = self.scalp()
        faces = faces_of(self.body, idx)
        img = hair_image('braid_hair', 256, edge=False, seed=9)
        mat = textured('hair_braids', img, 0.7)

        def shape(P):
            return P + normals(P, faces) * 0.004
        cap = make_piece('hair_braids', self.body, self.rig, idx, faces, self.shapes, shape, [[(0, 0)] * len(f) for f in faces], mat, self.build_keys + self.face_keys)
        P = self.A[idx]
        centre = P.mean(axis=0)
        top = P[:, 2].max()
        head_r = np.hypot(P[:, 0] - centre[0], P[:, 1] - centre[1]).max()
        shoulder = bone(self.rig, 'mixamorig:LeftShoulder').z
        verts, quads, uvs = [], [], []
        roots = list(P[P[:, 2] > centre[2] - 0.03])
        rnd.shuffle(roots)
        made = 0
        sides = 6
        for root in roots:
            out = Vector((root[0] - centre[0], root[1] - centre[1], 0))
            if out.length < 1e-4:
                continue
            out.normalize()
            if out.y < 0.1:
                out = Vector((math.copysign(max(abs(out.x), 0.75), out.x or rnd.uniform(-1, 1)), 0.25 + rnd.uniform(0, 0.25), 0)).normalized()
            sway = Vector((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.01, 0.02), 0))
            length = rnd.uniform(0.38, 0.5)
            steps = 12
            path = []
            for i in range(steps + 1):
                t = i / steps
                z = root[2] - t * length
                r = head_r + 0.012 + t * 0.06 + (0.05 if z < shoulder + 0.05 else 0)
                here = Vector((root[0], root[1], root[2])) if i == 0 else Vector((centre[0], centre[1], 0)) + out * max(r * (0.92 if z > centre[2] else 1.0), math.hypot(root[0] - centre[0], root[1] - centre[1]) + 0.006) + sway * t
                if i:
                    if z < shoulder + 0.02 and out.y < 0.2:
                        here += Vector((0, 0.06 * (shoulder + 0.02 - z) / 0.1, 0))
                    here.z = z
                path.append(here)
            # A tube round the path, a little thinner to its end.
            base = len(verts)
            for i, c in enumerate(path):
                d = (path[min(i + 1, steps)] - path[max(i - 1, 0)]).normalized()
                side = d.cross(Vector((0, 0, 1)))
                if side.length < 1e-4:
                    side = Vector((1, 0, 0))
                side.normalize()
                up = side.cross(d).normalized()
                rad = 0.0052 * (1 - 0.35 * i / steps)
                for k in range(sides):
                    a = 2 * math.pi * k / sides
                    p = c + (side * math.cos(a) + up * math.sin(a)) * rad
                    verts.append((p.x, p.y, p.z))
            for i in range(steps):
                for k in range(sides):
                    a, b = base + i * sides + k, base + i * sides + (k + 1) % sides
                    quads.append((a, b, b + sides, a + sides))
                    uvs.append([(k / sides, i / 3), ((k + 1) / sides, i / 3), ((k + 1) / sides, (i + 1) / 3), (k / sides, (i + 1) / 3)])
            made += 1
            if made >= 150:
                break
        strands = rigid('braid_strands', verts, quads, self.rig, mat, uvs)
        return join([cap, strands], 'hair_braids')

    def head_tie(self, mat):
        """A head-tie: wrapped round and up over the head, full at the back, its ends gathered in a
        pleated fan standing over the crown, and a knot at the front."""
        idx = self.scalp(lower=0.02)
        faces = faces_of(self.body, idx)

        def shape(P):
            lo, hi = P[:, 2].min(), P[:, 2].max()
            back = P[:, 1].max()
            N = normals(P, faces)
            t = (P[:, 2] - lo) / max(0.01, hi - lo)
            b = np.clip((P[:, 1] - (back - 0.12)) / 0.12, 0, None)
            out = P + N * (0.014 + 0.03 * t + 0.05 * b * t)[:, None]
            out[:, 2] += 0.015 * t
            out += N * (0.006 * np.sin((P[:, 2] - lo) * 140 + P[:, 0] * 30))[:, None]
            return out
        P = self.A[idx]
        cap = make_piece('hair_headtie', self.body, self.rig, idx, faces, self.shapes, shape, cylinder_uv(P, faces, around=2, tall=0.3, centre=(self.head.x, self.head.y)), mat, self.build_keys + self.face_keys)
        centre = P.mean(axis=0)
        top = P[:, 2].max()
        front = P[:, 1].min()
        cols, rows = 40, 10
        verts, quads, uvs = [], [], []
        for j in range(rows + 1):
            for i in range(cols + 1):
                u = i / cols - 0.5
                v = j / rows
                ang = u * 2.2
                r = 0.1 + 0.03 * v
                pleat = 0.012 * math.sin(i * math.pi / 2) * (0.3 + v)
                verts.append((centre[0] + math.sin(ang) * (r + pleat), centre[1] + 0.01 + math.cos(ang) * (r + pleat) * 0.55 - 0.03 * v, top + 0.0 + v * 0.13 * (1 - 0.6 * (2 * u) ** 2)))
        for j in range(rows):
            for i in range(cols):
                a = j * (cols + 1) + i
                quads.append((a, a + 1, a + cols + 2, a + cols + 1))
                uvs.append([(i / cols, j / rows), ((i + 1) / cols, j / rows), ((i + 1) / cols, (j + 1) / rows), (i / cols, (j + 1) / rows)])
        fan = rigid('headtie_fan', verts, quads, self.rig, mat, uvs)
        # The knot: two twists of the cloth at the front.
        kv, kf, ku = [], [], []
        for n, (tilt, shift) in enumerate(((0.6, -0.015), (-0.6, 0.015))):
            seg, ring = 24, 8
            base = len(kv)
            for i in range(seg):
                a = 2 * math.pi * i / seg
                for k in range(ring):
                    b = 2 * math.pi * k / ring
                    rr = 0.035 + 0.016 * math.cos(b)
                    x, y, z = rr * math.cos(a), 0.016 * math.sin(b), rr * math.sin(a)
                    # Tilted, at the front over the forehead.
                    x2 = x * math.cos(tilt) - z * math.sin(tilt)
                    z2 = x * math.sin(tilt) + z * math.cos(tilt)
                    kv.append((centre[0] + shift + x2, front + 0.02 + y, top + 0.01 + z2 * 0.8))
            for i in range(seg):
                for k in range(ring):
                    a, b = base + i * ring + k, base + i * ring + (k + 1) % ring
                    c, d = base + ((i + 1) % seg) * ring + (k + 1) % ring, base + ((i + 1) % seg) * ring + k
                    kf.append((a, b, c, d))
                    ku.append([(i / seg, k / ring)] * 4)
        knot = rigid('headtie_knot', kv, kf, self.rig, mat, ku)
        return join([cap, fan, knot], 'hair_headtie')

    def bigger(self, co, amount=0.05):
        """A fuller afro: the hair pushed out from the head's middle, most at the top and sides."""
        centre = np.array([self.head.x, self.head.y + 0.01, self.head.z + (self.top - self.head.z) * 0.55])
        d = co - centre
        up = np.clip((co[:, 2] - self.head.z) / max(0.01, self.top - self.head.z), 0, 1)
        return co + d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6) * (amount * (0.4 + 0.6 * up))[:, None]

    # -- Clothes.
    def garment(self, name, mat, top, skirt, offset, loose=False):
        """A dress or a lappa and top: the body's tights from the chest down (short sleeves), its
        skirt below (to the knee or the ankle); its neckline a clean scoop."""
        pieces = []
        A = self.A
        if top:
            bottom = self.hips - 0.04 if loose else self.waist - 0.05
            idx = np.where((self.W['helper-tights'] > 0.5) & (A[:, 2] <= self.neck) & (A[:, 2] >= bottom) & (self.arms_low < 0.2) & (np.abs(A[:, 0]) < self.shoulder_x + 0.16))[0]
            faces = faces_of(self.body, idx)
            edge = boundary(faces, len(idx))
            neck = self.neck

            def shape_top(P, faces=faces, edge=edge, neck=neck, off=offset + (0.006 if loose else 0)):
                P = P.copy()
                lift = edge & (P[:, 2] > neck - 0.05)
                scoop = np.where(P[:, 1] < 0, 0.04 * np.clip(1 - np.abs(P[:, 0]) / 0.12, 0, None), 0.0)
                P[lift, 2] = (neck - 0.012 - scoop)[lift]
                return P + normals(P, faces) * off
            pieces.append(make_piece(f'{name}_top', self.body, self.rig, idx, faces, self.shapes, shape_top, cylinder_uv(A[idx], faces), mat, self.build_keys))
        if skirt:
            idx = np.where(self.W['helper-skirt'] > 0.5)[0]
            faces = faces_of(self.body, idx)
            want = self.foot + 0.05 if skirt == 'ankle' else self.knee - 0.06
            flare_by = 0.1 if skirt == 'ankle' else 0.18

            def shape_skirt(P, faces=faces, want=want, flare_by=flare_by, off=offset + 0.006):
                P = P.copy()
                z0, z1 = P[:, 2].max(), P[:, 2].min()
                k = (z0 - want) / max(0.01, z0 - z1)
                t = (z0 - P[:, 2]) / max(0.01, z0 - z1)
                c = P.mean(axis=0)
                P[:, 2] = z0 - (z0 - P[:, 2]) * k
                f = 1 + t * flare_by
                P[:, 0] = c[0] + (P[:, 0] - c[0]) * f
                P[:, 1] = c[1] + (P[:, 1] - c[1]) * f
                return P + normals(P, faces) * off
            pieces.append(make_piece(f'{name}_skirt', self.body, self.rig, idx, faces, self.shapes, shape_skirt, cylinder_uv(shape_skirt(A[idx]), faces), mat, self.build_keys))
        return join(pieces, f'outfit_{name}') if len(pieces) > 1 else pieces[0]

    def covered(self, skirt):
        """The body's points under a made outfit (not drawn: no skin through the cloth); the arms
        stay (the sleeves are short)."""
        A = self.A
        low = self.foot + 0.15 if skirt == 'ankle' else self.knee + 0.1
        return self.on_body & (A[:, 2] > low) & (A[:, 2] < self.neck - 0.06) & (self.arms < 0.3)

    def slippers(self, rnd):
        """Slippers: a sole under each foot, a band over the front of it."""
        mat = textured('shoes_slippers', image('slipper', np.tile(np.array([*srgb(rnd.choice([(0.08, 0.08, 0.08), (0.35, 0.14, 0.07), (0.65, 0.5, 0.15)])), 1], dtype=np.float32), (8, 8, 1))), 0.55)
        A = self.A
        out = []
        for side, sign in (('Left', 1), ('Right', -1)):
            foot = bone(self.rig, f'mixamorig:{side}Foot')
            toe = bone(self.rig, f'mixamorig:{side}ToeBase')
            ahead = np.array([toe.x - foot.x, toe.y - foot.y, 0.0])
            ahead /= max(1e-6, np.linalg.norm(ahead))
            mine = self.on_body & (np.abs(A[:, 0] - foot.x) < 0.08)
            sole = np.where(mine & (A[:, 2] < 0.022))[0]
            band = np.where(mine & (A[:, 2] > 0.02) & (A[:, 2] < 0.055) & (((A - np.array([foot.x, foot.y, foot.z])) @ ahead) > 0.05))[0]
            for idx, kind in ((sole, 'sole'), (band, 'band')):
                if len(idx) < 3:
                    continue
                faces = faces_of(self.body, idx)

                def shape(P, faces=faces, kind=kind):
                    P = P.copy()
                    if kind == 'sole':
                        P[:, 2] = np.minimum(P[:, 2], 0.004)
                    return P + normals(P, faces) * (0.004 if kind == 'sole' else 0.003)
                out.append(make_piece(f'slipper_{kind}_{side}', self.body, self.rig, idx, faces, self.shapes, shape, [[(0.5, 0.5)] * len(f) for f in faces], mat, self.build_keys))
        return join(out, 'shoes_slippers')
