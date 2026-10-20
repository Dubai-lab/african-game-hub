# One Africa Life: the whole of Greater Monrovia for the game, from OpenStreetMap (© OpenStreetMap
# contributors, ODbL; Geofabrik's Liberia extract): every building as it stands (its footprint,
# its storeys, what it is, its name), the land (beaches, swamps, fields, cemeteries, parks), the
# town's named places (clinics, churches and mosques, schools, ministries, hotels, cookshops, bars,
# fuel stations, markets, embassies, banks...), and every road and lane (its width, one way or
# not, bridges), joined at its junctions.
#
#   <venv with osmium>/bin/python scripts/oal/makeCityData.py art-src/one-africa-life/osm/liberia/liberia.osm.pbf
#
# Out (metres east and north of the map's centre, 6.3045 N 10.79 W, as the town's map):
#   public/oal/city/monrovia/t/<cx>_<cy>.v1.json   one 200 m tile (cx, cy = floor(x / 200), floor(y / 200)):
#       b: buildings [kind, storeys, name index or -1, x0, y0, x1, y1, ...] (decimetres from the tile's corner)
#       l: land [kind, x0, y0, ...] (decimetres, polygons whose middle is in the tile)
#       p: places [category, name index, x, y, building index or -1] (decimetres)
#       n: the tile's names
#   public/oal/city/monrovia/places.v1.json   every named place: [category, name, x, y] (metres)
#   public/oal/maps/monrovia.v4.json           the town's map with every road (from v3: its water, sea, places)
import json
import math
import os
import sys
from collections import defaultdict

import osmium

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'public', 'oal', 'city', 'monrovia')
MAPS = os.path.join(ROOT, 'public', 'oal', 'maps')
LAT0, LON0 = 6.3045, -10.7900
M_LON = 111_320.0 * math.cos(math.radians(LAT0))
S, W, N, E = 6.20, -10.88, 6.37, -10.62
TILE = 200


def xy(lat, lon):
    return ((lon - LON0) * M_LON, (lat - LAT0) * 111_320.0)


# What a building is, from its tags (the order: the most telling first).
KINDS = ['house', 'block', 'shop', 'church', 'mosque', 'school', 'clinic', 'office', 'hotel', 'industrial', 'shed', 'other']


def building_kind(t):
    b = t.get('building', 'yes')
    a = t.get('amenity', '')
    if b in ('church', 'chapel', 'cathedral') or (a == 'place_of_worship' and t.get('religion') == 'christian'):
        return 'church'
    if b == 'mosque' or (a == 'place_of_worship' and t.get('religion') == 'muslim'):
        return 'mosque'
    if b in ('school', 'university', 'college', 'kindergarten') or a in ('school', 'college', 'university', 'kindergarten'):
        return 'school'
    if b in ('hospital', 'clinic') or a in ('hospital', 'clinic', 'doctors', 'pharmacy'):
        return 'clinic'
    if b in ('commercial', 'retail', 'supermarket', 'kiosk') or 'shop' in t or a in ('restaurant', 'bar', 'fast_food', 'cafe', 'bank', 'fuel', 'marketplace'):
        return 'shop'
    if b in ('office', 'government', 'public', 'civic') or 'office' in t:
        return 'office'
    if b in ('hotel',) or t.get('tourism') in ('hotel', 'guest_house', 'motel', 'hostel'):
        return 'hotel'
    if b in ('industrial', 'warehouse', 'factory', 'hangar'):
        return 'industrial'
    if b in ('shed', 'hut', 'roof', 'garage', 'garages', 'cabin', 'container', 'toilets'):
        return 'shed'
    if b in ('apartments', 'dormitory', 'terrace'):
        return 'block'
    if b in ('house', 'residential', 'detached', 'semidetached_house', 'bungalow', 'yes'):
        return 'house'
    return 'other'


