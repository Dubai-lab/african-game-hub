# One Africa Life: the first two test characters, made with MPFB (the free MakeHuman add-on for
# Blender) and its free CC0 asset packs, to judge the look before anything else is built.
#
#   blender -b --python scripts/oal/makeTestCharacters.py -- <out dir>
#
# (Blender's own preferences, not --factory-startup: MPFB is an add-on installed there.)
# A young Liberian man and woman: African body proportions, MakeHuman's African skins, natural
# hair, everyday clothes, on MPFB's Mixamo skeleton (so Mixamo's movements fit). Each is saved
# as a .blend and photographed from the front, three quarters and the side, lit like a film still.
import importlib
import math
import os
import sys

import bpy

OUT = os.path.expanduser(sys.argv[sys.argv.index('--') + 1])
os.makedirs(OUT, exist_ok=True)
mpfb = importlib.import_module('bl_ext.blender_org.mpfb.services')
HumanService = mpfb.HumanService

PEOPLE = {
    'kollie': {
        'phenotype': {'gender': 1.0, 'age': 0.42, 'muscle': 0.62, 'weight': 0.48, 'proportions': 0.6, 'height': 0.6, 'cupsize': 0.5, 'firmness': 0.5,
                      'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}},
        'skin_mhmat': 'young_african_male/young_african_male.mhmat',
        'hair': 'short01/short01.mhclo',
        'eyebrows': 'eyebrow001/eyebrow001.mhclo',
        'clothes': ['male_casualsuit06/male_casualsuit06.mhclo', 'shoes02/shoes02.mhclo'],
    },
    'musu': {
        'phenotype': {'gender': 0.0, 'age': 0.4, 'muscle': 0.5, 'weight': 0.52, 'proportions': 0.62, 'height': 0.52, 'cupsize': 0.55, 'firmness': 0.6,
                      'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}},
        'skin_mhmat': 'young_african_female/young_african_female.mhmat',
        'hair': 'rehmanpolanski_hair_bun_brown/rehmanpolanski_hair_bun_brown.mhclo',
        'eyebrows': 'eyebrow007/eyebrow007.mhclo',
        'clothes': ['female_elegantsuit01/female_elegantsuit01.mhclo', 'shoes05/shoes05.mhclo'],
    },
}


def make(name, spec):
    bpy.ops.wm.read_homefile(use_empty=True)
    info = HumanService._create_default_human_info_dict()
    info.update({
        'name': name,
        'phenotype': spec['phenotype'],
        'skin_mhmat': spec['skin_mhmat'],
        'skin_material_type': 'ENHANCED_SSS',
        'eyes': 'high-poly/high-poly.mhclo',
        'eyes_material_type': 'PROCEDURAL_EYES',
        'eyebrows': spec['eyebrows'],
        'eyelashes': 'eyelashes02/eyelashes02.mhclo',
        'teeth': 'teeth_base/teeth_base.mhclo',
        'tongue': 'tongue01/tongue01.mhclo',
        'hair': spec['hair'],
        'clothes': spec['clothes'],
        'rig': 'mixamo',
        'alternative_materials': {},
    })
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 1
    basemesh = HumanService.deserialize_from_dict(info, settings)
    # The free hair comes brown or blond: natural black, with a little shine left.
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.name.endswith('.' + spec['hair'].split('/')[0]):
            continue
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            for bsdf in [n for n in nodes if n.type == 'BSDF_PRINCIPLED']:
                socket = bsdf.inputs['Base Color']
                darker = nodes.new('ShaderNodeHueSaturation')
                darker.inputs['Saturation'].default_value = 0.2
                darker.inputs['Value'].default_value = 0.06
                if socket.links:
                    links.new(socket.links[0].from_socket, darker.inputs['Color'])
                else:
                    darker.inputs['Color'].default_value = socket.default_value
                links.new(darker.outputs['Color'], socket)
                bsdf.inputs['Roughness'].default_value = 0.55
                if 'Sheen Weight' in bsdf.inputs:
                    bsdf.inputs['Sheen Weight'].default_value = 0.0
    # Arms down at the sides, as a person stands, instead of the modelling pose: each upper
    # arm pointed down and a little out, the forearm following.
    rig = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if rig:
        from mathutils import Matrix, Vector
        for side in ('L', 'R'):
            bpy.context.view_layer.update()
            pb = rig.pose.bones.get('mixamorig:' + ('LeftArm' if side == 'L' else 'RightArm')) or rig.pose.bones.get(f'upperarm01.{side}')
            if not pb:
                continue
            head = pb.head.copy()
            out = 1 if pb.tail.x > pb.head.x else -1
            turn = (pb.tail - pb.head).normalized().rotation_difference(Vector((0.16 * out, 0.04, -1)).normalized())
            pb.matrix = Matrix.Translation(head) @ turn.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    return basemesh


def photograph(name):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 64
    scene.render.resolution_x, scene.render.resolution_y = 900, 1200
    try:
        scene.render.image_settings.media_type = 'IMAGE'
    except Exception:
        pass
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.09, 0.08, 0.1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    scene.world = world
    # Key, fill and rim, warm and cool, as for a film still.
    for light_name, kind, energy, colour, loc in (
        ('key', 'AREA', 900, (1.0, 0.92, 0.84), (-2.2, -2.6, 2.6)),
        ('fill', 'AREA', 280, (0.82, 0.88, 1.0), (2.6, -2.2, 1.6)),
        ('rim', 'AREA', 700, (1.0, 0.95, 0.9), (0.6, 2.8, 2.4)),
    ):
        light = bpy.data.objects.new(light_name, bpy.data.lights.new(light_name, kind))
        light.data.energy = energy
        light.data.color = colour
        light.data.size = 1.6
        light.location = loc
        scene.collection.objects.link(light)
        track = light.constraints.new('TRACK_TO')
        aim = bpy.data.objects.get('aim') or bpy.data.objects.new('aim', None)
        if aim.name not in scene.collection.objects:
            scene.collection.objects.link(aim)
        aim.location = (0, 0, 1.0)
        track.target = aim
    floor = bpy.data.meshes.new('floor')
    floor.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    floor_object = bpy.data.objects.new('floor', floor)
    scene.collection.objects.link(floor_object)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 70
    target = bpy.data.objects['aim']
    track = cam.constraints.new('TRACK_TO')
    track.target = target
    for view, angle, height, distance, aim_at in (('full', 25, 1.0, 5.2, 0.92), ('portrait', 20, 1.6, 1.5, 1.58), ('side', 90, 1.1, 5.0, 0.92)):
        a = math.radians(angle)
        cam.location = (math.sin(a) * distance, -math.cos(a) * distance, height)
        target.location = (0, 0, aim_at)
        scene.render.filepath = os.path.join(OUT, f'{name}_{view}.png')
        bpy.ops.render.render(write_still=True)


for name, spec in PEOPLE.items():
    make(name, spec)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{name}.blend'))
    photograph(name)
    print('MADE', name)
