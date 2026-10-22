# One Africa Life: Furniture City's delivery truck (public/oal/truck.v1.glb and
# src/games/oal/truckPlan.json): a light box truck of the kind Monrovia's furniture stores send
# out (an Isuzu-like cab-over): its white cab (the windscreen, side windows, mirrors on their arms,
# the grille, the headlamps, the bumper; its doors on their hinges, its seats, dashboard and
# steering wheel inside), its box behind (ribbed aluminium, the store's orange stripe and its name,
# its two back doors on their hinges for unloading, the tail lamps, the step), the chassis, the
# fuel tank, the mud flaps, its wheels (single at the front, steered; twin at the back), each on
# a pivot at its middle (turned as it rolls), Liberian plates.
#
# Facing +X (as the game's vehicles do), its left (the driver's side) +Y here (-Z in the game), its
# wheels on the ground. Its plan: the wheels, the steering, the doors, where the driver sits, its
# size, its wheelbase.
#
#   blender -b --factory-startup --python scripts/oal/makeTruck.py -- <out.glb> <plan.json>
import json
import math
import os
import sys

import bmesh
import bpy
import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenekit as kit  # noqa: E402
from scenekit import box, cylinder, flat, srgb  # noqa: E402

OUT, PLAN = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)

M = {
    'paint': flat('truck_paint', srgb('#f2f2ef'), 0.32, 0.1),
    'box': flat('truck_box', srgb('#e6e8ea'), 0.4, 0.55),
    'rib': flat('truck_rib', srgb('#c9ccd0'), 0.35, 0.7),
    'orange': flat('truck_orange', srgb('#e2571a'), 0.45),
    'black': flat('truck_black', (0.025, 0.025, 0.028), 0.6),
    'plastic': flat('truck_plastic', (0.05, 0.05, 0.055), 0.75),
    'chrome': flat('truck_chrome', (0.8, 0.8, 0.82), 0.15, 1.0),
    'glass': flat('truck_glass', (0.12, 0.16, 0.2), 0.05, alpha=0.45),
    'lamp': flat('truck_lamp', (0.95, 0.95, 0.9), 0.1, emission=0.6),
    'amber': flat('truck_amber', srgb('#ff9f1a'), 0.2, emission=0.3),
    'tail': flat('truck_tail', srgb('#c0121a'), 0.2, emission=0.4),
    'tyre': flat('truck_tyre', (0.03, 0.03, 0.032), 0.92),
    'rim': flat('truck_rim', (0.55, 0.56, 0.58), 0.35, 0.8),
    'hub': flat('truck_hub', (0.2, 0.2, 0.21), 0.45, 0.7),
    'chassis': flat('truck_chassis', (0.06, 0.06, 0.065), 0.6, 0.4),
    'seat': flat('truck_seat', srgb('#2a2c30'), 0.85),
    'dash': flat('truck_dash', srgb('#1c1d20'), 0.7),
    'plate': flat('truck_plate', (0.92, 0.92, 0.9), 0.5),
    'plate_blue': flat('truck_plate_blue', srgb('#1f3d8c'), 0.5),
    'mud': flat('truck_mud', (0.04, 0.04, 0.045), 0.9),
}
MATS = list(M.values())
IDX = {k: i for i, k in enumerate(M)}

# Its measures (metres): the cab's back and front, its width; the box; the wheels.
CAB0, CAB1, CABW = 1.45, 3.2, 1.96
BOX0, BOX1, BOXW, BOXZ0, BOXZ1 = -3.3, 1.38, 2.24, 1.02, 3.3
FRONT_X, REAR_X, R = 2.55, -1.15, 0.41
ARCH_R = R + 0.08
ARCH_TOP = R + ARCH_R + 0.05
TRACK_F, TRACK_R = 0.83, 0.82


def group():
    bm = bmesh.new()
    return bm, bm.loops.layers.uv.new()


