# One Africa Life: Monrovia's people, made with MPFB (the free MakeHuman add-on for Blender) and
# its CC0 packs, each one different: four men and four women of different ages, heights and
# builds (slim, muscular, a belly; curvy, big hips and bum, fat and short), faces, skin tones,
# hair and clothes. Where MPFB's packs have nothing Liberian, it is made here, fitted to each
# body from MakeHuman's own fitting shapes (its tights, its skirt, its hair cap): box braids, a
# low cut, a head-tie, an ankara dress, a lappa and top.
#
#   blender -b --python scripts/oal/makePeople.py -- <out dir> [name ...]
#
# Writes <out dir>/<name>.blend for each person, a portrait and a full-length picture of each,
# and everyone side by side (lineup.png).
import addon_utils

addon_utils.enable('bl_ext.blender_org.mpfb', default_set=True)

import importlib  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
import sys  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = os.path.expanduser(args[0])
ONLY = set(args[1:])
os.makedirs(OUT, exist_ok=True)
mpfb = importlib.import_module('bl_ext.blender_org.mpfb.services')
HumanService = mpfb.HumanService

# MakeHuman's age: 0.5 is 25 years, 1.0 is 90 (between, evenly); 0.1875 is 11.
def age(years):
    return 0.1875 + (years - 11) / (25 - 11) * (0.5 - 0.1875) if years < 25 else 0.5 + (years - 25) / (90 - 25) * 0.5


PEOPLE = {
    # A student, twenty: tall and slim, a low cut, a white tee, jeans, trainers.
    'junior': {
        'sex': 'male', 'age': 20, 'height': 0.68, 'weight': 0.32, 'muscle': 0.45, 'proportions': 0.65, 'tone': 0.92,
        'targets': {'neck/measure-neck-height-incr': 0.3, 'torso/measure-shoulder-dist-decr': 0.2},
        'skin': 'young_african_male', 'hair': 'lowcut', 'clothes': ['male_casualsuit06', 'shoes05'],
    },
    # A labourer, thirty-two: strong, shaved head, overalls, boots.
    'boima': {
        'sex': 'male', 'age': 32, 'height': 0.6, 'weight': 0.55, 'muscle': 0.95, 'proportions': 0.6, 'tone': 0.78,
        'targets': {'torso/torso-vshape-incr': 0.6, 'neck/measure-neck-circ-incr': 0.5},
        'skin': 'young_african_male', 'hair': None, 'clothes': ['male_worksuit01', 'shoes03'], 'tint': {'male_worksuit01': (0.09, 0.2, 0.12)},
    },
    # A businessman, fifty: average height, a big belly, greying, a suit.
    'kollie': {
        'sex': 'male', 'age': 50, 'height': 0.48, 'weight': 0.88, 'muscle': 0.42, 'proportions': 0.5, 'tone': 1.05,
        'targets': {'stomach/stomach-pregnant-incr': 0.55, 'neck/neck-double-incr': 0.5, 'torso/measure-waist-circ-incr': 0.4},
        'skin': 'middleage_african_male', 'hair': 'short01', 'hair_colour': (0.012, 0.011, 0.01), 'grey': 0.08,
        'clothes': ['male_elegantsuit01', 'shoes04'],
    },
    # An old man, sixty-eight: short and thin, white hair, a checked shirt, a hat.
    'sumo': {
        'sex': 'male', 'age': 68, 'height': 0.22, 'weight': 0.3, 'muscle': 0.3, 'proportions': 0.45, 'tone': 0.85,
        'targets': {'torso/measure-shoulder-dist-decr': 0.3},
        'skin': 'old_african_male', 'hair': 'short02', 'hair_colour': (0.62, 0.6, 0.58), 'clothes': ['male_casualsuit03', 'shoes01', 'fedora01'],
    },
    # A young woman, twenty-one: tall and slim, long box braids, sportswear.
    'fatu': {
        'sex': 'female', 'age': 21, 'height': 0.68, 'weight': 0.3, 'muscle': 0.5, 'proportions': 0.7, 'tone': 0.8, 'cup': 0.4,
        'targets': {'legs/upperlegs-height-incr': 0.3},
        'skin': 'young_african_female', 'hair': 'braids', 'clothes': ['female_sportsuit01', 'shoes05'],
    },
    # A woman of twenty-nine: curvy, big hips and bum, an afro, an ankara dress.
    'musu': {
        'sex': 'female', 'age': 29, 'height': 0.5, 'weight': 0.62, 'muscle': 0.5, 'proportions': 0.62, 'tone': 1.0, 'cup': 0.65,
        'targets': {'buttocks/buttocks-volume-incr': 1.0, 'hip/hip-scale-horiz-incr': 0.6, 'hip/hip-scale-depth-incr': 0.5, 'torso/measure-waist-circ-decr': 0.35, 'legs/measure-thigh-circ-incr': 0.5},
        'skin': 'young_african_female', 'hair': 'afro01', 'hair_colour': (0.02, 0.018, 0.016), 'afro': 0.05, 'made': ['dress', 'slippers'], 'print': 'ankara', 'clothes': [],
    },
    # A market woman, forty-five: short and big, a lappa and top in one print, a head-tie.
    'korto': {
        'sex': 'female', 'age': 45, 'height': 0.18, 'weight': 1.0, 'muscle': 0.4, 'proportions': 0.45, 'tone': 0.9, 'cup': 0.85,
        'targets': {'stomach/stomach-pregnant-incr': 0.9, 'torso/torso-scale-depth-incr': 0.5, 'hip/hip-scale-depth-incr': 0.6, 'buttocks/buttocks-volume-incr': 1.0, 'hip/hip-scale-horiz-incr': 0.6, 'torso/torso-scale-horiz-incr': 0.35, 'arms/l-upperarm-fat-incr': 0.9, 'arms/r-upperarm-fat-incr': 0.9, 'legs/measure-thigh-circ-incr': 0.6, 'neck/neck-double-incr': 0.6},
        'skin': 'middleage_african_female', 'hair': 'headtie', 'made': ['lappa', 'top', 'slippers'], 'print': 'lappa', 'clothes': [],
    },
    # An old woman, sixty-six: slim, grey hair, a blouse and skirt.
    'yatta': {
        'sex': 'female', 'age': 66, 'height': 0.4, 'weight': 0.4, 'muscle': 0.35, 'proportions': 0.45, 'tone': 0.75, 'cup': 0.45,
        'targets': {'neck/measure-neck-height-decr': 0.2},
        'skin': 'old_african_female', 'hair': 'short04', 'hair_colour': (0.55, 0.54, 0.52), 'clothes': ['female_elegantsuit01'], 'made': ['slippers'],
        'tint': {'female_elegantsuit01': (0.5, 0.34, 0.5)},
    },
}

