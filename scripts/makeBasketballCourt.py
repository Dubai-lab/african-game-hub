# Builds the street basketball court for the game, in Blender, without its window:
#
#   blender -b --factory-startup --python scripts/makeBasketballCourt.py -- \
#       art-src/basketball/player1 public/basketball/court.v3.glb art-src/basketball/court-preview.png \
#       art-src/basketball/court/basket_20blend/Basket_2.0.blend
#
# The court itself, its fence and its baskets are a bought model (the last argument; "Street
# Basketball Court", see ASSETS.md), turned and placed on the game's measurements, with the
# fence on the camera's side taken away and its pictures made small enough for a phone. Without
# that argument the court and fence are drawn here instead.
#
# Everything is made here, from code: the textures (worn asphalt and its paint, brick, lit
# windows, chain link, concrete, the mural) and the scene around the court (the fence, the
# bleachers and benches, the buildings, the street lights). The crowd is the player character
# from the folder given (Mixamo downloads, see makeBasketballCharacter.py), copied in different
# poses and frozen into one light mesh, so that it costs a phone almost nothing to draw.
#
# The court's measurements are the game's own (supabase/functions/_shared/basketball.ts): a full
# court 15 m across and 28 m long, the baseline at z = 0, the half-court line at z = 14, the far
# baseline at z = 28. Play is in the near half (street rules); the game's camera stands on the
# open side (+x), so nothing is built there between it and the court. The baskets are not here:
# the game draws them, exactly where its physics has them.
import bpy, bmesh, math, os, random, sys
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
CHARACTER_DIR, OUT_GLB, OUT_PNG = args[0], args[1], args[2]
BOUGHT = args[3] if len(args) > 3 else None
random.seed(7)
rng = np.random.default_rng(7)

HALF_W, DEPTH = 7.5, 14.0
LENGTH = DEPTH * 2
RIM_Z, ARC = 1.575, 6.75

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def P(x, y, z):
    """A point in the game's terms (x across, y up, z out from the baseline) in Blender's (z up)."""
    return (x, -z, y)


# ---- Textures --------------------------------------------------------------------------------

def blur(a, r):
    """A quick box blur, r pixels each way (for soft noise)."""
    for axis in (0, 1):
        c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(a.ndim)], mode='edge'), axis=axis)
        a = (np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis) - np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return a


def noise(h, w, r):
    return blur(rng.random((h, w)), r)


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def image(name, rgba):
    """A Blender image from an array (rows top to bottom, values 0-1), packed into the file."""
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=rgba.shape[2] == 4)
    flat = np.ones((h, w, 4), dtype=np.float32)
    flat[:, :, :rgba.shape[2]] = np.clip(rgba, 0, 1)
    img.pixels.foreach_set(flat[::-1].ravel())
    img.pack()
    return img