def cube(g, x0, y0, z0, x1, y1, z1, mat):
    bm, uv = g
    box(bm, uv, ((x0 + x1) / 2, (y0 + y1) / 2, z0), (x1 - x0, y1 - y0, z1 - z0), 0.0, IDX[mat], 1.0)


def obj(name, g, parent=None, smooth=False, round_edges=0.0):
    bm, _ = g
    o = kit.new_object(name, bm, MATS, smooth)
    if parent:
        o.parent = parent
    if round_edges:
        # Pressed metal's rounded edges (not a box's sharp ones), lit softly round.
        bev = o.modifiers.new('round', 'BEVEL')
        bev.width = round_edges
        bev.segments = 3
        bev.limit_method = 'ANGLE'
        bev.angle_limit = math.radians(50)
        bev.harden_normals = True
        o.data.shade_smooth()
        o.modifiers.new('normals', 'WEIGHTED_NORMAL').keep_sharp = True
    return o


def empty(name, at, parent):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = at
    return e


root = bpy.data.objects.new('truck', None)
bpy.context.scene.collection.objects.link(root)

# ---- The cab: a shell (its floor, back, roof, front, the sides round the doors) ----------------
g = group()
Z0, ZW, ZR = 0.62, 1.55, 2.62   # its floor, the windows' sill, its roof
# The front: bumper, grille, the lamps, the windscreen's frame; leaning back a little.
cube(g, CAB1 - 0.12, -CABW / 2 - 0.04, 0.42, CAB1 + 0.08, CABW / 2 + 0.04, 0.72, 'black')
cube(g, CAB1 - 0.08, -CABW / 2, 0.72, CAB1, CABW / 2, ZW, 'paint')
for z in (0.86, 0.98, 1.1, 1.22):
    cube(g, CAB1 - 0.01, -0.62, z, CAB1 + 0.03, 0.62, z + 0.05, 'black')
cube(g, CAB1 - 0.02, -0.66, 1.3, CAB1 + 0.035, 0.66, 1.36, 'chrome')
for side in (-1, 1):
    cube(g, CAB1 - 0.02, side * 0.68 - 0.13, 0.92, CAB1 + 0.04, side * 0.68 + 0.13, 1.18, 'lamp')
    cube(g, CAB1 - 0.02, side * 0.84 - 0.06, 0.92, CAB1 + 0.04, side * 0.84 + 0.06, 1.18, 'amber')
# The windscreen, leaning back from the sill to the roof; its pillars.
bm, uvl = g
lean = 0.28
ws = [bm.verts.new(p) for p in ((CAB1 - 0.05, -CABW / 2 + 0.08, ZW), (CAB1 - 0.05, CABW / 2 - 0.08, ZW), (CAB1 - 0.05 - lean, CABW / 2 - 0.12, ZR - 0.06), (CAB1 - 0.05 - lean, -CABW / 2 + 0.12, ZR - 0.06))]
f = bm.faces.new(ws)
f.material_index = IDX['glass']
for side in (-1, 1):
    y = side * (CABW / 2 - 0.04)
    pv = [bm.verts.new(p) for p in ((CAB1 - 0.02, y - 0.05, ZW), (CAB1 - 0.02, y + 0.05, ZW), (CAB1 - 0.02 - lean, y + 0.05, ZR), (CAB1 - 0.02 - lean, y - 0.05, ZR))]
    bmesh.ops.contextual_create(bm, geom=pv)
