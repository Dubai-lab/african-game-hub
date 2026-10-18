# One Africa Life: puts Mixamo movements (art-src/one-africa-life/animations) on a test character
# made by makeTestCharacters.py, and films a short reel of them to judge how they move.
#
#   blender -b <character>.blend --python scripts/oal/filmMoves.py -- <out dir> "<move>,<move>,..."
#
# Each move is carried across bone by bone in the world (scripts/retargetBasketball.py), so it
# fits whatever rest pose the character's skeleton has. Walks and runs are kept on the spot (the
# camera follows the character, as the game will).
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from retargetBasketball import retarget, skeleton, use  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = os.path.expanduser(args[0])
MOVES = args[1].split(',')
SECONDS = 3.0
# Filmed at fifteen frames a second (every other frame of the move): enough to judge it.
STEP = 2
ANIMATIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'art-src', 'one-africa-life', 'animations')
MIXAMO = skeleton(lambda t: 'mixamorig:' + t, fps=30)
TRAVELLING = ('Walk', 'Running', 'Jogging', 'Backwards')

os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
name = rig.name
for pb in rig.pose.bones:
    pb.matrix_basis.identity()

# A studio: key, fill and rim, a floor, a camera that follows.
aim = bpy.data.objects.new('aim', None)
scene.collection.objects.link(aim)
for light_name, energy, colour, loc in (('key', 900, (1.0, 0.92, 0.84), (-2.2, -2.6, 2.6)), ('fill', 280, (0.82, 0.88, 1.0), (2.6, -2.2, 1.6)), ('rim', 700, (1.0, 0.95, 0.9), (0.6, 2.8, 2.4))):
    light = bpy.data.objects.new(light_name, bpy.data.lights.new(light_name, 'AREA'))
    light.data.energy, light.data.color, light.data.size = energy, colour, 1.6
    light.location = loc
    light.constraints.new('TRACK_TO').target = aim
    scene.collection.objects.link(light)
floor = bpy.data.meshes.new('floor')
floor.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
scene.collection.objects.link(bpy.data.objects.new('floor', floor))
world = bpy.data.worlds.new('studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.09, 0.08, 0.1, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
scene.world = world
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 50
cam.constraints.new('TRACK_TO').target = aim
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.taa_render_samples = 8
scene.render.resolution_x, scene.render.resolution_y = 450, 600
# Without the smoothing subdivision: the same look at this size, much quicker to draw.
for o in bpy.data.objects:
    for m in getattr(o, 'modifiers', []):
        if m.type == 'SUBSURF':
            m.show_render = False
scene.view_settings.view_transform = 'AgX'
try:
    scene.render.image_settings.media_type = 'IMAGE'
except Exception:
    pass
scene.render.image_settings.file_format = 'PNG'

hips = rig.pose.bones['mixamorig:Hips']
frame_no = 0
for move in MOVES:
    path = os.path.join(ANIMATIONS, move + '.fbx')
    action = retarget(path, rig, move, prefix='mixamorig:', recorded=MIXAMO, travel=not any(t in move for t in TRAVELLING), at_rest=())
    use(rig, action)
    length = int(action.frame_range[1])
    for f in range(0, int(SECONDS * 30), STEP):
        scene.frame_set(f % max(1, length))
        at = rig.matrix_world @ hips.head
        aim.location = (at.x, at.y, 1.0)
        cam.location = (at.x + math.sin(math.radians(25)) * 4.6, at.y - math.cos(math.radians(25)) * 4.6, 1.3)
        scene.render.filepath = os.path.join(OUT, f'{name}_{frame_no:04d}.png')
        bpy.ops.render.render(write_still=True)
        frame_no += 1
    print('FILMED', name, move, length, 'frames')