def court_texture():
    """The court: asphalt, a blue playing surface, the keys in indigo, worn white lines."""
    scale = 80  # pixels a metre
    W, H = int(17 * scale), int((LENGTH + 2) * scale)
    xs = (np.arange(W) + 0.5) / scale - 8.5
    zs = (np.arange(H) + 0.5) / scale - 1.0
    X, Zfull = np.meshgrid(xs, zs)
    # Each half is drawn the same, measured from its own baseline.
    Z = np.minimum(Zfull, LENGTH - Zfull)
    grain = noise(H, W, 1) * 0.5 + noise(H, W, 6) * 0.5
    wear = noise(H, W, 40)
    img = np.zeros((H, W, 3))
    asphalt = hexrgb('#2b2f3a')
    img[:] = asphalt * (0.8 + grain[..., None] * 0.45)
    inside = (np.abs(X) <= HALF_W) & (Zfull >= 0) & (Zfull <= LENGTH)
    surface = hexrgb('#2e4a7a') * (0.85 + grain[..., None] * 0.3) * (0.85 + wear[..., None] * 0.3)
    img[inside] = surface[inside]
    key = (np.abs(X) <= 2.45) & (Z >= 0) & (Z <= 5.8)
    img[key] = (hexrgb('#1f2a7a') * (0.85 + grain[..., None] * 0.3))[key]
    d_rim = np.hypot(X, Z - RIM_Z)
    beyond = inside & (d_rim > ARC) & ~((np.abs(X) > HALF_W - 0.9) & (Z < RIM_Z + math.sqrt(ARC ** 2 - (HALF_W - 0.9) ** 2)))
    img[beyond] = img[beyond] * 0.82 + hexrgb('#163a5c') * 0.18
    # Lines, 5 cm wide, white, worn away in places.
    t = 0.025
    lines = np.zeros((H, W), bool)
    lines |= inside & ((np.abs(np.abs(X) - HALF_W) < t) | (np.abs(Z) < t) | (np.abs(Zfull - DEPTH) < t))
    lines |= np.abs(np.hypot(X, Zfull - DEPTH) - 1.8) < t
    lines |= (np.abs(np.abs(X) - 2.45) < t) & (Z <= 5.8)
    lines |= (np.abs(Z - 5.8) < t) & (np.abs(X) <= 2.45)
    lines |= np.abs(np.hypot(X, Z - 5.8) - 1.8) < t
    straight = HALF_W - 0.9
    side_end = RIM_Z + math.sqrt(ARC ** 2 - straight ** 2)
    lines |= (np.abs(np.abs(X) - straight) < t) & (Z <= side_end)
    lines |= (np.abs(d_rim - ARC) < t) & (Z >= side_end)
    lines |= (np.abs(d_rim - 1.25) < t) & (Z >= RIM_Z)
    painted = lines & (noise(H, W, 3) > 0.42)
    img[painted] = hexrgb('#e9ecf5') * (0.85 + grain[painted][..., None] * 0.2)
    # Cracks across the asphalt.
    for _ in range(50):
        x, z = random.uniform(-8.5, 8.5), random.uniform(-1, LENGTH + 1)
        a = random.uniform(0, math.pi * 2)
        for _ in range(random.randint(30, 90)):
            a += random.uniform(-0.5, 0.5)
            x += math.cos(a) * 0.03
            z += math.sin(a) * 0.03
            px, pz = int((x + 8.5) * scale), int((z + 1) * scale)
            if 1 <= px < W - 1 and 1 <= pz < H - 1:
                img[pz - 1:pz + 1, px - 1:px + 1] *= 0.55
    return image('court', img)


def tiles_texture(size, colour, joint, tile_px, name, jitter=0.08):
    """Paving or concrete: square slabs, each a little different, with darker joints."""
    h = w = size
    base = hexrgb(colour)
    img = np.zeros((h, w, 3))
    for ty in range(0, h, tile_px):
        for tx in range(0, w, tile_px):
            img[ty:ty + tile_px, tx:tx + tile_px] = base * (1 + random.uniform(-jitter, jitter))
    img *= (0.88 + noise(h, w, 2) * 0.24)[..., None]
    yy, xx = np.mgrid[0:h, 0:w]
    joints = (yy % tile_px < joint) | (xx % tile_px < joint)
    img[joints] *= 0.6
    return image(name, img)