cube(g, CAB1 - 0.1, -CABW / 2, ZW - 0.06, CAB1 + 0.02, CABW / 2, ZW + 0.02, 'paint')
# The roof (and its sun visor), the back wall, the floor.
cube(g, CAB0, -CABW / 2, ZR - 0.06, CAB1 - 0.05 - lean, CABW / 2, ZR + 0.04, 'paint')
cube(g, CAB1 - 0.05 - lean - 0.05, -CABW / 2 + 0.05, ZR - 0.02, CAB1 - lean + 0.1, CABW / 2 - 0.05, ZR + 0.06, 'paint')
cube(g, CAB0, -CABW / 2, Z0, CAB0 + 0.06, CABW / 2, ZR, 'paint')
cube(g, CAB0 + 0.05, -CABW / 2 + 0.3, ZW + 0.15, CAB0 + 0.07, CABW / 2 - 0.3, ZR - 0.3, 'glass')
cube(g, CAB0, -CABW / 2, Z0 - 0.06, CAB1, CABW / 2, Z0, 'plastic')
# The sides round the doors: behind the door (a pillar), the sill under it, the step.
DOOR0, DOOR1 = CAB0 + 0.12, CAB1 - 0.32
for side in (-1, 1):
    y0, y1 = (CABW / 2 - 0.05, CABW / 2) if side > 0 else (-CABW / 2, -CABW / 2 + 0.05)
    cube(g, CAB0, y0, Z0, DOOR0, y1, ZR, 'paint')
    # (Over the wheel the panel stops at the arch.)
    cube(g, DOOR1, y0, ARCH_TOP, CAB1 - 0.05, y1, ZW, 'paint')
    cube(g, CAB0, y0 - 0.02, 0.42, FRONT_X - ARCH_R - 0.02, y1 + 0.02, Z0, 'black')
    cube(g, FRONT_X + ARCH_R + 0.02, y0 - 0.02, 0.42, CAB1 - 0.1, y1 + 0.02, ARCH_TOP, 'paint')
    # The mudguard over the front wheel: a curved shell over its tread, its lip flush with the side.
    bm, uvl = g
    arc = []
    n_arc = 18
    for k in range(n_arc + 1):
        a = math.radians(8 + 164 * k / n_arc)
        for rr in (ARCH_R, ARCH_R + 0.05):
            for yy in (side * (TRACK_F - 0.2), side * (CABW / 2 + 0.01)):
                arc.append(bm.verts.new((FRONT_X + math.cos(a) * rr, yy, R + math.sin(a) * rr)))
    for k in range(n_arc):
        q = [arc[k * 4 + i] for i in range(4)]
        n = [arc[(k + 1) * 4 + i] for i in range(4)]
        for a_, b_ in ((0, 1), (3, 2), (2, 0), (1, 3)):
            f = bm.faces.new((q[a_], q[b_], n[b_], n[a_]) if side > 0 else (n[a_], n[b_], q[b_], q[a_]))
            f.material_index = IDX['plastic']
    # The step up to the door, on its two brackets under the sill.
    sy = side * (CABW / 2 + 0.02)
    cube(g, DOOR0 + 0.1, sy - 0.13, 0.28, DOOR0 + 0.6, sy + 0.11, 0.32, 'chassis')
    for x in (DOOR0 + 0.14, DOOR0 + 0.52):
        cube(g, x, sy - 0.03, 0.32, x + 0.04, sy + 0.01, 0.42, 'chassis')
cab = obj('truck_cab', g, root, round_edges=0.035)
# The windscreen's wipers, resting on its foot.
g = group()
for y in (-0.45, 0.35):
    cube(g, CAB1 - 0.1, y - 0.3, ZW + 0.03, CAB1 - 0.07, y + 0.3, ZW + 0.05, 'black')
obj('truck_wipers', g, root)

# Inside: the dashboard, the seats (the driver's on the left), the steering wheel on its column.
g = group()
cube(g, CAB1 - 0.55, -CABW / 2 + 0.06, Z0, CAB1 - 0.08, CABW / 2 - 0.06, ZW - 0.05, 'dash')
cube(g, CAB1 - 0.62, -CABW / 2 + 0.06, ZW - 0.12, CAB1 - 0.3, CABW / 2 - 0.06, ZW - 0.02, 'dash')
for y, wide in ((0.5, 0.5), (-0.35, 0.9)):
    cube(g, CAB0 + 0.25, y - wide / 2, Z0, CAB0 + 0.7, y + wide / 2, Z0 + 0.42, 'seat')
    cube(g, CAB0 + 0.12, y - wide / 2, Z0 + 0.42, CAB0 + 0.25, y + wide / 2, Z0 + 1.15, 'seat')
