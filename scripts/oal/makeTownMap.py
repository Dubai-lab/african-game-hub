# One Africa Life: the in-game map of a town, from OpenStreetMap (© OpenStreetMap contributors,
# ODbL): its roads (big and small), its rivers, lagoons and swamps, the sea, its airfields, and
# where the game's places are. Written as metres east (x) and north (y) of the town's centre,
# simplified to a few metres (a phone draws it as a picture it can drag and pinch).
#
#   python3 scripts/oal/makeTownMap.py            (all towns)
#   python3 scripts/oal/makeTownMap.py monrovia   (one)
#
# In: art-src/one-africa-life/osm/map_<town>.json (Overpass: roads) and map_<town>_water.json
# (water, coastline, airfields, with their tags).
# Out: public/oal/maps/<town>.v3.json.
import json
import math
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OSM = os.path.join(ROOT, 'art-src', 'one-africa-life', 'osm')
OUT = os.path.join(ROOT, 'public', 'oal', 'maps')
SRC = os.path.join(ROOT, 'src', 'games', 'oal')

# Each town: its centre; the sides of the map the sea lies to, from where the coastline ends
# (OSM runs it with the land on its left) round to where it starts;
# the 3D streets on it (their centres, so their places fall where they are); and the game's
# other places, where they are in the real town.
TOWNS = {
    'monrovia': {
        'centre': (6.3045, -10.7900), 'sea': ['s', 'sw', 'w', 'nw'],
        'streets': {'sinkor': ((6.2913452, -10.7781804), 'sinkorStreet.json'), 'waterside': ((6.3186932, -10.8030225), 'watersideMarket.json'),
                    'skd': ((6.257008812451475, -10.702114100037994), 'skdStadium.json')},
        'places': {
            'home': (6.2886, -10.7745),     # a family house off 16th Street, Sinkor
            'jobs': (6.3127, -10.8018),     # the job board on Broad Street
            'visa': (6.3169, -10.8102),     # the embassies' quarter, Mamba Point
            'station': (6.2905, -10.7206),  # Red Light parking station, Paynesville
            'health': (6.2795, -10.7590),   # the Ministry of Health, Oldest Congo Town
        },
        # Off the map, with the way to it: Roberts International, at Harbel.
        'far': {'airport': ((6.2338, -10.3623), 'Roberts International Airport')},
    },
    'accra': {
        'centre': (5.5800, -0.1950), 'sea': ['se', 's', 'sw'],
        'streets': {},
        'places': {
            'home': (5.5832, -0.2005),      # Nima
            'town': (5.5560, -0.1818),      # Oxford Street, Osu: the cookshop, phone shop, changer...
            'jobs': (5.5490, -0.2050),      # central Accra
            'visa': (5.5760, -0.1750),      # Cantonments
            'airport': (5.6052, -0.1668),   # Kotoka International
        },
    },
    'kumasi': {
        'centre': (6.6950, -1.6230), 'sea': [],
        'streets': {},
        'places': {'home': (6.7010, -1.6300), 'town': (6.6955, -1.6195), 'jobs': (6.6900, -1.6250)},
    },
    'voinjama': {
        'centre': (8.4219, -9.7478), 'sea': [],
        'streets': {'voinjama': ((8.4229204, -9.7477204), 'voinjamaTown.json')},
        'places': {'home': (8.4245, -9.7505), 'jobs': (8.4200, -9.7460), 'station': (8.4232, -9.7449)},
    },
}
MAJOR = {'motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'}
MIDDLE = {'tertiary', 'tertiary_link'}
MINOR = {'residential', 'unclassified', 'service', 'living_street', 'track'}
# Walked only: footpaths through the communities (the game's people walk them).
PATH = {'path', 'footway', 'pedestrian', 'steps'}


def simplify(pts, tol):
    """Douglas-Peucker: the fewest points within tol metres of the line."""
    if len(pts) < 3:
        return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy) or 1e-9
    far, k = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = abs(dy * px - dx * py + bx * ay - by * ax) / ln if ln > 1e-9 else math.hypot(px - ax, py - ay)
        if d > far:
            far, k = d, i
    if far <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)


