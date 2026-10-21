// One Africa Life: a whole town in 3D, made in the browser from its map (public/oal/maps/<town>
// .v2.json, from OpenStreetMap: every real road, the sea, lagoons and swamps). The town is cut in
// square chunks; each chunk is built from the roads in it, the same for everyone (a seed per
// chunk): the roads themselves (tarred, with concrete kerbs and pavements, a dashed line down the
// big ones; the small ones red laterite), and along them what Monrovia builds: compounds of one-
// storey houses in painted plaster under rusty zinc, behind their walls and gates; blocks of two
// and three storeys with flat roofs and water tanks on the big roads; zinc kiosks on the
// shoulders; coconut palms; wooden poles with their wires. Where a street has been built by hand
// (a "hub": Tubman Boulevard at Sinkor, Waterside Market), the chunk leaves its circle to it.
import { BufferAttribute, BufferGeometry, Color, ShapeUtils, Vector2 } from 'three'

export type RoadKind = 'major' | 'middle' | 'minor' | 'path'
/** The town's map, as the map screen has it (metres east and north of its centre). */
export type TownMapData = {
  /** Each road: its points, its name, one way, its width (metres, when the map says), a bridge. */
  roads: Partial<Record<RoadKind, { p: number[]; n?: string; o?: 1; w?: number; b?: 1; j?: 1 }[]>>
  water: number[][]
  wetland: number[][]
  rivers: { p: number[] }[]
  sea: number[]
  places: Record<string, { x: number; y: number; places?: Record<string, number[]> }>
}

export const ROAD_WIDTH: Record<RoadKind, number> = { major: 12, middle: 8, minor: 5.5, path: 1.8 }
/** The kerb and pavement either side of a tarred road. */
const PAVEMENT: Record<RoadKind, number> = { major: 3, middle: 2, minor: 0, path: 0 }
export const CHUNK = 200

export type Seg = {
  ax: number
  ay: number
  bx: number
  by: number
  kind: RoadKind
  w: number
  len: number
  ux: number
  uy: number
  road: number
  name?: string
  /** The edge (between two nodes of the network) this piece is of, how far along it the piece
   * starts, and its length: for where the junctions are. */
  edge: number
  t0: number
  elen: number
  one: boolean
  /** On a bridge: how far along the bridge the piece starts, and the bridge's length. */
  bridge?: { s: number; total: number }
}
type Poly = { pts: number[]; minX: number; maxX: number; minY: number; maxY: number }

export type City = {
  segs: Seg[]
  /** Segments by 50 m cell. */
  grid: Map<string, number[]>
  sea: Poly | null
  water: Poly[]
  wet: Poly[]
  /** The road network as a graph: its nodes (where roads meet or bend) and edges. */
  nodes: { x: number; y: number; edges: number[] }[]
  /** A node by its 4 m cell (where roads' points meet). */
  nodeAt?: Map<string, number>
  /** One way: driven from a to b only. */
  edges: { a: number; b: number; len: number; kind: RoadKind; w: number; one: boolean; name?: string; ring?: boolean }[]
  /** The roundabouts: each one's middle, its ring's radius and the ring road's width. */
  rings: { x: number; y: number; r: number; w: number }[]
}

const CELL = 50
const key = (cx: number, cy: number) => `${cx},${cy}`

function poly(flat: number[]): Poly {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < flat.length; i += 2) {
    minX = Math.min(minX, flat[i]!)
    maxX = Math.max(maxX, flat[i]!)
    minY = Math.min(minY, flat[i + 1]!)
    maxY = Math.max(maxY, flat[i + 1]!)
  }
  return { pts: flat, minX, maxX, minY, maxY }
}

export function inPoly(p: Poly, x: number, y: number) {
  if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return false
  let hit = false
  const a = p.pts
  for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) {
    const xi = a[i]!
    const yi = a[i + 1]!
    const xj = a[j]!
    const yj = a[j + 1]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** The town from its map: its roads cut in pieces of at most 30 m, indexed; its graph; its water. */
export function buildCity(map: TownMapData): City {
  const segs: Seg[] = []
  const grid = new Map<string, number[]>()
  const nodes: City['nodes'] = []
  const edges: City['edges'] = []
  const nodeAt = new Map<string, number>()
  const rings: City['rings'] = []
  const node = (x: number, y: number) => {
    // Where roads meet, their points are the same (within a few metres once simplified).
    const k = key(Math.round(x / 4), Math.round(y / 4))
    let id = nodeAt.get(k)
    if (id === undefined) {
      id = nodes.length
      nodes.push({ x, y, edges: [] })
      nodeAt.set(k, id)
    }
    return id
  }
  let road = 0
  for (const kind of ['major', 'middle', 'minor', 'path'] as RoadKind[]) {
    for (const r of map.roads[kind] ?? []) {
      const p = r.p
      // The map's own width where it gives one (within reason for its kind).
      const width = r.w && kind !== 'path' ? Math.max(kind === 'minor' ? 4 : 6, Math.min(30, r.w)) : ROAD_WIDTH[kind]
      road++
      // A bridge: its length (for its rise and fall), and how far along it each piece is.
      let bridgeTotal = 0
      if (r.b) for (let i = 0; i + 3 < p.length; i += 2) bridgeTotal += Math.hypot(p[i + 2]! - p[i]!, p[i + 3]! - p[i + 1]!)
      let along = 0
      // A roundabout: its ring (a closed road) round its middle.
      if (r.j && p.length >= 8) {
        let cx = 0
        let cy = 0
        const n = p.length / 2
        for (let i = 0; i < p.length; i += 2) {
          cx += p[i]! / n
          cy += p[i + 1]! / n
        }
        let rr = 0
        for (let i = 0; i < p.length; i += 2) rr += Math.hypot(p[i]! - cx, p[i + 1]! - cy) / n
        rings.push({ x: cx, y: cy, r: rr, w: width })
      }
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i]!
        const ay = p[i + 1]!
        const bx = p[i + 2]!
        const by = p[i + 3]!
        const len = Math.hypot(bx - ax, by - ay)
        if (len < 0.5) continue
        const a = node(ax, ay)
        const b = node(bx, by)
        const edgeId = edges.length
        if (a !== b) {
          edges.push({ a, b, len, kind, w: width, one: r.o === 1, name: r.n, ring: r.j === 1 })
          nodes[a]!.edges.push(edges.length - 1)
          nodes[b]!.edges.push(edges.length - 1)
        }
        // Pieces of 30 m (on a bridge 6 m, for its ramps' slope).
        const pieces = Math.ceil(len / (r.b ? 6 : 30))
        for (let k = 0; k < pieces; k++) {
          const s: Seg = {
            ax: ax + ((bx - ax) * k) / pieces,
            ay: ay + ((by - ay) * k) / pieces,
            bx: ax + ((bx - ax) * (k + 1)) / pieces,
            by: ay + ((by - ay) * (k + 1)) / pieces,
            kind,
            w: width,
            len: len / pieces,
            ux: (bx - ax) / len,
            uy: (by - ay) / len,
            road,
            name: r.n,
            edge: a !== b ? edgeId : -1,
            t0: (len * k) / pieces,
            elen: len,
            one: r.o === 1,
            bridge: r.b ? { s: along + (len * k) / pieces, total: bridgeTotal } : undefined,
          }
          const id = segs.length
          segs.push(s)
          const x0 = Math.floor((Math.min(s.ax, s.bx) - 15) / CELL)
          const x1 = Math.floor((Math.max(s.ax, s.bx) + 15) / CELL)
          const y0 = Math.floor((Math.min(s.ay, s.by) - 15) / CELL)
          const y1 = Math.floor((Math.max(s.ay, s.by) + 15) / CELL)
          for (let cx = x0; cx <= x1; cx++)
            for (let cy = y0; cy <= y1; cy++) {
              const list = grid.get(key(cx, cy))
              if (list) list.push(id)
              else grid.set(key(cx, cy), [id])
            }
        }
        along += len
      }
    }
  }
  return {
    segs,
    grid,
    sea: map.sea && map.sea.length > 6 ? poly(map.sea) : null,
    water: (map.water ?? []).map(poly),
    wet: (map.wetland ?? []).map(poly),
    nodes,
    edges,
    nodeAt,
    rings,
  }
}

/** A bridge's deck height a distance along it (rising from its ends over its first and last
 * stretch, to a little over a metre over the water). */
export function deckHeight(s: number, total: number) {
  const top = Math.min(1.4, total * 0.04)
  const ramp = Math.max(4, Math.min(14, total / 3))
  const up = Math.min(1, Math.max(0, s / ramp))
  const down = Math.min(1, Math.max(0, (total - s) / ramp))
  const e = (t: number) => t * t * (3 - 2 * t)
  return top * Math.min(e(up), e(down))
}

/** How high the ground is at a point: on a bridge, its deck; else the ground (0). */
export function groundHeight(city: City, x: number, y: number) {
  let h = 0
  for (const id of segsNear(city, x, y, 12)) {
    const s = city.segs[id]!
    if (!s.bridge) continue
    const n = toSeg(s, x, y)
    if (n.d < s.w / 2 + PAVEMENT[s.kind] + 0.4) h = Math.max(h, deckHeight(s.bridge.s + n.t, s.bridge.total))
  }
  return h
}

/** A junction's size (how far from its middle the roads meeting there keep their own markings):
 * 0 where fewer than three roads meet. */
export function junctionRadius(city: City, n: number) {
  const roads = city.nodes[n]!.edges.filter((e) => city.edges[e]!.kind !== 'path')
  if (roads.length < 3) return 0
  let w = 0
  let big = false
  for (const e of roads) {
    w = Math.max(w, city.edges[e]!.w)
    if (city.edges[e]!.kind === 'major' || city.edges[e]!.kind === 'middle') big = true
  }
  return w / 2 + (big ? 2.5 : 1.2)
}

/** A junction with traffic lights (big roads' arms, three or more; never on a roundabout). */
export function signalled(city: City, n: number) {
  const edges = city.nodes[n]!.edges
  if (edges.some((e) => city.edges[e]!.ring)) return false
  return edges.filter((e) => city.edges[e]!.kind === 'major' || city.edges[e]!.kind === 'middle').length >= 3
}

/** How far a point is from a segment, and the nearest point on it. */
export function toSeg(s: Seg, x: number, y: number) {
  const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.ux + (y - s.ay) * s.uy))
  const px = s.ax + s.ux * t
  const py = s.ay + s.uy * t
  return { d: Math.hypot(x - px, y - py), t, px, py }
}

/** The road segments within reach of a point. */
export function segsNear(city: City, x: number, y: number, r: number): number[] {
  const out = new Set<number>()
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
    for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) for (const id of city.grid.get(key(cx, cy)) ?? []) out.add(id)
  return [...out]
}

