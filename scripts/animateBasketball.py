# Basketball moves animated by hand, pose by pose, on a Mixamo skeleton: the jump shot and the
# dunk. Mixamo has no basketball, so these are made here, as an animator would by keyframes.
#
# Used two ways:
#   * imported by makeBasketballCharacter.py, which adds the moves to the character for the game;
#   * on its own, to render a short film of each move to look at:
#       blender -b --factory-startup --python scripts/animateBasketball.py -- \
#           art-src/basketball/player1 ~/Documents/basketball-moves
#
# A pose is written the way a coach would say it: how deep the knees bend, how far the body
# leans, where each arm and hand points, how high off the ground. Directions are given in the
# player's own terms (forward, up, to their right). The hips are lowered by exactly what the
# bent legs take away, so the feet stay on the floor until the player leaves it.
import math
import os
import sys

import bpy
from mathutils import Vector

FPS = 30


def build(rig):
    """Adds the moves to this rig as actions: 'jump_shot', 'dunk' and 'dribble_arms'."""
    prefix = next(b.name for b in rig.pose.bones if b.name.endswith('Hips')).replace('Hips', '')
    bones = {b.name[len(prefix):]: b for b in rig.pose.bones if b.name.startswith(prefix)}
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    world = rig.matrix_world
    to_rig = world.inverted()

    # The player faces Blender's -Y; up is +Z; their right is -X.
    F, U, R = Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((-1, 0, 0))

    def d(f, u, r):
        return (F * f + U * u + R * r).normalized()

    def reset():
        for pb in rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        bpy.context.view_layer.update()

    reset()
    head = lambda n: world @ bones[n].head
    thigh = (head('LeftUpLeg') - head('LeftLeg')).length
    shin = (head('LeftLeg') - head('LeftFoot')).length
    hips_rest = world @ bones['Hips'].matrix.translation

    def point(name, direction):
        """Turns a bone so that it points along `direction` (world), keeping its root in place."""
        pb = bones.get(name)
        if pb is None:
            return
        bpy.context.view_layer.update()
        m = pb.matrix.copy()
        current = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
        target = (to_rig.to_3x3() @ direction).normalized()
        turn = current.rotation_difference(target).to_matrix().to_4x4()
        place = m.translation.copy()
        m = turn @ m
        m.translation = place
        pb.matrix = m

    def pose(knee=(5, 5), air=0.0, lean=4.0, arms=None, feet='flat', head_up=8, spread=0.12, hands=None):
        """One pose. knee = (thigh forward, shin back) in degrees from upright."""
        reset()
        a1, a2 = (math.radians(a) for a in knee)
        drop = thigh * (1 - math.cos(a1)) + shin * (1 - math.cos(a2))
        pb = bones['Hips']
        m = pb.matrix.copy()
        m.translation = to_rig @ (hips_rest + Vector((0, 0, air - drop)) + F * (thigh * math.sin(a1) * 0.15))
        pb.matrix = m
        tilt = math.radians(lean)
        for name in ('Spine', 'Spine1', 'Spine2'):
            point(name, d(math.sin(tilt), math.cos(tilt), 0))
        point('Neck', d(math.sin(tilt * 0.6), 1, 0))
        point('Head', d(math.sin(math.radians(-head_up)), 1, 0))
        for side, s in (('Left', -1), ('Right', 1)):
            point(f'{side}UpLeg', d(math.sin(a1), -math.cos(a1), s * spread))
            point(f'{side}Leg', d(-math.sin(a2), -math.cos(a2), s * spread * 0.4))
            point(f'{side}Foot', d(0.9, -0.42, s * 0.08) if feet == 'flat' else d(0.45, -0.88, s * 0.05))
        for name, direction in (arms or relaxed).items():
            point(name, direction)
        for name, direction in (hands or {}).items():
            point(name, direction)

    def key(frame):
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
        bones['Hips'].keyframe_insert('location', frame=frame, group=bones['Hips'].name)

    def arms_of(r_up, r_fore, l_up, l_fore):
        return {'RightArm': d(*r_up), 'RightForeArm': d(*r_fore), 'LeftArm': d(*l_up), 'LeftForeArm': d(*l_fore)}

    relaxed = arms_of((0.05, -1, 0.14), (0.25, -0.95, 0.05), (0.05, -1, -0.14), (0.25, -0.95, -0.05))
    ball_chest = arms_of((0.35, -0.85, 0.25), (0.85, 0.4, -0.25), (0.35, -0.85, -0.25), (0.85, 0.4, 0.25))
    # The set: the ball at the forehead, the shooting elbow under it, the guide hand at its side.
    shot_set = arms_of((0.75, 0.42, 0.28), (0.05, 0.95, -0.18), (0.6, 0.3, -0.55), (0.25, 0.85, 0.45))
    release = arms_of((0.5, 0.86, 0.06), (0.3, 0.95, 0.0), (0.45, 0.62, -0.6), (0.3, 0.9, 0.25))
    follow = arms_of((0.6, 0.8, 0.02), (0.72, 0.68, 0.0), (0.35, 0.45, -0.8), (0.3, 0.75, -0.55))
    lowering = arms_of((0.3, -0.3, 0.35), (0.6, 0.0, 0.1), (0.3, -0.3, -0.35), (0.6, 0.0, -0.1))
    flick = {'RightHand': d(0.75, -0.25, 0)}
    gooseneck = {'RightHand': d(0.45, -0.88, 0), 'LeftHand': d(0.2, 0.9, 0.3)}

    actions = {}

    def action(name, frames):
        rig.animation_data_create()
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        for frame, kwargs in frames:
            pose(**kwargs)
            key(frame)
        actions[name] = act
        return act

    # The jump shot. Off the floor at frame 7 (0.23 s), the top of the jump and the release at
    # frame 15-16 (0.5 s), back on the floor at frame 23: the game's own timing for a jump shot.
    action('jump_shot', [
        (0, dict(knee=(8, 8), lean=6, arms=ball_chest)),
        (4, dict(knee=(52, 48), lean=14, arms=shot_set, head_up=14)),
        (7, dict(knee=(18, 12), air=0.02, lean=6, arms=shot_set, feet='point', head_up=14)),
        (11, dict(knee=(8, 18), air=0.28, lean=0, arms=shot_set, feet='point', head_up=16)),
        (15, dict(knee=(10, 22), air=0.36, lean=-3, arms=release, feet='point', hands=flick, head_up=18)),
        (18, dict(knee=(12, 24), air=0.3, lean=-2, arms=follow, feet='point', hands=gooseneck, head_up=16)),
        (23, dict(knee=(22, 26), air=0.0, lean=2, arms=follow, hands=gooseneck, head_up=10)),
        (26, dict(knee=(38, 36), lean=8, arms=lowering)),
        (34, dict(knee=(6, 6), lean=4)),
    ])

    cocked = arms_of((0.1, 0.9, 0.32), (-0.65, 0.72, 0.1), (0.5, 0.85, -0.18), (0.45, 0.88, 0.0))
    # Reaching the ball up over the rim, then the slam: the forearm whips down through it.
    reach = arms_of((0.32, 0.95, 0.08), (0.22, 0.98, 0.0), (0.4, 0.88, -0.25), (0.35, 0.92, 0.0))
    slam = arms_of((0.6, 0.8, 0.05), (0.8, -0.6, 0.0), (0.3, 0.2, -0.9), (0.5, -0.2, -0.8))
    hang = arms_of((0.3, 0.95, 0.05), (0.2, 0.98, 0.0), (0.3, 0.95, -0.05), (0.2, 0.98, 0.0))
    landing_arms = arms_of((0.3, 0.1, 0.8), (0.6, 0.1, 0.5), (0.3, 0.1, -0.8), (0.6, 0.1, -0.5))
    # The dunk: a hard plant, an explosive rise with the ball cocked behind the head, the ball
    # reached up over the rim at the top of the jump (frame 12) and slammed through it (frame 14,
    # 0.47 s), a moment hanging on the rim, the drop and the landing. The top of the jump is
    # 1.1 m: a standing reach of about 2.3 m puts the hand well above the rim.
    action('dunk', [
        (0, dict(knee=(40, 44), lean=22, arms=ball_chest)),
        (3, dict(knee=(58, 56), lean=26, arms=ball_chest, head_up=16)),
        (5, dict(knee=(16, 10), air=0.08, lean=10, arms=cocked, feet='point', head_up=24)),
        (9, dict(knee=(44, 72), air=0.85, lean=0, arms=cocked, feet='point', head_up=28)),
        (12, dict(knee=(34, 60), air=1.08, lean=-2, arms=reach, feet='point', head_up=30)),
        (14, dict(knee=(30, 52), air=1.05, lean=16, arms=slam, feet='point', head_up=4)),
        (17, dict(knee=(14, 22), air=0.8, lean=4, arms=hang, feet='point', head_up=24)),
        (22, dict(knee=(10, 18), air=0.42, lean=2, arms=hang, feet='point', head_up=10)),
        (27, dict(knee=(48, 52), air=0.0, lean=14, arms=landing_arms)),
        (35, dict(knee=(8, 8), lean=4)),
    ])

    # Dribbling, the arms and shoulders only (the legs come from standing or running): the hand
    # meets the ball at the top, at the hip, pushes it down, and lets it go; one bounce in 0.5 s.
    dribble_top = arms_of((0.25, -0.75, 0.45), (0.75, -0.2, 0.25), (0.45, 0.0, -0.75), (0.75, 0.2, -0.3))
    dribble_low = arms_of((0.3, -0.9, 0.35), (0.6, -0.8, 0.12), (0.45, 0.0, -0.75), (0.75, 0.2, -0.3))
    action('dribble_arms', [
        (0, dict(knee=(22, 20), lean=14, arms=dribble_top, hands={'RightHand': d(0.5, -0.6, 0.2)})),
        (6, dict(knee=(24, 22), lean=15, arms=dribble_low, hands={'RightHand': d(0.4, -0.9, 0.1)})),
        (15, dict(knee=(22, 20), lean=14, arms=dribble_top, hands={'RightHand': d(0.5, -0.6, 0.2)})),
    ])

    for act in actions.values():
        for fc in fcurves(act):
            for k in fc.keyframe_points:
                k.interpolation = 'BEZIER'
                k.easing = 'AUTO'
    rig.animation_data.action = None
    reset()
    return actions