# Some faces of each: MakeHuman's face targets, a little each way (seeded by the name).
FACE = ['nose/nose-scale-horiz-incr', 'nose/nose-scale-horiz-decr', 'nose/nose-flaring-incr', 'nose/nose-scale-vert-incr', 'nose/nose-scale-vert-decr',
        'mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-upperlip-volume-incr', 'mouth/mouth-scale-horiz-incr', 'mouth/mouth-scale-horiz-decr',
        'chin/chin-width-incr', 'chin/chin-width-decr', 'chin/chin-prominent-incr', 'cheek/l-cheek-bones-incr', 'cheek/r-cheek-bones-incr',
        'forehead/forehead-scale-vert-incr', 'forehead/forehead-scale-vert-decr', 'eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr', 'head/head-round', 'head/head-oval', 'head/head-square']
TARGET_DIR = os.path.join(os.path.dirname(mpfb.__file__), '..', 'data', 'targets')
FACE_PARTS = ['nose', 'mouth', 'chin', 'cheek', 'eyes', 'forehead', 'head', 'ears', 'eyebrows']


def face_targets(rnd, n=14):
    """A face of its own: some of MakeHuman's face targets, each a good way (a feature's two sides
    alike)."""
    names = []
    for part in FACE_PARTS:
        for f in sorted(os.listdir(os.path.join(TARGET_DIR, part))):
            t = f.replace('.target.gz', '').replace('.target', '')
            if t.startswith('r-') or 'trans' in t:
                continue
            names.append(t)
    chosen = {}
    for t in rnd.sample(names, min(n, len(names))):
        # (Of a pair, one end only.)
        stem = t.rsplit('-', 1)[0]
        if any(c.rsplit('-', 1)[0] == stem for c in chosen):
            continue
        chosen[t] = round(rnd.uniform(0.35, 0.9), 2)
    out = []
    for t, v in chosen.items():
        out.append({'target': t, 'value': v})
        if t.startswith('l-'):
            out.append({'target': 'r-' + t[2:], 'value': v})
    return out


def target_exists(t):
    return os.path.exists(os.path.join(TARGET_DIR, t + '.target.gz')) or os.path.exists(os.path.join(TARGET_DIR, t + '.target'))


def find(kind, name, ext):
    for base in (os.path.expanduser('~/.config/blender/5.2/extensions/.user/blender_org/mpfb/data'), os.path.join(os.path.dirname(mpfb.__file__), '..', 'data')):
        p = os.path.join(base, kind, name, f'{name}.{ext}')
        if os.path.exists(p):
            return f'{name}/{name}.{ext}'
    return None


