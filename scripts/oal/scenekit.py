# One Africa Life: what the test scenes (scripts/oal/makeStreet.py, makeAirport.py) are built
# from, in Blender. Photo materials from Poly Haven (CC0) tinted and dusted; boxes and meshes;
# Poly Haven models and the frozen people of makeCrowd.py placed as instances (one copy in
# memory, many in the scene); vehicles made here (cars, Monrovia's yellow taxis, kekehs);
# painted signs; the sky, the sun, the cameras.
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art-src', 'one-africa-life')
TEX = os.path.join(ART, 'textures')
MODELS = os.path.join(ART, 'models')
HDRI = os.path.join(ART, 'hdri')
PEOPLE = os.path.expanduser('~/Documents/one-africa-life/people')


def scene():
    return bpy.context.scene


def srgb(h):
    c = [int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# ---- Materials -----------------------------------------------------------------------------


def _mix(nt, a, b, factor=1.0, blend='MIX'):
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = blend
    if isinstance(factor, float):
        m.inputs['Factor'].default_value = factor
    else:
        nt.links.new(factor, m.inputs['Factor'])
    for socket, value in ((m.inputs['A'], a), (m.inputs['B'], b)):
        if isinstance(value, tuple):
            socket.default_value = (*value, 1) if len(value) == 3 else value
        else:
            nt.links.new(value, socket)
    return m.outputs['Result']


def photo(name, stem, scale=1.0, tint=None, tint_amount=0.0, dust=0.0, metallic=0.0, rough_mul=1.0, mul=None, streaks=0.4):
    """A Poly Haven photo material on UVs in metres: optionally painted a colour (the photo's
    light and dark kept), cast darker or redder, with red laterite dust splashed up the bottom
    half metre and rain streaks running down from the top."""
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
        bw = nt.nodes.new('ShaderNodeRGBToBW')
        nt.links.new(colour, bw.inputs['Color'])
        painted = _mix(nt, bw.outputs['Val'], tuple(c * 2.2 for c in tint), 1.0, 'MULTIPLY')
        colour = _mix(nt, colour, painted, tint_amount)
    if dust:
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
        colour = _mix(nt, colour, (0.36, 0.13, 0.06), ramp.outputs['Result'])
    if streaks:
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        stretch = nt.nodes.new('ShaderNodeMapping')
        stretch.inputs['Scale'].default_value = (4.0, 4.0, 0.25)
        nt.links.new(geo.outputs['Position'], stretch.inputs['Vector'])
        streak = nt.nodes.new('ShaderNodeTexNoise')
        streak.inputs['Scale'].default_value = 1.0
        streak.inputs['Detail'].default_value = 4
        nt.links.new(stretch.outputs['Vector'], streak.inputs['Vector'])
        sramp = nt.nodes.new('ShaderNodeMapRange')
        nt.links.new(streak.outputs['Fac'], sramp.inputs['Value'])
        sramp.inputs['From Min'].default_value = 0.45
        sramp.inputs['From Max'].default_value = 0.75
        sramp.inputs['To Min'].default_value = 1.0
        sramp.inputs['To Max'].default_value = 1.0 - streaks
        grey = nt.nodes.new('ShaderNodeCombineXYZ')
        for k in ('X', 'Y', 'Z'):
            nt.links.new(sramp.outputs['Result'], grey.inputs[k])
        colour = _mix(nt, colour, grey.outputs['Vector'], 1.0, 'MULTIPLY')
    if mul is not None:
        colour = _mix(nt, colour, mul, 1.0, 'MULTIPLY')
    nt.links.new(colour, bsdf.inputs['Base Color'])
    rough = tex('rough', False)
    if rough_mul != 1.0:
        r = nt.nodes.new('ShaderNodeMath')
        r.operation = 'MULTIPLY'
        r.inputs[1].default_value = rough_mul
        nt.links.new(rough.outputs['Color'], r.inputs[0])
        nt.links.new(r.outputs['Value'], bsdf.inputs['Roughness'])
    else:
        nt.links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex('nor', False).outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = metallic
    return m


def flat(name, rgb, roughness=0.8, metallic=0.0, emission=0.0, alpha=1.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metallic
    if emission:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emission
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
    return m


# ---- Meshes --------------------------------------------------------------------------------


def new_object(name, bm, mats, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene().collection.objects.link(obj)
    for m in mats:
        obj.data.materials.append(m)
    for p in mesh.polygons:
        p.use_smooth = smooth
    return obj


def box(bm, uv, centre, size, yaw=0.0, mat=0, uv_scale=1.0, pitch=0.0):
    """A box in a bmesh: centre (x, y, z of its bottom), size (along, across, high), turned by yaw."""
    c, s = math.cos(yaw), math.sin(yaw)
    a, b, h = size[0] / 2, size[1] / 2, size[2]
    corners = [(-a, -b), (a, -b), (a, b), (-a, b)]
    lo = [bm.verts.new((centre[0] + x * c - y * s, centre[1] + x * s + y * c, centre[2] + x * math.sin(pitch))) for x, y in corners]
    hi = [bm.verts.new((v.co.x, v.co.y, v.co.z + h)) for v in lo]
    faces = [bm.faces.new(hi), bm.faces.new(list(reversed(lo)))]
    for i in range(4):
        j = (i + 1) % 4
        faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    for f in faces:
        f.material_index = mat
        f.normal_update()
        n = f.normal
        for loop in f.loops:
            p = loop.vert.co
            loop[uv].uv = ((p.x if abs(n.x) < 0.7 else p.y) / uv_scale, (p.z if abs(n.z) < 0.7 else p.y) / uv_scale)
    return faces


def cylinder(bm, centre, radius, depth, axis_yaw=0.0, segments=16, mat=0, lying=False):
    """A cylinder in a bmesh, standing (or lying along yaw, as a wheel's axle runs)."""
    made = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    for v in made['verts']:
        p = v.co.copy()
        if lying:
            # Axis along local Y, then turned by yaw.
            p = Vector((p.x, p.z, p.y))
        c, s = math.cos(axis_yaw), math.sin(axis_yaw)
        v.co = Vector((centre[0] + p.x * c - p.y * s, centre[1] + p.x * s + p.y * c, centre[2] + p.z))
    for f in {f for v in made['verts'] for f in v.link_faces}:
        f.material_index = mat


# ---- Instances: Poly Haven models and people -----------------------------------------------

_library = {}


def _hidden():
    lib = bpy.data.collections.get('library')
    if lib is None:
        lib = bpy.data.collections.new('library')
        scene().collection.children.link(lib)
        bpy.context.view_layer.layer_collection.children['library'].exclude = True
    return lib


def model(name):
    """A Poly Haven model, imported once into a hidden collection."""
    if name in _library:
        return _library[name]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, name, f'{name}.gltf'))
    col = bpy.data.collections.new(f'model_{name}')
    _hidden().children.link(col)
    for o in set(bpy.data.objects) - before:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    _library[name] = col
    return col


def person(name):
    """A frozen person from makeCrowd.py, linked from its file once."""
    key = 'person:' + name
    if key in _library:
        return _library[key]
    with bpy.data.libraries.load(os.path.join(PEOPLE, f'{name}.blend'), link=False) as (src, dst):
        dst.collections = ['person']
    col = dst.collections[0]
    col.name = f'person_{name}'
    _hidden().children.link(col)
    _library[key] = col
    return col


def place(col, at, yaw=0.0, z=0.0, scale=1.0):
    """An instance of a collection at a point on the ground, turned by yaw (radians)."""
    inst = bpy.data.objects.new(col.name, None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = col
    inst.location = (at[0], at[1], z)
    inst.rotation_euler = (0, 0, yaw)
    inst.scale = (scale, scale, scale)
    scene().collection.objects.link(inst)
    return inst


def facing(direction):
    """The yaw that turns a person (who faces -Y) to look along a direction on the ground."""
    return math.atan2(direction[1], direction[0]) + math.pi / 2


# ---- Vehicles ------------------------------------------------------------------------------

_vehicle_mats = {}


def _vm(key, make):
    if key not in _vehicle_mats:
        _vehicle_mats[key] = make()
    return _vehicle_mats[key]


def car(at, yaw, colour, kind='saloon', taxi=False):
    """A car made here: a saloon (the Corolla shape Monrovia's taxis are) or an SUV. The body is a
    side profile pushed across the car's width; on it a glass cabin narrowing toward the roof;
    wheels showing under the body; lights. Liberia drives on the right."""
    paint = _vm(('paint', colour), lambda: flat(f'paint_{colour}', srgb(colour), 0.25, 0.6))
    glass = _vm('glass', lambda: flat('car_glass', (0.02, 0.025, 0.03), 0.05, 0.2))
    tyre = _vm('tyre', lambda: flat('tyre', (0.02, 0.02, 0.02), 0.85))
    hub = _vm('hub', lambda: flat('hub', (0.5, 0.5, 0.52), 0.35, 0.9))
    lamp = _vm('lamp', lambda: flat('lamp', (0.9, 0.9, 0.85), 0.1, 0.0))
    red = _vm('tail', lambda: flat('tail', (0.5, 0.02, 0.02), 0.2))
    black = _vm('trim', lambda: flat('trim', (0.03, 0.03, 0.03), 0.5))
    if kind == 'suv':
        length, width = 4.7, 1.88
        body = [(-2.35, 0.48), (2.35, 0.48), (2.38, 0.85), (2.2, 1.05), (1.4, 1.12), (-2.35, 1.12), (-2.4, 0.85)]
        cabin = ((1.35, -2.3, 1.1), (0.75, -2.25, 1.82))
        axle = (1.45, -1.45, 0.37)
    else:
        length, width = 4.5, 1.74
        body = [(-2.22, 0.42), (2.22, 0.42), (2.28, 0.66), (2.15, 0.8), (1.25, 0.9), (-1.65, 0.93), (-2.2, 0.88), (-2.28, 0.62)]
        cabin = ((1.2, -1.6, 0.9), (0.38, -0.85, 1.44))
        axle = (1.35, -1.32, 0.31)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    left = [bm.verts.new((x, -width / 2, z)) for x, z in body]
    right = [bm.verts.new((x, width / 2, z)) for x, z in body]
    bm.faces.new(left)
    bm.faces.new(list(reversed(right)))
    for i in range(len(body)):
        j = (i + 1) % len(body)
        bm.faces.new((left[i], left[j], right[j], right[i]))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.05, segments=2, affect='EDGES')
    # The cabin: glass sides, windscreen and rear screen, a painted roof.
    (bx0, bx1, bz), (tx0, tx1, tz) = cabin
    bw, tw = width / 2 - 0.05, width / 2 - 0.2
    lo = [bm.verts.new(p) for p in ((bx0, -bw, bz), (bx1, -bw, bz), (bx1, bw, bz), (bx0, bw, bz))]
    hi = [bm.verts.new(p) for p in ((tx0, -tw, tz), (tx1, -tw, tz), (tx1, tw, tz), (tx0, tw, tz))]
    bm.faces.new(hi).material_index = 0
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i])).material_index = 1
    # Pillars between the side windows.
    for x in ((bx0 + bx1) / 2 + 0.1,):
        for side in (-1, 1):
            box(bm, uv, (x, side * ((bw + tw) / 2), bz), (0.08, 0.06, tz - bz), mat=6)
    for wx in axle[:2]:
        for side in (-1, 1):
            cylinder(bm, (wx, side * (width / 2 - 0.08), axle[2]), axle[2], 0.24, 0, 18, mat=2, lying=True)
            cylinder(bm, (wx, side * (width / 2 + 0.02), axle[2]), axle[2] * 0.58, 0.04, 0, 12, mat=3, lying=True)
    for side in (-1, 1):
        box(bm, uv, (length / 2 + 0.02, side * (width / 2 - 0.28), body[2][1] - 0.02), (0.04, 0.34, 0.12), mat=4)
        box(bm, uv, (-length / 2 - 0.03, side * (width / 2 - 0.24), body[-1][1]), (0.04, 0.3, 0.14), mat=5)
    box(bm, uv, (length / 2 + 0.03, 0, body[0][1]), (0.06, width - 0.2, 0.14), mat=6)
    if taxi:
        # Monrovia's taxis: yellow, a little sign on the roof.
        box(bm, uv, ((tx0 + tx1) / 2, 0, tz), (0.55, 0.22, 0.16), mat=4)
    obj = new_object('car', bm, [paint, glass, tyre, hub, lamp, red, black])
    obj.location = (at[0], at[1], 0)
    obj.rotation_euler = (0, 0, yaw)
    return obj


