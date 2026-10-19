# One Africa Life: makes the owner's downloaded models (Fab; cars, a police car, a plane, a rifle;
# palms, trees, tanks, bins, a shed, a market stand, a petrol station) light enough for budget phones: their triangles reduced to a target (Blender's
# decimate, collapsing edges, which keeps the shape), every picture at most 1024 pixels, the
# model stood on the ground at its real size (length in metres), facing +X, and saved as glTF.
#
#   blender -b --factory-startup --python scripts/oal/slimModels.py -- <out dir>
#
# The sources stay in art-src/one-africa-life/{cars,plane,weapons}; the light copies go to
# <out dir>/<name>.glb (then packed by gltfpack where the game uses them).
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

OUT = os.path.expanduser(sys.argv[sys.argv.index('--') + 1])
os.makedirs(OUT, exist_ok=True)
ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art-src', 'one-africa-life')

# name: (source, triangles wanted, real length in metres[, how])
#   how: 'height' (the size given is its height, for plants), 'keep' (the file's own size),
#   tex=(folder, {material: picture prefix}) to wire pictures the file only names, uv=n to draw
#   with the file's n-th texture layout, clip=True for leaves cut out of a picture.
MODELS = {
    'sedan': ('cars/generic_sedan_car.glb', 24000, 4.6),
    'coupe': ('cars/generic_sport_coupe_car.glb', 24000, 4.5),
    'suv': ('cars/nexus_rx.glb', 26000, 4.8),
    'police_car': ('cars/police_car.glb', 28000, 4.9),
    'bus': ('cars/paz_652.glb', 26000, 7.6),
    'toy_bus': ('cars/toy_bus.glb', 20000, 7.6),
    # A four-engined wide-body: at a 747's length its span and height come out right too.
    'airliner': ('plane/2_plane.glb', 60000, 64.0),
    'rifle': ('weapons/AK105fbx.fbx', 4000, 0.82),
    # The street's trees and things (the owner's downloads, 2026-10-19).
    'coconut_palm': ('tree/coconut_tree.glb', 4000, 12.0, {'how': 'height', 'clip': True}),
    'shade_tree': ('tree/realistic_tree.glb', 8000, 10.0, {'how': 'height', 'clip': True}),
    'banana_clump': ('tree/scene.gltf', 6000, 0, {'how': 'keep', 'uv': 1}),
    # A potted palm, about a person's height: indoors (the arrivals halls). Its leaflets are
    # modelled, so its opacity picture is not used.
    'potted_palm': ('tree/Alexandra_Palm_ukgkcilia_Raw_ukgkcilia_VarA_LOD0.fbx', 6000, 1.6,
                    {'how': 'height', 'tex': ('tree', {'': 'Alexandra_Palm_ukgkcilia_Raw_8K_'})}),
    'water_tank': ('water_tank_and_rubbish/water_tank.glb', 2000, 0, {'how': 'keep'}),
    'skip': ('water_tank_and_rubbish/dirty_rusty_skip___low_poly_game_ready.glb', 1000, 3.7),
    'waste_bin': ('water_tank_and_rubbish/waste_bin___low_poly_game_ready.glb', 1000, 1.0, {'how': 'height'}),
    'dumpsters': ('water_tank_and_rubbish/dumpsters_glb.glb', 5000, 0, {'how': 'keep'}),
    'zinc_shed': ('buildings/Building_M.fbx', 6000, 0,
                  {'how': 'keep', 'tex': ('buildings/textures', {'Material.002': 'BuildingM2_', 'Material.003': 'BuildingM1_'})}),
    'wheelbarrow': ('market/TACHKA.fbx', 6000, 1.45, {'tex': ('market', {'': 'tachka_'})}),
    # A photo scan: Blender's decimate tears its picture apart, gltfpack's simplifier (which
    # keeps the picture's seams) takes it to a twentieth first. Still 50,000 triangles (the seams
    # allow no fewer, and gltfpack's aggressive mode tears the picture): pictures only for now.
    'veg_stand': ('market/vegetable_stand.glb', 60000, 0, {'how': 'keep', 'pre': 0.05}),
    'petrol_station': ('buildings/gas_station.fbx', 15000, 20.0),
}
ONLY = os.environ.get('SLIM_ONLY', '').split(',') if os.environ.get('SLIM_ONLY') else None


