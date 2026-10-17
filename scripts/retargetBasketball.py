# Puts motion-capture basketball moves recorded on Unreal's "Manny" skeleton (the Ailive pack,
# see ASSETS.md) onto the game's Mixamo character, in Blender, without its window:
#
#   blender -b --factory-startup --python scripts/retargetBasketball.py -- \
#       art-src/basketball/player1 art-src/basketball/animations ~/Documents/basketball-moves
#
# On its own it renders a film of each move to look at; makeBasketballCharacter.py imports
# `retarget` to bake the moves into the game's character.
#
# How a move is carried across: each Manny bone's turn away from its own rest pose, in the
# world, is given to the matching Mixamo bone. The two skeletons stand differently at rest (Manny
# with his arms down at an angle, the Mixamo character with them out), so the Mixamo bones are
# first laid along Manny's rest pose and the turns are given from there. The hips also take
# Manny's height and sway, scaled to the character's size. Fingers come across too: that is the
# point of motion capture, the hands really hold the ball.
import bpy, math, os, sys
from mathutils import Matrix, Quaternion, Vector

FPS = 30

# Manny bone -> Mixamo bone (without the 'mixamorig9:' prefix). Manny's extra spine bones are
# simply skipped: every turn is taken in the world, so nothing between is lost.
PAIRS = [('pelvis', 'Hips'), ('spine_02', 'Spine'), ('spine_04', 'Spine1'), ('spine_05', 'Spine2'), ('neck_01', 'Neck'), ('head', 'Head')]
for side, s in (('l', 'Left'), ('r', 'Right')):
    PAIRS += [(f'clavicle_{side}', f'{s}Shoulder'), (f'upperarm_{side}', f'{s}Arm'), (f'lowerarm_{side}', f'{s}ForeArm'), (f'hand_{side}', f'{s}Hand')]
    for finger, F in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Pinky')):
        PAIRS += [(f'{finger}_0{i}_{side}', f'{s}Hand{F}{i}') for i in (1, 2, 3)]
    PAIRS += [(f'thigh_{side}', f'{s}UpLeg'), (f'calf_{side}', f'{s}Leg'), (f'foot_{side}', f'{s}Foot'), (f'ball_{side}', f'{s}ToeBase')]
# Where each bone points, for laying one rest pose along the other: toward the next joint.
NEXT = {'pelvis': 'spine_02', 'spine_02': 'spine_04', 'spine_04': 'spine_05', 'spine_05': 'neck_01', 'neck_01': 'head'}
for side in 'lr':
    NEXT.update({f'clavicle_{side}': f'upperarm_{side}', f'upperarm_{side}': f'lowerarm_{side}', f'lowerarm_{side}': f'hand_{side}', f'hand_{side}': f'middle_01_{side}',
                 f'thigh_{side}': f'calf_{side}', f'calf_{side}': f'foot_{side}', f'foot_{side}': f'ball_{side}'})
    for finger in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        NEXT.update({f'{finger}_01_{side}': f'{finger}_02_{side}', f'{finger}_02_{side}': f'{finger}_03_{side}'})


def rest_world(obj, bone):
    """A bone's rest position and turn, in the world."""
    m = obj.matrix_world @ bone.matrix_local
    loc, rot, _ = m.decompose()
    return loc, rot


