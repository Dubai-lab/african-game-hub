# Reads the meshes out of an ASCII FBX file (the text kind, which Blender's importer refuses)
# into Blender: positions, faces, UVs and each model's placement. Enough for a static model such
# as the basketball kit (art-src/basketball/uniform-kit); no skeletons, no animation.
#
#   from asciiFbx import load
#   objects = load('Mens_Basketball_Uniform.fbx')   # one Blender mesh object per FBX model
#
# The file is a tree of `Name: values { children }` blocks. Arrays are written `*count { a: ... }`.
import math
import re

import bpy
from mathutils import Euler, Matrix, Vector

_TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|[{}]|[^\s,{}:]+:|[^\s,{}]+|,')


def _parse(text):
    """The file as nested lists of (name, values, children)."""
    text = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith(';'))
    tokens = _TOKEN.findall(text)
    pos = 0

    def node_list(until_close):
        nonlocal pos
        nodes = []
        while pos < len(tokens):
            tok = tokens[pos]
            if tok == '}':
                pos += 1
                return nodes
            if not tok.endswith(':') or tok.startswith('"'):
                pos += 1
                continue
            name = tok[:-1]
            pos += 1
            values = []
            children = []
            while pos < len(tokens):
                tok = tokens[pos]
                if tok == ',':
                    pos += 1
                    continue
                if tok == '{':
                    pos += 1
                    children = node_list(True)
                    break
                if tok == '}' or (tok.endswith(':') and not tok.startswith('"')):
                    break
                values.append(tok)
                pos += 1
            nodes.append((name, values, children))
        return nodes

    return node_list(False)


def _value(token):
    if token.startswith('"'):
        return token[1:-1]
    try:
        return int(token)
    except ValueError:
        try:
            return float(token)
        except ValueError:
            return token


def _child(node, name):
    return next((c for c in node[2] if c[0] == name), None)


def _array(node, name):
    """An `*count { a: ... }` array under `node`."""
    c = _child(node, name)
    if c is None:
        return []
    a = _child(c, 'a')
    return [_value(v) for v in a[1]] if a else []


def _props(node):
    """Properties70 as name -> list of values."""
    p = _child(node, 'Properties70')
    out = {}
    for prop in (p[2] if p else []):
        if prop[0] == 'P':
            vals = [_value(v) for v in prop[1]]
            out[vals[0]] = vals[4:]
    return out


def load(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        tree = _parse(f.read())
    objects_node = next(n for n in tree if n[0] == 'Objects')
    connections = next((n for n in tree if n[0] == 'Connections'), ('', [], []))
    geometries = {}
    models = {}
    for node in objects_node[2]:
        if node[0] == 'Geometry' and len(node[1]) >= 3 and _value(node[1][2]) == 'Mesh':
            geometries[_value(node[1][0])] = node
        elif node[0] == 'Model':
            models[_value(node[1][0])] = node
    # Geometry -> model it belongs to.
    owner = {}
    for c in connections[2]:
        if c[0] == 'C':
            vals = [_value(v) for v in c[1]]
            if vals[0] == 'OO' and vals[1] in geometries and vals[2] in models:
                owner[vals[1]] = vals[2]

    made = []
    for gid, geo in geometries.items():
        verts = _array(geo, 'Vertices')
        index = _array(geo, 'PolygonVertexIndex')
        points = [Vector(verts[i:i + 3]) for i in range(0, len(verts), 3)]
        faces = []
        face = []
        for i in index:
            if i < 0:
                face.append(-i - 1)
                faces.append(face)
                face = []
            else:
                face.append(i)
        mesh = bpy.data.meshes.new(str(gid))
        mesh.from_pydata([tuple(p) for p in points], [], faces)
        # UVs, by polygon vertex (directly or through an index).
        layer = _child(geo, 'LayerElementUV')
        if layer is not None:
            uv = _array(layer, 'UV')
            uv_index = _array(layer, 'UVIndex')
            mapping = (_child(layer, 'MappingInformationType') or ('', ['"ByPolygonVertex"'], []))[1][0].strip('"')
            ref = (_child(layer, 'ReferenceInformationType') or ('', ['"Direct"'], []))[1][0].strip('"')
            pairs = [(uv[i], uv[i + 1]) for i in range(0, len(uv), 2)]
            data = mesh.uv_layers.new(name='UVMap').data
            loop = 0
            for f_i, f in enumerate(faces):
                for k, vi in enumerate(f):
                    if mapping == 'ByPolygonVertex':
                        j = uv_index[loop] if ref == 'IndexToDirect' else loop
                    else:  # ByControlPoint / ByVertice
                        j = uv_index[vi] if ref == 'IndexToDirect' else vi
                    data[loop].uv = pairs[j]
                    loop += 1
        mesh.validate()
        model = models.get(owner.get(gid))
        name = _value(model[1][1]).split('::')[-1] if model else str(gid)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if model:
            props = _props(model)
            t = props.get('Lcl Translation', [0, 0, 0])
            r = props.get('Lcl Rotation', [0, 0, 0])
            s = props.get('Lcl Scaling', [1, 1, 1])
            obj.matrix_world = Matrix.Translation(Vector(t)) @ Euler([math.radians(a) for a in r], 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal(Vector((*s, 1)))
        made.append(obj)
    return made