def police_livery():
    """The downloaded police car is American (black and white, '911'). Ours: the black of the body
    made navy, the white panels kept, so 'POLICE' reads navy on white, as on Liberian and Ghanaian
    police cars; the '911' marks painted out."""
    import numpy as np
    body = bpy.data.materials.get('body')
    tex = next(n for n in body.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.channels >= 3 and n.outputs['Color'].is_linked)
    img = tex.image
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)[::-1].copy()
    # The '911' marks (the picture's rows from the top, at 1024 pixels).
    k = w / 1024
    for (x0, y0, x1, y1) in ((355, 440, 410, 470), (750, 605, 805, 635)):
        px[int(y0 * k):int(y1 * k), int(x0 * k):int(x1 * k), :3] = 0.0
    rgb = px[:, :, :3]
    lum = rgb.mean(axis=2)
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    dark = (lum < 0.1) & (spread < 0.06)
    navy = np.array((0.035, 0.09, 0.3), dtype=np.float32)
    rgb[dark] = navy * (0.8 + lum[dark, None] * 4)
    px[:, :, :3] = rgb
    img.pixels.foreach_set(px[::-1].ravel())
    img.pack()


def wheels_back():
    """The police car's file lost where its rig held the wheels: all four (and their brakes) sit
    at one point inside the body. They go back into the wheel arches, found in the body itself
    (along the car, the body's lowest point near its sides rises where an arch is), each turned
    so its axle runs across the car, standing on the ground."""
    def box_of(objs):
        pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return lo, hi

    parts = [o for o in bpy.data.objects if o.type == 'MESH' and 'Wheel' in o.name]
    body = [o for o in bpy.data.objects if o.type == 'MESH' and o not in parts]
    lo, hi = box_of(body)
    length, half = hi.y - lo.y, (hi.x - lo.x) / 2
    cx = (lo.x + hi.x) / 2
    # The body's lowest point along the car, near its sides, in 60 slices.
    slices = 60
    low = [hi.z] * slices
    for o in body:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            if abs(p.x - cx) > 0.75 * half:
                k = min(slices - 1, int((p.y - lo.y) / length * slices))
                low[k] = min(low[k], p.z)
    floor = sorted(low)[slices // 4]
    arch = [z > floor + 0.12 * (hi.z - lo.z) for z in low]
    # The two longest runs of raised slices, away from the very ends, are the arches.
    runs, start = [], None
    for k, raised in enumerate(arch + [False]):
        if raised and start is None:
            start = k
        if not raised and start is not None:
            if start > 1 and k < slices - 1:
                runs.append((k - start, (start + k) / 2))
            start = None
    centres = sorted(c for _, c in sorted(runs)[-2:])
    ys = [lo.y + (c / slices) * length for c in centres]
    print('ARCHES', [round(y, 2) for y in ys], 'of', round(lo.y, 2), round(hi.y, 2))
    for o in parts:
        wlo, whi = box_of([o])
        size = whi - wlo
        # Turn the wheel so its thin side (the axle) is across the car (X).
        if size.y < size.x and size.y < size.z:
            c = (wlo + whi) / 2
            o.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Translation(-c) @ o.matrix_world
            wlo, whi = box_of([o])
            size = whi - wlo
        front = '.Ft.' in o.name
        left = '.L' in o.name.split('Wheel')[-1]
        y = ys[1] if front else ys[0]
        x = cx + (-1 if left else 1) * (half - size.x / 2 - 0.03 * half)
        z = lo.z + size.z / 2 if 'Brake' not in o.name else None
        here = (wlo + whi) / 2
        target = Vector((x, y, z if z is not None else here.z))
        o.matrix_world = Matrix.Translation(target - here) @ o.matrix_world
    # Brakes inside their wheel.
    for o in parts:
        if 'Brake' not in o.name:
            continue
        twin = next((w for w in parts if 'Brake' not in w.name and w.name.split('Wheel.')[-1] == o.name.split('WheelBrake.')[-1]), None)
        if twin:
            a_lo, a_hi = box_of([twin])
            b_lo, b_hi = box_of([o])
            o.matrix_world = Matrix.Translation((a_lo + a_hi) / 2 - (b_lo + b_hi) / 2) @ o.matrix_world


def wire(folder, prefixes, opacity):
    """Pictures a file only names (Megascans, Substance exports): each material given the
    pictures in folder that start with its prefix ('' = every material), as glTF reads them."""
    names = os.listdir(os.path.join(ART, folder))

    def find(prefix, *kinds):
        for kind in kinds:
            for n in names:
                if n.startswith(prefix) and kind.lower() in n.lower() and 'billboard' not in n.lower():
                    return os.path.join(ART, folder, n)
        return None

    for m in bpy.data.materials:
        prefix = prefixes.get(m.name, prefixes.get(''))
        if prefix is None or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')

        def tex(path, colour=True):
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = bpy.data.images.load(path)
            if not colour:
                t.image.colorspace_settings.name = 'Non-Color'
            return t

        if (path := find(prefix, 'BaseColor', 'Base_Color')):
            nt.links.new(tex(path).outputs['Color'], bsdf.inputs['Base Color'])
        if (path := find(prefix, 'Roughness')):
            nt.links.new(tex(path, False).outputs['Color'], bsdf.inputs['Roughness'])
        if (path := find(prefix, 'Metallic')):
            nt.links.new(tex(path, False).outputs['Color'], bsdf.inputs['Metallic'])
        if (path := find(prefix, 'Normal_OpenGL', 'Normal')):
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(tex(path, False).outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        if opacity and (path := find(prefix, 'Opacity')):
            nt.links.new(tex(path, False).outputs['Color'], bsdf.inputs['Alpha'])


def clip():
    """Leaves cut out of a picture: drawn cut (glTF 'MASK'), never see-through (which phones
    sort badly), through a Round node on the alpha, as the glTF exporter reads it."""
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None or not bsdf.inputs['Alpha'].is_linked:
            continue
        src = bsdf.inputs['Alpha'].links[0].from_socket
        if src.node.type == 'MATH' and src.node.operation == 'ROUND':
            continue
        rnd = nt.nodes.new('ShaderNodeMath')
        rnd.operation = 'ROUND'
        nt.links.new(src, rnd.inputs[0])
        nt.links.new(rnd.outputs['Value'], bsdf.inputs['Alpha'])
        m.surface_render_method = 'DITHERED'


def use_uv(index):
    """Draw with the file's index-th texture layout (the banana plants keep theirs second)."""
    for o in bpy.data.objects:
        if o.type == 'MESH' and len(o.data.uv_layers) > index:
            keep = o.data.uv_layers[index].name
            for u in [u for u in o.data.uv_layers if u.name != keep]:
                o.data.uv_layers.remove(u)
    for m in bpy.data.materials:
        if m.use_nodes:
            for n in [n for n in m.node_tree.nodes if n.type == 'UVMAP']:
                m.node_tree.nodes.remove(n)


def triangles(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')


for name, (source, target, length, *rest) in MODELS.items():
    how = rest[0] if rest else {}
    if ONLY and name not in ONLY:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(ART, source)
    if 'pre' in how:
        import subprocess
        simpler = os.path.join(OUT, f'_{name}_simpler.glb')
        subprocess.run(['npx', 'gltfpack@0.24.0', '-i', path, '-o', simpler, '-si', str(how['pre']), '-kn'], check=True)
        path = simpler
    if source.endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    if 'tex' in how:
        wire(*how['tex'], how.get('clip', False))
    if 'uv' in how:
        use_uv(how['uv'])
    if how.get('clip'):
        clip()
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # Only the texture layout it is drawn with (the others are lightmaps and spares).
    for o in meshes:
        drawn = next((u.name for u in o.data.uv_layers if u.active_render), None)
        for u in [u for u in o.data.uv_layers if u.name != drawn]:
            o.data.uv_layers.remove(u)
    before = triangles(meshes)
    # Everything as one: transforms applied, joined, so one decimation spreads evenly.
    for o in bpy.data.objects:
        o.select_set(o.type == 'MESH')
    bpy.context.view_layer.objects.active = meshes[0]
    # Parts drawn several times from one mesh (four wheels) each get their own copy first, or
    # they cannot be moved into place and joined.
    bpy.ops.object.make_single_user(object=True, obdata=True)
    # Parts hung on a rig's bones (the police car's wheels) keep where the bones hold them: every
    # place worked out, then each part fixed there, before the rig goes.
    bpy.context.view_layer.update()
    placed = {o: o.matrix_world.copy() for o in bpy.data.objects if o.type == 'MESH'}
    for o, m in placed.items():
        o.parent = None
        o.matrix_world = m
    if name == 'police_car':
        wheels_back()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for o in [o for o in bpy.data.objects if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    if before > target:
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = target / before
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Its real size, on the ground, centred, its long side along X (the mesh itself moved, so
    # nothing depends on which objects an operator sees as selected).
    def bounds():
        xs = [v.co for v in obj.data.vertices]
        lo = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
        hi = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
        return lo, hi

    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    lo, hi = bounds()
    if (hi - lo).y > (hi - lo).x:
        obj.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
        lo, hi = bounds()
    s = {'height': lambda: length / (hi - lo).z, 'keep': lambda: 1.0}.get(how.get('how'), lambda: length / (hi - lo).x)()
    centre = (lo + hi) / 2
    obj.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-centre.x, -centre.y, -lo.z))))
    obj.data.update()
    if name == 'police_car':
        police_livery()
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size)
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    out = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='AUTO' if how.get('clip') else 'JPEG', export_image_quality=82, export_apply=True)
    lo, hi = bounds()
    dims = hi - lo
    print(f'SLIM {name}: {before} -> {triangles([obj])} triangles, {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f} m, {os.path.getsize(out) / 1e6:.1f} MB')
    if 'pre' in how:
        os.remove(simpler)
