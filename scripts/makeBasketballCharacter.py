# Builds one basketball character for the game from Mixamo downloads.
#
#   blender -b --factory-startup --python scripts/makeBasketballCharacter.py -- \
#       art-src/basketball/player1 public/basketball/player1.v6.glb art-src/basketball/player1/preview.png
#
# The folder holds the FBX files downloaded from Mixamo for one character (see CLIPS below for
# the file names). The character itself is taken from "Happy Idle.fbx"; only the movement is
# taken from the others. The result is one GLB with every movement in it as a named animation,
# kept small for phones: half the triangles, pictures of 1024 pixels at most, in JPEG (which
# every phone's browser reads; WebP alone left some phones drawing the character all white).
# The downloads stay in art-src/ (never in the repository); only the GLB is published.
# Builds one game file (GLB) for a basketball character from Mixamo downloads:
# the character from one file, the movements from all of them.
import bpy, sys, os, math
args = sys.argv[sys.argv.index('--') + 1:]
src, out_glb, out_png = args[0], args[1], args[2]
CLIPS = {  # file -> name in the game
    'Happy Idle.fbx': 'idle', 'Dribble.fbx': 'dribble', 'Running.fbx': 'run', 'Jump.fbx': 'jump',
    'Left Strafe.fbx': 'strafe_left', 'Right Strafe.fbx': 'strafe_right', 'Jogging Stumble.fbx': 'stumble',
    'Victory.fbx': 'victory', 'Defeated.fbx': 'defeated',
}
bpy.ops.wm.read_factory_settings(use_empty=True)

def imported(path):
    before = set(bpy.data.objects); acts = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in acts]

# The character, from the idle file.
objs, acts = imported(os.path.join(src, 'Happy Idle.fbx'))
rig = next(o for o in objs if o.type == 'ARMATURE')
body = [o for o in objs if o.type == 'MESH']
acts[0].name = 'idle'

# Only the movement from every other file.
for file, name in CLIPS.items():
    if name == 'idle': continue
    objs, acts = imported(os.path.join(src, file))
    if not acts: print('NOACTION', file); continue
    acts[0].name = name
    acts[0].use_fake_user = True
    for o in objs: bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)

# The dribble from motion capture (the Ailive pack, art-src/basketball/animations), put on this
# character by retargetBasketball.py, in place of Mixamo's: a loop of four dribbles of the same
# length, the hand at the top of its stroke at the start of each (the game times the ball by it:
# DRIBBLE_CYCLES in src/games/basketball/Athletes.tsx).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from retargetBasketball import retarget, dribble_loop, strokes
MOVES = os.path.join(os.path.dirname(os.path.abspath(src)), 'animations')
if os.path.isdir(MOVES):
    take = retarget(os.path.join(MOVES, 'Dribbling_in_Place_with_One_Hand.FBX'), rig, 'dribble_take')
    bpy.data.actions.remove(bpy.data.actions['dribble'])
    loop, each = dribble_loop(take, rig, 'dribble', cycles=4)
    bpy.data.actions.remove(take)
    print('DRIBBLE', each, 'frames a dribble,', int(loop.frame_range[1]), 'in the loop')
    # The crossover: in the two-hand take the ball goes across on every bounce; the right hand is
    # at the top of its stroke at frame 17, the left at 40, the right again at 64 (found by
    # following both hands through the take). Two strokes the length of the dribble's, right to
    # left and back (CROSS_STROKES in Athletes.tsx).
    take = retarget(os.path.join(MOVES, 'Dribbling_in_Place_in_Basketball.FBX'), rig, 'cross_take')
    strokes(take, rig, 'crossover', [17, 40, 64], each)
    bpy.data.actions.remove(take)
    # The dunk (bought by the owner: a Mixamo skeleton baked out of a Maya rig, in dunk/). In the
    # take he loads down until frame 18, rises, puts the ball through the rim at frame 37, hangs
    # on it and drops (found by following his hips, hands and the ball in its file). The rise is
    # squeezed to the game's own (DUNK_SLAM, 0.46 s, 14 frames); the rest keeps its own pace.
    # His height comes with it: the game does not lift him itself while he dunks.
    from retargetBasketball import BIND
    dunk_file = os.path.join(MOVES, 'dunk', 'smac.fbx')
    if os.path.exists(dunk_file):
        take = retarget(dunk_file, rig, 'dunk_take', recorded=BIND, travel=False)
        strokes(take, rig, 'dunk', [18, 37, 70], [14, 33])
        bpy.data.actions.remove(take)