obj('truck_inside', g, root)
DRIVER = mathutils.Vector((CAB0 + 0.5, 0.5, Z0 + 0.42))
column = empty('truck_steer', (CAB1 - 0.62, 0.5, ZW - 0.05), root)
column.rotation_euler = (0, math.radians(-38), 0)
g = group()
bm, uvl = g
ring = bmesh.ops.create_circle(bm, segments=24, radius=0.21)
for v in ring['verts']:
    v.co = mathutils.Vector((0, v.co.x, v.co.y))
bmesh.ops.extrude_edge_only(bm, edges=bm.edges[:])
for v in bm.verts[24:]:
    v.co = mathutils.Vector((0.03, v.co.y * 0.88, v.co.z * 0.88))
for f in bm.faces:
    f.material_index = IDX['black']
cube(g, -0.02, -0.03, -0.2, 0.02, 0.03, 0.2, 'black')
cylinder(bm, (0.0, 0.0, 0.0), 0.05, 0.06, segments=12, mat=IDX['black'], lying=True)
wheel_mesh = obj('truck_steering_wheel', g, column)
wheel_mesh.rotation_euler = (0, math.radians(90), 0)

# ---- The doors: each hinged at its front edge, its window, its handle, its mirror ---------------
doors = []
for side, name in ((1, 'truck_door_l'), (-1, 'truck_door_r')):
    hinge = empty(name, (DOOR1, side * (CABW / 2 - 0.025), 0), root)
    g = group()
    w = DOOR1 - DOOR0
    cube(g, -w, -0.025, 0.72, 0, 0.025, ZW, 'paint')
    bm, uvl = g
    gv = [bm.verts.new(p) for p in ((-w + 0.06, side * 0.03, ZW + 0.02), (-0.04, side * 0.03, ZW + 0.02), (-0.04 - lean * 0.6, side * 0.03, ZR - 0.1), (-w + 0.06, side * 0.03, ZR - 0.1))]
    f = bm.faces.new(gv if side > 0 else list(reversed(gv)))
    f.material_index = IDX['glass']
    cube(g, -w, -0.03, ZR - 0.12, -0.03 - lean * 0.6, 0.03, ZR - 0.06, 'paint')
    cube(g, -w, -0.03, ZW - 0.02, 0, 0.03, ZW + 0.04, 'black')
    cube(g, -w + 0.15, side * 0.03 - 0.015, 1.25, -w + 0.4, side * 0.03 + 0.015, 1.3, 'chrome')
    # The mirror, on its arm out from the door's front.
    cube(g, -0.05, side * 0.02, ZW + 0.1, 0.02, side * 0.32, ZW + 0.14, 'chrome')
    cube(g, -0.05, side * 0.28, ZW - 0.05, 0.03, side * 0.42, ZW + 0.45, 'black')
    obj(f'{name}_mesh', g, hinge, round_edges=0.02)
    doors.append({'name': name, 'side': 'left' if side > 0 else 'right', 'front': True, 'open': -side * 1.15})