def make(name, spec):
    bpy.ops.wm.read_homefile(use_empty=True)
    rnd = random.Random(name)
    targets = [{'target': t.split('/')[-1], 'value': v} for t, v in spec['targets'].items() if target_exists(t)]
    targets += face_targets(rnd)
    female = spec['sex'] == 'female'
    info = HumanService._create_default_human_info_dict()
    hair = spec['hair'] if spec['hair'] and find('hair', spec['hair'], 'mhclo') else ''
    info.update({
        'name': name,
        'phenotype': {'gender': 0.0 if female else 1.0, 'age': age(spec['age']), 'muscle': spec['muscle'], 'weight': spec['weight'], 'proportions': spec['proportions'],
                      'height': spec['height'], 'cupsize': spec.get('cup', 0.5), 'firmness': 0.5 if spec['age'] < 40 else 0.3,
                      'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}},
        'targets': targets,
        'skin_mhmat': find('skins', spec['skin'], 'mhmat'),
        'skin_material_type': 'ENHANCED_SSS',
        'eyes': 'high-poly/high-poly.mhclo',
        'eyes_material_type': 'PROCEDURAL_EYES',
        'eyebrows': f'eyebrow{rnd.choice(["001", "002", "006", "007", "009", "010"])}/eyebrow{"%s"}.mhclo',
        'eyelashes': 'eyelashes02/eyelashes02.mhclo' if female else 'eyelashes01/eyelashes01.mhclo',
        'teeth': 'teeth_base/teeth_base.mhclo',
        'tongue': 'tongue01/tongue01.mhclo',
        'hair': find('hair', hair, 'mhclo') if hair else '',
        'clothes': [c for c in (find('clothes', c, 'mhclo') for c in spec['clothes']) if c],
        'rig': 'mixamo',
        'alternative_materials': {},
    })
    brow = info['eyebrows'].split('/')[0]
    info['eyebrows'] = f'{brow}/{brow}.mhclo'
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 1
    body = HumanService.deserialize_from_dict(info, settings)
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    skin_tone(spec.get('tone', 1.0))
    brown_eyes(rnd)
    colour_hair('eyebrow', (0.012, 0.01, 0.009), 0.35 if spec['age'] > 60 else 0.0)
    if hair and spec.get('hair_colour'):
        colour_hair(spec['hair'], spec['hair_colour'], spec.get('grey', 0))
    for cloth, rgb in spec.get('tint', {}).items():
        tint(cloth, rgb)
    made = spec.get('made', [])
    pattern = print_material(spec.get('print', 'ankara'), rnd) if set(made) - {'slippers'} else None
    if 'dress' in made:
        garment(body, rig, 'dress', pattern, top=True, skirt='knee', sleeves='short', offset=0.008)
    if 'top' in made:
        garment(body, rig, 'top', pattern, top=True, skirt=None, sleeves='short', offset=0.014, loose=True)
    if 'lappa' in made:
        garment(body, rig, 'lappa', pattern, top=False, skirt='ankle', sleeves=None, offset=0.012)
    if 'slippers' in made:
        slippers(body, rig, rnd)
    if spec.get('afro'):
        bigger_hair(spec['hair'], rig, spec['afro'])
    if spec['hair'] == 'lowcut':
        low_cut(body, rig)
    if spec['hair'] == 'braids':
        braids(body, rig, rnd)
    if spec['hair'] == 'headtie':
        head_tie(body, rig, pattern)
    arms_down(rig)
    return body, rig


# ---- Materials ---------------------------------------------------------------------------------

def skin_tone(value):
    """Lighter or darker (each person's own shade of brown): the skin's picture brightened or deepened."""
    for mat in bpy.data.materials:
        if not mat.use_nodes or 'skin' not in mat.name.lower() and 'body' not in mat.name.lower():
            continue
        tree = mat.node_tree
        for node in list(tree.nodes):
            if node.type == 'TEX_IMAGE' and node.image and 'diffuse' in node.image.name.lower() or (node.type == 'TEX_IMAGE' and node.image and node.label.lower().startswith('diffuse')):
                hsv = tree.nodes.new('ShaderNodeHueSaturation')
                hsv.inputs['Value'].default_value = value
                hsv.inputs['Saturation'].default_value = 0.92
                for link in list(node.outputs['Color'].links):
                    tree.links.new(hsv.outputs['Color'], link.to_socket)
                tree.links.new(node.outputs['Color'], hsv.inputs['Color'])
        # Its pores and fine creases (MakeHuman's skins have none of their own).
        for bsdf in [n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED']:
            if bsdf.inputs['Normal'].links:
                continue
            pores = tree.nodes.new('ShaderNodeTexNoise')
            pores.inputs['Scale'].default_value = 1800
            pores.inputs['Detail'].default_value = 4
            bump = tree.nodes.new('ShaderNodeBump')
            bump.inputs['Strength'].default_value = 0.08
            bump.inputs['Distance'].default_value = 0.0005
            tree.links.new(pores.outputs['Fac'], bump.inputs['Height'])
            tree.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])


def brown_eyes(rnd):
    """Brown eyes (dark, some a little lighter), their whites not pure white."""
    shade = rnd.uniform(0.6, 1.3)
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == 'GROUP' and n.node_tree and n.node_tree.name.startswith('EnhancedEye'):
                n.inputs['IrisMajorColor'].default_value = (0.05 * shade, 0.022 * shade, 0.008 * shade, 1)
                n.inputs['IrisMinorColor'].default_value = (0.1 * shade, 0.045 * shade, 0.015 * shade, 1)
                n.inputs['EyeWhiteColor'].default_value = (0.7, 0.62, 0.56, 1)
                n.inputs['IrisSection4Color'].default_value = (0.03 * shade, 0.014 * shade, 0.006 * shade, 1)
                n.inputs['PupilColor'].default_value = (0.005, 0.004, 0.004, 1)


