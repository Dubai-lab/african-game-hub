# One Africa Life: the people who stand in the test scenes (the Sinkor street, the airport), made
# with MPFB and its CC0 packs, each frozen in a moment of a Mixamo movement (standing, phoning,
# talking, sitting, walking, carrying, typing at a desk). Frozen: the pose is baked into the
# mesh and the skeleton dropped, so a scene can place many cheaply.
#
#   blender -b --python scripts/oal/makeCrowd.py -- <out dir>
#
# (Blender's own preferences, not --factory-startup: MPFB is an add-on installed there.)
# Writes <out dir>/<name>.blend for each person, with the person in a collection named 'person',
# standing on the origin and facing -Y; and a picture of everyone in a row, to check them.
import importlib
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from retargetBasketball import retarget, skeleton, use  # noqa: E402

OUT = os.path.expanduser(sys.argv[sys.argv.index('--') + 1])
os.makedirs(OUT, exist_ok=True)
mpfb = importlib.import_module('bl_ext.blender_org.mpfb.services')
HumanService = mpfb.HumanService
ANIMATIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art-src', 'one-africa-life', 'animations')
MIXAMO = skeleton(lambda t: 'mixamorig:' + t, fps=30)
random.seed(11)


def person(gender, age, skin, hair, clothes, move, frame, weight=0.5, muscle=0.5, height=0.5, dye=None, top=None):
    return {'gender': gender, 'age': age, 'skin': skin, 'hair': hair, 'clothes': clothes, 'move': move, 'frame': frame,
            'weight': weight, 'muscle': muscle, 'height': height, 'dye': dye, 'top': top}


# Ages on MakeHuman's scale: 0.5 is 25 years, 1.0 is 90; 0.42 about 21, 0.62 about 40, 0.75 about 55.
PEOPLE = {
    'man_phone': person(1, 0.5, 'young_african_male', 'short02', ['male_casualsuit02', 'shoes02'], 'Talking On A Cell Phone', 40, 0.45, 0.55, 0.6, top=(0.45, 0.04, 0.05)),
    'man_idle': person(1, 0.62, 'middleage_african_male', 'short04', ['male_casualsuit04', 'shoes01'], 'Standing Idle', 20, 0.62, 0.5, 0.55, top=(0.8, 0.78, 0.74)),
    'man_talk': person(1, 0.45, 'young_african_male', 'afro01', ['male_casualsuit06', 'shoes02'], 'Talking', 30, 0.4, 0.6, 0.62),
    'man_argue': person(1, 0.7, 'middleage_african_male', 'short01', ['male_casualsuit01', 'shoes03'], 'Standing Arguing (1)', 50, 0.66, 0.45, 0.5),
    'man_walk': person(1, 0.48, 'young_african_male', 'short03', ['male_casualsuit03', 'shoes02'], 'Walking', 12, 0.42, 0.62, 0.58),
    'man_carry': person(1, 0.44, 'young_african_male', 'short02', ['male_worksuit01', 'shoes04'], 'Carrying', 20, 0.4, 0.7, 0.55),
    'man_sit': person(1, 0.78, 'old_african_male', 'short04', ['male_casualsuit05', 'shoes01'], 'Sitting Idle (1)', 30, 0.55, 0.4, 0.5),
    'woman_idle': person(0, 0.5, 'young_african_female', 'braid01', ['female_casualsuit01', 'shoes05'], 'Standing Idle', 60, 0.6, 0.45, 0.5, top=(0.75, 0.5, 0.02)),
    'woman_phone': person(0, 0.45, 'young_african_female', 'rehmanpolanski_hair_bun_brown', ['female_casualsuit02', 'shoes06'], 'Talking On A Cell Phone', 20, 0.5, 0.45, 0.55, top=(0.8, 0.8, 0.8)),
    'woman_walk': person(0, 0.55, 'young_african_female', 'afro01', ['female_casualsuit01', 'shoes05'], 'Female Walk', 14, 0.62, 0.45, 0.5, top=(0.05, 0.25, 0.09)),
    'woman_sit': person(0, 0.66, 'middleage_african_female', 'elvs_reverse_french_braid_bun', ['female_casualsuit02', 'shoes06'], 'Sitting Talking', 40, 0.72, 0.4, 0.45, top=(0.6, 0.12, 0.25)),
    'woman_looking': person(0, 0.48, 'young_african_female', 'elvs_double_mh_braid', ['female_sportsuit01', 'shoes03'], 'Looking Around', 50, 0.5, 0.5, 0.55),
    # The immigration officers at the airport: navy uniforms, one at a desk.
    'officer_desk': person(1, 0.6, 'middleage_african_male', 'short01', ['male_elegantsuit01', 'shoes01'], 'Typing', 30, 0.62, 0.55, 0.55, dye=(0.03, 0.05, 0.13)),
    'officer_stand': person(0, 0.55, 'middleage_african_female', 'rehmanpolanski_hair_bun_brown', ['female_elegantsuit01', 'shoes05'], 'Standing Idle', 10, 0.6, 0.5, 0.52, dye=(0.03, 0.05, 0.13)),
}