# ---- The box: ribbed aluminium, the store's stripe and name, its back doors ---------------------
g = group()
cube(g, BOX0 + 0.06, -BOXW / 2, BOXZ0, BOX1, BOXW / 2, BOXZ1, 'box')
cube(g, BOX0, -BOXW / 2 - 0.02, BOXZ1 - 0.06, BOX1 + 0.02, BOXW / 2 + 0.02, BOXZ1 + 0.04, 'rib')
cube(g, BOX0, -BOXW / 2 - 0.02, BOXZ0 - 0.06, BOX1 + 0.02, BOXW / 2 + 0.02, BOXZ0 + 0.04, 'rib')
for side in (-1, 1):
    y = side * (BOXW / 2 + 0.012)
    x = BOX0 + 0.25
    while x < BOX1 - 0.1:
        cube(g, x - 0.02, y - 0.012, BOXZ0 + 0.05, x + 0.02, y + 0.012, BOXZ1 - 0.05, 'rib')
        x += 0.52
    # The stripe: orange, along the side, and over it the store's name.
    cube(g, BOX0 + 0.1, y - 0.016, BOXZ0 + 0.45, BOX1 - 0.1, y + 0.016, BOXZ0 + 0.62, 'orange')
    yaw = 0 if side < 0 else math.pi
    kit.text('FURNITURE CITY', ((BOX0 + BOX1) / 2, y + side * 0.03), yaw, 0.48, '#141414', BOXZ0 + 1.25, depth=0.005)
    kit.text('Home · Living · Bed Room · Kitchen', ((BOX0 + BOX1) / 2, y + side * 0.03), yaw, 0.15, '#3a3a3a', BOXZ0 + 0.9, depth=0.003)
    kit.text('Tubman Boulevard, Monrovia  ·  0777 210 455', ((BOX0 + BOX1) / 2, y + side * 0.03), yaw, 0.11, '#ffffff', BOXZ0 + 0.5, depth=0.003)
# The front of the box over the cab: a wind deflector.
bm, uvl = g
# (A closed wedge on the cab's roof: its sloped face, its two sides, back to the box.)
DX0, DZ1, DW = CAB0 + 0.85, BOXZ1 - 0.06, CABW / 2 - 0.06
wedge = []
for y in (-DW, DW):
    wedge.append([bm.verts.new(p) for p in ((DX0, y, ZR + 0.04), (BOX1, y, ZR + 0.04), (BOX1, y, DZ1), (CAB0 + 0.15, y, DZ1))])
(a0, a1, a2, a3), (b0, b1, b2, b3) = wedge
for quad in ((a0, a3, b3, b0), (a3, a2, b2, b3), (a1, b1, b2, a2), (a0, b0, b1, a1), (a0, a1, a2, a3), (b0, b3, b2, b1)):
    f = bm.faces.new(quad)
    f.material_index = IDX['paint']
bmesh.ops.recalc_face_normals(bm, faces=list({f for side in wedge for v in side for f in v.link_faces}))
# The back: its frame, the tail lamps, the step, the bar against cars running under.
cube(g, BOX0, -BOXW / 2, BOXZ0, BOX0 + 0.06, -BOXW / 2 + 0.08, BOXZ1, 'rib')
cube(g, BOX0, BOXW / 2 - 0.08, BOXZ0, BOX0 + 0.06, BOXW / 2, BOXZ1, 'rib')
cube(g, BOX0, -BOXW / 2, BOXZ1 - 0.12, BOX0 + 0.06, BOXW / 2, BOXZ1, 'rib')
for side in (-1, 1):
    cube(g, BOX0 - 0.03, side * (BOXW / 2 - 0.2) - 0.12, 0.72, BOX0 + 0.02, side * (BOXW / 2 - 0.2) + 0.12, 0.92, 'tail')
    cube(g, BOX0 - 0.03, side * (BOXW / 2 - 0.2) - 0.12, 0.62, BOX0 + 0.02, side * (BOXW / 2 - 0.2) + 0.12, 0.7, 'amber')