def kekeh(at, yaw, colour='#e8b41c'):
    """A kekeh (a three-wheeled motor taxi): a rounded nose with the front wheel under it, a
    bench for three behind the driver, a canopy roof on thin posts, open sides."""
    paint = _vm(('paint', colour), lambda: flat(f'paint_{colour}', srgb(colour), 0.3, 0.4))
    black = _vm('kekeh_black', lambda: flat('kekeh_black', (0.03, 0.03, 0.03), 0.6))
    tyre = _vm('tyre', lambda: flat('tyre', (0.02, 0.02, 0.02), 0.85))
    canvas = _vm('canvas', lambda: flat('canvas', (0.05, 0.05, 0.05), 0.9))
    glass = _vm('glass', lambda: flat('car_glass', (0.02, 0.025, 0.03), 0.05, 0.2))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    box(bm, uv, (0.0, 0, 0.3), (2.6, 1.3, 0.35), mat=0)                    # the floor pan and sides
    box(bm, uv, (1.05, 0, 0.3), (0.55, 1.1, 0.75), mat=0)                  # the nose
    box(bm, uv, (1.22, 0, 1.05), (0.06, 1.1, 0.6), mat=4)                  # the windscreen
    box(bm, uv, (-0.75, 0, 0.6), (0.9, 1.25, 0.35), mat=1)                 # the back bench
    box(bm, uv, (-1.2, 0, 0.6), (0.12, 1.25, 0.8), mat=1)                  # its back
    box(bm, uv, (0.2, 0, 0.6), (0.4, 0.5, 0.3), mat=1)                     # the driver's seat
    for px, py in ((1.2, 0.55), (1.2, -0.55), (-1.25, 0.6), (-1.25, -0.6)):
        box(bm, uv, (px, py, 0.6), (0.04, 0.04, 1.15), mat=1)
    box(bm, uv, (-0.05, 0, 1.72), (2.7, 1.4, 0.06), mat=3)                 # the canopy
    box(bm, uv, (-1.3, 0, 0.65), (0.04, 1.35, 1.08), mat=3)                # the back of it
    cylinder(bm, (1.05, 0, 0.27), 0.27, 0.14, 0, 16, mat=2, lying=True)
    for side in (-1, 1):
        cylinder(bm, (-0.75, side * 0.62, 0.27), 0.27, 0.16, 0, 16, mat=2, lying=True)
    obj = new_object('kekeh', bm, [paint, black, tyre, canvas, glass])
    obj.location = (at[0], at[1], 0)
    obj.rotation_euler = (0, 0, yaw)
    return obj