/** The nearest road to a point (within r), and where on it. */
export function nearestRoad(city: City, x: number, y: number, r = 60) {
  let best: { seg: Seg; d: number; px: number; py: number } | null = null
  for (const id of segsNear(city, x, y, r)) {
    const s = city.segs[id]!
    const n = toSeg(s, x, y)
    if (!best || n.d < best.d) best = { seg: s, d: n.d, px: n.px, py: n.py }
  }
  return best
}

export function onWater(city: City, x: number, y: number) {
  if (city.sea && inPoly(city.sea, x, y)) return true
  for (const p of city.water) if (inPoly(p, x, y)) return true
  return false
}

// ---- Building a chunk -------------------------------------------------------------------------

/** The same numbers for the same chunk, for everyone. */
function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A colour by its name, read once (reading '#rrggbb' is slow, and asked for every face). */
const colours = new Map<string, Color>()
function colourOf(name: string) {
  let c = colours.get(name)
  if (!c) colours.set(name, (c = new Color(name)))
  return c
}

/** A mesh being built: positions, normals, uvs, colours. */
class Mesher {
  p: number[] = []
  n: number[] = []
  uv: number[] = []
  c: number[] = []
  /** A quad (four corners in order), its normal, its uv corners, a colour. */
  quad(v: number[][], nx: number, ny: number, nz: number, uvs: number[][], colour: string | Color) {
    const col = typeof colour === 'string' ? colourOf(colour) : colour
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const q = v[i]!
      this.p.push(q[0]!, q[1]!, q[2]!)
      this.n.push(nx, ny, nz)
      this.uv.push(uvs[i]![0]!, uvs[i]![1]!)
      this.c.push(col.r, col.g, col.b)
    }
  }
  tri(a: number[], b: number[], c: number[], nx: number, ny: number, nz: number, colour: string | Color, uvs = [[0, 0], [1, 0], [0.5, 1]]) {
    const col = typeof colour === 'string' ? colourOf(colour) : colour
    for (const [q, u] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]]] as [number[], number[]][]) {
      this.p.push(q[0]!, q[1]!, q[2]!)
      this.n.push(nx, ny, nz)
      this.uv.push(u[0]!, u[1]!)
      this.c.push(col.r, col.g, col.b)
    }
  }
  /** A flat strip on the ground (map x, y; three's x, height, -y). */
  ground(ax: number, ay: number, bx: number, by: number, w: number, h: number, colour: string, uScale = 0.25) {
    const len = Math.hypot(bx - ax, by - ay) || 1
    const nx = (-(by - ay) / len) * (w / 2)
    const ny = ((bx - ax) / len) * (w / 2)
    this.quad(
      [
        [ax - nx, h, -(ay - ny)],
        [bx - nx, h, -(by - ny)],
        [bx + nx, h, -(by + ny)],
        [ax + nx, h, -(ay + ny)],
      ],
      0,
      1,
      0,
      [
        [0, 0],
        [len * uScale, 0],
        [len * uScale, 1],
        [0, 1],
      ],
      colour,
    )
  }
  /** A strip rising from one height to another (a bridge's ramp), its uv along its length. */
  slope(ax: number, ay: number, bx: number, by: number, w: number, ha: number, hb: number, colour: string, uScale = 0.25) {
    const len = Math.hypot(bx - ax, by - ay) || 1
    const nx = (-(by - ay) / len) * (w / 2)
    const ny = ((bx - ax) / len) * (w / 2)
    this.quad(
      [
        [ax - nx, ha, -(ay - ny)],
        [bx - nx, hb, -(by - ny)],
        [bx + nx, hb, -(by + ny)],
        [ax + nx, ha, -(ay + ny)],
      ],
      0,
      1,
      0,
      [
        [0, 0],
        [len * uScale, 0],
        [len * uScale, 1],
        [0, 1],
      ],
      colour,
    )
  }
  /** A disc on the ground (to round a road's bends and joins). */
  disc(x: number, y: number, r: number, h: number, colour: string) {
    const n = 10
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      this.tri([x, h, -y], [x + Math.cos(a0) * r, h, -(y + Math.sin(a0) * r)], [x + Math.cos(a1) * r, h, -(y + Math.sin(a1) * r)], 0, 1, 0, colour, [
        [0.5, 0.5],
        [0.5, 0.5],
        [0.5, 0.5],
      ])
    }
  }
  /** A box standing on the ground, turned by yaw (map radians from east), walls uv in metres. */
  box(x: number, y: number, yaw: number, w: number, d: number, z0: number, h: number, colour: string | Color, uv = [4, 3], top = true) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const corner = (u: number, v: number) => [x + c * u - s * v, y + s * u + c * v]
    const k = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)]
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = k[i]!
      const [bx, by] = k[(i + 1) % 4]!
      const len = Math.hypot(bx! - ax!, by! - ay!)
      const nx = (by! - ay!) / len
      const ny = -(bx! - ax!) / len
      this.quad(
        [
          [ax!, z0, -ay!],
          [bx!, z0, -by!],
          [bx!, z0 + h, -by!],
          [ax!, z0 + h, -ay!],
        ],
        nx,
        0,
        -ny,
        [
          [0, 0],
          [len / uv[0]!, 0],
          [len / uv[0]!, h / uv[1]!],
          [0, h / uv[1]!],
        ],
        colour,
      )
    }
    if (top)
      this.quad(
        k.map(([a, b]) => [a!, z0 + h, -b!]),
        0,
        1,
        0,
        [
          [0, 0.02],
          [0.02, 0.02],
          [0.02, 0],
          [0, 0],
        ],
        colour,
      )
    return k
  }
  /** A hipped roof over a box's corners (four slopes up to a ridge). */
  hip(x: number, y: number, yaw: number, w: number, d: number, z: number, rise: number, colour: string | Color) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const o = 0.5
    const at = (u: number, v: number, zz: number) => [x + c * u - s * v, zz, -(y + s * u + c * v)]
    const W = w / 2 + o
    const D = d / 2 + o
    const ridge = Math.max(0, W - D)
    const k = [at(-W, -D, z), at(W, -D, z), at(W, D, z), at(-W, D, z)]
    const r0 = at(-ridge, 0, z + rise)
    const r1 = at(ridge, 0, z + rise)
    const uv = [
      [0, 0],
      [W, 0],
      [W, 1],
      [0, 1],
    ]
    // Long sides (quads to the ridge), short sides (triangles).
    this.quad([k[0]!, k[1]!, r1, r0], 0, 1, 0, uv, colour)
    this.quad([k[2]!, k[3]!, r0, r1], 0, 1, 0, uv, colour)
    this.tri(k[1]!, k[2]!, r1, 0, 1, 0, colour)
    this.tri(k[3]!, k[0]!, r0, 0, 1, 0, colour)
  }
  /** A cylinder (a pole, a trunk, a tank), from z0 to z1, narrowing. */
  post(x: number, y: number, r0: number, r1: number, z0: number, z1: number, colour: string, sides = 6, lean = [0, 0]) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2
      const a1 = ((i + 1) / sides) * Math.PI * 2
      const nx = Math.cos((a0 + a1) / 2)
      const ny = Math.sin((a0 + a1) / 2)
      this.quad(
        [
          [x + Math.cos(a0) * r0, z0, -(y + Math.sin(a0) * r0)],
          [x + Math.cos(a1) * r0, z0, -(y + Math.sin(a1) * r0)],
          [x + lean[0]! + Math.cos(a1) * r1, z1, -(y + lean[1]! + Math.sin(a1) * r1)],
          [x + lean[0]! + Math.cos(a0) * r1, z1, -(y + lean[1]! + Math.sin(a0) * r1)],
        ],
        nx,
        0,
        -ny,
        [
          [0, 0],
          [0.2, 0],
          [0.2, 1],
          [0, 1],
        ],
        colour,
      )
    }
  }
  geometry(): BufferGeometry | null {
    if (this.p.length === 0) return null
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.p), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.n), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.c), 3))
    g.computeBoundingSphere()
    return g
  }
}

/** A solid on the ground, to walk against: its outline (a turned rectangle's corners, a real
 * building's footprint), with its box (minX, minY, maxX, maxY) for finding it quickly. */
export type Solid = number[][] & { bb?: [number, number, number, number] }

export function solidOf(pts: number[][]): Solid {
  const out = pts as Solid
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  for (const [x, y] of pts) {
    a = Math.min(a, x!)
    b = Math.min(b, y!)
    c = Math.max(c, x!)
    d = Math.max(d, y!)
  }
  out.bb = [a, b, c, d]
  return out
}

/** A tile of the town's real data (scripts/oal/makeCityData.py), 200 m square. */
export type Tile = { b: number[][]; l: (string | number)[][]; p: (string | number)[][]; n: string[] }
/** What a building is (the tile's first number). */
export const BUILDING_KINDS = ['house', 'block', 'shop', 'church', 'mosque', 'school', 'clinic', 'office', 'hotel', 'industrial', 'shed', 'other'] as const
/** A named place in a tile: what kind of place, its name, where (town metres); its door (on
 * the building's front, toward the road) and the way one faces it there. */
export type TilePlace = { cat: string; name: string; x: number; y: number; door?: [number, number]; face?: [number, number]; everyday?: boolean }
/** A place's sign board on its building's front: what it says and is, where, which way it faces
 * (map radians), its width and height. */
export type Sign = { text: string; cat: string; x: number; y: number; z: number; yaw: number; w: number; h: number }

/** The traffic lights' lamps, by which way they face (A: the first road's line, B: across it)
 * and colour: each lit in turn by the town's one cycle (signalState). */
export const SIGNAL_LAMPS = ['Ar', 'Ay', 'Ag', 'Br', 'By', 'Bg'] as const
export type SignalLamp = (typeof SIGNAL_LAMPS)[number]
/** A signalled junction: where, and which way each road into it goes (A or B), by edge. */
export type Signal = { node: number; x: number; y: number; groups: Record<number, 'A' | 'B'> }

/** The town's traffic lights all keep one cycle (seconds): A green, A amber, all red, B green,
 * B amber, all red. Which colour each way shows at a moment. */
export const SIGNAL_CYCLE = [22, 3, 2, 22, 3, 2]
export function signalState(seconds: number): { A: 'r' | 'y' | 'g'; B: 'r' | 'y' | 'g' } {
  const total = SIGNAL_CYCLE.reduce((a, b) => a + b, 0)
  let t = ((seconds % total) + total) % total
  const phases: { A: 'r' | 'y' | 'g'; B: 'r' | 'y' | 'g' }[] = [
    { A: 'g', B: 'r' },
    { A: 'y', B: 'r' },
    { A: 'r', B: 'r' },
    { A: 'r', B: 'g' },
    { A: 'r', B: 'y' },
    { A: 'r', B: 'r' },
  ]
  for (let i = 0; i < SIGNAL_CYCLE.length; i++) {
    if (t < SIGNAL_CYCLE[i]!) return phases[i]!
    t -= SIGNAL_CYCLE[i]!
  }
  return phases[0]!
}