cube(g, BOX0 - 0.08, -0.95, 0.42, BOX0 + 0.05, 0.95, 0.52, 'chassis')
cube(g, BOX0 - 0.3, -0.5, 0.55, BOX0 + 0.05, 0.5, 0.6, 'chassis')
obj('truck_box', g, root, round_edges=0.025)
for side, name in ((1, 'truck_back_l'), (-1, 'truck_back_r')):
    hinge = empty(name, (BOX0, side * (BOXW / 2 - 0.04), 0), root)
    g = group()
    half = BOXW / 2 - 0.06
    cube(g, -0.04, -half if side > 0 else 0.0, BOXZ0 + 0.04, 0.0, 0.0 if side > 0 else half, BOXZ1 - 0.12, 'box')
    # (Its own frame: the door's leaf spans from the hinge to the middle.)
    for z in (BOXZ0 + 0.6, BOXZ1 - 0.7):
        cube(g, -0.06, -half * 0.95 if side > 0 else 0.05, z, -0.03, -0.05 if side > 0 else half * 0.95, z + 0.05, 'rib')
    rod_y = -half * 0.5 if side > 0 else half * 0.5
    for ry in (rod_y - 0.18, rod_y + 0.18):
        cube(g, -0.08, ry - 0.02, BOXZ0 + 0.1, -0.04, ry + 0.02, BOXZ1 - 0.2, 'chrome')
        cube(g, -0.12, ry - 0.025, BOXZ0 + 0.9, -0.04, ry + 0.025, BOXZ0 + 1.0, 'chassis')
    leaf = obj(f'{name}_mesh', g, hinge)
    leaf.location = (0, 0, 0)
    doors.append({'name': name, 'side': 'left' if side > 0 else 'right', 'front': False, 'open': -side * 1.6, 'back': True})

# ---- The chassis, the tank, the exhaust, the mud flaps; the plates -----------------------------
g = group()
for y in (-0.42, 0.42):
    cube(g, BOX0 + 0.1, y - 0.05, 0.6, CAB1 - 0.2, y + 0.05, 0.82, 'chassis')
bm, uvl = g
cylinder(bm, (-0.2, 0.86, 0.62), 0.24, 0.9, axis_yaw=0.0, segments=20, mat=IDX['chrome'], lying=True)
cylinder(bm, (0.9, -0.9, 0.6), 0.05, 1.2, axis_yaw=math.pi / 2, segments=10, mat=IDX['chassis'], lying=True)
for x in (REAR_X - R - 0.1, FRONT_X - ARCH_R - 0.06):
    for side in (-1, 1):
        cube(g, x - 0.008, side * 0.9 - 0.16, 0.16, x + 0.008, side * 0.9 + 0.16, 0.6, 'mud')
for x, s in ((CAB1 + 0.09, 1), (BOX0 - 0.04, -1)):
    cube(g, x - 0.01, -0.26, 0.48 if s > 0 else 0.98, x + 0.01, 0.26, 0.62 if s > 0 else 1.12, 'plate')
    cube(g, x + 0.011 * s, -0.24, 0.585 if s > 0 else 1.085, x + 0.013 * s, 0.24, 0.61 if s > 0 else 1.11, 'plate_blue')
obj('truck_chassis', g, root)
for x, s in ((CAB1 + 0.11, 1), (BOX0 - 0.06, -1)):
    kit.text('LIBERIA', (x, 0), math.pi / 2 if s > 0 else -math.pi / 2, 0.035, '#ffffff', (0.6 if s > 0 else 1.1) - 0.005)
    kit.text('CM 4417', (x, 0), math.pi / 2 if s > 0 else -math.pi / 2, 0.075, '#1f3d8c', (0.53 if s > 0 else 1.03))