def brick_texture(name, colour):
    h, w = 512, 512
    base = hexrgb(colour)
    img = np.zeros((h, w, 3))
    bh, bw = 16, 48
    for row in range(0, h, bh):
        offset = (row // bh % 2) * bw // 2
        for col in range(-bw, w, bw):
            c = base * (1 + random.uniform(-0.18, 0.12))
            img[row:row + bh, max(0, col + offset):max(0, col + offset + bw)] = c
    img *= (0.85 + noise(h, w, 1) * 0.3)[..., None]
    yy, xx = np.mgrid[0:h, 0:w]
    mortar = (yy % bh < 2) | (((xx + (yy // bh % 2) * bw // 2) % bw) < 2)
    img[mortar] = hexrgb('#8a8378') * 0.7
    return image(name, img)


def windows_texture(name):
    """A facade of windows, some lit warm, most dark: colour, and the glow of the lit ones."""
    h, w = 512, 512
    img = np.zeros((h, w, 3)) + hexrgb('#3b3443')
    glow = np.zeros((h, w, 3))
    for row in range(16, h, 64):
        for col in range(14, w, 64):
            lit = random.random() < 0.38
            colour = hexrgb('#ffd9a0') * random.uniform(0.7, 1) if lit else hexrgb('#1a2238') * random.uniform(0.8, 1.2)
            img[row:row + 40, col:col + 34] = colour
            img[row + 19:row + 21, col:col + 34] *= 0.6
            if lit:
                glow[row:row + 40, col:col + 34] = colour
    img *= (0.9 + noise(h, w, 1) * 0.2)[..., None]
    return image(name, img), image(name + '_glow', glow)


def chain_link():
    """Chain-link fence: diamonds of wire, see-through between."""
    s = 128
    yy, xx = np.mgrid[0:s, 0:s] + 0.5
    u = (xx + yy) % 32
    v = (xx - yy) % 32
    wire = (np.minimum(u, 32 - u) < 1.6) | (np.minimum(v, 32 - v) < 1.6)
    img = np.zeros((s, s, 4))
    img[..., :3] = hexrgb('#b9c0cc')
    img[..., 3] = wire * 0.95
    return image('chainlink', img)


def mural_texture():
    h, w = 512, 1536
    img = np.zeros((h, w, 3)) + hexrgb('#2b2340')
    yy, xx = np.mgrid[0:h, 0:w]
    for colour, cx, cy, r in [('#f5b700', 200, 330, 190), ('#d1264f', 560, 170, 230), ('#0b7a55', 860, 360, 200), ('#4455c7', 1160, 190, 250), ('#f5b700', 1420, 380, 150)]:
        mask = np.hypot(xx - cx, yy - cy) < r
        img[mask] = img[mask] * 0.15 + hexrgb(colour) * 0.85
    for y0 in (70, 440):
        zig = y0 + np.abs(((xx / 40) % 2) - 1) * 26
        img[np.abs(yy - zig) < 6] = hexrgb('#f4f5ff')
    img *= (0.85 + noise(h, w, 2) * 0.25)[..., None]
    return image('mural', img)


# ---- Materials -------------------------------------------------------------------------------

def material(name, colour=None, texture=None, roughness=0.9, metallic=0.0, emission=None, emission_strength=1.0, alpha=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if colour is not None:
        bsdf.inputs['Base Color'].default_value = (*hexrgb(colour) ** 2.2, 1)
    if texture is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = texture
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha == 'texture':
            mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            try:
                mat.surface_render_method = 'DITHERED'
            except Exception:
                pass
            mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else None
    if emission is not None:
        if isinstance(emission, str):
            bsdf.inputs['Emission Color'].default_value = (*hexrgb(emission) ** 2.2, 1)
        else:
            glow = nodes.new('ShaderNodeTexImage')
            glow.image = emission
            mat.node_tree.links.new(glow.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


def uv_scale(obj, su, sv):
    for loop in obj.data.uv_layers.active.data:
        loop.uv = (loop.uv[0] * su, loop.uv[1] * sv)


def plane(name, cx, cz, w, d, y, mat, uv=(1, 1)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=P(cx, y, cz))
    o = bpy.context.object
    o.name = name
    o.scale = (w, d, 1)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    uv_scale(o, *uv)
    return o


def wall(name, x0, z0, x1, z1, height, mat, uv=(1, 1), y0=0.0):
    """A vertical rectangle from (x0, z0) to (x1, z1) on the ground, facing the court."""
    length = math.hypot(x1 - x0, z1 - z0)
    bpy.ops.mesh.primitive_plane_add(size=1, location=P((x0 + x1) / 2, y0 + height / 2, (z0 + z1) / 2))
    o = bpy.context.object
    o.name = name
    o.scale = (length, height, 1)
    # Turned about the wall's own middle (applying the location too would turn it about the world's).
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    angle = math.atan2(-(z1 - z0), x1 - x0)
    o.rotation_euler = (math.radians(90), 0, angle)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    o.data.materials.append(mat)
    uv_scale(o, *uv)
    return o


def box(name, cx, cy, cz, sx, sy, sz, mat, uv=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(cx, cy, cz))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sz, sy)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    if uv:
        uv_scale(o, *uv)
    return o


def cylinder(name, x, z, y0, y1, r, mat, vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=y1 - y0, location=P(x, (y0 + y1) / 2, z))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    return o


def rail(name, x0, z0, x1, z1, y, r, mat):
    length = math.hypot(x1 - x0, z1 - z0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=r, depth=length, location=P((x0 + x1) / 2, y, (z0 + z1) / 2))
    o = bpy.context.object
    o.name = name
    angle = math.atan2(-(z1 - z0), x1 - x0)
    o.rotation_euler = (0, math.radians(90), angle)
    o.data.materials.append(mat)
    return o


# ---- The scene -------------------------------------------------------------------------------

m_court = material('court', texture=court_texture(), roughness=0.95)
m_paving = material('paving', texture=tiles_texture(512, '#7b7b80', 3, 128, 'paving'), roughness=0.95)
m_street = material('street', texture=tiles_texture(512, '#30333b', 0, 512, 'street', 0.02), roughness=0.95)
m_brick = material('brick', texture=brick_texture('brick', '#7a3b2e'), roughness=0.95)
m_brick2 = material('brick2', texture=brick_texture('brick2', '#5e5a63'), roughness=0.95)
win_colour, win_glow = windows_texture('windows')
m_windows = material('windows', texture=win_colour, emission=win_glow, emission_strength=2.2, roughness=0.6)
m_mural = material('mural', texture=mural_texture(), roughness=0.9)
m_fence = material('fence', texture=chain_link(), roughness=0.5, metallic=0.6, alpha='texture')
m_metal = material('metal', colour='#8a909c', roughness=0.4, metallic=0.85)
m_dark_metal = material('dark_metal', colour='#2f3442', roughness=0.5, metallic=0.6)
m_wood = material('bench_wood', colour='#7a5232', roughness=0.8)
m_lamp = material('lamp', colour='#fff4d6', emission='#ffd98a', emission_strength=12, roughness=0.3)
m_concrete = material('concrete', colour='#6e6c70', roughness=0.95)

# ---- The bought court ------------------------------------------------------------------------

def shrink(img, size):
    if img.size[0] > size:
        img.scale(size, size)


def bought_court(path):
    """The bought court, fence and baskets, on the game's measurements."""
    with bpy.data.libraries.load(path) as (src, dst):
        # The nets are the game's own (they move when the ball goes through).
        dst.objects = [n for n in src.objects if n.startswith(('Court', 'Fence', 'HoopFrame', 'HoopPole', 'HoopRing'))]
    objs = [o for o in dst.objects if o is not None]
    for o in objs:
        scene.collection.objects.link(o)
    bpy.context.view_layer.update()
    # Each piece on its own (the fence hangs from the court in the file), where it stands.
    for o in objs:
        if o.parent:
            world = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = world
    bpy.context.view_layer.update()
    # Its court runs along its x, the centre at 0. Turned a quarter, the near basket's rim lands
    # on the game's (1.575 m out from the baseline, at z = 0 here).
    from mathutils import Matrix
    place = Matrix.Translation((0, -13.955, 0)) @ Matrix.Rotation(math.radians(-90), 4, 'Z')
    for o in objs:
        o.matrix_world = place @ o.matrix_world
    bpy.context.view_layer.update()
    # The top of the court at the floor.
    court = next(o for o in objs if o.name.startswith('Court'))
    top = max((court.matrix_world @ v.co).z for v in court.data.vertices)
    for o in objs:
        o.location.z -= top
    bpy.context.view_layer.update()
    # Nothing between the camera (on the +x side) and the court: that side of the fence goes.
    for o in objs:
        if not o.name.startswith('Fence'):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        doomed = [f for f in bm.faces if (o.matrix_world @ f.calc_center_median()).x > HALF_W + 0.8]
        bmesh.ops.delete(bm, geom=doomed, context='FACES')
        bm.to_mesh(o.data)
        bm.free()
    # The rims in fewer pieces: they are small on a phone.
    for o in objs:
        if o.name.startswith('HoopRing'):
            bpy.context.view_layer.objects.active = o
            d = o.modifiers.new('decimate', 'DECIMATE')
            d.ratio = 0.15
            bpy.ops.object.modifier_apply(modifier='decimate')
    court.name = 'court'
    for o in objs:
        for slot in o.material_slots:
            if slot.material and slot.material.name == 'Fence':
                slot.material.name = 'fence'
    # Its materials as the game reads them: the textures on the meshes' own UV maps, the bump map
    # into the normal input (it was wired to the strength), the shading painted into the colour,
    # the pictures small.
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nodes, links = m.node_tree.nodes, m.node_tree.links
        for l in list(links):
            if l.from_node.type == 'ATTRIBUTE':
                links.remove(l)
        for n in nodes:
            if n.type == 'NORMAL_MAP':
                for l in list(n.inputs['Strength'].links):
                    src_socket = l.from_socket
                    links.remove(l)
                    links.new(src_socket, n.inputs['Color'])
                n.inputs['Strength'].default_value = 1.0
                for l in n.inputs['Color'].links:
                    l.from_node.image.colorspace_settings.name = 'Non-Color'
        images = {n.image.name: n for n in nodes if n.type == 'TEX_IMAGE' and n.image}
        base = next((n for n in nodes if n.type == 'TEX_IMAGE' and n.image and 'Diffuse' in n.image.name), None)
        ao = next((n for n in nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('Basket_AO')), None)
        if base and ao:
            shrink(base.image, 2048)
            shrink(ao.image, 2048)
            px = np.empty(2048 * 2048 * 4, dtype=np.float32)
            base.image.pixels.foreach_get(px)
            occ = np.empty_like(px)
            ao.image.pixels.foreach_get(occ)
            px = px.reshape(-1, 4)
            px[:, :3] *= (0.35 + 0.65 * occ.reshape(-1, 4)[:, :1])
            out = bpy.data.images.new('court_colour', 2048, 2048)
            out.pixels.foreach_set(px.ravel())
            out.pack()
            base.image = out
            nodes.remove(ao)
        for n in nodes:
            if n.type == 'TEX_IMAGE' and n.image and n.image is not (base.image if base else None):
                shrink(n.image, 1024)
    for o in objs:
        uv = o.data.uv_layers
        if len(uv) > 1:
            uv.active_index = 0
            uv[0].active_render = True
    return objs


# The ground: the court, paving around it, a street past each end.
if BOUGHT:
    bought_court(BOUGHT)
else:
    plane('court', 0, DEPTH, 17, LENGTH + 2, 0.0, m_court)
plane('paving', 0, DEPTH, 44, LENGTH + 14, -0.006, m_paving, uv=(44 / 2, (LENGTH + 14) / 2))

# A brick wall behind each basket, a mural on the near one, and buildings behind both.
for end, z in ((0, -2.4), (1, LENGTH + 2.4)):
    box(f'end_wall_{end}', 0, 4.5, z, 26, 9, 0.5, m_brick, uv=(8, 3))
    behind = -9 if end == 0 else LENGTH + 9
    face = -4.99 if end == 0 else LENGTH + 4.99
    for i, (cx, w, hgt, mat) in enumerate([(-15, 10, 16, m_brick2), (0, 14, 22, m_brick), (15, 10, 14, m_brick2)]):
        box(f'building_{end}_{i}', cx, hgt / 2, behind, w, hgt, 8, mat, uv=(w / 4, hgt / 4))
        wall(f'facade_{end}_{i}', cx - w / 2 + 0.6, face, cx + w / 2 - 0.6, face, hgt - 10, m_windows, uv=(w / 4, (hgt - 10) / 4), y0=9.5)
wall('mural', -9, -2.14, 9, -2.14, 5.0, m_mural, y0=3.4)
wall('mural_far', 9, LENGTH + 2.14, -9, LENGTH + 2.14, 5.0, m_mural, y0=3.4)

# The far side, the background of the camera's picture: a fence, the bleachers and their crowd,
# street lights, and a long building behind.
FENCE_X = HALF_W + 1.6
x = -FENCE_X
if BOUGHT:
    FENCE_X = HALF_W + 1.45  # the bought court's own fence
else:
  wall('fence', x, -2.1, x, LENGTH + 2.1, 3.6, m_fence, uv=((LENGTH + 4.2) / 1.4, 3.6 / 1.4))
  for i in range(13):
    z = -2.1 + i * ((LENGTH + 4.2) / 12)
    cylinder(f'post_{i}', x, z, 0, 3.7, 0.045, m_dark_metal)
  rail('rail_top', x, -2.1, x, LENGTH + 2.1, 3.65, 0.03, m_dark_metal)
  rail('rail_mid', x, -2.1, x, LENGTH + 2.1, 1.2, 0.025, m_dark_metal)
box('far_building', -24, 8, DEPTH, 8, 16, LENGTH + 10, m_brick, uv=((LENGTH + 10) / 4, 4))
wall('far_facade', -19.99, -4, -19.99, LENGTH + 4, 12, m_windows, uv=((LENGTH + 8) / 4, 3), y0=3)

# Bleachers behind the fence: four steps of aluminium planks on a frame, along the near half
# and a little past it.
BL_X = -FENCE_X - 1.2
BL_Z, BL_LEN = 8.0, 16.0
for step in range(4):
    x = BL_X - step * 0.8
    y = 0.45 + step * 0.45
    box(f'bleacher_seat_{step}', x, y, BL_Z, 0.6, 0.06, BL_LEN, m_metal)
    box(f'bleacher_foot_{step}', x + 0.35, y - 0.3, BL_Z, 0.08, 0.04, BL_LEN, m_metal)
for z in (BL_Z - BL_LEN / 2 + 0.3, BL_Z - 4, BL_Z, BL_Z + 4, BL_Z + BL_LEN / 2 - 0.3):
    for step in range(4):
        cylinder(f'bleacher_leg_{z}_{step}', BL_X - step * 0.8, z, 0, 0.45 + step * 0.45, 0.04, m_dark_metal, 6)

# Street lights along the far side, leaning over the court.
for i, z in enumerate((-0.5, DEPTH / 2, DEPTH + 3, LENGTH + 0.5)):
    lx = -FENCE_X - 0.5
    cylinder(f'lamp_post_{i}', lx, z, 0, 7.2, 0.08, m_dark_metal)
    rail(f'lamp_arm_{i}', lx, z, lx + 1.4, z, 7.2, 0.05, m_dark_metal)
    box(f'lamp_head_{i}', lx + 1.4, 7.1, z, 0.7, 0.12, 0.35, m_lamp)

# ---- The crowd ---------------------------------------------------------------------------------

def imported(path):
    before, acts = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in acts]

objs, acts = imported(os.path.join(CHARACTER_DIR, 'Happy Idle.fbx'))
rig = next(o for o in objs if o.type == 'ARMATURE')
body = next(o for o in objs if o.type == 'MESH')
acts[0].name = 'idle'
for file, name in (('Victory.fbx', 'victory'), ('Defeated.fbx', 'defeated'), ('Dribble.fbx', 'dribble')):
    o2, a2 = imported(os.path.join(CHARACTER_DIR, file))
    if a2:
        a2[0].name = name
        a2[0].use_fake_user = True
    for o in o2:
        bpy.data.objects.remove(o, do_unlink=True)

# Light enough to draw many: a twentieth of the triangles, pictures of 512 pixels.
bpy.context.view_layer.objects.active = body
dec = body.modifiers.new('decimate', 'DECIMATE')
dec.ratio = 0.05
while body.modifiers[0].name != 'decimate':
    bpy.ops.object.modifier_move_up(modifier='decimate')
bpy.ops.object.modifier_apply(modifier='decimate')
for mat in body.data.materials:
    if not mat or not mat.use_nodes:
        continue
    for node in mat.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            node.inputs['Metallic'].default_value = 0
            for link in list(node.inputs['Metallic'].links):
                mat.node_tree.links.remove(link)
            if 'eyelash' not in mat.name.lower():
                for link in list(node.inputs['Alpha'].links):
                    mat.node_tree.links.remove(link)
                node.inputs['Alpha'].default_value = 1
for img in list(bpy.data.images):
    if img.size[0] > 512 and img.filepath and 'fbm' in img.filepath:
        img.scale(512, 512)

POSES = [('idle', 1), ('idle', 30), ('victory', 40), ('victory', 120), ('victory', 200), ('defeated', 60), ('dribble', 10)]

def frozen(pose, frame, at, facing):
    """One spectator: the character in a pose, frozen, standing at `at` (game terms) facing `facing`."""
    action = bpy.data.actions[pose]
    rig.animation_data_create()
    rig.animation_data.action = action
    try:
        rig.animation_data.action_slot = action.slots[0]
    except Exception:
        pass
    scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    mesh.transform(evaluated.matrix_world)
    o = bpy.data.objects.new('spectator', mesh)
    scene.collection.objects.link(o)
    o.location = P(*at)
    # The character faces Blender's -Y (glTF +Z): turned to face the court.
    o.rotation_euler = (0, 0, facing)
    return o

crowd = []
# On the bleachers.
for step in range(4):
    for k in range(9):
        if random.random() < 0.45:
            continue
        z = BL_Z - BL_LEN / 2 + 1 + k * 1.75 + random.uniform(-0.3, 0.3)
        y = 0.45 + step * 0.45 + 0.03
        pose = random.choice(POSES)
        crowd.append(frozen(pose[0], pose[1] + random.randint(0, 8), (BL_X - step * 0.8, y, z), math.radians(-90 + random.uniform(-20, 20))))
# Standing along the fence, past the bleachers.
for k in range(4):
    z = BL_Z + BL_LEN / 2 + 0.8 + k * 1.6 + random.uniform(-0.3, 0.3)
    pose = random.choice(POSES)
    crowd.append(frozen(pose[0], pose[1] + random.randint(0, 8), (-FENCE_X - 0.6 - random.uniform(0, 0.6), 0, z), math.radians(-90 + random.uniform(-25, 25))))
# A few behind the basket.
for k in range(3):
    x = -4 + k * 4 + random.uniform(-0.5, 0.5)
    pose = random.choice(POSES)
    crowd.append(frozen(pose[0], pose[1] + random.randint(0, 8), (x, 0, -1.5 - random.uniform(0, 0.2)), math.radians(random.uniform(-25, 25))))

bpy.data.objects.remove(body, do_unlink=True)
bpy.data.objects.remove(rig, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in crowd:
    o.select_set(True)
bpy.context.view_layer.objects.active = crowd[0]
bpy.ops.object.join()
bpy.context.object.name = 'crowd'
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
print('CROWD', len(crowd), 'spectators,', len(bpy.context.object.data.polygons), 'faces')

bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_image_format='JPEG', export_image_quality=80, export_animations=False, export_lights=False, export_cameras=False, export_apply=True, export_yup=True)
print('GLB', os.path.getsize(OUT_GLB))

# A picture to check by eye, from where the game's camera stands.
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
cam.location = P(12.5, 7.2, 7.5)
cam.data.lens = 22
direction = (lambda a, b: (b[0] - a[0], b[1] - a[1], b[2] - a[2]))(P(12.5, 7.2, 7.5), P(-1, 0.9, 7))
import mathutils
cam.rotation_euler = mathutils.Vector(direction).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(35))
sun.data.energy = 2.5
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.05, 0.06, 0.16)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1280, 640
scene.render.filepath = OUT_PNG
bpy.ops.render.render(write_still=True)
print('PNG', OUT_PNG)