export type ChunkParts = {
  signs: Sign[]
  /** The traffic lights' lamps (one mesh each way and colour) and the junctions they keep. */
  signalLamps: Partial<Record<SignalLamp, BufferGeometry | null>>
  signals: Signal[]
  /** The street lamps: their posts (in plain), their glass (lit at night), the pools of light
   * they throw on the road, and where each working lamp's light is (town metres, its height). */
  glow: BufferGeometry | null
  pools: BufferGeometry | null
  lamps: number[][]
  land: BufferGeometry | null
  shops: BufferGeometry | null
  places: TilePlace[]
  asphalt: BufferGeometry | null
  dirt: BufferGeometry | null
  pavement: BufferGeometry | null
  marks: BufferGeometry | null
  walls: BufferGeometry | null
  roofs: BufferGeometry | null
  plain: BufferGeometry | null
  leaves: BufferGeometry | null
  solids: Solid[]
  /** The trees: [kind (TREE), x, y, turn, size], each drawn by the page from its model. */
  trees: number[][]
}

/** A circle the chunk leaves alone (a hub built by hand, a compound placed by the game). */
/** Ground kept for something of its own (a hub's street, a compound, a landmark): the city builds
 * nothing there (but roads, unless roads is false); its walls, if given, solid. */
export type Keep = { x: number; y: number; r: number; roads?: boolean; solids?: number[][][] }

const PLASTER = ['#efe6d2', '#e8d6a6', '#d9e6ea', '#f2d9c4', '#e6efd8', '#f4f0e6', '#e2c9a0', '#cfe0d0', '#f0e0a8', '#d8d0e8']
const ZINC = ['#8a4a2c', '#7a3f26', '#9a5a3a', '#6e4a3a', '#a06040', '#8a8a86']
const KIOSK = ['#2f6fb8', '#c8281e', '#2f8a4a', '#e2b62a', '#e86a1c', '#6a3a8a']
const WALL = ['#d8d0c0', '#cfc6b4', '#e4ddcc', '#bdb3a0']
/** The trees' kinds, as the trees file has them (public/oal/trees.v1.glb, scripts/oal/makeTrees.py). */
export const TREE = { shade: 0, palm: 1, banana: 2 } as const
export const TREE_KINDS = ['shade_tree', 'coconut_palm', 'banana_clump'] as const
const BLOCK = ['#f4f2ee', '#e8e4dc', '#ece6da']
/** The walls' styles: the facade atlas's four tiles (CityScene), picked by v (style × 100). */
export const WALL_STYLE = { house: 0, painted: 1, blocks: 2, storeys: 3 } as const
const GATE = ['#1f3a5a', '#2a2a2a', '#3a5a2a', '#5a2a1c']

const LAND_COLOUR: Record<string, string> = {
  industrial: '#8a8478', cemetery: '#6f8a4a', grass: '#7a9a48', pitch: '#4f9a3a', forest: '#3f6a2e', scrub: '#6f7a3e', wetland: '#4f5f34', sand: '#d8c49a', farm: '#8aa04e', bare: '#9a7a5a',
}
// The colours a kind of building is painted (Monrovia's: pale plasters, a bright school, a white church).
const PAINT: Record<string, string[]> = {
  house: PLASTER_HOUSE(),
  block: ['#efe6d2', '#e8d6a6', '#d9e6ea', '#f4f0e6', '#e2c9a0', '#cfd8e0'],
  shop: ['#f0e0a8', '#e8d6a6', '#f2d9c4', '#cfe0d0', '#f4f0e6', '#e6c8c8', '#c8dcef'],
  church: ['#f4f2ec', '#efe9dc', '#e9e0c6'],
  mosque: ['#f4f2ec', '#e2efe0'],
  school: ['#f0d870', '#c8dcef', '#f4f0e6', '#e8b8a0'],
  clinic: ['#f4f4f0', '#e2efe8'],
  office: ['#e9e0c6', '#d8d0c0', '#cfd8e0', '#f4f0e6'],
  hotel: ['#f4f0e6', '#e8d6a6', '#d9e6ea'],
  industrial: ['#bdb6a8', '#a8a49a', '#c8c0b0'],
  shed: ['#8a8a86', '#7a6a5a', '#9a8a7a'],
  other: ['#e8e0d0', '#d8d0c0'],
}
function PLASTER_HOUSE() {
  return ['#efe6d2', '#e8d6a6', '#d9e6ea', '#f2d9c4', '#e6efd8', '#f4f0e6', '#e2c9a0', '#cfe0d0', '#f0e0a8', '#d8d0e8']
}

/** The smallest turned rectangle round a footprint: centre, sides, the turn of the first side. */
function boxAround(pts: number[][]) {
  let best = { area: Infinity, x: 0, y: 0, w: 0, d: 0, yaw: 0 }
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]!
    const [bx, by] = pts[(i + 1) % pts.length]!
    const yaw = Math.atan2(by! - ay!, bx! - ax!)
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const [x, y] of pts) {
      const u = x! * c + y! * sn
      const v = -x! * sn + y! * c
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const area = (u1 - u0) * (v1 - v0)
    if (area < best.area) {
      const mu = (u0 + u1) / 2
      const mv = (v0 + v1) / 2
      best = { area, x: mu * c - mv * sn, y: mu * sn + mv * c, w: u1 - u0, d: v1 - v0, yaw }
    }
  }
  return best
}

function areaOf(pts: number[][]) {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]![0]! - pts[i]![0]!) * (pts[j]![1]! + pts[i]![1]!)
  return a / 2
}