def retarget(source_fbx, rig, name, prefix='mixamorig9:'):
    """Bakes the move in `source_fbx` onto `rig` as an action called `name` (30 frames a second)."""
    before, acts_before = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=source_fbx)
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == 'ARMATURE')
    src_action = next(a for a in bpy.data.actions if a not in acts_before)
    scene = bpy.context.scene
    start, end = (int(v) for v in src_action.frame_range)
    src_fps = 120

    tb = {p[1]: rig.data.bones[prefix + p[1]] for p in PAIRS}
    sb = {p[0]: src.data.bones[p[0]] for p in PAIRS}
    pair_of = {prefix + t: s for s, t in PAIRS}

    # Manny's rest pose, in the world.
    scene.frame_set(start)
    src_rest = {s: rest_world(src, sb[s]) for s, _ in PAIRS}
    tgt_rest = {b.name: rest_world(rig, b) for b in rig.data.bones}

    # Which way each one faces: from the hips, left to right, turned a quarter forward. Manny's
    # file stands him turned; his rest pose is first turned to face the way the character does.
    def facing(left, right):
        across = right - left
        return math.atan2(across.y, across.x)
    face_tgt = facing(tgt_rest[prefix + 'LeftUpLeg'][0], tgt_rest[prefix + 'RightUpLeg'][0])
    align = Quaternion((0, 0, 1), face_tgt - facing(src_rest['thigh_l'][0], src_rest['thigh_r'][0]))
    src_rest = {s: (align @ loc, align @ rot) for s, (loc, rot) in src_rest.items()}
    src_dir = {s: (src_rest[NEXT[s]][0] - src_rest[s][0]).normalized() for s in NEXT}

    # The character laid along Manny's rest pose: each bone turned the least way that points it
    # where Manny's points, parents first; the bones without a partner follow their parents.
    laid = {}
    for b in rig.data.bones:  # Blender lists parents before children
        rest_rot = tgt_rest[b.name][1]
        if b.parent:
            follow = laid[b.parent.name] @ tgt_rest[b.parent.name][1].inverted() @ rest_rot
        else:
            follow = rest_rot
        s = pair_of.get(b.name)
        if s in src_dir:
            child = next((c for c in b.children if pair_of.get(c.name) == NEXT[s]), None)
            if child is not None:
                own = (tgt_rest[child.name][0] - tgt_rest[b.name][0]).normalized()
                now = (follow @ tgt_rest[b.name][1].inverted()) @ own
                follow = now.rotation_difference(src_dir[s]) @ follow
        laid[b.name] = follow

    # The performer may face any way in the take: the whole move is turned so that at its start
    # he faces the way the character stands at rest (from the hips, left to right, turned a
    # quarter forward).
    sp = lambda n: (src.matrix_world @ src.pose.bones[n].matrix).to_translation()
    turn = Quaternion((0, 0, 1), face_tgt - facing(sp('thigh_l'), sp('thigh_r')))

    # The character's size against Manny's.
    hips = prefix + 'Hips'
    scale = tgt_rest[hips][0].z / src_rest['pelvis'][0].z

    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    rig_rot = rig.matrix_world.decompose()[1]
    rig_inv = rig.matrix_world.inverted()
    bones = list(rig.data.bones)
    frame = 0
    first_pelvis = None
    for f in range(start, end + 1, src_fps // FPS):
        scene.frame_set(f)
        world = {}
        pose_arm = {}
        for b in bones:
            s = pair_of.get(b.name)
            if s is not None:
                m = src.matrix_world @ src.pose.bones[s].matrix
                _, rot, _ = m.decompose()
                world[b.name] = turn @ rot @ src_rest[s][1].inverted() @ laid[b.name]
            elif b.parent:
                world[b.name] = world[b.parent.name] @ tgt_rest[b.parent.name][1].inverted() @ tgt_rest[b.name][1]
            else:
                world[b.name] = tgt_rest[b.name][1]
            # Into the rig's own terms, then into the bone's own (its rest, under its parent).
            arm = rig_rot.inverted() @ world[b.name]
            pose_arm[b.name] = arm
            rest = b.matrix_local.to_quaternion()
            if b.parent:
                prest = b.parent.matrix_local.to_quaternion()
                basis = rest.inverted() @ prest @ pose_arm[b.parent.name].inverted() @ arm
            else:
                basis = rest.inverted() @ arm
            pb = rig.pose.bones[b.name]
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = basis
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=b.name)
        # The hips: Manny's height and sway, the character's size, kept on the spot.
        pelvis = (src.matrix_world @ src.pose.bones['pelvis'].matrix).to_translation()
        if first_pelvis is None:
            first_pelvis = pelvis.copy()
        sway = turn @ Vector((pelvis.x - first_pelvis.x, pelvis.y - first_pelvis.y, 0))
        at = Vector((sway.x * scale, sway.y * scale, pelvis.z * scale))
        at.x += tgt_rest[hips][0].x
        at.y += tgt_rest[hips][0].y
        b = rig.data.bones[hips]
        local = b.matrix_local.inverted() @ (rig_inv @ at)
        pb = rig.pose.bones[hips]
        pb.location = local
        pb.keyframe_insert('location', frame=frame, group=hips)
        frame += 1

    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.actions.remove(src_action)
    action.use_fake_user = True
    return action