# ---- Signs ---------------------------------------------------------------------------------


def text(body, at, yaw, size, colour, z, depth=0.0, align='CENTER'):
    """Painted letters (Blender's own font), standing upright, facing along the yaw's normal."""
    curve = bpy.data.curves.new('sign', 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = align
    curve.align_y = 'CENTER'
    curve.extrude = depth
    obj = bpy.data.objects.new('sign', curve)
    obj.location = (at[0], at[1], z)
    obj.rotation_euler = (math.pi / 2, 0, yaw)
    curve.materials.append(_vm(('ink', colour), lambda: flat(f'ink_{colour}', srgb(colour), 0.7)))
    scene().collection.objects.link(obj)
    return obj


# ---- Palms ---------------------------------------------------------------------------------


def palm(at, rng=random):
    trunk = _vm('trunk', lambda: flat('trunk', (0.20, 0.16, 0.12), 0.9))
    frond = _vm('frond', lambda: flat('frond', (0.10, 0.20, 0.05), 0.7))
    dry = _vm('frond_dry', lambda: flat('frond_dry', (0.32, 0.24, 0.10), 0.8))
    height = rng.uniform(8, 14)
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized() * rng.uniform(0.4, 1.8)
    tip = Vector((at[0] + lean.x, at[1] + lean.y, height))
    bm = bmesh.new()
    rings = []
    for k in range(9):
        t = k / 8
        c = Vector((at[0], at[1], 0)).lerp(tip, t) + Vector((lean.x, lean.y, 0)) * (-0.25 * math.sin(t * math.pi))
        r = 0.2 - 0.06 * t + (0.06 if k == 0 else 0)
        rings.append([bm.verts.new(c + Vector((math.cos(j / 8 * 2 * math.pi) * r, math.sin(j / 8 * 2 * math.pi) * r, 0))) for j in range(8)])
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(8):
            bm.faces.new((r0[j], r0[(j + 1) % 8], r1[(j + 1) % 8], r1[j]))
    for k in range(14):
        ang = k / 14 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        is_dry = k % 5 == 0
        droop = rng.uniform(0.6, 1.1) + (0.8 if is_dry else 0)
        length = rng.uniform(3.5, 4.8)
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
                    bm.faces.new(q).material_index = 2 if is_dry else 1
            prev = p
    return new_object('palm', bm, [trunk, frond, dry])


# ---- Sky, sun, render ----------------------------------------------------------------------


def daylight(sun_elevation=50, sun_heading=235, hdri='kloofendal_48d_partly_cloudy_puresky', sky_strength=0.7, sun_energy=3.6):
    """A real sky photographed (a Poly Haven HDRI, CC0) for the light all round, and the sun."""
    s = scene()
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(HDRI, f'{hdri}.hdr'), check_existing=True)
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Rotation'].default_value = (0, 0, math.radians(sun_heading))
    coords = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(coords.outputs['Generated'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    nt.nodes['Background'].inputs['Strength'].default_value = sky_strength
    s.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = sun_energy
    sun.data.angle = math.radians(1.2)
    sun.data.color = (1.0, 0.95, 0.87)
    sun.rotation_euler = (math.radians(90 - sun_elevation), 0, math.radians(sun_heading))
    s.collection.objects.link(sun)
    return sun


def render_setup(samples=48, width=1280, height=720, exposure=-0.3):
    s = scene()
    s.render.engine = 'BLENDER_EEVEE'
    s.eevee.taa_render_samples = samples
    for attr, value in (('use_shadows', True), ('use_raytracing', True), ('use_gtao', True)):
        try:
            setattr(s.eevee, attr, value)
        except Exception:
            pass
    s.view_settings.view_transform = 'AgX'
    try:
        s.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    s.view_settings.exposure = exposure
    s.render.resolution_x, s.render.resolution_y = width, height
    s.render.image_settings.file_format = 'PNG'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    s.collection.objects.link(cam)
    s.camera = cam
    aim = bpy.data.objects.new('aim', None)
    s.collection.objects.link(aim)
    cam.constraints.new('TRACK_TO').target = aim
    cam.data.clip_end = 2000
    cam.data.clip_start = 0.05
    return cam, aim


def shoot(cam, aim, out, name, at, look, lens=26, cycles=False):
    """A picture from a point toward another. Interiors go through Cycles (EEVEE turns some
    interior views pure white as its samples add up), on the processor, denoised."""
    s = scene()
    cam.location = at
    aim.location = look
    cam.data.lens = lens
    engine = s.render.engine
    if cycles:
        s.render.engine = 'CYCLES'
        s.cycles.device = 'CPU'
        s.cycles.samples = 96
        s.cycles.use_denoising = True
        s.cycles.max_bounces = 6
    s.render.filepath = os.path.join(out, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    s.render.engine = engine
    print('VIEW', name)


# ---- Airports ------------------------------------------------------------------------------


def airliner(centre, yaw, belly='#1c3f8c', cheat='#c8102e'):
    """A narrow-body airliner of the A320's size (37.6 m long, 34 m span, the cabin 3.95 m
    across, its centre 3.9 m above the ground; the front door on the left, 12.5 m behind the
    nose). Its livery is invented (no airline's): white, a coloured cheat line and tail."""
    white = _vm('plane_white', lambda: flat('plane_white', (0.85, 0.86, 0.87), 0.3, 0.1))
    blue = _vm(('plane', belly), lambda: flat(f'plane_{belly}', srgb(belly), 0.35, 0.1))
    red = _vm(('plane', cheat), lambda: flat(f'plane_{cheat}', srgb(cheat), 0.35, 0.1))
    glass = _vm('glass', lambda: flat('car_glass', (0.02, 0.025, 0.03), 0.05, 0.2))
    grey = _vm('plane_grey', lambda: flat('plane_grey', (0.45, 0.46, 0.48), 0.4, 0.7))
    tyre = _vm('tyre', lambda: flat('tyre', (0.02, 0.02, 0.02), 0.85))
    L, R, H = 37.6, 1.98, 3.9
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    # The fuselage: rings along X, the nose rounded, the tail swept up and narrowing.
    rings = []
    stations = [(-L / 2, 0.15, 1.2), (-L / 2 + 2, 0.45, 0.9), (-L / 2 + 5, 0.75, 0.55), (-L / 2 + 9, 0.95, 0.15), (-L / 2 + 12, 1.0, 0.0)]
    stations += [(x, 1.0, 0.0) for x in range(-6, 13, 3)]
    stations += [(L / 2 - 5, 0.97, -0.05), (L / 2 - 3, 0.85, -0.15), (L / 2 - 1.6, 0.66, -0.3), (L / 2 - 0.6, 0.4, -0.45), (L / 2, 0.05, -0.55)]
    for x, scale, lift in stations:
        ring = []
        for j in range(24):
            a = j / 24 * 2 * math.pi
            ring.append(bm.verts.new((x, math.cos(a) * R * scale, H + lift + math.sin(a) * R * scale * 1.04)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(24):
            f = bm.faces.new((r0[j], r0[(j + 1) % 24], r1[(j + 1) % 24], r1[j]))
            zc = sum(v.co.z for v in f.verts) / 4
            f.material_index = 1 if zc < H - R * 0.45 else 0
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    # The cheat line under the windows, the windows, the cockpit, the front door.
    for side in (1, -1):
        y = side * (R + 0.01)
        box(bm, uv, (0.5, y, H + 0.05), (27, 0.03, 0.18), mat=2)
        x = -12.0
        while x < 11.5:
            if abs(x - 12.5 + 1.2) > 1.0 and abs(x + 1.0) > 0.4:
                box(bm, uv, (x, y * 1.002, H + 0.42), (0.24, 0.03, 0.32), mat=3)
            x += 0.53
        box(bm, uv, (L / 2 - 1.75, side * 0.62, H + 0.55), (0.5, 0.42, 0.25), mat=3)
        box(bm, uv, (12.5, y * 1.003, H - 0.7), (0.85, 0.03, 1.85), mat=4)
    # Wings, low on the body, swept back, with winglets; engines under them on pylons.
    for side in (1, -1):
        root = [(4.0, 0.0), (-2.5, 0.0)]
        tip_y, sweep, tip = 17.0, 8.2, 1.6
        z0, z1 = H - 1.3, H - 1.3 + 17 * math.tan(math.radians(5))
        verts = []
        for (xa, _), yy, zz, chord in (((4.0, 0), 1.6, z0, 6.5), ((4.0 - sweep, 0), tip_y, z1, tip)):
            for dx, dz in ((0, 0.25), (-chord, 0.08), (-chord, -0.04), (0, -0.12)):
                verts.append(bm.verts.new((xa + dx, side * yy, zz + dz * (1 if chord > 2 else 0.4))))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((verts[i], verts[j], verts[4 + j], verts[4 + i]))
        bm.faces.new(verts[4:8])
        box(bm, uv, (4.0 - sweep - 0.8, side * tip_y, z1), (1.2, 0.12, 2.3), mat=1)
        ex, ey = 5.2, side * 5.75
        cylinder(bm, (ex, ey, H - 2.15), 1.05, 4.3, math.pi / 2, 20, mat=0, lying=True)
        cylinder(bm, (ex + 2.16, ey, H - 2.15), 0.85, 0.05, math.pi / 2, 20, mat=5, lying=True)
        box(bm, uv, (ex - 0.6, ey, H - 1.6), (2.8, 0.3, 0.6), mat=0)
        # Main gear.
        for wy in (-0.35, 0.35):
            cylinder(bm, (-1.2, side * 3.8 + wy, 0.57), 0.57, 0.36, 0, 16, mat=6, lying=True)
        box(bm, uv, (-1.2, side * 3.8, 0.6), (0.25, 0.25, H - 1.6 - 0.6), mat=5)
    # The nose gear.
    for wy in (-0.2, 0.2):
        cylinder(bm, (12.8, wy, 0.38), 0.38, 0.22, 0, 14, mat=6, lying=True)
    box(bm, uv, (12.8, 0, 0.4), (0.18, 0.18, H - R - 0.4), mat=5)
    # The tail: the fin (in the livery's colour) and the stabilisers.
    fin = [bm.verts.new(p) for p in ((-L / 2 + 6.5, -0.12, H + 1.2), (-L / 2 + 0.6, -0.12, H + 1.2), (-L / 2 - 1.2, -0.12, H + 7.3), (-L / 2 + 1.5, -0.12, H + 7.3))]
    fin2 = [bm.verts.new((v.co.x, 0.12, v.co.z)) for v in fin]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((fin[i], fin[j], fin2[j], fin2[i])).material_index = 1
    bm.faces.new(fin).material_index = 1
    bm.faces.new(list(reversed(fin2))).material_index = 1
    for side in (1, -1):
        st = [bm.verts.new(p) for p in ((-L / 2 + 5.0, side * 0.8, H + 0.6), (-L / 2 + 1.5, side * 0.8, H + 0.6), (-L / 2 - 0.4, side * 6.2, H + 1.0), (-L / 2 + 1.3, side * 6.2, H + 1.0))]
        bm.faces.new(st if side > 0 else list(reversed(st)))
    obj = new_object('airliner', bm, [white, blue, red, glass, grey, grey, tyre])
    obj.location = (centre[0], centre[1], 0)
    obj.rotation_euler = (0, 0, yaw)
    return obj


def liberian_flag(at, yaw, height=8.0, size=1.9):
    """Liberia's flag on a white pole: eleven red and white stripes, a blue square with a white star."""
    import numpy as np
    img = bpy.data.images.get('flag_liberia')
    if img is None:
        W, H = 380, 200
        px = np.ones((H, W, 4), dtype=np.float32)
        red, white, blue = np.array(srgb('#bf0a30')), np.array((0.95, 0.95, 0.95)), np.array(srgb('#002868'))
        for y in range(H):
            px[y, :, :3] = red if int(y / H * 11) % 2 == 0 else white
        c = int(H * 5 / 11)
        px[:c, :c, :3] = blue
        # The star: ten points, out and in, one pointing up (rows run down the picture).
        cx, cy, r = c / 2, c / 2, c * 0.38
        star = [(cx + math.sin(k * math.pi / 5) * (r if k % 2 == 0 else r * 0.382), cy - math.cos(k * math.pi / 5) * (r if k % 2 == 0 else r * 0.382)) for k in range(10)]
        for y in range(c):
            for x in range(c):
                hit = False
                for i in range(10):
                    (x0, y0), (x1, y1) = star[i], star[(i + 1) % 10]
                    if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
                        hit = not hit
                if hit:
                    px[y, x, :3] = white
        img = bpy.data.images.new('flag_liberia', W, H)
        img.pixels.foreach_set(px[::-1].ravel())
        img.pack()
    mat = _vm('flag', lambda: None)
    if mat is None:
        mat = bpy.data.materials.new('flag')
        mat.use_nodes = True
        t = mat.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = img
        mat.node_tree.links.new(t.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
        _vehicle_mats['flag'] = mat
    pole = _vm('pole_white', lambda: flat('pole_white', (0.85, 0.85, 0.85), 0.3, 0.6))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    cylinder(bm, (0, 0, height / 2), 0.05, height, 0, 10, mat=1)
    # The cloth, rippling a little in the wind off the sea.
    cols, rows = 12, 4
    w, h = size, size * 10 / 19
    grid = [[bm.verts.new((0.06 + w * i / cols, 0.12 * math.sin(i / cols * 7.0) * (i / cols), height - 0.1 - h * j / rows)) for j in range(rows + 1)] for i in range(cols + 1)]
    for i in range(cols):
        for j in range(rows):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for loop, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[uv].uv = (a / cols, 1 - b / rows)
    obj = new_object('flag', bm, [mat, pole], smooth=True)
    obj.location = (at[0], at[1], 0)
    obj.rotation_euler = (0, 0, yaw)
    return obj


def beam_seats(at, yaw, seats=5):
    """A row of airport seats on one beam: black seat pans and backs, steel legs and arms."""
    black = _vm('seat_black', lambda: flat('seat_black', (0.03, 0.03, 0.035), 0.45))
    steel = _vm('steel', lambda: flat('steel', (0.6, 0.6, 0.62), 0.3, 1.0))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    width = seats * 0.62
    box(bm, uv, (0, 0, 0.36), (width, 0.12, 0.08), mat=1)
    for k in range(seats):
        x = -width / 2 + 0.31 + k * 0.62
        box(bm, uv, (x, 0.0, 0.44), (0.54, 0.5, 0.06), mat=0, pitch=0)
        box(bm, uv, (x, 0.27, 0.5), (0.54, 0.06, 0.5), mat=0)
    for x in (-width / 2 + 0.2, width / 2 - 0.2):
        for y in (-0.15, 0.15):
            box(bm, uv, (x, y, 0), (0.06, 0.06, 0.36), mat=1)
    for k in range(seats + 1):
        box(bm, uv, (-width / 2 + k * 0.62, 0.0, 0.62), (0.05, 0.42, 0.04), mat=1)
    obj = new_object('seats', bm, [black, steel])
    obj.location = (at[0], at[1], at[2] if len(at) > 2 else 0)
    obj.rotation_euler = (0, 0, yaw)
    return obj