export function buildChunk(city: City, cx: number, cy: number, keep: Keep[], tile?: Tile | null): ChunkParts {
  const rand = seeded(cx * 73856093 ^ cy * 19349663)
  const land = new Mesher()
  const shops = new Mesher()
  const glow = new Mesher()
  const pools = new Mesher()
  const signalMesh = Object.fromEntries(SIGNAL_LAMPS.map((k) => [k, new Mesher()])) as Record<SignalLamp, Mesher>
  const signals: Signal[] = []
  const lamps: number[][] = []
  const places: TilePlace[] = []
  const signs: Sign[] = []
  // Each real building drawn: its footprint, height, whether a shopfront (for its sign).
  const drawn = new Map<number, { pts: number[][]; h: number; shop: boolean; kind: string; box: ReturnType<typeof boxAround> }>()
  /** A street lamp at the kerb, its arm over the road (toward rx, ry): a galvanised steel post on
   * its concrete base, the arm, the lamp head and its glass; most work (a few are broken, as in
   * town), each throwing its pool of light at night. */
  const lamp = (x: number, y: number, rx: number, ry: number, working: boolean) => {
    if (kept(x, y) || !free(x, y, 0.3)) return
    const yaw = Math.atan2(ry, rx)
    plain.post(x, y, 0.2, 0.2, 0, 0.45, '#9a968c', 8)
    plain.post(x, y, 0.11, 0.07, 0.45, 8.4, '#8c9092', 8)
    plain.post(x + rx * 0.35, y + ry * 0.35, 0.05, 0.05, 8.2, 8.55, '#8c9092', 6, [rx * 0.4, ry * 0.4])
    plain.box(x + rx * 1.05, y + ry * 1.05, yaw, 1.5, 0.07, 8.48, 0.07, '#8c9092', [1, 1])
    const hx = x + rx * 1.9
    const hy = y + ry * 1.9
    plain.box(hx, hy, yaw, 0.75, 0.32, 8.32, 0.2, '#6c7072', [1, 1])
    glow.box(hx, hy, yaw, 0.6, 0.24, 8.29, 0.04, working ? '#ffffff' : '#3a3a38', [1, 1])
    if (working) {
      pools.disc(hx, hy, 7.5, 0.09, '#ffffff')
      lamps.push([hx, hy, 8.1])
    }
  }
  const asphalt = new Mesher()
  const dirt = new Mesher()
  const pavement = new Mesher()
  const marks = new Mesher()
  const walls = new Mesher()
  const roofs = new Mesher()
  const plain = new Mesher()
  const leaves = new Mesher()
  const solids: Solid[] = []
  // The trees: where each stands (drawn by the page from the owner's models, TREE_KINDS).
  const trees: number[][] = []
  const plant = (kind: number, x: number, y: number) => trees.push([kind, x, y, rand() * Math.PI * 2, 0.8 + rand() * 0.4])
  const x0 = cx * CHUNK
  const y0 = cy * CHUNK
  const inChunk = (x: number, y: number) => x >= x0 && x < x0 + CHUNK && y >= y0 && y < y0 + CHUNK
  const kept = (x: number, y: number, pad = 0, roads = false) => keep.some((k) => (!roads || k.roads !== false) && Math.hypot(x - k.x, y - k.y) < k.r + pad)
  const mine = segsNear(city, x0 + CHUNK / 2, y0 + CHUNK / 2, CHUNK * 0.75).filter((id) => {
    const s = city.segs[id]!
    return inChunk((s.ax + s.bx) / 2, (s.ay + s.by) / 2)
  })
  // Taken ground in this chunk (2 m cells): buildings never overlap.
  // (Cells by number, not by name: this is asked thousands of times a chunk.)
  const taken = new Set<number>()
  const cell = (gx: number, gy: number) => (gx + 20000) * 40000 + (gy + 20000)
  const free = (x: number, y: number, r: number) => {
    for (let gx = Math.floor((x - r) / 2); gx <= Math.floor((x + r) / 2); gx++) for (let gy = Math.floor((y - r) / 2); gy <= Math.floor((y + r) / 2); gy++) if (taken.has(cell(gx, gy))) return false
    return true
  }
  const take = (x: number, y: number, r: number) => {
    for (let gx = Math.floor((x - r) / 2); gx <= Math.floor((x + r) / 2); gx++) for (let gy = Math.floor((y - r) / 2); gy <= Math.floor((y + r) / 2); gy++) taken.add(cell(gx, gy))
  }
  /** Clear of every road (each by its width), of water, of what is kept. */
  const clear = (x: number, y: number, r: number) => {
    if (kept(x, y, r)) return false
    for (const id of segsNear(city, x, y, r + 12)) {
      const s = city.segs[id]!
      if (toSeg(s, x, y).d < s.w / 2 + PAVEMENT[s.kind] + r) return false
    }
    return !onWater(city, x, y)
  }

  if (tile) {
    // The land: beaches, fields, cemeteries, swamps, forest, flat on the ground.
    for (const l of tile.l) {
      const colour = LAND_COLOUR[l[0] as string]
      if (!colour) continue
      const pts: Vector2[] = []
      for (let i = 1; i + 1 < l.length; i += 2) pts.push(new Vector2(x0 + (l[i] as number) / 10, y0 + (l[i + 1] as number) / 10))
      if (pts.length > 2 && pts[0]!.equals(pts[pts.length - 1]!)) pts.pop()
      if (pts.length < 3) continue
      for (const [a, b, c] of ShapeUtils.triangulateShape(pts, [])) land.tri([pts[a!]!.x, 0.012, -pts[a!]!.y], [pts[b!]!.x, 0.012, -pts[b!]!.y], [pts[c!]!.x, 0.012, -pts[c!]!.y], 0, 1, 0, colour)
    }
    // Every building as it stands: its footprint, raised to its storeys, roofed as Monrovia roofs.
    tile.b.forEach((b, i) => {
      const kind = BUILDING_KINDS[b[0]!] ?? 'other'
      let pts: number[][] = []
      for (let k = 3; k + 1 < b.length; k += 2) pts.push([x0 + b[k]! / 10, y0 + b[k + 1]! / 10])
      if (pts.length < 3) return
      if (areaOf(pts) < 0) pts = pts.reverse()
      const area = Math.abs(areaOf(pts))
      if (area < 4) return
      const box = boxAround(pts)
      if (kept(box.x, box.y, 0) || onWater(city, box.x, box.y)) return
      const r = seeded(cx * 92821 + cy * 68917 + i * 15485863)
      // Storeys: the map's, else what such a building has (most houses one, some two; the big
      // ones on the main roads more).
      const road = nearestRoad(city, box.x, box.y, 40)
      const onMain = road && (road.seg.kind === 'major' || road.seg.kind === 'middle') && road.d < 30
      let storeys = b[1]!
      if (!storeys) {
        const roll = r()
        storeys =
          kind === 'block' || kind === 'hotel' || kind === 'office'
            ? 2 + Math.floor(roll * 3)
            : kind === 'shop'
              ? onMain && roll < 0.6 ? 2 + Math.floor(r() * 2) : 1
              : kind === 'house'
                ? area > 300 && roll < 0.5 ? 2 : onMain && roll < 0.35 ? 2 : roll < 0.08 ? 2 : 1
                : 1
      }
      const h = kind === 'church' || kind === 'mosque' ? Math.max(7, storeys * 3.2) : kind === 'industrial' ? 6 : kind === 'shed' ? 2.4 : storeys * 3.1
      const paints = PAINT[kind] ?? PAINT.other!
      let tint = paints[Math.floor(r() * paints.length)]!
      // The walls: windows and burglar bars for homes and offices; shopfronts on the ground floor.
      const mesh = kind === 'shop' || (onMain && kind !== 'church' && kind !== 'mosque' && kind !== 'shed' && r() < 0.5) ? shops : kind === 'shed' || kind === 'industrial' ? plain : walls
      // Which wall (WALL_STYLE): flats and offices their storeys; a house its maroon base and
      // bars, or its painted wall and louvres, or (now and then) its blocks not yet plastered.
      const style = kind === 'block' || kind === 'hotel' || kind === 'office' || storeys >= 3 ? WALL_STYLE.storeys : mesh === shops ? WALL_STYLE.painted : r() < 0.14 ? WALL_STYLE.blocks : r() < 0.55 ? WALL_STYLE.house : WALL_STYLE.painted
      if (style === WALL_STYLE.blocks) tint = BLOCK[Math.floor(r() * BLOCK.length)]!
      const sv = style * 100
      for (let k = 0; k < pts.length; k++) {
        const [ax, ay] = pts[k]!
        const [bx, by] = pts[(k + 1) % pts.length]!
        const len = Math.hypot(bx! - ax!, by! - ay!)
        if (len < 0.05) continue
        const nx = (by! - ay!) / len
        const ny = -(bx! - ax!) / len
        // A shop: its shopfront the ground floor's height; above it, the storeys' windows.
        const ground = mesh === shops ? Math.min(h, 3.1) : 0
        if (ground > 0)
          shops.quad(
            [
              [ax!, 0, -ay!],
              [bx!, 0, -by!],
              [bx!, ground, -by!],
              [ax!, ground, -ay!],
            ],
            nx,
            0,
            -ny,
            [
              [0, 0],
              [len / 4, 0],
              [len / 4, 1],
              [0, 1],
            ],
            tint,
          )
        if (h > ground)
          (mesh === shops ? walls : mesh).quad(
            [
              [ax!, ground, -ay!],
              [bx!, ground, -by!],
              [bx!, h, -by!],
              [ax!, h, -ay!],
            ],
            nx,
            0,
            -ny,
            [
              [0, sv + ground / 3.1],
              [len / 4, sv + ground / 3.1],
              [len / 4, sv + h / 3.1],
              [0, sv + h / 3.1],
            ],
            tint,
          )
      }
      // The roof: hipped zinc over a house's rectangle, else flat with its parapet (a water
      // tank on many).
      const rect = area / (box.w * box.d)
      const zinc = ZINC[Math.floor(r() * ZINC.length)]!
      if ((kind === 'house' || kind === 'shed' || (kind === 'shop' && storeys === 1) || kind === 'church' || kind === 'school' || kind === 'clinic') && rect > 0.78 && Math.max(box.w, box.d) < 40) {
        roofs.hip(box.x, box.y, box.yaw, box.w, box.d, h, Math.min(2.5, 0.8 + Math.min(box.w, box.d) * 0.12), kind === 'church' ? '#7a3a2a' : zinc)
      } else {
        const flat = pts.map(([x, y]) => new Vector2(x!, y!))
        for (const [a, bb, c] of ShapeUtils.triangulateShape(flat, [])) plain.tri([flat[a!]!.x, h, -flat[a!]!.y], [flat[bb!]!.x, h, -flat[bb!]!.y], [flat[c!]!.x, h, -flat[c!]!.y], 0, 1, 0, '#a8a296')
        for (let k = 0; k < pts.length; k++) {
          const [ax, ay] = pts[k]!
          const [bx, by] = pts[(k + 1) % pts.length]!
          plain.quad(
            [
              [ax!, h, -ay!],
              [bx!, h, -by!],
              [bx!, h + 0.6, -by!],
              [ax!, h + 0.6, -ay!],
            ],
            0,
            0,
            1,
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            tint,
          )
        }
        if (kind !== 'industrial' && r() < 0.55) plain.post(box.x + (r() - 0.5) * box.w * 0.5, box.y + (r() - 0.5) * box.d * 0.5, 0.75, 0.75, h, h + 1.5, '#1c1c20', 8)
      }
      solids.push(solidOf(pts))
      drawn.set(i, { pts, h, shop: mesh === shops, kind, box })
      take(box.x, box.y, Math.min(box.w, box.d) / 2)
      for (const [x, y] of pts) take(x!, y!, 0.5)
    })
    // The places: each on its building's front (the wall facing the nearest road), its sign
    // board over the shopfront or the door, its door below.
    // Boards already on each building (a second place in it: its board lower; more: none).
    const boards = new Map<number, number>()
    for (const p of tile.p) {
      const place: TilePlace = { cat: p[0] as string, name: tile.n[p[1] as number] ?? '', x: x0 + (p[2] as number) / 10, y: y0 + (p[3] as number) / 10, everyday: p[5] === 1 }
      const b = drawn.get(p[4] as number)
      if (b && place.name) {
        const road = nearestRoad(city, place.x, place.y, 60)
        let best: { score: number; mx: number; my: number; nx: number; ny: number; len: number } | null = null
        for (let k = 0; k < b.pts.length; k++) {
          const [ax, ay] = b.pts[k]!
          const [bx, by] = b.pts[(k + 1) % b.pts.length]!
          const len = Math.hypot(bx! - ax!, by! - ay!)
          if (len < 2.2) continue
          const nx = (by! - ay!) / len
          const ny = -(bx! - ax!) / len
          const mx = (ax! + bx!) / 2
          const my = (ay! + by!) / 2
          const tx = road ? road.px - mx : nx
          const ty = road ? road.py - my : ny
          const tl = Math.hypot(tx, ty) || 1
          const score = (nx * tx + ny * ty) / tl + Math.min(len, 8) * 0.03
          if (!best || score > best.score) best = { score, mx, my, nx, ny, len }
        }
        const already = boards.get(p[4] as number) ?? 0
        boards.set(p[4] as number, already + 1)
        if (best && already < 2) {
          const w = Math.min(best.len * 0.88, 7.5) * (already ? 0.7 : 1)
          const hgt = Math.max(0.55, Math.min(1.0, w * 0.15))
          const z = (b.shop ? 2.75 : Math.min(b.h - 0.45, 3.0)) - already * (hgt + 0.15)
          signs.push({ text: place.name, cat: place.cat, x: best.mx + best.nx * 0.07, y: best.my + best.ny * 0.07, z, yaw: Math.atan2(best.ny, best.nx), w, h: hgt })
          place.door = [best.mx + best.nx * 1.4, best.my + best.ny * 1.4]
          place.face = [-best.nx, -best.ny]
        }
      }
      places.push(place)
    }
    surroundings(city, tile, { x0, y0, cx, cy, drawn, signs, solids, land, plain, leaves, dirt, free, take, clear, kept, inChunk, plant })
  }

  // Traffic lights where big roads meet (three big roads' arms or more): for each
  // road coming in, a post at its right-hand kerb before the junction, its lamps toward the
  // traffic coming.
  const nodesHere = new Set<number>()
  for (const id of mine) {
    const sg = city.segs[id]!
    for (const [x, y] of [
      [sg.ax, sg.ay],
      [sg.bx, sg.by],
    ] as const) {
      const n = city.nodeAt?.get(`${Math.round(x / 4)},${Math.round(y / 4)}`)
      if (n !== undefined && inChunk(city.nodes[n]!.x, city.nodes[n]!.y)) nodesHere.add(n)
    }
  }
  for (const n of nodesHere) {
    const node = city.nodes[n]!
    const roads = node.edges.filter((e) => city.edges[e]!.kind !== 'path')
    if (!signalled(city, n) || kept(node.x, node.y, 10)) continue
    const groups: Record<number, 'A' | 'B'> = {}
    let ref: number | null = null
    for (const e of roads) {
      const ed = city.edges[e]!
      const other = city.nodes[ed.a === n ? ed.b : ed.a]!
      // Which way the road leaves the junction.
      const dx = other.x - node.x
      const dy = other.y - node.y
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const ang = Math.atan2(uy, ux)
      ref ??= ang
      let diff = Math.abs(((ang - ref) % Math.PI) + Math.PI) % Math.PI
      if (diff > Math.PI / 2) diff = Math.PI - diff
      const group = diff < Math.PI / 4 ? 'A' : 'B'
      groups[e] = group
      // Traffic comes in along -u; its right is (-uy, ux) turned: for travel (-ux, -uy), right is (-uy, ux).
      const back = junctionRadius(city, n) + 4.6
      const px = node.x + ux * back + -uy * (ed.w / 2 + 1.2)
      const py = node.y + uy * back + ux * (ed.w / 2 + 1.2)
      if (!free(px, py, 0.3)) continue
      plain.post(px, py, 0.09, 0.08, 0, 3.4, '#2a2c2e', 8)
      // The lamp housing facing the traffic (toward +u), its three lamps stacked.
      const yaw = Math.atan2(uy, ux)
      plain.box(px, py, yaw, 0.28, 0.36, 2.6, 1.05, '#1a1a1c', [1, 1])
      plain.box(px + ux * 0.16, py + uy * 0.16, yaw, 0.04, 0.42, 2.58, 1.09, '#e8c020', [1, 1])
      for (const [k, z] of [
        ['r', 3.38],
        ['y', 3.06],
        ['g', 2.74],
      ] as const) {
        signalMesh[`${group}${k}` as SignalLamp].box(px + ux * 0.19, py + uy * 0.19, yaw, 0.03, 0.22, z, 0.22, '#ffffff', [1, 1])
      }
    }
    signals.push({ node: n, x: node.x, y: node.y, groups })
  }
  // At the corner of a junction of two named streets: the street-name signs on their post, each
  // plate along its street (read from both sides).
  for (const n of nodesHere) {
    const node = city.nodes[n]!
    const r = junctionRadius(city, n)
    if (!r || kept(node.x, node.y, 6)) continue
    const named: { name: string; ux: number; uy: number }[] = []
    for (const ei of node.edges) {
      const ed = city.edges[ei]!
      if (ed.kind === 'path' || !ed.name || named.some((x) => x.name === ed.name)) continue
      const o = city.nodes[ed.a === n ? ed.b : ed.a]!
      const l = Math.hypot(o.x - node.x, o.y - node.y) || 1
      named.push({ name: ed.name, ux: (o.x - node.x) / l, uy: (o.y - node.y) / l })
    }
    if (named.length < 2) continue
    const [A, B] = named as [(typeof named)[number], (typeof named)[number]]
    let dx = A.ux + B.ux
    let dy = A.uy + B.uy
    const dl = Math.hypot(dx, dy)
    if (dl < 0.2) {
      dx = -A.uy
      dy = A.ux
    } else {
      dx /= dl
      dy /= dl
    }
    const px = node.x + dx * (r + 1.8)
    const py = node.y + dy * (r + 1.8)
    if (!free(px, py, 0.3)) continue
    plain.post(px, py, 0.05, 0.05, 0, 3.0, '#2c4a36', 6)
    for (const [k, road] of [A, B].entries()) {
      const yaw = Math.atan2(road.uy, road.ux) + Math.PI / 2
      for (const flip of [0, Math.PI]) signs.push({ text: road.name, cat: 'street', x: px + Math.cos(yaw + flip) * 0.03, y: py + Math.sin(yaw + flip) * 0.03, z: 2.78 - k * 0.42, yaw: yaw + flip, w: 1.9, h: 0.34 })
    }
  }
  // A roundabout's island: grass inside its kerb, a palm in the middle.
  for (const ring of city.rings) {
    if (!inChunk(ring.x, ring.y) || kept(ring.x, ring.y)) continue
    const ri = ring.r - ring.w / 2 - 0.4
    if (ri < 2) continue
    land.disc(ring.x, ring.y, ri, 0.09, '#6f9a44')
    for (let k = 0; k < 28; k++) {
      const a0 = (k / 28) * Math.PI * 2
      const a1 = ((k + 1) / 28) * Math.PI * 2
      const cxk = ring.x + Math.cos((a0 + a1) / 2) * ri
      const cyk = ring.y + Math.sin((a0 + a1) / 2) * ri
      plain.box(cxk, cyk, (a0 + a1) / 2 + Math.PI / 2, ((a1 - a0) * ri) + 0.05, 0.25, 0, 0.22, k % 2 ? '#e8e4da' : '#2a2a2a', [1, 1])
    }
    const pts: number[][] = []
    for (let k = 0; k < 16; k++) pts.push([ring.x + Math.cos((k / 16) * Math.PI * 2) * ri, ring.y + Math.sin((k / 16) * Math.PI * 2) * ri])
    solids.push(solidOf(pts))
    plant(TREE.palm, ring.x, ring.y)
  }

  for (const id of mine) {
    const s = city.segs[id]!
    const mx = (s.ax + s.bx) / 2
    const my = (s.ay + s.by) / 2
    if (kept(mx, my, 0, true)) continue
    // The road, by the junctions at its edge's ends (how big each is): its surface, kerbs and
    // markings stopping short of them, the stop lines and zebra crossings before them.
    const e = s.edge >= 0 ? city.edges[s.edge]! : null
    const ra = e ? junctionRadius(city, e.a) : 0
    const rb = e ? junctionRadius(city, e.b) : 0
    const t0 = s.t0
    const t1 = s.t0 + s.len
    // A point t along the edge; the way to the right of its direction (a to b).
    const at = (t: number): [number, number] => [s.ax + s.ux * (t - t0), s.ay + s.uy * (t - t0)]
    const rx = s.uy
    const ry = -s.ux
    const lift = (t: number) => (s.bridge ? deckHeight(s.bridge.s + (t - t0), s.bridge.total) : 0)
    const hA = lift(t0)
    const hB = lift(t1)
    if (s.kind === 'path') {
      // A footpath: a trodden strip of laterite.
      dirt.slope(s.ax, s.ay, s.bx, s.by, s.w, 0.025 + hA, 0.025 + hB, '#e0c8b8')
    } else if (s.kind === 'minor') {
      dirt.slope(s.ax, s.ay, s.bx, s.by, s.w, 0.03 + hA, 0.03 + hB, '#ffffff')
      if (!s.bridge) {
        dirt.disc(s.bx, s.by, s.w / 2, 0.03, '#ffffff')
        dirt.disc(s.ax, s.ay, s.w / 2, 0.03, '#ffffff')
      }
    } else {
      const pw = PAVEMENT[s.kind]
      pavement.slope(s.ax, s.ay, s.bx, s.by, s.w + pw * 2, 0.05 + hA, 0.05 + hB, '#ffffff')
      asphalt.slope(s.ax, s.ay, s.bx, s.by, s.w, 0.07 + hA, 0.07 + hB, '#ffffff')
      if (!s.bridge) {
        pavement.disc(s.bx, s.by, s.w / 2 + pw, 0.05, '#ffffff')
        pavement.disc(s.ax, s.ay, s.w / 2 + pw, 0.05, '#ffffff')
        asphalt.disc(s.bx, s.by, s.w / 2, 0.07, '#ffffff')
        asphalt.disc(s.ax, s.ay, s.w / 2, 0.07, '#ffffff')
      }
      const hm = (t: number) => 0.078 + lift(t)
      // The markings, clear of the junctions: lane lines on a one-way carriageway, the dashed
      // centre line on a two-way road, solid edge lines on the main roads.
      const m0 = Math.max(t0, ra ? ra + 1.2 : 0)
      const m1 = Math.min(t1, rb ? s.elen - rb - 1.2 : s.elen)
      const lanes = Math.max(1, Math.round(s.w / 3.4))
      const dashes: number[] = []
      if (s.one) for (let k = 1; k < lanes; k++) dashes.push(-s.w / 2 + (s.w * k) / lanes)
      else if (lanes >= 2) dashes.push(0)
      for (const o of dashes)
        for (let t = Math.ceil(m0 / 6) * 6; t + 3 <= m1; t += 6) {
          const [px, py] = at(t)
          const [qx, qy] = at(t + 3)
          marks.slope(px + rx * o, py + ry * o, qx + rx * o, qy + ry * o, 0.14, hm(t), hm(t + 3), '#f2f0e6')
        }
      if (s.kind === 'major' && m1 > m0 + 0.5)
        for (const o of [-s.w / 2 + 0.35, s.w / 2 - 0.35]) {
          const [px, py] = at(m0)
          const [qx, qy] = at(m1)
          marks.slope(px + rx * o, py + ry * o, qx + rx * o, qy + ry * o, 0.12, hm(m0), hm(m1), '#ece6d6')
        }
      // The kerbs: raised concrete along both edges, ending at the corners.
      const k0 = Math.max(t0, ra ? ra - 0.4 : 0)
      const k1 = Math.min(t1, rb ? s.elen - rb + 0.4 : s.elen)
      if (k1 > k0 + 0.3 && !s.bridge && !e?.ring)
        for (const side of [-1, 1]) {
          const o = side * (s.w / 2 + 0.09)
          const [px, py] = at(k0)
          const [qx, qy] = at(k1)
          plain.box((px + qx) / 2 + rx * o, (py + qy) / 2 + ry * o, Math.atan2(s.uy, s.ux), k1 - k0, 0.18, 0, 0.19, '#bab4a8', [1, 1])
        }
      // Before a junction of the big roads: the zebra crossing; before a signalled one, the stop
      // line too, across the lanes coming in.
      for (const end of ['a', 'b'] as const) {
        const r = end === 'a' ? ra : rb
        // (Never on a roundabout's ring itself: its entries have them.)
        if (!r || !e || e.ring) continue
        const node = end === 'a' ? e.a : e.b
        const z0 = end === 'a' ? r + 0.4 : s.elen - r - 3.4
        const z1 = z0 + 3
        if (z1 > t0 && z0 < t1)
          for (let o = -s.w / 2 + 0.45; o <= s.w / 2 - 0.4; o += 1.0) {
            const [px, py] = at(Math.max(z0, t0))
            const [qx, qy] = at(Math.min(z1, t1))
            marks.slope(px + rx * o, py + ry * o, qx + rx * o, qy + ry * o, 0.5, hm(Math.max(z0, t0)) + 0.002, hm(Math.min(z1, t1)) + 0.002, '#f4f2ea')
          }
        if (signalled(city, node) && !(s.one && end === 'a')) {
          const ts = end === 'a' ? r + 4.2 : s.elen - r - 4.2
          if (ts >= t0 && ts <= t1) {
            const [lo, hi] = s.one ? [-s.w / 2, s.w / 2] : end === 'b' ? [0, s.w / 2] : [-s.w / 2, 0]
            const [px, py] = at(ts)
            marks.slope(px + rx * lo, py + ry * lo, px + rx * hi, py + ry * hi, 0.45, hm(ts) + 0.002, hm(ts) + 0.002, '#f4f2ea')
          }
        }
      }
    }
    // A bridge: its parapets (walked against), its sides down to the water, its piers.
    if (s.bridge) {
      const half = (s.kind === 'path' ? s.w / 2 : s.w / 2 + PAVEMENT[s.kind]) + 0.15
      for (const side of [-1, 1]) {
        const o = side * half
        const ax = s.ax + rx * o
        const ay = s.ay + ry * o
        const bx = s.bx + rx * o
        const by = s.by + ry * o
        plain.quad(
          [
            [ax, hA + 0.04, -ay],
            [bx, hB + 0.04, -by],
            [bx, hB + (s.kind === 'path' ? 1.0 : 0.9), -by],
            [ax, hA + (s.kind === 'path' ? 1.0 : 0.9), -ay],
          ],
          rx * side,
          0,
          -ry * side,
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
          s.kind === 'path' ? '#6a5a4a' : '#cfc9bc',
        )
        plain.quad(
          [
            [ax, -1.5, -ay],
            [bx, -1.5, -by],
            [bx, hB + 0.04, -by],
            [ax, hA + 0.04, -ay],
          ],
          rx * side,
          0,
          -ry * side,
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
          '#a49e92',
        )
        solids.push(solidOf([
          [ax - rx * side * 0.1, ay - ry * side * 0.1],
          [bx - rx * side * 0.1, by - ry * side * 0.1],
          [bx + rx * side * 0.15, by + ry * side * 0.15],
          [ax + rx * side * 0.15, ay + ry * side * 0.15],
        ]))
      }
      if (s.kind !== 'path' && Math.floor(s.bridge.s / 14) !== Math.floor((s.bridge.s + s.len) / 14) && s.bridge.s > 4 && s.bridge.s + s.len < s.bridge.total - 4)
        for (const o of [-s.w / 3, s.w / 3]) plain.post(mx + rx * o, my + ry * o, 0.5, 0.45, -2, Math.min(hA, hB) - 0.1, '#9a948a', 8)
    }
    // Street lamps: every 30 m or so along the big roads, sides by turns; now and then on a lane.
    if (s.kind === 'major' || s.kind === 'middle' || (s.kind === 'minor' && rand() < 0.3)) {
      const side = id % 2 === 0 ? 1 : -1
      const off = s.w / 2 + PAVEMENT[s.kind] - 0.5
      // The kerb point, and the way across the road (toward its middle).
      const lx = mx - s.uy * (off + (s.kind === 'minor' ? 1 : 0)) * side
      const ly = my + s.ux * (off + (s.kind === 'minor' ? 1 : 0)) * side
      lamp(lx, ly, s.uy * side, -s.ux * side, rand() > 0.12)
    }
    // Wooden poles and wires along the big roads (not on a bridge).
    if ((s.kind === 'major' || s.kind === 'middle') && !s.bridge && rand() < 0.75) {
      const side = rand() < 0.5 ? 1 : -1
      const off = s.w / 2 + PAVEMENT[s.kind] - 0.4
      const px = mx - s.uy * off * side
      const py = my + s.ux * off * side
      if (!kept(px, py)) {
        plain.post(px, py, 0.13, 0.1, 0, 9, '#5a4632')
        plain.box(px, py, Math.atan2(s.uy, s.ux) + Math.PI / 2, 1.6, 0.12, 8.2, 0.12, '#4a3a2a')
      }
    }
    // Along both sides: lots (where the town's real buildings are not known).
    for (const side of tile ? [] : [1, -1]) {
      const nx = -s.uy * side
      const ny = s.ux * side
      const big = s.kind === 'major' || s.kind === 'middle'
      let t = rand() * 6
      while (t < s.len) {
        const w = big ? 8 + rand() * 6 : 7 + rand() * 5
        const d = 7 + rand() * 4
        const at = t + w / 2
        t += w + 1 + rand() * 3
        if (at > s.len) break
        const fx = s.ax + s.ux * at
        const fy = s.ay + s.uy * at
        const yaw = Math.atan2(ny, nx) - Math.PI / 2
        const roll = rand()
        // A zinc kiosk on the shoulder of a big road, its shutter to the road.
        if (big && roll < 0.22) {
          const off = s.w / 2 + PAVEMENT[s.kind] + 1.6
          const kx = fx + nx * off
          const ky = fy + ny * off
          if (clear(kx, ky, 1.2) && free(kx, ky, 1.6)) {
            take(kx, ky, 1.6)
            const colour = KIOSK[Math.floor(rand() * KIOSK.length)]!
            solids.push(walls.box(kx, ky, yaw, 2.8, 2.0, 0, 2.4, colour, [2.8, 2.4]))
            roofs.box(kx + nx * 0.3, ky + ny * 0.3, yaw, 3.4, 2.8, 2.4, 0.06, ZINC[Math.floor(rand() * ZINC.length)]!, [3, 3])
          }
          continue
        }
        if (roll > 0.9) continue
        const setback = big ? 3 + rand() * 3 : 1 + rand() * 2
        const off = s.w / 2 + PAVEMENT[s.kind] + setback + d / 2
        const bx = fx + nx * off
        const by = fy + ny * off
        const r = Math.max(w, d) / 2
        if (!clear(bx, by, r * 0.85) || !free(bx, by, r)) continue
        take(bx, by, r)
        const tint = PLASTER[Math.floor(rand() * PLASTER.length)]!
        const storeys = big && rand() < 0.35 ? (rand() < 0.3 ? 3 : 2) : 1
        const h = storeys * 3.0
        solids.push(walls.box(bx, by, yaw, w, d, 0, h, tint, [4, 3]))
        if (storeys === 1) roofs.hip(bx, by, yaw, w, d, h, 1.1 + rand() * 0.4, ZINC[Math.floor(rand() * ZINC.length)]!)
        else {
          // A flat roof: its parapet, a black water tank.
          plain.box(bx, by, yaw, w + 0.2, d + 0.2, h, 0.6, tint, [4, 3], false)
          if (rand() < 0.6) plain.post(bx + (rand() - 0.5) * (w - 2), by + (rand() - 0.5) * (d - 2), 0.8, 0.8, h, h + 1.6, '#202024', 8)
        }
        // A compound wall in front, its gate on the road.
        if (storeys === 1 && rand() < 0.65) {
          const wallOff = s.w / 2 + PAVEMENT[s.kind] + Math.min(setback, 1.5) * 0.5 + 0.3
          const gx = fx + nx * wallOff
          const gy = fy + ny * wallOff
          const half = w / 2 + 1
          const colour = WALL[Math.floor(rand() * WALL.length)]!
          const gate = 1.6
          for (const dir of [-1, 1]) {
            const cxw = gx + s.ux * dir * (gate + (half - gate) / 2)
            const cyw = gy + s.uy * dir * (gate + (half - gate) / 2)
            if (!kept(cxw, cyw)) solids.push(walls.box(cxw, cyw, yaw, half - gate, 0.2, 0, 2.2, colour, [3, 2.2]))
          }
          plain.box(gx, gy, yaw, gate * 2, 0.08, 0, 2.0, GATE[Math.floor(rand() * GATE.length)]!, [1, 1])
          solids.push(plain.box(gx, gy, yaw, gate * 2, 0.08, 0, 0.01, '#000000', [1, 1], false))
        }
        // A palm in the yard, now and then.
        if (rand() < 0.3) {
          const px = bx + nx * (d / 2 + 1.5) + s.ux * (rand() - 0.5) * w
          const py = by + ny * (d / 2 + 1.5) + s.uy * (rand() - 0.5) * w
          if (clear(px, py, 0.5)) plant(TREE.palm, px, py)
        }
      }
    }
  }
  // Between the roads (where the town's real buildings are not known): houses, close together
  // as a community builds them, each turned to the nearest road, with paths between.
  for (let gx = tile ? Infinity : x0 + 5; gx < x0 + CHUNK; gx += 11)
    for (let gy = y0 + 5; gy < y0 + CHUNK; gy += 11) {
      if (rand() > 0.88) continue
      const bx = gx + (rand() - 0.5) * 5
      const by = gy + (rand() - 0.5) * 5
      const w = 6.5 + rand() * 4
      const d = 6 + rand() * 3
      const r = Math.max(w, d) / 2
      if (!free(bx, by, r * 0.9) || !clear(bx, by, r * 0.85 + 0.8)) continue
      const road = nearestRoad(city, bx, by, 90)
      // Far from any road (a swamp, the bush): left as it is.
      if (!road) continue
      take(bx, by, r)
      const yaw = Math.atan2(road.py - by, road.px - bx) - Math.PI / 2
      const tint = PLASTER[Math.floor(rand() * PLASTER.length)]!
      const storeys = rand() < 0.12 ? 2 : 1
      const h = storeys * 3.0
      solids.push(walls.box(bx, by, yaw, w, d, 0, h, tint, [4, 3]))
      if (storeys === 1) roofs.hip(bx, by, yaw, w, d, h, 1.0 + rand() * 0.4, ZINC[Math.floor(rand() * ZINC.length)]!)
      else plain.box(bx, by, yaw, w + 0.2, d + 0.2, h, 0.6, tint, [4, 3], false)
      if (rand() < 0.15) {
        const px = bx + (rand() - 0.5) * 10
        const py = by + (rand() - 0.5) * 10
        if (free(px, py, 0.6) && clear(px, py, 0.6)) plant(TREE.palm, px, py)
      }
    }
  // What is kept here and has walls of its own (a landmark): solid in each chunk it reaches.
  for (const k of keep)
    for (const poly of k.solids ?? []) {
      const sol = solidOf(poly.map((p) => [p[0]!, p[1]!]))
      const [a, b, c, d] = sol.bb!
      if (c >= x0 && a < x0 + CHUNK && d >= y0 && b < y0 + CHUNK) solids.push(sol)
    }
  return {
    signs,
    signalLamps: Object.fromEntries(SIGNAL_LAMPS.map((k) => [k, signalMesh[k].geometry()])) as Partial<Record<SignalLamp, BufferGeometry | null>>,
    signals,
    glow: glow.geometry(),
    pools: pools.geometry(),
    lamps,
    land: land.geometry(),
    shops: shops.geometry(),
    places,
    asphalt: asphalt.geometry(),
    dirt: dirt.geometry(),
    pavement: pavement.geometry(),
    marks: marks.geometry(),
    walls: walls.geometry(),
    roofs: roofs.geometry(),
    plain: plain.geometry(),
    leaves: leaves.geometry(),
    solids,
    trees,
  }
}