# A named place's category (the map's and the signs').
def category(t):
    a = t.get('amenity', '')
    s = t.get('shop', '')
    tour = t.get('tourism', '')
    o = t.get('office', '')
    lei = t.get('leisure', '')
    if a in ('hospital', 'clinic', 'doctors', 'dentist') or t.get('healthcare'):
        return 'health'
    if a == 'pharmacy' or s in ('chemist', 'drug_store'):
        return 'pharmacy'
    if a in ('school', 'college', 'university', 'kindergarten') or o == 'educational_institution':
        return 'school'
    if a == 'place_of_worship':
        return 'mosque' if t.get('religion') == 'muslim' else 'church'
    if o in ('government',) or a in ('townhall', 'courthouse', 'police', 'fire_station', 'post_office', 'prison'):
        return 'government'
    if o == 'diplomatic' or a == 'embassy':
        return 'embassy'
    if tour in ('hotel', 'guest_house', 'motel', 'hostel', 'apartment'):
        return 'hotel'
    if a in ('restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream') or s in ('cookshop', 'bakery'):
        return 'food'
    if a in ('bar', 'pub', 'nightclub', 'cinema', 'theatre', 'casino', 'studio'):
        return 'fun'
    if a == 'fuel':
        return 'fuel'
    if a in ('bank', 'atm', 'bureau_de_change', 'money_transfer'):
        return 'bank'
    if a == 'marketplace':
        return 'market'
    if s in ('hairdresser', 'beauty', 'barber'):
        return 'salon'
    if s in ('hardware', 'doityourself', 'building_materials', 'paint', 'trade'):
        return 'materials'
    if s in ('mobile_phone', 'electronics', 'computer'):
        return 'phones'
    if s in ('supermarket', 'convenience', 'kiosk', 'general', 'wholesale', 'greengrocer'):
        return 'provisions'
    if s:
        return 'shop'
    if lei in ('pitch', 'stadium', 'sports_centre', 'park', 'garden', 'playground'):
        return 'sport'
    if a in ('bus_station', 'taxi', 'parking'):
        return 'transport'
    if o:
        return 'office'
    return None


LAND = {'residential': 'built', 'commercial': 'built', 'retail': 'built', 'industrial': 'industrial', 'cemetery': 'cemetery', 'grass': 'grass', 'meadow': 'grass',
        'recreation_ground': 'grass', 'park': 'grass', 'pitch': 'pitch', 'forest': 'forest', 'wood': 'forest', 'scrub': 'scrub', 'wetland': 'wetland', 'beach': 'sand',
        'sand': 'sand', 'farmland': 'farm', 'farmyard': 'farm', 'orchard': 'farm', 'construction': 'bare', 'brownfield': 'bare', 'quarry': 'bare'}

MAJOR = {'motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'}
MIDDLE = {'tertiary', 'tertiary_link'}
MINOR = {'residential', 'unclassified', 'service', 'living_street', 'track', 'road'}
PATH = {'path', 'footway', 'pedestrian', 'steps', 'cycleway', 'bridleway'}


def inside(lat, lon):
    return S < lat < N and W < lon < E


