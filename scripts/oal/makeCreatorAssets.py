# One Africa Life: the character creator's files, one per sex, made with MPFB (the free
# MakeHuman add-on for Blender) and its CC0 packs.
#
#   blender -b --python scripts/oal/makeCreatorAssets.py -- <male|female> art-src/one-africa-life/creator-<sex>.glb (then packed into public/oal/creator-<sex>.v3.glb)
#
# (Blender's own preferences, not --factory-startup: MPFB is an add-on installed there.)
#
# One GLB holds everything the creator offers for that sex, on MPFB's Mixamo skeleton:
#   * the body, with a morph for each slider: build (weight, muscle) and face (nose,
#     lips, jaw, ...), each as a "min" and a "max" morph from the average. They are measured on
#     MPFB: the average character is made, then the same character at each end of each slider,
#     and the difference is the morph. Face morphs are MPFB's own targets (MakeHuman's).
#   * every outfit and hairstyle in the catalogue (supabase/functions/_shared/oal.ts), each a
#     mesh named outfit_<id> or hair_<id>, with the build morphs too, so they follow the body;
#     and the eyes, eyebrows and eyelashes, which follow the face as well.
#   * for each outfit, a mark on each point of the body it hides (a channel of the body's
#     vertex colour, in the catalogue's order): the app hides what is under the clothes, so skin
#     never pokes through.
#   * a standing idle movement from Mixamo, for the creator to show the character breathing.
# Skin tone, eye colour and hair colour are the app's to set (it tints the pictures).
import importlib
import math
import os
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from retargetBasketball import retarget, skeleton, use  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
SEX, OUT = args[0], args[1]
mpfb = importlib.import_module('bl_ext.blender_org.mpfb.services')
HumanService, TargetService, ClothesService = mpfb.HumanService, mpfb.TargetService, mpfb.ClothesService
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
ANIMATIONS = os.path.join(ROOT, 'art-src', 'one-africa-life', 'animations')

# The average character of each sex: African, a young adult.
PHENOTYPE = {
    'male': {'gender': 1.0, 'age': 0.42, 'muscle': 0.5, 'weight': 0.5, 'proportions': 0.6, 'height': 0.55, 'cupsize': 0.5, 'firmness': 0.5},
    'female': {'gender': 0.0, 'age': 0.4, 'muscle': 0.5, 'weight': 0.5, 'proportions': 0.62, 'height': 0.5, 'cupsize': 0.55, 'firmness': 0.6},
}[SEX]
SKIN = {'male': 'young_african_male/young_african_male.mhmat', 'female': 'young_african_female/young_african_female.mhmat'}[SEX]
# How far each build slider goes, as MPFB macro values either side of the average.
# (Height is not a morph: MakeHuman's height changes the whole build with it. The app makes a
# taller or shorter person by scaling them evenly, as people really differ.)
BUILD = {'weight': (0.0, 1.0), 'muscle': (0.0, 1.0)}
# Each face slider: MakeHuman's targets at its "min" and "max" ends (both sides for paired features).
FACE = {
    'noseWidth': (['nose/nose-scale-horiz-decr'], ['nose/nose-scale-horiz-incr']),
    'noseLength': (['nose/nose-scale-vert-decr'], ['nose/nose-scale-vert-incr']),
    'lips': (['mouth/mouth-lowerlip-volume-decr', 'mouth/mouth-upperlip-volume-decr'], ['mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-upperlip-volume-incr']),
    'mouthWidth': (['mouth/mouth-scale-horiz-decr'], ['mouth/mouth-scale-horiz-incr']),
    'jaw': (['chin/chin-width-decr'], ['chin/chin-width-incr']),
    'chin': (['chin/chin-prominent-decr'], ['chin/chin-prominent-incr']),
    'cheekbones': (['cheek/l-cheek-bones-decr', 'cheek/r-cheek-bones-decr'], ['cheek/l-cheek-bones-incr', 'cheek/r-cheek-bones-incr']),
    'eyes': (['eyes/l-eye-scale-decr', 'eyes/r-eye-scale-decr'], ['eyes/l-eye-scale-incr', 'eyes/r-eye-scale-incr']),
}
# The catalogue's choices as MPFB assets (ids as in supabase/functions/_shared/oal.ts).
HAIR = {
    'male': {'lowcut': 'short01/short01.mhclo', 'short': 'short04/short04.mhclo', 'afro': 'afro01/afro01.mhclo'},
    'female': {'bun': 'rehmanpolanski_hair_bun_brown/rehmanpolanski_hair_bun_brown.mhclo', 'afro': 'afro01/afro01.mhclo', 'braids': 'elvs_double_mh_braid/elvs_double_mh_braid.mhclo', 'short': 'short02/short02.mhclo'},
}[SEX]
OUTFITS = {
    'male': {'tee_jeans': ['male_casualsuit06', 'shoes02'], 'shirt_jeans': ['male_casualsuit01', 'shoes02'], 'jacket_jeans': ['male_casualsuit05', 'shoes02'], 'suit': ['male_elegantsuit01', 'shoes01']},
    'female': {'blouse_skirt': ['female_elegantsuit01', 'shoes05'], 'tee_jeans': ['female_casualsuit01', 'shoes05'], 'tee_shorts': ['female_casualsuit02', 'shoes05'], 'sport': ['female_sportsuit01', 'shoes03']},
}[SEX]
PARTS = {'eyes': 'high-poly/high-poly.mhclo', 'eyebrows': {'male': 'eyebrow001/eyebrow001.mhclo', 'female': 'eyebrow007/eyebrow007.mhclo'}[SEX], 'eyelashes': 'eyelashes02/eyelashes02.mhclo'}