def make(name, spec):
    bpy.ops.wm.read_homefile(use_empty=True)
    info = HumanService._create_default_human_info_dict()
    hair = f"{spec['hair']}/{spec['hair']}.mhclo"
    info.update({
        'name': name,
        'phenotype': {'gender': float(spec['gender']), 'age': spec['age'], 'muscle': spec['muscle'], 'weight': spec['weight'], 'proportions': 0.6,
                      'height': spec['height'], 'cupsize': 0.5, 'firmness': 0.5, 'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}},
        'skin_mhmat': f"{spec['skin']}/{spec['skin']}.mhmat",
        'skin_material_type': 'ENHANCED_SSS',
        'eyes': 'high-poly/high-poly.mhclo',
        'eyes_material_type': 'PROCEDURAL_EYES',
        'eyebrows': 'eyebrow001/eyebrow001.mhclo' if spec['gender'] else 'eyebrow007/eyebrow007.mhclo',
        'eyelashes': 'eyelashes02/eyelashes02.mhclo',
        'teeth': 'teeth_base/teeth_base.mhclo',
        'tongue': 'tongue01/tongue01.mhclo',
        'hair': hair,
        'clothes': [f'{c}/{c}.mhclo' for c in spec['clothes']],
        'rig': 'mixamo',
        'alternative_materials': {},
    })
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 0
    HumanService.deserialize_from_dict(info, settings)

    def recolour(obj, change):
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            for bsdf in [n for n in nodes if n.type == 'BSDF_PRINCIPLED']:
                socket = bsdf.inputs['Base Color']
                hsv = nodes.new('ShaderNodeHueSaturation')
                change(hsv, bsdf)
                if socket.links:
                    links.new(socket.links[0].from_socket, hsv.inputs['Color'])
                else:
                    hsv.inputs['Color'].default_value = socket.default_value
                links.new(hsv.outputs['Color'], socket)

    def black_hair(hsv, bsdf):
        hsv.inputs['Saturation'].default_value = 0.2
        hsv.inputs['Value'].default_value = 0.06
        bsdf.inputs['Roughness'].default_value = 0.55
        if 'Sheen Weight' in bsdf.inputs:
            bsdf.inputs['Sheen Weight'].default_value = 0.0

    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        if obj.name.endswith('.' + spec['hair']):
            recolour(obj, black_hair)
        elif spec['dye'] and any(obj.name.endswith('.' + c) for c in spec['clothes'] if not c.startswith('shoes')):
            # A uniform: the clothes' folds and seams kept, the colour made navy.
            def navy(hsv, bsdf, colour=spec['dye']):
                hsv.inputs['Saturation'].default_value = 0.0
                hsv.inputs['Value'].default_value = 0.9
                mul = bsdf.id_data.nodes.new('ShaderNodeMix')
                mul.data_type = 'RGBA'
                mul.blend_type = 'MULTIPLY'
                mul.inputs['Factor'].default_value = 1.0
                mul.inputs['B'].default_value = (*[c * 1.4 for c in colour], 1)
                bsdf.id_data.links.new(hsv.outputs['Color'], mul.inputs['A'])
                bsdf.id_data.links.new(mul.outputs['Result'], bsdf.inputs['Base Color'])
            for mat in obj.data.materials:
                if not mat or not mat.use_nodes:
                    continue
                for bsdf in [n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']:
                    socket = bsdf.inputs['Base Color']
                    hsv = mat.node_tree.nodes.new('ShaderNodeHueSaturation')
                    if socket.links:
                        mat.node_tree.links.new(socket.links[0].from_socket, hsv.inputs['Color'])
                    else:
                        hsv.inputs['Color'].default_value = socket.default_value
                    navy(hsv, bsdf)

    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    action = retarget(os.path.join(ANIMATIONS, spec['move'] + '.fbx'), rig, spec['move'], prefix='mixamorig:', recorded=MIXAMO, travel=False, at_rest=())
    use(rig, action)
    bpy.context.scene.frame_set(min(spec['frame'], int(action.frame_range[1])))
    bpy.context.view_layer.update()

    if spec['top']:
        # A plain T-shirt in its own colour, over the free one's blue and its MakeHuman logo: the
        # cloth's colour above the hips replaced (the jeans below keep theirs), its folds kept.
        hips = (rig.matrix_world @ rig.pose.bones['mixamorig:Hips'].head).z - 0.05
        for obj in bpy.data.objects:
            if obj.type != 'MESH' or not any(obj.name.endswith('.' + c) for c in spec['clothes'] if not c.startswith('shoes')):
                continue
            for mat in obj.data.materials:
                nodes, links = mat.node_tree.nodes, mat.node_tree.links
                for bsdf in [n for n in nodes if n.type == 'BSDF_PRINCIPLED']:
                    socket = bsdf.inputs['Base Color']
                    coords = nodes.new('ShaderNodeTexCoord')
                    sep = nodes.new('ShaderNodeSeparateXYZ')
                    links.new(coords.outputs['Object'], sep.inputs['Vector'])
                    above = nodes.new('ShaderNodeMath')
                    above.operation = 'GREATER_THAN'
                    above.inputs[1].default_value = hips
                    links.new(sep.outputs['Z'], above.inputs[0])
                    mix = nodes.new('ShaderNodeMix')
                    mix.data_type = 'RGBA'
                    links.new(above.outputs['Value'], mix.inputs['Factor'])
                    if socket.links:
                        links.new(socket.links[0].from_socket, mix.inputs['A'])
                    else:
                        mix.inputs['A'].default_value = socket.default_value
                    mix.inputs['B'].default_value = (*spec['top'], 1)
                    links.new(mix.outputs['Result'], socket)

    # Frozen: every mesh replaced by itself as posed now; the skeleton and helpers gone.
    dg = bpy.context.evaluated_depsgraph_get()
    collection = bpy.data.collections.new('person')
    bpy.context.scene.collection.children.link(collection)
    frozen = []
    for obj in [o for o in bpy.data.objects if o.type == 'MESH' and o.visible_get()]:
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
        if not len(mesh.polygons):
            continue
        copy = bpy.data.objects.new(f'{name}.{obj.name.split(".")[-1]}', mesh)
        copy.matrix_world = obj.matrix_world.copy()
        collection.objects.link(copy)
        frozen.append(copy)
    for obj in [o for o in bpy.data.objects if o not in frozen]:
        bpy.data.objects.remove(obj)
    # Feet on the ground: the lowest point at zero (sitting people keep their own height: a seat).
    low = min((o.matrix_world @ v.co).z for o in frozen for v in o.data.vertices)
    if 'Sitting' not in spec['move'] and spec['move'] != 'Typing':
        for o in frozen:
            o.location.z -= low
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{name}.blend'))
    print('MADE', name, len(frozen), 'parts', round(sum(len(o.data.polygons) for o in frozen) / 1000), 'k faces')


for name, spec in PEOPLE.items():
    make(name, spec)

# Everyone in a row, to check.
bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
for i, name in enumerate(PEOPLE):
    with bpy.data.libraries.load(os.path.join(OUT, f'{name}.blend')) as (src, dst):
        dst.collections = ['person']
    col = dst.collections[0]
    inst = bpy.data.objects.new(name, None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = col
    inst.location = (i * 0.9 - len(PEOPLE) * 0.45, 0, 0)
    scene.collection.objects.link(inst)
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
scene.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.location = (0, -15, 1.4)
cam.rotation_euler = (math.radians(88), 0, 0)
cam.data.lens = 40
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1800, 500
scene.view_settings.view_transform = 'AgX'
scene.render.filepath = os.path.join(OUT, 'everyone.png')
bpy.ops.render.render(write_still=True)
