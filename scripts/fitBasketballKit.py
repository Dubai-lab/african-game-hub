# Puts the basketball kit (a jersey and shorts, art-src/basketball/uniform-kit, an ASCII FBX made
# to fit a mannequin) on the game's character, in Blender. Used by makeBasketballCharacter.py.
#
# The kit comes with the mannequin it was made on: the mannequin is stood where the character
# stands, as tall as him, and the kit goes with it, keeping its own shape. What it covers of the
# character's own clothes is taken away (it would show through as he moves). Finally the kit takes the character's skin weights, so it moves with
# the skeleton exactly as the body under it does.
import math
import os

import bmesh

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from asciiFbx import load

# A piece of the character within this distance under the kit, looking straight out, is covered.
COVERED = 0.14
# ... or the kit within this distance of it, any way.
CLOSE = 0.04


def _bounds(obj):
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])


def _apply(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def _image(path, size, name, non_color=False):
    img = bpy.data.images.load(path)
    img.name = name
    if img.size[0] > size:
        img.scale(size, size)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    img.pack()
    return img


def _material(name, folder, tile):
    """The kit's own pictures for one UDIM tile, small enough for a phone."""
    base = os.path.join(folder, f'Mens_Basketball_Uniform_{tile}')
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes['Principled BSDF']
    colour = nodes.new('ShaderNodeTexImage')
    colour.image = _image(base + '_bcolor.png', 1024, name + '_colour')
    links.new(colour.outputs['Color'], bsdf.inputs['Base Color'])
    normal = nodes.new('ShaderNodeTexImage')
    normal.image = _image(base + '_norm.png', 512, name + '_normal', non_color=True)
    bump = nodes.new('ShaderNodeNormalMap')
    links.new(normal.outputs['Color'], bump.inputs['Color'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.75
    bsdf.inputs['Metallic'].default_value = 0.0
    return m


def fit_kit(folder, rig, body):
    """Dresses `body` (skinned to `rig`) in the kit from `folder`. Returns the kit's objects."""
    # Everything is fitted to the skeleton's rest pose (arms out), which the skin weights mean.
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    loaded = load(os.path.join(folder, 'Mens_Basketball_Uniform.fbx'))
    # FBX is centimetres with Y up; Blender metres with Z up.
    to_blender = Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Scale(0.01, 4)
    for o in loaded:
        o.matrix_world = to_blender @ o.matrix_world
    bpy.context.view_layer.update()
    mannequin = next(o for o in loaded if o.name.startswith('G2M'))
    jersey = next(o for o in loaded if o.name.endswith('Uniform2'))
    shorts = next(o for o in loaded if o.name.endswith('Uniform3'))
    kit = [jersey, shorts]
    for o in loaded:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        o.select_set(False)

    # The mannequin stood where the character stands, as tall as him.
    (m_lo, m_hi), (b_lo, b_hi) = _bounds(mannequin), _bounds(body)
    scale = (b_hi.z - b_lo.z) / (m_hi.z - m_lo.z)
    m_mid = Vector(((m_lo.x + m_hi.x) / 2, (m_lo.y + m_hi.y) / 2, m_lo.z))
    b_mid = Vector(((b_lo.x + b_hi.x) / 2, (b_lo.y + b_hi.y) / 2, b_lo.z))
    place = Matrix.Translation(b_mid) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-m_mid)
    for o in loaded:
        o.data.transform(place)
        o.data.update()

    # The kit keeps its own shape: what of the character's own clothes it covers is taken away
    # below, so nothing needs pushing aside.
    bpy.data.objects.remove(mannequin, do_unlink=True)

    # The pictures: the jersey on tile 1001, the shorts on tile 1002 (its UVs moved back to 0-1).
    jersey.data.materials.append(_material('kit_jersey', folder, 1001))
    for loop in shorts.data.uv_layers[0].data:
        loop.uv = (loop.uv[0] - 1, loop.uv[1])
    shorts.data.materials.append(_material('kit_shorts', folder, 1002))

    # What the kit covers of the character is taken away: never seen, and it would show
    # through the kit as he moves. Looking straight out from each piece of him, the kit right
    # in front means it is covered.
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(o, depsgraph) for o in kit]
    to_world = body.matrix_world
    normal_to_world = to_world.to_3x3().inverted().transposed()
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    mesh.normal_update()
    covered = []
    for face in mesh.faces:
        at = to_world @ face.calc_center_median()
        out = (normal_to_world @ face.normal).normalized()
        # Both ways: the character's surfaces do not all face out.
        # Or the kit lies right on it.
        near = min((tree.find_nearest(at)[3] or 1) for tree in trees)
        if near < CLOSE or any(tree.ray_cast(at + d * 0.002, d, COVERED)[0] is not None for tree in trees for d in (out, -out)):
            covered.append(face)
    bmesh.ops.delete(mesh, geom=covered, context='FACES')
    mesh.to_mesh(body.data)
    mesh.free()
    print('KIT covers', len(covered), 'faces of the character')

    # The character's skin weights, nearest point on his body, and his skeleton.
    for o in kit:
        for group in body.vertex_groups:
            o.vertex_groups.new(name=group.name)
        weights = o.modifiers.new('weights', 'DATA_TRANSFER')
        weights.object = body
        weights.use_vert_data = True
        weights.data_types_verts = {'VGROUP_WEIGHTS'}
        weights.vert_mapping = 'POLYINTERP_NEAREST'
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.datalayout_transfer(modifier='weights')
        _apply(o, weights)
        o.parent = rig
        o.matrix_parent_inverse = rig.matrix_world.inverted()
        arm = o.modifiers.new('armature', 'ARMATURE')
        arm.object = rig
        o.name = 'kit_' + ('jersey' if o is jersey else 'shorts')
    rig.data.pose_position = 'POSE'
    return kit