# Movements made to travel ("In Place" not ticked) are kept on the spot: the game moves the
# player across the court itself. The drift of the hips from the first frame to the last is
# taken out; the bounce and sway within the movement stay.
def fcurves(action):
    try:
        return list(action.fcurves)
    except Exception:
        return [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]

for a in bpy.data.actions:
    # Only Mixamo's: the motion-capture moves above are already on the spot, and the dunk's
    # rise and the crossover's sway are part of them.
    if a.name not in CLIPS.values(): continue
    for fc in fcurves(a):
        if not (fc.data_path.endswith('Hips"].location')): continue
        keys = fc.keyframe_points
        if len(keys) < 2: continue
        f0, f1 = keys[0].co.x, keys[-1].co.x
        drift = keys[-1].co.y - keys[0].co.y
        if abs(drift) < 5 or f1 <= f0: continue
        for k in keys:
            share = drift * (k.co.x - f0) / (f1 - f0)
            k.co.y -= share
            k.handle_left.y -= share
            k.handle_right.y -= share
        print('INPLACE', a.name, fc.array_index, round(drift, 1))

# Does each movement stay in place? (How far the hips travel across the ground.)
rig.animation_data_create()
for a in bpy.data.actions:
    rig.animation_data.action = a
    try: rig.animation_data.action_slot = a.slots[0]
    except Exception: pass
    f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    hips = rig.pose.bones[[b.name for b in rig.pose.bones if b.name.endswith('Hips')][0]]
    bpy.context.scene.frame_set(f0); p0 = rig.matrix_world @ hips.head
    bpy.context.scene.frame_set(f1); p1 = rig.matrix_world @ hips.head
    print('CLIP', a.name, 'frames', f0, f1, 'travel_xy=%.2f' % math.hypot(p1.x - p0.x, p1.y - p0.y), 'rise=%.2f' % (p1.z - p0.z))

# Lighter for phones: half the triangles, smaller pictures.
for o in body:
    bpy.context.view_layer.objects.active = o
    mod = o.modifiers.new('decimate', 'DECIMATE'); mod.ratio = 0.5
    while o.modifiers[0].name != 'decimate': bpy.ops.object.modifier_move_up(modifier='decimate')
    bpy.ops.object.modifier_apply(modifier='decimate')
    o.data.calc_loop_triangles(); print('MESH', o.name, 'tris', len(o.data.loop_triangles))
# Cloth and skin, not metal; solid, not see-through (only the eyelashes keep their cut-out).
for mat in bpy.data.materials:
    if not mat.use_nodes: continue
    for node in mat.node_tree.nodes:
        if node.type != 'BSDF_PRINCIPLED': continue
        for name, value in (('Metallic', 0.0),):
            socket = node.inputs.get(name)
            if socket is None: continue
            for link in list(socket.links): mat.node_tree.links.remove(link)
            socket.default_value = value
        if 'eyelash' not in mat.name.lower():
            alpha = node.inputs.get('Alpha')
            if alpha is not None:
                for link in list(alpha.links): mat.node_tree.links.remove(link)
                alpha.default_value = 1.0
    if 'eyelash' not in mat.name.lower():
        try: mat.surface_render_method = 'DITHERED'
        except Exception: pass
        try: mat.blend_method = 'OPAQUE'
        except Exception: pass
    print('MATERIAL', mat.name)
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024 if '1001' in img.filepath else 512, 1024 if '1001' in img.filepath else 512)

# Every movement on its own track, so each leaves as a named animation.
rig.animation_data.action = None
for a in bpy.data.actions:
    track = rig.animation_data.nla_tracks.new(); track.name = a.name
    strip = track.strips.new(a.name, int(a.frame_range[0]), a)
    try: strip.action_slot = a.slots[0]
    except Exception: pass

# Every movement at the 30 frames a second it was made in.
bpy.context.scene.render.fps, bpy.context.scene.render.fps_base = 30, 1.0
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_animation_mode='NLA_TRACKS', export_image_format='JPEG', export_image_quality=82,
                          export_optimize_animation_size=True, export_apply=False, export_yup=True)
print('GLB', os.path.getsize(out_glb))

# A picture to check by eye: the character standing, from the front, lit.
rig.animation_data.action = bpy.data.actions['idle']
try: rig.animation_data.action_slot = bpy.data.actions['idle'].slots[0]
except Exception: pass
for t in rig.animation_data.nla_tracks: t.mute = True
bpy.context.scene.frame_set(1)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
cam.location = (0, -4.2, 1.0); cam.rotation_euler = (math.radians(90), 0, 0); cam.data.lens = 50
bpy.context.scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); sun.data.energy = 3
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 600, 900
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.08, 0.1, 0.25)
sc.render.filepath = out_png
bpy.ops.render.render(write_still=True)
print('PNG', out_png)