def use(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action
    try:
        rig.animation_data.action_slot = action.slots[0]
    except Exception:
        pass


def dribble_loop(take, rig, name, cycles=4, hand='mixamorig9:RightHand'):
    """A clean loop of `cycles` dribbles cut from the middle of a dribbling take, every dribble
    the same length (so the game can put the ball in the hand at the right moment: the hand is
    at the top of its stroke at the start of each), the end joined smoothly back to the start
    and the drift across the floor taken out. Returns (action, frames per dribble)."""
    scene = bpy.context.scene
    use(rig, take)
    frames = int(take.frame_range[1]) + 1
    height = []
    for f in range(frames):
        scene.frame_set(f)
        height.append((rig.matrix_world @ rig.pose.bones[hand].head).z)
    tops = [f for f in range(3, frames - 3) if height[f] == max(height[f - 3:f + 4])]
    best = None
    for i in range(len(tops) - cycles):
        lengths = [tops[i + k + 1] - tops[i + k] for k in range(cycles)]
        if min(lengths) >= 8 and max(lengths) - min(lengths) <= 4:
            score = abs(i + cycles / 2 - len(tops) / 2)
            if best is None or score < best[0]:
                best = (score, i)
    if best is None:
        raise RuntimeError(f'no steady dribbling in {take.name}: tops at {tops}')
    span = tops[best[1]:best[1] + cycles + 1]
    each = round((span[-1] - span[0]) / cycles)
    total = each * cycles

    def source(i):
        k, within = divmod(i, each)
        if k >= cycles:
            return float(span[-1])
        return span[k] + (span[k + 1] - span[k]) * within / each

    poses = []
    for i in range(total + 1):
        at = source(i)
        scene.frame_set(int(at), subframe=at - int(at))
        poses.append({pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in rig.pose.bones})
    first, last = poses[0], poses[-1]
    out = bpy.data.actions.new(name)
    use(rig, out)
    for i, pose in enumerate(poses):
        w = i / total
        for pb in rig.pose.bones:
            q, loc = pose[pb.name]
            fix = Quaternion().slerp(first[pb.name][0] @ last[pb.name][0].inverted(), w)
            pb.rotation_quaternion = fix @ q
            pb.location = loc + (first[pb.name][1] - last[pb.name][1]) * w
            pb.keyframe_insert('rotation_quaternion', frame=i, group=pb.name)
            pb.keyframe_insert('location', frame=i, group=pb.name)
    out.use_fake_user = True
    return out, each


# ---- On its own: render a film of each move ------------------------------------------------------

MOVES = [
    ('Dribbling_in_Place_with_One_Hand', 'dribble_one_hand'),
    ('Dribbling_in_Place_in_Basketball', 'dribble'),
    ('Shooting_a_Free_Throw_in_Basketball', 'free_throw'),
    ('Faking_a_Shot_in_Basketball', 'pump_fake'),
    ('Blocking_in_Basketball', 'block'),
]


BALL_R = 0.12


def place_ball(scene, rig, ball, name, frames):
    """Where the ball is in a film: between the palms while both hands are on it; for a dribble,
    pushed down from under the palm at the top of each stroke to the floor and back up; for a
    shot, flying on from the hands once they let go. The moves were captured without a ball, so
    this follows the hands."""
    def palm(side):
        bones = rig.pose.bones
        hand = rig.matrix_world @ bones[f'mixamorig9:{side}Hand'].head
        middle = rig.matrix_world @ bones[f'mixamorig9:{side}HandMiddle1'].head
        return hand.lerp(middle, 0.6)
    hands = []
    for f in range(frames):
        scene.frame_set(f)
        hands.append((palm('Left'), palm('Right')))
    at = [None] * frames
    held = [(l - r).length < 0.36 for l, r in hands]
    for f, (l, r) in enumerate(hands):
        if held[f]:
            at[f] = (l + r) / 2
    if name.startswith('dribble'):
        # The dribbling hand is the one going up and down most, over the second around each frame;
        # the stroke's top is the moment it stops rising.
        def busy(f):
            span = range(max(0, f - FPS // 2), min(frames, f + FPS // 2))
            reach = [max(hands[g][i].z for g in span) - min(hands[g][i].z for g in span) for i in (0, 1)]
            return 0 if reach[0] >= reach[1] else 1
        which = [busy(f) for f in range(frames)]
        low = lambda f: hands[f][which[f]]
        tops = [f for f in range(1, frames - 1) if not held[f] and low(f).z >= low(f - 1).z and low(f).z > low(f + 1).z]
        for a, b in zip(tops, tops[1:]):
            top_a = low(a) - Vector((0, 0, BALL_R + 0.02))
            top_b = low(b) - Vector((0, 0, BALL_R + 0.02))
            for f in range(a, b + 1):
                if held[f]:
                    continue
                s = (f - a) / (b - a)
                where = top_a.lerp(top_b, s)
                # Down to the floor at half way, and back up into the hand.
                depth = 1 - abs(2 * s - 1)
                where.z = where.z + (BALL_R - where.z) * depth
                at[f] = where
        for f in range(frames):
            if at[f] is None:
                at[f] = low(f) - Vector((0, 0, BALL_R + 0.02))
    else:
        last, velocity = None, Vector()
        for f in range(frames):
            if at[f] is not None:
                if last is not None:
                    velocity = (at[f] - last) * FPS
                last = at[f]
                continue
            if last is None:
                continue
            if name == 'free_throw':
                # Let go: on it flies, until it is out of the picture.
                velocity.z -= 9.8 / FPS
                last = last + velocity / FPS
                at[f] = last if last.z > BALL_R else Vector((last.x, last.y, BALL_R))
            elif name == 'pump_fake':
                l, r = hands[f]
                at[f] = min((l, r), key=lambda p: (p - last).length)
                last = at[f]
    ball.animation_data_clear()
    for f in range(frames):
        if at[f] is None:
            ball.hide_render = True
            ball.keyframe_insert('hide_render', frame=f)
            continue
        ball.hide_render = False
        ball.keyframe_insert('hide_render', frame=f)
        ball.location = at[f]
        ball.keyframe_insert('location', frame=f)


def films(character_dir, moves_dir, out_dir, only=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.fbx(filepath=os.path.join(character_dir, 'Happy Idle.fbx'))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    acts = {}
    for file, name in MOVES:
        if only and name not in only:
            continue
        acts[name] = retarget(os.path.join(moves_dir, file + '.FBX'), rig, name)
        print('MOVE', name, int(acts[name].frame_range[1]) + 1, 'frames')

    bpy.ops.mesh.primitive_uv_sphere_add(radius=BALL_R, location=(0, 0, 1))
    ball = bpy.context.object
    mb = bpy.data.materials.new('ball'); mb.use_nodes = True
    mb.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.85, 0.3, 0.05, 1)
    ball.data.materials.append(mb)
    bpy.ops.object.shade_smooth()

    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    floor = bpy.context.object
    m = bpy.data.materials.new('floor'); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.16, 0.38, 1)
    floor.data.materials.append(m)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
    sun.data.energy = 3.5
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.12, 0.13, 0.22)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = (-2.2, -2.6, 1.5)
    aim = bpy.data.objects.new('aim', None)
    scene.collection.objects.link(aim)
    aim.location = (0, 0, 1.0)
    look = cam.constraints.new('TRACK_TO')
    look.target = aim
    look.track_axis = 'TRACK_NEGATIVE_Z'
    look.up_axis = 'UP_Y'
    cam.data.lens = 35
    scene.camera = cam
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 12
    scene.render.resolution_x, scene.render.resolution_y = 600, 600
    scene.render.fps = FPS

    for name, action in acts.items():
        rig.animation_data.action = action
        try:
            rig.animation_data.action_slot = action.slots[0]
        except Exception:
            pass
        place_ball(scene, rig, ball, name, int(action.frame_range[1]) + 1)
        os.makedirs(os.path.join(out_dir, name), exist_ok=True)
        for f in range(0, int(action.frame_range[1]) + 1):
            scene.frame_set(f)
            # The camera keeps the player in the picture when the move takes him across the floor.
            hips = rig.matrix_world @ rig.pose.bones['mixamorig9:Hips'].head
            aim.location = (hips.x, hips.y, 1.0)
            cam.location = (hips.x - 2.2, hips.y - 2.6, 1.5)
            scene.render.filepath = os.path.join(out_dir, name, f'frame_{f:04d}.png')
            bpy.ops.render.render(write_still=True)
        print('FILM', name)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    films(args[0], args[1], os.path.expanduser(args[2]), only=set(args[3].split(',')) if len(args) > 3 else None)