// ---- The town round its buildings: markets, trees, compound walls, the beaches -----------------

type Around = {
  x0: number
  y0: number
  cx: number
  cy: number
  drawn: Map<number, { pts: number[][]; h: number; shop: boolean; kind: string; box: ReturnType<typeof boxAround> }>
  signs: Sign[]
  solids: Solid[]
  land: Mesher
  plain: Mesher
  leaves: Mesher
  dirt: Mesher
  free: (x: number, y: number, r: number) => boolean
  take: (x: number, y: number, r: number) => void
  clear: (x: number, y: number, r: number) => boolean
  kept: (x: number, y: number, pad?: number) => boolean
  inChunk: (x: number, y: number) => boolean
  plant: (kind: number, x: number, y: number) => void
}

/** How far a market spreads round its point (Red Light, the biggest in the country, far more). */
const MARKET_REACH: [RegExp, number][] = [
  [/red light/i, 75],
  [/general market|waterside/i, 38],
  [/./, 24],
]
const UMBRELLA = [
  ['#d8282a', '#f2f2f2'],
  ['#2a6ad8', '#f2d82a'],
  ['#2a9a4a', '#f2f2f2'],
  ['#e86a1c', '#2a6ad8'],
  ['#8a2ad8', '#f2d82a'],
  ['#d8282a', '#2a9a4a', '#f2d82a', '#2a6ad8'],
  ['#f2d82a', '#d8282a'],
]
// What is piled on the tables: tomatoes, peppers, onions, greens, dried fish, palm oil, cloth.
const GOODS = ['#c8281e', '#e83a1c', '#b8885a', '#4a8a2a', '#6a6a5a', '#b8501c', '#2a6ad8', '#e8b82a', '#8a2a6a', '#f2f2e8']
const CANOE = ['#2a6ad8', '#d8282a', '#f2d82a', '#2a9a4a', '#f2f2f2']