class Reader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.buildings = []   # (kind, storeys, name, pts, tags)
        self.land = []        # (kind, pts)
        self.places = []      # (category, name, x, y)
        self.roads = []       # (cls, pts(node ids), name, oneway, width, bridge)
        self.uses = defaultdict(int)
        self.loc = {}

    def node(self, n):
        if not n.location.valid() or not inside(n.location.lat, n.location.lon):
            return
        t = n.tags
        if 'name' in t:
            c = category({k.k: k.v for k in t})
            if c:
                x, y = xy(n.location.lat, n.location.lon)
                self.places.append((c, t['name'], x, y))

    def way(self, w):
        t = {k.k: k.v for k in w.tags}
        try:
            pts = [(n.ref, n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not pts or not any(inside(p[1], p[2]) for p in pts):
            return
        coords = [xy(p[1], p[2]) for p in pts]
        if 'building' in t:
            levels = t.get('building:levels', '')
            try:
                storeys = max(1, min(30, int(float(levels))))
            except ValueError:
                storeys = 0
            self.buildings.append((building_kind(t), storeys, t.get('name'), coords, t))
            c = category(t)
            if c and t.get('name'):
                cx = sum(p[0] for p in coords) / len(coords)
                cy = sum(p[1] for p in coords) / len(coords)
                self.places.append((c, t['name'], cx, cy))
            return
        hw = t.get('highway')
        if hw in MAJOR | MIDDLE | MINOR | PATH:
            cls = 'major' if hw in MAJOR else 'middle' if hw in MIDDLE else 'minor' if hw in MINOR else 'path'
            one = t.get('oneway') in ('yes', '1', 'true') or hw in ('motorway', 'motorway_link')
            ids = [p[0] for p in pts]
            if t.get('oneway') == '-1':
                ids = ids[::-1]
                coords = coords[::-1]
                one = True
            for p in pts:
                self.loc[p[0]] = xy(p[1], p[2])
            lanes = t.get('lanes', '')
            try:
                width = float(t.get('width', '')) if t.get('width') else max(1, int(lanes)) * 3.4 if lanes.isdigit() else 0
            except ValueError:
                width = 0
            self.roads.append((cls, ids, t.get('name'), one, width, t.get('bridge') in ('yes', 'viaduct')))
            for n in set(ids):
                self.uses[n] += 1
            return
        kind = LAND.get(t.get('landuse')) or LAND.get(t.get('natural')) or LAND.get(t.get('leisure'))
        if kind and len(coords) > 3 and coords[0] == coords[-1]:
            self.land.append((kind, coords))


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    dx, dy = bx - ax, by - ay
    ln = math.hypot(dx, dy)
    far, k = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = abs(dy * px - dx * py + bx * ay - by * ax) / ln if ln > 1e-9 else math.hypot(px - ax, py - ay)
        if d > far:
            far, k = d, i
    if far <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)


def tile_of(x, y):
    return (math.floor(x / TILE), math.floor(y / TILE))


def main(pbf):
    r = Reader()
    r.apply_file(pbf, locations=True)
    print('read', len(r.buildings), 'buildings', len(r.land), 'land', len(r.places), 'places', len(r.roads), 'roads')
    tiles = defaultdict(lambda: {'b': [], 'l': [], 'p': [], 'n': []})

    def name_in(tile, name):
        if not name:
            return -1
        if name in tile['n']:
            return tile['n'].index(name)
        tile['n'].append(name)
        return len(tile['n']) - 1

    building_at = {}
    for kind, storeys, name, coords, _ in r.buildings:
        ring = coords[:-1] if len(coords) > 1 and coords[0] == coords[-1] else coords
        if len(ring) < 3:
            continue
        ring = simplify(ring + [ring[0]], 0.3)[:-1]
        if len(ring) < 3:
            continue
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        k = tile_of(cx, cy)
        t = tiles[k]
        ox, oy = k[0] * TILE, k[1] * TILE
        flat = [v for p in ring for v in (round((p[0] - ox) * 10), round((p[1] - oy) * 10))]
        t['b'].append([KINDS.index(kind), storeys, name_in(t, name)] + flat)
        building_at[(k, round(cx), round(cy))] = len(t['b']) - 1
    for kind, coords in r.land:
        cx = sum(p[0] for p in coords) / len(coords)
        cy = sum(p[1] for p in coords) / len(coords)
        k = tile_of(cx, cy)
        ox, oy = k[0] * TILE, k[1] * TILE
        ring = simplify(coords, 2.0)
        tiles[k]['l'].append([kind] + [v for p in ring for v in (round((p[0] - ox) * 10), round((p[1] - oy) * 10))])
    every = []
    seen = set()
    for cat, name, x, y in r.places:
        key = (name, round(x / 20), round(y / 20))
        if key in seen:
            continue
        seen.add(key)
        k = tile_of(x, y)
        ox, oy = k[0] * TILE, k[1] * TILE
        tiles[k]['p'].append([cat, name_in(tiles[k], name), round((x - ox) * 10), round((y - oy) * 10), building_at.get((k, round(x), round(y)), -1)])
        every.append([cat, name, round(x, 1), round(y, 1)])
    os.makedirs(os.path.join(OUT, 't'), exist_ok=True)
    total = 0
    for (cx, cy), t in tiles.items():
        body = json.dumps(t, separators=(',', ':'), ensure_ascii=False)
        total += len(body)
        with open(os.path.join(OUT, 't', f'{cx}_{cy}.v1.json'), 'w') as f:
            f.write(body)
    with open(os.path.join(OUT, 'places.v1.json'), 'w') as f:
        json.dump(every, f, separators=(',', ':'), ensure_ascii=False)
    print('tiles', len(tiles), 'bytes', total, 'places', len(every))

    # The roads, every one, kept joined where they meet (their shared points never simplified away).
    roads = {'major': [], 'middle': [], 'minor': [], 'path': []}
    for cls, ids, name, one, width, bridge in r.roads:
        ids = [n for n in ids if n in r.loc]
        if len(ids) < 2:
            continue
        cuts = [0] + [i for i in range(1, len(ids) - 1) if r.uses[ids[i]] > 1] + [len(ids) - 1]
        line = []
        tol = 2.5 if cls in ('major', 'middle') else 3.0
        for a, b in zip(cuts, cuts[1:]):
            piece = simplify([r.loc[n] for n in ids[a:b + 1]], tol)
            line += piece if not line else piece[1:]
        if sum(math.dist(p, q) for p, q in zip(line, line[1:])) < 4:
            continue
        entry = {'p': [v for p in line for v in (round(p[0]), round(p[1]))]}
        if name:
            entry['n'] = name
        if one:
            entry['o'] = 1
        if width:
            entry['w'] = round(width, 1)
        if bridge:
            entry['b'] = 1
        roads[cls].append(entry)
    with open(os.path.join(MAPS, 'monrovia.v3.json')) as f:
        town = json.load(f)
    town['roads'] = roads
    with open(os.path.join(MAPS, 'monrovia.v4.json'), 'w') as f:
        json.dump(town, f, separators=(',', ':'), ensure_ascii=False)
    print('map', {k: len(v) for k, v in roads.items()}, os.path.getsize(os.path.join(MAPS, 'monrovia.v4.json')))


if __name__ == '__main__':
    main(sys.argv[1])