def colour_hair(hair, rgb, grey=0.0):
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or hair not in obj.name:
            continue
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            tree = mat.node_tree
            for bsdf in [n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED']:
                socket = bsdf.inputs['Base Color']
                mix = tree.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1.0
                mix.inputs[7].default_value = (*rgb, 1)
                src = socket.links[0].from_socket if socket.links else None
                if src:
                    # (The hair's own picture as a pattern of light and dark, in the hair's colour.)
                    bw = tree.nodes.new('ShaderNodeRGBToBW')
                    tree.links.new(src, bw.inputs['Color'])
                    ramp = tree.nodes.new('ShaderNodeMapRange')
                    tree.links.new(bw.outputs['Val'], ramp.inputs['Value'])
                    ramp.inputs['To Min'].default_value = 0.55
                    ramp.inputs['To Max'].default_value = 1.6
                    tree.links.new(ramp.outputs['Result'], mix.inputs[6])
                else:
                    mix.inputs[6].default_value = (1, 1, 1, 1)
                out = mix.outputs[2]
                if grey:
                    g = tree.nodes.new('ShaderNodeMix')
                    g.data_type = 'RGBA'
                    g.inputs['Factor'].default_value = grey
                    tree.links.new(out, g.inputs[6])
                    g.inputs[7].default_value = (0.6, 0.6, 0.6, 1)
                    out = g.outputs[2]
                tree.links.new(out, socket)
                bsdf.inputs['Roughness'].default_value = 0.72
                if 'Specular IOR Level' in bsdf.inputs:
                    bsdf.inputs['Specular IOR Level'].default_value = 0.25
                if 'Sheen Weight' in bsdf.inputs:
                    bsdf.inputs['Sheen Weight'].default_value = 0.0


def tint(cloth, rgb):
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or cloth not in obj.name:
            continue
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            tree = mat.node_tree
            for bsdf in [n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED']:
                socket = bsdf.inputs['Base Color']
                if not socket.links:
                    socket.default_value = (*rgb, 1)
                    continue
                src = socket.links[0].from_socket
                bw = tree.nodes.new('ShaderNodeRGBToBW')
                tree.links.new(src, bw.inputs['Color'])
                mix = tree.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1.0
                ramp = tree.nodes.new('ShaderNodeMapRange')
                tree.links.new(bw.outputs['Val'], ramp.inputs['Value'])
                ramp.inputs['To Min'].default_value = 0.35
                ramp.inputs['To Max'].default_value = 1.15
                tree.links.new(ramp.outputs['Result'], mix.inputs[6])
                mix.inputs[7].default_value = (*rgb, 1)
                tree.links.new(mix.outputs[2], socket)


PALETTES = {
    # Ankara wax prints: bold colours, big shapes (circles, leaves, stripes).
    'ankara': [(0.6, 0.12, 0.01), (0.0, 0.16, 0.2), (0.75, 0.42, 0.0), (0.18, 0.02, 0.14), (0.01, 0.01, 0.01)],
    'lappa': [(0.02, 0.05, 0.28), (0.7, 0.6, 0.45), (0.5, 0.02, 0.03), (0.8, 0.35, 0.0), (0.01, 0.01, 0.015)],
}


def print_material(kind, rnd):
    """A wax print (made, not pictured): circles in rings over leaves and bands, in its palette."""
    pal = PALETTES[kind]
    mat = bpy.data.materials.new(f'print_{kind}')
    mat.use_nodes = True
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.75
    if 'Sheen Weight' in bsdf.inputs:
        bsdf.inputs['Sheen Weight'].default_value = 0.0
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    mapping.inputs['Scale'].default_value = (3.2, 3.2, 3.2) if kind == 'ankara' else (2.4, 2.4, 2.4)
    # Rings: the distance to the nearest of scattered points, banded.
    vor = nodes.new('ShaderNodeTexVoronoi')
    vor.feature = 'F1'
    links.new(mapping.outputs['Vector'], vor.inputs['Vector'])
    vor.inputs['Randomness'].default_value = 0.35
    rings = nodes.new('ShaderNodeMath')
    rings.operation = 'PINGPONG'
    rings.inputs[1].default_value = 0.12
    links.new(vor.outputs['Distance'], rings.inputs[0])
    band = nodes.new('ShaderNodeTexWave')
    band.wave_type = 'BANDS'
    band.inputs['Scale'].default_value = 1.3
    band.inputs['Distortion'].default_value = 4.0
    links.new(mapping.outputs['Vector'], band.inputs['Vector'])
    ramp_a = nodes.new('ShaderNodeValToRGB')
    ramp_a.color_ramp.interpolation = 'CONSTANT'
    els = ramp_a.color_ramp.elements
    els[0].position, els[0].color = 0.0, (*pal[0], 1)
    els[1].position, els[1].color = 0.55, (*pal[1], 1)
    e = els.new(0.3)
    e.color = (*pal[2], 1)
    links.new(band.outputs['Fac'], ramp_a.inputs['Fac'])
    ramp_b = nodes.new('ShaderNodeValToRGB')
    ramp_b.color_ramp.interpolation = 'CONSTANT'
    els = ramp_b.color_ramp.elements
    els[0].position, els[0].color = 0.0, (*pal[3], 1)
    els[1].position, els[1].color = 0.07, (*pal[4], 1)
    links.new(rings.outputs[0], ramp_b.inputs['Fac'])
    # The rings over the bands where the points' circles are.
    inside = nodes.new('ShaderNodeMath')
    inside.operation = 'LESS_THAN'
    inside.inputs[1].default_value = 0.36
    links.new(vor.outputs['Distance'], inside.inputs[0])
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    links.new(inside.outputs[0], mix.inputs['Factor'])
    links.new(ramp_a.outputs['Color'], mix.inputs[6])
    links.new(ramp_b.outputs['Color'], mix.inputs[7])
    links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    # Cloth: a fine weave.
    weave = nodes.new('ShaderNodeTexNoise')
    weave.inputs['Scale'].default_value = 900
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.15
    links.new(weave.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def plain(name, rgb, rough=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return mat


# ---- Fitted from MakeHuman's own fitting shapes ------------------------------------------------

def piece(body, group, name, keep=lambda co, groups: True):
    """A copy of the body's fitting shape (its tights, skirt, hair cap), as shaped for this person,
    weighted to the skeleton as the body is."""
    shown = {m.name: m.show_viewport for m in body.modifiers}
    for m in body.modifiers:
        m.show_viewport = False
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(body.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    for m in body.modifiers:
        m.show_viewport = shown[m.name]
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = body.matrix_world.copy()
    for g in body.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    gi = body.vertex_groups[group].index
    names = [g.name for g in body.vertex_groups]
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.active
    drop = []
    for v in bm.verts:
        w = v[deform].get(gi, 0.0)
        groups = {names[k]: x for k, x in v[deform].items()}
        if w < 0.5 or not keep(v.co, groups):
            drop.append(v)
    bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    if me.shape_keys:
        obj.shape_key_clear()
    return obj


def finish(obj, rig, mat, offset, subdiv=1):
    """Pushed out from the body a little, smooth, on the skeleton."""
    me = obj.data
    me.materials.clear()
    me.materials.append(mat)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    arm = obj.modifiers.new('rig', 'ARMATURE')
    arm.object = rig
    if subdiv:
        sub = obj.modifiers.new('smooth', 'SUBSURF')
        sub.levels = sub.render_levels = subdiv
    sol = obj.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = 0.003
    sol.offset = 1


def bone_z(rig, bone):
    return (rig.matrix_world @ rig.data.bones[bone].head_local).z


def scalp(body, rig, name, lower=0.0):
    """The scalp, cut from the head along a hairline: high at the forehead, down round the ears,
    low at the nape (lower: further down, for a head-tie)."""
    base = bone_z(rig, 'mixamorig:Head')
    top = (rig.matrix_world @ rig.data.bones['mixamorig:Head'].tail_local).z
    h = top - base
    head = rig.matrix_world @ rig.data.bones['mixamorig:Head'].head_local
    mw = body.matrix_world

    def keep(co, groups):
        if groups.get('mixamorig:Head', 0) < 0.6:
            return False
        w = mw @ co
        # Round the head from the front (0) to the back (1).
        a = abs(math.atan2(w.x - head.x, -(w.y - head.y))) / math.pi
        s = a * a * (3 - 2 * a)
        line = base + h * (0.6 - 0.46 * s) - lower * (0.25 + 0.75 * s)
        return w.z > line
    return piece(body, 'body', name, keep)


def garment(body, rig, name, mat, top, skirt, sleeves, offset, loose=False):
    """A dress, a top or a lappa: the body's tights from the chest down (sleeves to the elbow), its
    skirt below (to the knee or the ankle)."""
    waist = bone_z(rig, 'mixamorig:Spine') + 0.02
    neck = bone_z(rig, 'mixamorig:Neck') - 0.035
    hips = bone_z(rig, 'mixamorig:Hips')
    shoulder_x = abs((rig.matrix_world @ rig.data.bones['mixamorig:LeftArm'].head_local).x)
    parts = []
    if top:
        bottom = hips - 0.04 if loose else waist - 0.05
        def keep(co, groups):
            if co.z > neck or co.z < bottom:
                return False
            arm = sum(w for g, w in groups.items() if 'ForeArm' in g or 'Hand' in g)
            if arm > 0.2:
                return False
            return abs(co.x) < shoulder_x + 0.16
        parts.append(piece(body, 'helper-tights', f'{name}_top', keep))
    if skirt:
        parts.append(piece(body, 'helper-skirt', f'{name}_skirt'))
        sk = parts[-1]
        zs = [v.co.z for v in sk.data.vertices]
        z0, z1 = max(zs), min(zs)
        foot = bone_z(rig, 'mixamorig:LeftFoot')
        knee = bone_z(rig, 'mixamorig:LeftLeg')
        want = foot + 0.05 if skirt == 'ankle' else knee - 0.06
        k = (z0 - want) / max(0.01, z0 - z1)
        # Down to its length, flaring a little at the hem.
        cx = sum(v.co.x for v in sk.data.vertices) / len(sk.data.vertices)
        cy = sum(v.co.y for v in sk.data.vertices) / len(sk.data.vertices)
        for v in sk.data.vertices:
            t = (z0 - v.co.z) / max(0.01, z0 - z1)
            v.co.z = z0 - (z0 - v.co.z) * k
            flare = 1 + t * (0.1 if skirt == 'ankle' else 0.18)
            v.co.x = cx + (v.co.x - cx) * flare
            v.co.y = cy + (v.co.y - cy) * flare
        if top and skirt:
            # (The skirt from the waist: the top's lower edge meets it.)
            pass
    for p in parts:
        if p.name.endswith('_top'):
            # Its neckline: a clean scoop, not the cut's steps.
            bm = bmesh.new()
            bm.from_mesh(p.data)
            mw = p.matrix_world
            inv = mw.inverted()
            for v in bm.verts:
                if v.is_boundary and (mw @ v.co).z > neck - 0.05:
                    w = mw @ v.co
                    scoop = 0.04 * max(0.0, 1 - abs(w.x) / 0.12) if w.y < 0 else 0.0
                    w.z = neck - 0.012 - scoop
                    v.co = inv @ w
            bm.to_mesh(p.data)
            bm.free()
        finish(p, rig, mat, offset + (0.006 if p.name.endswith('_skirt') else 0))
    return parts


def low_cut(body, rig):
    """A low cut: the hair cap tight to the scalp, short black hair with the scalp just showing
    through (more at its edges: the hairline, the neck, over the ears)."""
    cap = scalp(body, rig, 'lowcut')
    mat = bpy.data.materials.new('lowcut')
    mat.use_nodes = True
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    b = nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.85
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = 0.15
    zs = [v.co.z for v in cap.data.vertices]
    lo, hi = min(zs), max(zs)
    attr = cap.data.color_attributes.new('edge', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(cap.data.vertices):
        t = max(0.0, min(1.0, (v.co.z - lo) / max(0.01, (hi - lo) * 0.4)))
        attr.data[i].color = (t, t, t, 1)
    col = nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'edge'
    hair = nodes.new('ShaderNodeTexNoise')
    hair.inputs['Scale'].default_value = 1400
    hair.inputs['Detail'].default_value = 2
    # The hair's density: full on top, thinning to the edge.
    dens = nodes.new('ShaderNodeMath')
    dens.operation = 'MULTIPLY_ADD'
    links.new(col.outputs['Color'], dens.inputs[0])
    dens.inputs[1].default_value = 0.35
    dens.inputs[2].default_value = 0.25
    over = nodes.new('ShaderNodeMath')
    over.operation = 'GREATER_THAN'
    links.new(hair.outputs['Fac'], over.inputs[0])
    links.new(dens.outputs[0], over.inputs[1])
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    links.new(over.outputs[0], mix.inputs['Factor'])
    mix.inputs[6].default_value = (0.006, 0.005, 0.005, 1)
    mix.inputs[7].default_value = (0.11, 0.06, 0.04, 1)
    links.new(mix.outputs[2], b.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.12
    links.new(hair.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], b.inputs['Normal'])
    finish(cap, rig, mat, 0.0012, subdiv=1)
    for m in list(cap.modifiers):
        if m.type == 'SOLIDIFY':
            cap.modifiers.remove(m)


def head_frame(body, rig):
    cap = scalp(body, rig, '_probe')
    vs = [cap.matrix_world @ v.co for v in cap.data.vertices]
    bpy.data.objects.remove(cap)
    centre = sum(vs, Vector()) / len(vs)
    top = max(v.z for v in vs)
    return centre, top, vs


def braids(body, rig, rnd):
    """Long box braids: a braided cap, and braids from all over the scalp falling past the shoulders."""
    cap = scalp(body, rig, 'braids_cap')
    dark = plain('braid', (0.012, 0.01, 0.009), 0.72)
    tree = dark.node_tree
    wave = tree.nodes.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = 60
    wave.bands_direction = 'Z'
    bump = tree.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.6
    tree.links.new(wave.outputs['Fac'], bump.inputs['Height'])
    tree.links.new(bump.outputs['Normal'], tree.nodes['Principled BSDF'].inputs['Normal'])
    finish(cap, rig, dark, 0.004)
    centre, top, vs = head_frame(body, rig)
    shoulder = bone_z(rig, 'mixamorig:LeftShoulder')
    head_r = max((Vector((v.x, v.y, 0)) - Vector((centre.x, centre.y, 0))).length for v in vs)
    curve = bpy.data.curves.new('braids', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.005
    curve.bevel_resolution = 1
    curve.resolution_u = 3
    roots = [v for v in vs if v.z > centre.z - 0.03]
    rnd.shuffle(roots)
    made = 0
    for root in roots:
        out = Vector((root.x - centre.x, root.y - centre.y, 0))
        # (Not over the face: the front of the head, below the hairline.)
        if out.length < 1e-4 or (out.normalized().y < -0.55 and root.z < top - 0.05):
            continue
        out.normalize()
        # (From the front of the head: swept to the side and back, off the face.)
        if out.y < 0.1:
            out = Vector((math.copysign(max(abs(out.x), 0.75), out.x or rnd.uniform(-1, 1)), 0.25 + rnd.uniform(0, 0.25), 0)).normalized()
        sway = Vector((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.01, 0.02), 0))
        spline = curve.splines.new('NURBS')
        spline.order_u = 3
        spline.use_endpoint_u = True
        length = rnd.uniform(0.38, 0.5)
        pts = []
        steps = 9
        for i in range(steps + 1):
            t = i / steps
            z = root.z - t * length
            r = head_r + 0.012 + t * 0.06 + (0.05 if z < shoulder + 0.05 else 0)
            side = Vector((centre.x, centre.y, 0)) + out * max(r * (0.92 if z > centre.z else 1.0), (Vector((root.x, root.y, 0)) - Vector((centre.x, centre.y, 0))).length + 0.006)
            # Over the shoulders and down the back, not through them.
            if z < shoulder + 0.02 and out.y < 0.2:
                side += Vector((0, 0.06 * (shoulder + 0.02 - z) / 0.1, 0))
            side += sway * t
            pts.append((side.x if i else root.x, side.y if i else root.y, z if i else root.z))
        spline.points.add(len(pts) - 1)
        for p, c in zip(spline.points, pts):
            p.co = (*c, 1)
        made += 1
        if made > 160:
            break
    obj = bpy.data.objects.new('braids', curve)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    with bpy.context.temp_override(active_object=obj, selected_objects=[obj], selected_editable_objects=[obj], object=obj):
        bpy.ops.object.convert(target='MESH')
    obj = bpy.context.view_layer.objects.active
    obj.data.materials.clear()
    obj.data.materials.append(dark)
    g = obj.vertex_groups.new(name='mixamorig:Head')
    g.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    arm = obj.modifiers.new('rig', 'ARMATURE')
    arm.object = rig
    print('braids', made)


def head_tie(body, rig, mat):
    """A head-tie: wrapped round and up over the head, full at the back, its ends knotted at the front."""
    cap = scalp(body, rig, 'headtie', lower=0.02)
    zs = [v.co.z for v in cap.data.vertices]
    lo, hi = min(zs), max(zs)
    ys = [v.co.y for v in cap.data.vertices]
    back = max(ys)
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    bm.normal_update()
    for v in bm.verts:
        t = (v.co.z - lo) / max(0.01, hi - lo)
        b = max(0.0, (v.co.y - (back - 0.12)) / 0.12)
        v.co += v.normal * (0.014 + 0.03 * t + 0.05 * b * t)
        v.co.z += 0.015 * t
        # Folds wrapped round it.
        v.co += v.normal * 0.006 * math.sin((v.co.z - lo) * 140 + v.co.x * 30)
    bm.to_mesh(cap.data)
    bm.free()
    finish(cap, rig, mat, 0.0, subdiv=2)
    # Its fan: the cloth's ends gathered and standing up over the crown, pleated, curving round.
    centre, top, vs = head_frame(body, rig)
    front = min(v.y for v in vs)
    fan = bmesh.new()
    cols, rows = 40, 10
    grid = []
    for j in range(rows + 1):
        row = []
        for i in range(cols + 1):
            u = i / cols - 0.5
            v = j / rows
            ang = u * 2.2
            r = 0.1 + 0.03 * v
            pleat = 0.012 * math.sin(i * math.pi / 2) * (0.3 + v)
            x = centre.x + math.sin(ang) * (r + pleat)
            y = centre.y + 0.01 + math.cos(ang) * (r + pleat) * 0.55 - 0.03 * v
            z = top - 0.02 + v * 0.13 * (1 - 0.6 * (2 * u) ** 2)
            row.append(fan.verts.new((x, y, z)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            fan.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    fme = bpy.data.meshes.new('headtie_fan')
    fan.to_mesh(fme)
    fan.free()
    fo = bpy.data.objects.new('headtie_fan', fme)
    bpy.context.scene.collection.objects.link(fo)
    fo.vertex_groups.new(name='mixamorig:Head').add(list(range(len(fme.vertices))), 1.0, 'REPLACE')
    finish(fo, rig, mat, 0.0, subdiv=1)
    for i, (rx, ry) in enumerate(((0.5, -0.4), (-0.5, 0.4))):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.035, minor_radius=0.016, location=(centre.x + (0.015 if i else -0.015), front + 0.02, top + 0.01), rotation=(rx + 1.2, ry, 0))
        knot = bpy.context.active_object
        knot.name = f'headtie_knot{i}'
        knot.data.materials.append(mat)
        for p in knot.data.polygons:
            p.use_smooth = True
        g = knot.vertex_groups.new(name='mixamorig:Head')
        g.add(list(range(len(knot.data.vertices))), 1.0, 'REPLACE')
        mw = knot.matrix_world.copy()
        knot.parent = rig
        knot.matrix_world = mw
        a = knot.modifiers.new('rig', 'ARMATURE')
        a.object = rig
    # (No hair under it shows.)


def slippers(body, rig, rnd):
    """Slippers: a sole under each foot and a band over the front of it."""
    mat = plain('slipper', rnd.choice([(0.02, 0.02, 0.02), (0.25, 0.08, 0.04), (0.6, 0.45, 0.1)]), 0.55)
    mw = body.matrix_world
    for side in ('Left', 'Right'):
        foot = rig.matrix_world @ rig.data.bones[f'mixamorig:{side}Foot'].head_local
        toe = rig.matrix_world @ rig.data.bones[f'mixamorig:{side}ToeBase'].head_local
        ahead = (toe - foot)
        ahead.z = 0
        ahead.normalize()

        def on(groups):
            # (Its foot: below the ankle, on its side.)
            return groups.get('body', 0) > 0.5 and sum(w for g, w in groups.items() if side in g and ('Foot' in g or 'Toe' in g or 'Leg' in g)) > 0.3

        def sole(co, groups):
            w = mw @ co
            return on(groups) and w.z < 0.022 and (w.x - foot.x) * (1 if foot.x > 0 else -1) > -0.08

        def band(co, groups):
            w = mw @ co
            return on(groups) and 0.02 < w.z < 0.055 and (w - foot).dot(ahead) > 0.05 and abs(w.x - foot.x) < 0.08

        s = piece(body, 'body', f'slipper_sole_{side}', sole)
        for v in s.data.vertices:
            v.co.z = min(v.co.z, 0.004)
        finish(s, rig, mat, 0.004, subdiv=0)
        for m in s.modifiers:
            if m.type == 'SOLIDIFY':
                m.thickness = 0.012
                m.offset = -1
        b = piece(body, 'body', f'slipper_band_{side}', band)
        finish(b, rig, mat, 0.003, subdiv=1)


def bigger_hair(hair, rig, amount):
    """A fuller afro: the hair pushed out from the head's middle, most at the top and sides."""
    head = rig.matrix_world @ rig.data.bones['mixamorig:Head'].head_local
    top = (rig.matrix_world @ rig.data.bones['mixamorig:Head'].tail_local).z
    centre = Vector((head.x, head.y + 0.01, head.z + (top - head.z) * 0.55))
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or hair not in obj.name:
            continue
        mw = obj.matrix_world
        inv = mw.inverted()
        for v in obj.data.vertices:
            w = mw @ v.co
            d = w - centre
            up = max(0.0, min(1.0, (w.z - head.z) / max(0.01, top - head.z)))
            w = w + d.normalized() * amount * (0.4 + 0.6 * up)
            v.co = inv @ w


def arms_down(rig):
    """Arms down at the sides, as a person stands, instead of the modelling pose."""
    for side in ('Left', 'Right'):
        bpy.context.view_layer.update()
        pb = rig.pose.bones.get(f'mixamorig:{side}Arm')
        if not pb:
            continue
        head = pb.head.copy()
        out = 1 if pb.tail.x > pb.head.x else -1
        turn = (pb.tail - pb.head).normalized().rotation_difference(Vector((0.17 * out, 0.03, -1)).normalized())
        pb.matrix = Matrix.Translation(head) @ turn.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix


# ---- Pictures ------------------------------------------------------------------------------------

def studio(scene):
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 64
    try:
        scene.render.image_settings.media_type = 'IMAGE'
    except Exception:
        pass
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.11, 0.1, 0.12, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
    scene.world = world
    aim = bpy.data.objects.new('aim', None)
    scene.collection.objects.link(aim)
    for light_name, energy, colour, loc in (('key', 1400, (1.0, 0.93, 0.85), (-3, -4, 4)), ('fill', 450, (0.82, 0.88, 1.0), (4, -3.5, 2.2)), ('rim', 900, (1.0, 0.95, 0.9), (1, 4, 3.5))):
        light = bpy.data.objects.new(light_name, bpy.data.lights.new(light_name, 'AREA'))
        light.data.energy = energy
        light.data.color = colour
        light.data.size = 3
        light.location = loc
        scene.collection.objects.link(light)
        light.constraints.new('TRACK_TO').target = aim
    floor = bpy.data.meshes.new('floor')
    floor.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('floor', floor)
    fo.data.materials.append(plain('floor', (0.2, 0.19, 0.2), 0.8))
    scene.collection.objects.link(fo)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.constraints.new('TRACK_TO').target = aim
    return cam, aim


def shoot(scene, cam, aim, path, loc, at, lens, w, h):
    scene.render.resolution_x, scene.render.resolution_y = w, h
    cam.data.lens = lens
    cam.location = loc
    aim.location = at
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


names = [n for n in PEOPLE if not ONLY or n in ONLY]
for name in names:
    body, rig = make(name, PEOPLE[name])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{name}.blend'))
    scene = bpy.context.scene
    cam, aim = studio(scene)
    top = max((o.matrix_world @ Vector(c)).z for o in bpy.data.objects if o.type == 'MESH' and o.name != 'floor' for c in o.bound_box)
    shoot(scene, cam, aim, os.path.join(OUT, f'{name}_full.png'), (1.2, -4.6, 1.0), (0, 0, top * 0.5), 55, 700, 1100)
    shoot(scene, cam, aim, os.path.join(OUT, f'{name}_face.png'), (0.35, -1.25, top - 0.12), (0, 0, top - 0.14), 85, 700, 800)
    print('MADE', name, f'{top:.2f} m')