def human(phenotype, with_parts=False):
    """A new MPFB human in the scene; returns its body."""
    info = HumanService._create_default_human_info_dict()
    info.update({'name': SEX, 'phenotype': {**phenotype, 'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}}, 'alternative_materials': {}})
    if with_parts:
        info.update({'skin_mhmat': SKIN, 'skin_material_type': 'MAKESKIN', 'eyes_material_type': 'MAKESKIN', 'rig': 'mixamo', **PARTS})
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 0
    return HumanService.deserialize_from_dict(info, settings)


def shape_of(body):
    """The body's vertex positions with its shape keys mixed in, before any modifier."""
    shown = [(m, m.show_viewport) for m in body.modifiers]
    for m, _ in shown:
        m.show_viewport = False
    bpy.context.view_layer.update()
    mesh = body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', co)
    body.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    for m, was in shown:
        m.show_viewport = was
    return co.reshape(-1, 3)


def remove(obj):
    for child in list(obj.children):
        remove(child)
    bpy.data.objects.remove(obj, do_unlink=True)


bpy.ops.wm.read_homefile(use_empty=True)

# 1. The shapes: the average character, then each build slider's two ends.
shapes = {}
for name, (low, high) in BUILD.items():
    for end, value in (('min', low), ('max', high)):
        body = human({**PHENOTYPE, name: value})
        shapes[f'build_{name}_{end}'] = shape_of(body)
        remove(body.parent if body.parent else body)
        print('SHAPE', name, end)

# 2. The character itself, average, with its rig, skin, eyes, brows and lashes.
body = human(PHENOTYPE, with_parts=True)
rig = body.parent
average = shape_of(body)
for name, (low, high) in FACE.items():
    for end, targets in (('min', low), ('max', high)):
        keys = []
        for target in targets:
            path = os.path.join(TargetService.target_full_path(target.split('/')[-1]) or '')
            keys.append(TargetService.load_target(body, path, weight=1.0, name=f'tmp_{len(keys)}'))
        shapes[f'face_{name}_{end}'] = shape_of(body)
        for key in keys:
            body.shape_key_remove(key)
    print('FACE', name)

# 3. Every outfit and hairstyle, fitted to the average body.
attachments = {}
for hair_id, asset in HAIR.items():
    before = set(bpy.data.objects)
    HumanService.add_mhclo_asset(mpfb.AssetService.find_asset_absolute_path(asset, asset_subdir='hair'), body, asset_type='hair', subdiv_levels=0, material_type='MAKESKIN')
    for o in set(bpy.data.objects) - before:
        attachments.setdefault(f'hair_{hair_id}', []).append(o)
shoes_loaded = {}
for outfit_id, assets in OUTFITS.items():
    for asset in assets:
        if asset.startswith('shoes') and asset in shoes_loaded:
            continue
        before = set(bpy.data.objects)
        HumanService.add_mhclo_asset(mpfb.AssetService.find_asset_absolute_path(f'{asset}/{asset}.mhclo', asset_subdir='clothes'), body, asset_type='clothes', subdiv_levels=0, material_type='MAKESKIN')
        for o in set(bpy.data.objects) - before:
            if asset.startswith('shoes'):
                shoes_loaded[asset] = o
                attachments.setdefault(f'shoes_{asset}', []).append(o)
            else:
                attachments.setdefault(f'outfit_{outfit_id}', []).append(o)
print('ATTACHED', {k: [o.name for o in v] for k, v in attachments.items()})

# 4. The body's own shape made the average one, with the sliders as morphs.
TargetService.bake_targets(body)
if body.data.shape_keys:
    body.shape_key_clear()
body.data.vertices.foreach_set('co', average.ravel())
body.shape_key_add(name='Basis')
for name, co in shapes.items():
    key = body.shape_key_add(name=name, from_mix=False)
    key.data.foreach_set('co', co.ravel())
body.data.update()

# 5. Everything worn follows the body: the same morphs, by MakeHuman's own fitting (each point
# of a garment sits on the body's surface where it was made to): the body set to each end of
# each slider, every garment fitted to it there, and the garment's shape kept as its morph.
worn = [o for objs in attachments.values() for o in objs]
parts = [o for o in bpy.data.objects if o.type == 'MESH' and o is not body and o not in worn]
followers = worn + parts
for obj in followers:
    for m in list(obj.modifiers):
        if m.type == 'SUBSURF':
            obj.modifiers.remove(m)


def fitted(obj):
    ClothesService.fit_clothes_to_human(obj, body, set_parent=False)
    co = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get('co', co)
    return co


captured = {obj.name: {} for obj in followers}
for key in body.data.shape_keys.key_blocks[1:]:
    key.value = 1.0
    bpy.context.view_layer.update()
    for obj in followers:
        # The face's morphs move only what sits on the face.
        if key.name.startswith('face_') and obj not in parts:
            continue
        captured[obj.name][key.name] = fitted(obj)
    key.value = 0.0
bpy.context.view_layer.update()
for obj in followers:
    base = fitted(obj)
    if captured[obj.name]:
        obj.shape_key_add(name='Basis').data.foreach_set('co', base)
        for name, co in captured[obj.name].items():
            obj.shape_key_add(name=name, from_mix=False).data.foreach_set('co', co)
print('FITTED', len(followers), 'pieces')

# 6. Where each outfit covers the body: a mark on each point of the body it hides, one mark per
# outfit (shoes leave the body alone; they fit close and hide too much of the legs). The app
# hides the triangles an outfit covers completely, so skin never pokes through the clothes.
# The marks are the four channels of the body's vertex colour (red for the first outfit, green
# for the second, and so on: four outfits a sex), which survives every step to the phone.
assert len(OUTFITS) <= 4, 'four outfits a sex: one colour channel each'
index = {g.name: g.index for g in body.vertex_groups}
marks = np.zeros((len(body.data.vertices), 4), dtype=np.float32)
for channel, (outfit_id, assets) in enumerate(OUTFITS.items()):
    groups = {index[f'Delete.{a}'] for a in assets if not a.startswith('shoes') and f'Delete.{a}' in index}
    for v in body.data.vertices:
        if any(g.group in groups and g.weight > 0.5 for g in v.groups):
            marks[v.index, channel] = 1.0
    print('HIDE', outfit_id, int(marks[:, channel].sum()), 'points')
colour = body.data.color_attributes.new('hide', 'FLOAT_COLOR', 'POINT')
colour.data.foreach_set('color', marks.ravel())
body.data.color_attributes.active_color = colour

# 7. Only what the game shows: no helper geometry, no MPFB masks, plain materials.
for m in list(body.modifiers):
    if m.type in ('MASK', 'SUBSURF'):
        body.modifiers.remove(m)
bm = bmesh.new()
bm.from_mesh(body.data)
deform = bm.verts.layers.deform.active
keep = body.vertex_groups['body'].index
doomed = [v for v in bm.verts if not (keep in v[deform] and v[deform][keep] > 0.5)]
bmesh.ops.delete(bm, geom=doomed, context='VERTS')
bm.to_mesh(body.data)
bm.free()
body.name = 'body'

# A plain material on the body: its colour picture, matte (the MPFB skin is a node group the
# game cannot read).
diffuse = next((n.image for m in body.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and 'diffuse' in n.image.name.lower()), None)
if diffuse is None:
    skin_dir = os.path.dirname(mpfb.AssetService.find_asset_absolute_path(SKIN, asset_subdir='skins'))
    diffuse = bpy.data.images.load(next(os.path.join(skin_dir, f) for f in os.listdir(skin_dir) if f.endswith('.png')))
skin = bpy.data.materials.new('skin')
skin.use_nodes = True
tex = skin.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = diffuse
skin.node_tree.links.new(tex.outputs['Color'], skin.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
skin.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.55
body.data.materials.clear()
body.data.materials.append(skin)
# Names the app looks for.
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        for part, plain in (('high-poly', 'eyes'), ('eyebrow', 'eyebrows'), ('eyelashes', 'eyelashes')):
            if part in o.name and not o.name.startswith(('hair_', 'outfit_', 'shoes_')):
                o.name = plain
for key, objs in attachments.items():
    for i, o in enumerate(objs):
        o.name = key if i == 0 else f'{key}_{i}'
for o in bpy.data.objects:
    if o.type == 'MESH':
        for slot in o.material_slots:
            if slot.material and slot.material.use_nodes:
                for n in slot.material.node_tree.nodes:
                    if n.type == 'BSDF_PRINCIPLED':
                        n.inputs['Metallic'].default_value = 0.0
# Which shoes go with each outfit (the app reads it from the outfit mesh's extras).
for outfit_id, assets in OUTFITS.items():
    obj = bpy.data.objects.get(f'outfit_{outfit_id}')
    shoes = [a for a in assets if a.startswith('shoes')]
    if obj and shoes:
        obj['shoes'] = f'shoes_{shoes[0]}'

# Pictures small enough for a phone: the skin (seen close up) 1024, the rest 512. Only hair,
# brows and lashes keep a see-through channel; the rest leave it unused, so they go as JPEG.
for o in bpy.data.objects:
    if o.type != 'MESH' or o.name.startswith('hair_') or any(part in o.name for part in ('eyebrow', 'eyelash', 'eyes', 'high-poly')):
        continue
    for slot in o.material_slots:
        if slot.material and slot.material.use_nodes:
            for n in slot.material.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    for link in list(n.inputs['Alpha'].links):
                        slot.material.node_tree.links.remove(link)
                    n.inputs['Alpha'].default_value = 1.0
            try:
                slot.material.surface_render_method = 'DITHERED'
            except Exception:
                pass
for img in list(bpy.data.images):
    if img.size[0] == 0:
        continue
    size = 1024 if img == diffuse else 512
    if img.size[0] > size:
        img.scale(size, size)

# 8. The movements, from Mixamo, each a track of its own: standing and breathing (the creator,
# and anyone waiting); walking, on the spot (the game moves the character); talking (officers,
# shopkeepers, anyone spoken to); sitting (a seat in a car or bus, a bench); lying asleep (a
# bed, a hospital bed).
CLIPS = {
    'idle': 'Breathing Idle.fbx' if SEX == 'male' else 'Standing Idle.fbx',
    'walk': 'Walking.fbx' if SEX == 'male' else 'Female Walk.fbx',
    'talk': 'Talking.fbx',
    'sit': 'Sitting Idle.fbx',
    'sleep': 'Sleeping Idle.fbx',
}
for clip, file in CLIPS.items():
    path = os.path.join(ANIMATIONS, file)
    if not os.path.exists(path):
        continue
    action = retarget(path, rig, clip, prefix='mixamorig:', recorded=skeleton(lambda t: 'mixamorig:' + t, fps=30), travel=clip != 'walk', at_rest=())
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 0, action)
    rig.animation_data.action = None
bpy.context.scene.render.fps = 30

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animation_mode='NLA_TRACKS', export_image_format='JPEG', export_image_quality=82,
                          export_morph=True, export_morph_normal=False, export_try_sparse_sk=True, export_apply=False, export_yup=True, export_extras=True, export_vertex_color='ACTIVE')
print('GLB', os.path.getsize(OUT), 'morphs', len(shapes))