function surroundings(city: City, tile: Tile, a: Around) {
  const rand = seeded(a.cx * 2654435761 + a.cy * 40503 + 17)
  const lands = tile.l
    .map((l) => {
      const flat: number[] = []
      for (let i = 1; i + 1 < l.length; i += 2) flat.push(a.x0 + (l[i] as number) / 10, a.y0 + (l[i + 1] as number) / 10)
      return { kind: (l[0] as string).replace(/^~/, ''), poly: poly(flat) }
    })
    .filter((l) => l.poly.pts.length >= 6)
  const landAt = (x: number, y: number) => lands.find((l) => inPoly(l.poly, x, y))?.kind
  const footprints = [...a.drawn].map(([i, b]) => ({ i, p: poly(b.pts.flat() as number[]) }))
  const insideBuilding = (x: number, y: number, except = -1) => footprints.some((f) => f.i !== except && inPoly(f.p, x, y))
  const rect = (x: number, y: number, yaw: number, w: number, d: number) => {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    return solidOf([
      [x + c * (-w / 2) - s * (-d / 2), y + s * (-w / 2) + c * (-d / 2)],
      [x + c * (w / 2) - s * (-d / 2), y + s * (w / 2) + c * (-d / 2)],
      [x + c * (w / 2) - s * (d / 2), y + s * (w / 2) + c * (d / 2)],
      [x + c * (-w / 2) - s * (d / 2), y + s * (-w / 2) + c * (d / 2)],
    ])
  }

  // Markets: the ground worn bare, packed with stalls (tables of goods under striped umbrellas,
  // white tarpaulin tents, rice bags), the market's own board at the road.
  for (const p of tile.p) {
    if (p[0] !== 'market' || p[5] === 1) continue
    const name = tile.n[p[1] as number] ?? ''
    const mx = a.x0 + (p[2] as number) / 10
    const my = a.y0 + (p[3] as number) / 10
    if (a.kept(mx, my, 10)) continue
    const R = MARKET_REACH.find(([re]) => re.test(name))![1]
    const mr = seeded(Math.round(mx * 31 + my * 17))
    // The ground: laterite trodden bare, in a ragged ring.
    const n = 20
    const edge = Array.from({ length: n }, () => R * (0.85 + mr() * 0.2) * 1.05)
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      a.land.tri([mx, 0.014, -my], [mx + Math.cos(a0) * edge[i]!, 0.014, -(my + Math.sin(a0) * edge[i]!)], [mx + Math.cos(a1) * edge[(i + 1) % n]!, 0.014, -(my + Math.sin(a1) * edge[(i + 1) % n]!)], 0, 1, 0, '#a2683f')
    }
    // The rows of stalls, turned the way the nearest road runs.
    const road = nearestRoad(city, mx, my, 120)
    const yaw = road ? Math.atan2(road.seg.uy, road.seg.ux) : 0
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const step = 3.8
    for (let u = -R; u <= R; u += step)
      for (let v = -R; v <= R; v += step) {
        if (Math.hypot(u, v) > R * (0.9 + mr() * 0.15)) continue
        if (mr() < 0.35) continue
        const x = mx + c * u - sn * v + (mr() - 0.5) * 0.6
        const y = my + sn * u + c * v + (mr() - 0.5) * 0.6
        if (!a.free(x, y, 0.6) || !a.clear(x, y, 1.4) || insideBuilding(x, y) || onWater(city, x, y)) continue
        const roll = mr()
        if (roll < 0.12) {
          // A tarpaulin tent: four poles, its white roof sagging.
          if (!a.clear(x, y, 2.4)) continue
          for (const [du, dv] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]] as const) a.plain.post(x + c * du - sn * dv, y + sn * du + c * dv, 0.05, 0.05, 0, 2.5, '#6a5a4a', 5)
          a.plain.box(x, y, yaw, 4.2, 4.2, 2.5, 0.06, mr() < 0.7 ? '#eeeeea' : '#2a6ad8', [1, 1])
          a.plain.box(x, y, yaw, 4.0, 1.0, 0, 0.8, '#7a5a3a', [1, 1])
          a.solids.push(rect(x, y, yaw, 4.0, 1.0))
          continue
        }
        // A table of planks, its goods piled.
        const ty = yaw + (mr() < 0.5 ? 0 : Math.PI / 2)
        a.plain.box(x, y, ty, 1.8, 0.9, 0, 0.82, mr() < 0.5 ? '#7a5a3a' : '#5a4430', [1, 1])
        const tc = Math.cos(ty)
        const ts = Math.sin(ty)
        // Two heaps of goods (each its own colour), some in an enamel basin.
        for (const du of [-0.42, 0.42]) {
          const gx = x + tc * du
          const gy = y + ts * du
          const g = GOODS[Math.floor(mr() * GOODS.length)]!
          if (mr() < 0.3) a.plain.post(gx, gy, 0.3, 0.36, 0.82, 0.95, '#c8c8c4', 5)
          a.plain.box(gx, gy, ty + (mr() - 0.5) * 0.4, 0.7, 0.62, 0.82, 0.12 + mr() * 0.14, g, [1, 1])
        }
        a.solids.push(rect(x, y, ty, 1.8, 0.9))
        // Rice bags stacked beside, now and then.
        if (mr() < 0.2) a.plain.box(x - ts * 1.0, y + tc * 1.0, ty, 0.9, 0.55, 0, 0.6, '#ecebe2', [1, 1])
        if (mr() < 0.78) umbrella(a.plain, x + (mr() - 0.5) * 0.4, y + (mr() - 0.5) * 0.4, 1.3 + mr() * 0.4, 2.2 + mr() * 0.3, UMBRELLA[Math.floor(mr() * UMBRELLA.length)]!, mr() * 6)
      }
    // Its board at the road: on two posts, its face to the traffic.
    if (road && name) {
      let nx = mx - road.px
      let ny = my - road.py
      const l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      const off = road.seg.w / 2 + 3
      const bx = road.px + nx * off
      const by = road.py + ny * off
      if (a.clear(bx, by, 0.4)) {
        const w = Math.min(7, 2.2 + name.length * 0.3)
        for (const d of [-1, 1]) a.plain.post(bx - ny * d * (w / 2 - 0.3), by + nx * d * (w / 2 - 0.3), 0.08, 0.08, 0, 4.4, '#4a4a48', 6)
        a.signs.push({ text: name, cat: 'market', x: bx - nx * 0.05, y: by - ny * 0.05, z: 3.4, yaw: Math.atan2(-ny, -nx), w, h: 1.1 })
        a.signs.push({ text: name, cat: 'market', x: bx + nx * 0.05, y: by + ny * 0.05, z: 3.4, yaw: Math.atan2(ny, nx), w, h: 1.1 })
      }
    }
  }

  // Compound walls round houses (not businesses, open to the street): plastered block, its cap,
  // the gate's opening toward the road between two pillars.
  const business = new Set(tile.p.map((p) => p[4] as number))
  for (const [i, b] of a.drawn) {
    if (b.kind !== 'house' || business.has(i)) continue
    const bb = b.box
    if (bb.w * bb.d > 420 || bb.w * bb.d < 30) continue
    const r = seeded(a.cx * 7919 + a.cy * 104729 + i * 31)
    if (r() > 0.5) continue
    const m = 2 + r() * 1.5
    const W = bb.w + m * 2
    const D = bb.d + m * 2
    const c = Math.cos(bb.yaw)
    const sn = Math.sin(bb.yaw)
    const at = (u: number, v: number) => [bb.x + c * u - sn * v, bb.y + sn * u + c * v] as const
    // Every point of the wall clear of the roads, the water and every other building; no other
    // building inside it.
    let ok = true
    for (let k = 0; k < 4 && ok; k++) {
      for (let t = 0; t <= 1.0001 && ok; t += 0.125) {
        const u = k === 0 ? -W / 2 + W * t : k === 1 ? W / 2 : k === 2 ? W / 2 - W * t : -W / 2
        const v = k === 0 ? -D / 2 : k === 1 ? -D / 2 + D * t : k === 2 ? D / 2 : D / 2 - D * t
        const [x, y] = at(u, v)
        if (!a.clear(x, y, 0.6) || insideBuilding(x, y, i) || !a.inChunk(x, y)) ok = false
      }
    }
    if (!ok) continue
    for (const [j, o] of a.drawn) {
      if (j === i || Math.abs(o.box.x - bb.x) > W || Math.abs(o.box.y - bb.y) > W) continue
      for (const [x, y] of o.pts) {
        const dx = x! - bb.x
        const dy = y! - bb.y
        if (Math.abs(dx * c + dy * sn) < W / 2 && Math.abs(-dx * sn + dy * c) < D / 2) ok = false
      }
    }
    if (!ok) continue
    // The side facing the road: the gate's.
    const road = nearestRoad(city, bb.x, bb.y, 60)
    const sides = [
      { u: 0, v: -D / 2, len: W, nu: 0, nv: -1 },
      { u: W / 2, v: 0, len: D, nu: 1, nv: 0 },
      { u: 0, v: D / 2, len: W, nu: 0, nv: 1 },
      { u: -W / 2, v: 0, len: D, nu: -1, nv: 0 },
    ]
    let gate = 0
    if (road) {
      const tx = road.px - bb.x
      const ty = road.py - bb.y
      let best = -Infinity
      sides.forEach((sd, k) => {
        const dot = (c * sd.nu - sn * sd.nv) * tx + (sn * sd.nu + c * sd.nv) * ty
        if (dot > best) {
          best = dot
          gate = k
        }
      })
    }
    const colour = WALL[Math.floor(r() * WALL.length)]!
    const h = 2.1 + r() * 0.4
    const gw = 3.2
    sides.forEach((sd, k) => {
      const along = sd.nu === 0 ? 0 : Math.PI / 2
      const pieces: [number, number][] = k === gate ? [[-sd.len / 2, -gw / 2], [gw / 2, sd.len / 2]] : [[-sd.len / 2, sd.len / 2]]
      for (const [s0, s1] of pieces) {
        const mid = (s0 + s1) / 2
        const len = s1 - s0 + 0.2
        const pu = sd.nu === 0 ? sd.u + mid : sd.u
        const pv = sd.nu === 0 ? sd.v : sd.v + mid
        const [x, y] = at(pu, pv)
        a.plain.box(x, y, bb.yaw + along, len, 0.2, 0, h, colour, [1, 1])
        a.plain.box(x, y, bb.yaw + along, len, 0.3, h, 0.08, '#9a958a', [1, 1])
        a.solids.push(rect(x, y, bb.yaw + along, len, 0.25))
      }
      if (k === gate)
        for (const d of [-1, 1]) {
          const pu = sd.nu === 0 ? sd.u + (d * gw) / 2 : sd.u
          const pv = sd.nu === 0 ? sd.v : sd.v + (d * gw) / 2
          const [x, y] = at(pu, pv)
          a.plain.box(x, y, bb.yaw, 0.45, 0.45, 0, h + 0.4, colour, [1, 1])
          // The gate's leaf, swung open inward against the wall.
          const [lx, ly] = at(pu - sd.nu * 0.8 + (sd.nu === 0 ? -d * 0.05 : 0), pv - sd.nv * 0.8 + (sd.nv === 0 ? -d * 0.05 : 0))
          a.plain.box(lx, ly, bb.yaw + along + Math.PI / 2, 1.5, 0.05, 0.05, h - 0.2, GATE[Math.floor(r() * GATE.length)]!, [1, 1])
        }
    })
  }

  // Trees: shade trees and palms in the yards, woods where the land is forest or bush, palms
  // and canoes along the beaches.
  const tree = (x: number, y: number, kind: 'palm' | 'shade' | 'bush') => {
    if (!a.free(x, y, kind === 'bush' ? 0.6 : 1.2) || !a.clear(x, y, kind === 'bush' ? 0.6 : 1.5) || insideBuilding(x, y) || onWater(city, x, y)) return
    a.take(x, y, kind === 'bush' ? 0.5 : 1)
    a.plant(kind === 'palm' ? TREE.palm : kind === 'bush' ? TREE.banana : TREE.shade, x, y)
    if (kind !== 'bush') a.solids.push(rect(x, y, 0, 0.5, 0.5))
  }
  // A yard's tree, beside about every other house.
  for (const [i, b] of a.drawn) {
    if (b.kind !== 'house' && b.kind !== 'other' && b.kind !== 'school' && b.kind !== 'church') continue
    const r = seeded(a.cx * 131 + a.cy * 977 + i * 7)
    if (r() > 0.5) continue
    const bb = b.box
    const side = r() * Math.PI * 2
    const dist = Math.max(bb.w, bb.d) / 2 + 2 + r() * 3
    tree(bb.x + Math.cos(side) * dist, bb.y + Math.sin(side) * dist, r() < 0.4 ? 'palm' : 'shade')
  }
  // The land's own: woods, bush, the beaches.
  for (let k = 0; k < 260; k++) {
    const x = a.x0 + rand() * CHUNK
    const y = a.y0 + rand() * CHUNK
    const kind = landAt(x, y)
    if (kind === 'forest') tree(x, y, rand() < 0.15 ? 'palm' : rand() < 0.3 ? 'bush' : 'shade')
    else if (kind === 'scrub' || kind === 'wetland') {
      if (rand() < 0.55) tree(x, y, rand() < 0.25 ? 'shade' : 'bush')
    } else if (kind === 'grass' || kind === 'farm' || kind === 'cemetery') {
      if (rand() < 0.08) tree(x, y, rand() < 0.5 ? 'palm' : 'shade')
    } else if (kind === 'sand') {
      if (rand() < 0.25) tree(x, y, 'palm')
      else if (rand() < 0.12 && a.free(x, y, 3.5) && a.clear(x, y, 3) && !onWater(city, x, y)) {
        a.take(x, y, 3)
        canoe(a.plain, x, y, rand() * Math.PI, CANOE[Math.floor(rand() * CANOE.length)]!, CANOE[Math.floor(rand() * CANOE.length)]!)
      }
    } else if (!kind && rand() < 0.07) {
      // Open ground among the houses: a mango or a palm now and then.
      tree(x, y, rand() < 0.5 ? 'palm' : 'shade')
    }
  }
}