# ---- The wheels: a tyre with its tread, a steel rim and its hub, its studs --------------------------
def make_wheel(name, parent, width=0.24, twin=False):
    g = group()
    bm, uvl = g
    segs, sec = 36, 10
    for k_off in ((-0.14, 0.14) if twin else (0.0,)):
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            rib = 0.012 if i % 2 == 0 else 0.0
            row = []
            for j in range(sec):
                b = 2 * math.pi * j / sec
                rr = R * 0.7 + (R * 0.3 + rib * max(0, math.cos(b))) * (0.5 + 0.5 * math.cos(b))
                row.append(bm.verts.new((math.cos(a) * rr, k_off + math.sin(b) * width / 2, math.sin(a) * rr)))
            ring.append(row)
        for i in range(segs):
            for j in range(sec):
                f = bm.faces.new((ring[i][j], ring[(i + 1) % segs][j], ring[(i + 1) % segs][(j + 1) % sec], ring[i][(j + 1) % sec]))
                f.material_index = IDX['tyre']
    outer = (0.14 + width * 0.32) if twin else width * 0.32
    for side in (-1, 1):
        rim = bmesh.ops.create_circle(bm, cap_ends=True, radius=R * 0.6, segments=segs)
        for v in rim['verts']:
            v.co = mathutils.Vector((v.co.x, side * outer, v.co.y))
        for f in {f for v in rim['verts'] for f in v.link_faces}:
            f.material_index = IDX['rim']
        hub = bmesh.ops.create_circle(bm, cap_ends=True, radius=R * 0.22, segments=16)
        for v in hub['verts']:
            v.co = mathutils.Vector((v.co.x, side * (outer + 0.02), v.co.y))
        for f in {f for v in hub['verts'] for f in v.link_faces}:
            f.material_index = IDX['hub']
        for k in range(6):
            a = 2 * math.pi * k / 6
            cylinder(bm, (math.cos(a) * R * 0.32, side * (outer + 0.025), math.sin(a) * R * 0.32), 0.018, 0.03, axis_yaw=math.pi / 2, segments=6, mat=IDX['chrome'], lying=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj(name, g, parent, smooth=True)
    return o


plan_wheels = {}
steer_pivots = []
for key, x, y, twin in (('fl', FRONT_X, TRACK_F, False), ('fr', FRONT_X, -TRACK_F, False), ('rl', REAR_X, TRACK_R, True), ('rr', REAR_X, -TRACK_R, True)):
    # (Turned so that its own x is the axle, its own up the upright, as the cars' are: the game
    # rolls it about its x and steers it about its up.)
    pivot = empty(f'truck_wheel_{key}', (x, y, R), root)
    pivot.rotation_euler = (0, 0, math.pi / 2)
    tyre = make_wheel(f'truck_tyre_{key}', pivot, twin=twin)
    tyre.rotation_euler = (0, 0, -math.pi / 2)
    plan_wheels[key] = {'node': pivot.name, 'at': [round(x, 3), round(R, 3), round(-y, 3)], 'r': R}

# Text as meshes, under the root (the box's lettering with the box).
for o in list(bpy.context.scene.objects):
    if o.type == 'FONT':
        with bpy.context.temp_override(active_object=o, selected_objects=[o], selected_editable_objects=[o], object=o):
            bpy.ops.object.convert(target='MESH')
for o in list(bpy.context.scene.objects):
    if o.parent is None and o is not root:
        o.parent = root
        o.name = 'truck_lettering'

plan = {
    'truck': {
        'wheels': plan_wheels,
        'doors': doors,
        'steer': 'truck_steer',
        'driver': [round(DRIVER.x, 3), round(DRIVER.z, 3), round(-DRIVER.y, 3)],
        'size': [round(CAB1 + 0.12 - BOX0, 2), round(BOXZ1 + 0.04, 2), round(BOXW + 0.04, 2)],
        'wheelbase': round(FRONT_X - REAR_X, 3),
        # The box's floor (where things ride), its back (where they come out).
        'cargo': {'x0': round(BOX0 + 0.1, 2), 'x1': round(BOX1 - 0.1, 2), 'floor': BOXZ0, 'wide': BOXW - 0.1},
    }
}
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='JPEG', export_apply=True, export_yup=True)
with open(PLAN, 'w') as f:
    json.dump(plan, f, indent=1)
print('GLB', os.path.getsize(OUT), plan['truck']['size'])