def fcurves(action):
    try:
        return list(action.fcurves)
    except Exception:
        return [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


# ---- On its own: render a film of each move ------------------------------------------------------

def films(character_dir, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.fbx(filepath=os.path.join(character_dir, 'Happy Idle.fbx'))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    acts = build(rig)

    # A floor, a basket in front of the player, a ball, a light and a camera from the side.
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    floor = bpy.context.object
    m = bpy.data.materials.new('floor'); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.16, 0.38, 1)
    floor.data.materials.append(m)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.229, minor_radius=0.02, location=(0, -0.5, 3.05))
    rim = bpy.context.object
    mr = bpy.data.materials.new('rim'); mr.use_nodes = True
    mr.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.25, 0.05, 1)
    rim.data.materials.append(mr)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.9, 3.42))
    board = bpy.context.object
    board.scale = (1.8, 0.04, 1.05)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=(0, 0, 1))
    ball = bpy.context.object
    mb = bpy.data.materials.new('ball'); mb.use_nodes = True
    mb.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.85, 0.3, 0.05, 1)
    ball.data.materials.append(mb)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
    sun.data.energy = 3.5
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.12, 0.13, 0.22)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.location = (-3.9, 1.9, 1.9)
    aim = bpy.data.objects.new('aim', None)
    scene.collection.objects.link(aim)
    aim.location = (0, -0.25, 1.75)
    look = cam.constraints.new('TRACK_TO')
    look.target = aim
    look.track_axis = 'TRACK_NEGATIVE_Z'
    look.up_axis = 'UP_Y'
    cam.data.lens = 28
    scene.camera = cam
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 720, 720
    scene.render.fps = FPS

    hand = lambda side: rig.matrix_world @ rig.pose.bones[next(b.name for b in rig.pose.bones if b.name.endswith(side + 'Hand'))].head
    for name, release_frame, end in (('jump_shot', 16, 40), ('dunk', 14, 40)):
        rig.animation_data.action = acts[name]
        try:
            rig.animation_data.action_slot = acts[name].slots[0]
        except Exception:
            pass
        ball.animation_data_clear()
        start = None
        for f in range(0, end + 1):
            scene.frame_set(f)
            if f <= release_frame:
                at = (hand('Right') + hand('Left')) / 2 if f < 4 else hand('Right') + Vector((0, -0.05, 0.12))
                ball.location = at
                start = at.copy()
            else:
                t = (f - release_frame) / FPS
                target = Vector((0, -0.5, 3.05))
                if name == 'dunk':
                    ball.location = Vector((0, -0.5, max(0.12, start.z - 4 * t - 4.9 * t * t)))
                else:
                    flight = 0.9
                    s = min(1.0, t / flight)
                    across = start.lerp(target, s)
                    height = start.z + (target.z - start.z) * s + 1.4 * 4 * s * (1 - s) if s < 1 else max(0.12, target.z - (t - flight) * 4)
                    ball.location = Vector((across.x, across.y, height))
            ball.keyframe_insert('location', frame=f)
        scene.frame_start, scene.frame_end = 0, end
        frames = os.path.join(out_dir, name, 'frame_')
        scene.render.filepath = frames
        bpy.ops.render.render(animation=True)
        print('FILM', name)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) >= 2:
        films(args[0], os.path.expanduser(args[1]))