/** A market umbrella: its pole, its canopy of coloured panels, tilted a little. */
function umbrella(m: Mesher, x: number, y: number, r: number, h: number, colours: string[], turn: number) {
  m.post(x, y, 0.025, 0.025, 0, h + 0.35, '#d8d8d4', 4)
  const n = 8
  const tilt = [0.12, 0.08]
  for (let i = 0; i < n; i++) {
    const a0 = turn + (i / n) * Math.PI * 2
    const a1 = turn + ((i + 1) / n) * Math.PI * 2
    const p = (a: number) => {
      const ex = Math.cos(a) * r
      const ey = Math.sin(a) * r
      return [x + ex, h + ex * tilt[0]! + ey * tilt[1]!, -(y + ey)]
    }
    m.tri([x, h + 0.45, -y], p(a0), p(a1), 0, 1, 0, colours[i % colours.length]!)
  }
}

/** A fishing canoe drawn up on the sand: its long hull painted in two colours, pointed at both ends. */
function canoe(m: Mesher, x: number, y: number, yaw: number, hull: string, band: string) {
  const L = 7.5
  m.box(x, y, yaw, L - 2, 1.1, 0, 0.55, hull, [1, 1])
  m.box(x, y, yaw, L - 2, 1.14, 0.38, 0.12, band, [1, 1])
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  for (const d of [-1, 1]) {
    const bx = x + c * d * ((L - 2) / 2)
    const by = y + s * d * ((L - 2) / 2)
    const tx = x + c * d * (L / 2)
    const ty = y + s * d * (L / 2)
    const lx = -s * 0.55
    const ly = c * 0.55
    for (const z of [0.55, 0.0]) m.tri([bx + lx, z, -(by + ly)], [bx - lx, z, -(by - ly)], [tx, z + 0.2, -ty], 0, z ? 1 : -1, 0, hull)
    m.quad([[bx + lx, 0, -(by + ly)], [tx, 0.2, -ty], [tx, 0.75, -ty], [bx + lx, 0.55, -(by + ly)]], ly, 0, lx, [[0, 0], [1, 0], [1, 1], [0, 1]], hull)
    m.quad([[tx, 0.2, -ty], [bx - lx, 0, -(by - ly)], [bx - lx, 0.55, -(by - ly)], [tx, 0.75, -ty]], -ly, 0, -lx, [[0, 0], [1, 0], [1, 1], [0, 1]], hull)
  }
}