def build(name, cfg):
    data = json.load(open(os.path.join(OSM, f'map_{name}.json')))
    # The water, coast and airfields come in their own file (with their tags).
    extra = os.path.join(OSM, f'map_{name}_water.json')
    if os.path.exists(extra):
        data['elements'] += json.load(open(extra))['elements']
    lat0, lon0 = cfg['centre']
    m_lon = 111_320.0 * math.cos(math.radians(lat0))

    def xy(lat, lon):
        return ((lon - lon0) * m_lon, (lat - lat0) * 111_320.0)

    nodes = {e['id']: xy(e['lat'], e['lon']) for e in data['elements'] if e['type'] == 'node'}
    ways = {}
    for e in data['elements']:
        if e['type'] == 'way':
            ways.setdefault(e['id'], {}).update({k: v for k, v in e.items() if k in ('nodes', 'tags')})
    pts_of = lambda w: [nodes[n] for n in w.get('nodes', []) if n in nodes]
    r = lambda p: [round(p[0]), round(p[1])]
    flat = lambda line: [c for p in line for c in r(p)]

    roads = {'major': [], 'middle': [], 'minor': [], 'path': []}
    # Where roads meet (a node in two of them or more): kept through simplifying, so the game's
    # road network stays joined at its junctions.
    uses = {}
    for w in ways.values():
        if w.get('tags', {}).get('highway') in MAJOR | MIDDLE | MINOR | PATH:
            for n in set(w.get('nodes', [])):
                uses[n] = uses.get(n, 0) + 1

    def keep_junctions(w, tol):
        ids = [n for n in w.get('nodes', []) if n in nodes]
        pts = [nodes[n] for n in ids]
        cuts = [0] + [i for i in range(1, len(ids) - 1) if uses.get(ids[i], 0) > 1] + [len(ids) - 1]
        out = []
        for a, b in zip(cuts, cuts[1:]):
            piece = simplify(pts[a:b + 1], tol)
            out += piece if not out else piece[1:]
        return out
    water, wetland, rivers, coast, airfields = [], [], [], [], []
    for w in ways.values():
        tags = w.get('tags', {})
        pts = pts_of(w)
        if len(pts) < 2:
            continue
        hw = tags.get('highway')
        if hw in MAJOR | MIDDLE | MINOR | PATH:
            cls = 'major' if hw in MAJOR else 'middle' if hw in MIDDLE else 'minor' if hw in MINOR else 'path'
            if cls in ('minor', 'path') and sum(math.dist(a, b) for a, b in zip(pts, pts[1:])) < 15:
                continue
            line = keep_junctions(w, 2.5 if cls in ('major', 'middle') else 4.0)
            # One way (a dual carriageway is two of them): its traffic goes the way it is drawn.
            one = tags.get('oneway') in ('yes', '1', 'true') or hw in ('motorway', 'motorway_link')
            if tags.get('oneway') == '-1':
                line, one = line[::-1], True
            roads[cls].append({'p': flat(line), **({'n': tags['name']} if tags.get('name') and cls != 'path' else {}), **({'o': 1} if one else {})})
        elif tags.get('natural') == 'coastline':
            coast.append(pts)
        elif tags.get('natural') == 'water' and len(pts) > 3:
            water.append(flat(simplify(pts, 4.0)))
        elif tags.get('natural') == 'wetland' and len(pts) > 3:
            wetland.append(flat(simplify(pts, 6.0)))
        elif tags.get('waterway') in ('river', 'stream'):
            rivers.append({'p': flat(simplify(pts, 4.0)), 'w': 1 if tags['waterway'] == 'stream' else 3})
        elif tags.get('aeroway') == 'aerodrome' and len(pts) > 3:
            airfields.append(flat(simplify(pts, 5.0)))
    # Water multipolygons (rivers and lagoons drawn as areas): their outer rings.
    for e in data['elements']:
        if e['type'] == 'relation' and e.get('tags', {}).get('natural') == 'water':
            for m in e.get('members', []):
                if m['type'] == 'way' and m['role'] == 'outer' and m['ref'] in ways:
                    pts = pts_of(ways[m['ref']])
                    if len(pts) > 3:
                        water.append(flat(simplify(pts, 4.0)))

    xs = [p[0] for p in nodes.values()]
    ys = [p[1] for p in nodes.values()]
    bounds = [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))]

    # The sea: the coastline's pieces joined, closed round the map's corners on the sea side.
    sea = []
    if coast and cfg['sea']:
        pieces = [list(c) for c in coast]
        line = pieces.pop(0)
        while pieces:
            best = min(range(len(pieces)), key=lambda i: min(math.dist(line[-1], pieces[i][0]), math.dist(line[0], pieces[i][-1])))
            p = pieces.pop(best)
            if math.dist(line[-1], p[0]) <= math.dist(line[0], p[-1]):
                line = line + p
            else:
                line = p + line
        x0, y0, x1, y1 = bounds
        pad = 4000
        corner = {'sw': (x0 - pad, y0 - pad), 'se': (x1 + pad, y0 - pad), 'nw': (x0 - pad, y1 + pad), 'ne': (x1 + pad, y1 + pad),
                  'w': (x0 - pad, (y0 + y1) / 2), 'e': (x1 + pad, (y0 + y1) / 2), 's': ((x0 + x1) / 2, y0 - pad), 'n': ((x0 + x1) / 2, y1 + pad)}
        # OSM coastlines run with the land on their left: from the line's end, round the sea's
        # corners (listed in that order), back to its start.
        # Where the data stops short of the map's edge, each end goes straight out to the nearest
        # edge first (or the sea would cut across the land to the next corner).
        def out(p):
            d = {'w': p[0] - x0, 'e': x1 - p[0], 's': p[1] - y0, 'n': y1 - p[1]}
            side = min(d, key=d.get)
            return {'w': (x0 - pad, p[1]), 'e': (x1 + pad, p[1]), 's': (p[0], y0 - pad), 'n': (p[0], y1 + pad)}[side]
        line = simplify(line, 4.0)
        sea_pts = line + [out(line[-1])] + [corner[c] for c in cfg['sea']] + [out(line[0])]
        sea = flat(sea_pts)

    # Around the streets built in 3D, every building's outline (from those scenes' own maps).
    buildings = []
    for street, ((la, lo), _plan) in cfg['streets'].items():
        src = os.path.join(OSM, {'sinkor': 'sinkor.json', 'waterside': 'waterside.json', 'voinjama': 'voinjama.json', 'skd': 'skd.json'}[street])
        sd = json.load(open(src))
        snodes = {e['id']: (e['lat'], e['lon']) for e in sd['elements'] if e['type'] == 'node'}
        cx, cy = xy(la, lo)
        for e in sd['elements']:
            if e['type'] == 'way' and 'building' in e.get('tags', {}):
                ring = [xy(*snodes[n]) for n in e['nodes'] if n in snodes]
                if len(ring) > 3 and math.dist(ring[0], (cx, cy)) < 260:
                    buildings.append(flat(simplify(ring, 0.8)))
    places = {}
    for street, ((la, lo), plan_file) in cfg['streets'].items():
        cx, cy = xy(la, lo)
        plan = json.load(open(os.path.join(SRC, plan_file)))
        places[street] = {'x': round(cx), 'y': round(cy), 'places': {k: [round(cx + v['x']), round(cy + v['y'])] for k, v in plan['places'].items()}}
    for k, (la, lo) in cfg['places'].items():
        x, y = xy(la, lo)
        places[k] = {'x': round(x), 'y': round(y)}
    far = {}
    for k, ((la, lo), label) in cfg.get('far', {}).items():
        x, y = xy(la, lo)
        far[k] = {'x': round(x), 'y': round(y), 'km': round(math.hypot(x, y) / 1000)}

    out = {
        'frame': f'metres east (x) and north (y) of {lat0}, {lon0}; © OpenStreetMap contributors',
        'bounds': bounds, 'roads': roads, 'water': water, 'wetland': wetland, 'rivers': rivers, 'sea': sea,
        'airfields': airfields, 'buildings': buildings, 'places': places, 'far': far,
    }
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.v3.json')
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('MAP', name, round(os.path.getsize(path) / 1024), 'KB', {k: len(v) for k, v in roads.items()}, 'water', len(water), 'sea', len(sea) // 2)


for name in sys.argv[1:] or TOWNS:
    if os.path.exists(os.path.join(OSM, f'map_{name}.json')):
        build(name, TOWNS[name])
    else:
        print('NO DATA', name)