/** The water of the town (sea, lagoons, swamps) as flat meshes, built once. */
export function waterGeometry(city: City, which: 'sea' | 'water' | 'wet'): BufferGeometry | null {
  const polys = which === 'sea' ? (city.sea ? [city.sea] : []) : which === 'water' ? city.water : city.wet
  const pos: number[] = []
  const h = which === 'wet' ? 0.02 : 0.015
  for (const p of polys) {
    const pts: Vector2[] = []
    for (let i = 0; i + 1 < p.pts.length; i += 2) pts.push(new Vector2(p.pts[i]!, p.pts[i + 1]!))
    if (pts.length > 2 && pts[0]!.equals(pts[pts.length - 1]!)) pts.pop()
    if (pts.length < 3) continue
    for (const [a, b, c] of ShapeUtils.triangulateShape(pts, [])) {
      for (const i of [a!, c!, b!]) pos.push(pts[i]!.x, h, -pts[i]!.y)
    }
  }
  if (pos.length === 0) return null
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.computeVertexNormals()
  return g
}

// ---- Finding the way ---------------------------------------------------------------------------

/** One step of a route: an edge, driven from one of its nodes to the other. */
export type Leg = { edge: number; from: number; to: number }

/** The nearest node to a point among the roads a vehicle may use (within r). */
export function nearestNode(city: City, x: number, y: number, ok: (e: City['edges'][number]) => boolean, r = 400): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const id of segsNear(city, x, y, r)) {
    const s = city.segs[id]!
    for (const [px, py] of [
      [s.ax, s.ay],
      [s.bx, s.by],
    ] as const) {
      const d = Math.hypot(px - x, py - y)
      if (d >= bestD) continue
      const k = `${Math.round(px / 4)},${Math.round(py / 4)}`
      const n = city.nodeAt?.get(k)
      if (n === undefined || !city.nodes[n]!.edges.some((e) => ok(city.edges[e]!))) continue
      best = n
      bestD = d
    }
  }
  return best
}

/** The shortest way by road from one node to another (A*, one-way roads the right way). */
export function route(city: City, from: number, to: number, ok: (e: City['edges'][number]) => boolean): Leg[] | null {
  const goal = city.nodes[to]!
  const g = new Map<number, number>([[from, 0]])
  const came = new Map<number, Leg>()
  const open: [number, number][] = [[Math.hypot(city.nodes[from]!.x - goal.x, city.nodes[from]!.y - goal.y), from]]
  const done = new Set<number>()
  while (open.length) {
    // The open list is small enough to keep sorted by hand.
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i]![0] < open[bi]![0]) bi = i
    const [, n] = open.splice(bi, 1)[0]!
    if (n === to) break
    if (done.has(n)) continue
    done.add(n)
    if (done.size > 20000) return null
    for (const ei of city.nodes[n]!.edges) {
      const e = city.edges[ei]!
      if (!ok(e)) continue
      if (e.one && e.a !== n) continue
      const m = e.a === n ? e.b : e.a
      const cost = g.get(n)! + e.len * (e.kind === 'minor' ? 1.4 : 1)
      if (cost < (g.get(m) ?? Infinity)) {
        g.set(m, cost)
        came.set(m, { edge: ei, from: n, to: m })
        const nm = city.nodes[m]!
        open.push([cost + Math.hypot(nm.x - goal.x, nm.y - goal.y), m])
      }
    }
  }
  if (!came.has(to) && from !== to) return null
  const legs: Leg[] = []
  for (let n = to; n !== from; ) {
    const leg = came.get(n)!
    legs.unshift(leg)
    n = leg.from
  }
  return legs
}
