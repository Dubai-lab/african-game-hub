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
  roads: Partial<Record<RoadKind, { p: number[]; n?: string; o?: 1; w?: number; b?: 1 }[]>>
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

export type Seg = { ax: number; ay: number; bx: number; by: number; kind: RoadKind; w: number; len: number; ux: number; uy: number; road: number; name?: string }
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
  edges: { a: number; b: number; len: number; kind: RoadKind; w: number; one: boolean }[]
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
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i]!
        const ay = p[i + 1]!
        const bx = p[i + 2]!
        const by = p[i + 3]!
        const len = Math.hypot(bx - ax, by - ay)
        if (len < 0.5) continue
        const a = node(ax, ay)
        const b = node(bx, by)
        if (a !== b) {
          edges.push({ a, b, len, kind, w: width, one: r.o === 1 })
          nodes[a]!.edges.push(edges.length - 1)
          nodes[b]!.edges.push(edges.length - 1)
        }
        const pieces = Math.ceil(len / 30)
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
  }
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

/** A mesh being built: positions, normals, uvs, colours. */
class Mesher {
  p: number[] = []
  n: number[] = []
  uv: number[] = []
  c: number[] = []
  private col = new Color()
  /** A quad (four corners in order), its normal, its uv corners, a colour. */
  quad(v: number[][], nx: number, ny: number, nz: number, uvs: number[][], colour: string | Color) {
    const col = typeof colour === 'string' ? this.col.set(colour) : colour
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const q = v[i]!
      this.p.push(q[0]!, q[1]!, q[2]!)
      this.n.push(nx, ny, nz)
      this.uv.push(uvs[i]![0]!, uvs[i]![1]!)
      this.c.push(col.r, col.g, col.b)
    }
  }
  tri(a: number[], b: number[], c: number[], nx: number, ny: number, nz: number, colour: string | Color, uvs = [[0, 0], [1, 0], [0.5, 1]]) {
    const col = typeof colour === 'string' ? this.col.set(colour) : colour
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
}

/** A circle the chunk leaves alone (a hub built by hand, a compound placed by the game). */
export type Keep = { x: number; y: number; r: number; roads?: boolean }

const PLASTER = ['#efe6d2', '#e8d6a6', '#d9e6ea', '#f2d9c4', '#e6efd8', '#f4f0e6', '#e2c9a0', '#cfe0d0', '#f0e0a8', '#d8d0e8']
const ZINC = ['#8a4a2c', '#7a3f26', '#9a5a3a', '#6e4a3a', '#a06040', '#8a8a86']
const KIOSK = ['#2f6fb8', '#c8281e', '#2f8a4a', '#e2b62a', '#e86a1c', '#6a3a8a']
const WALL = ['#d8d0c0', '#cfc6b4', '#e4ddcc', '#bdb3a0']
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
  const drawn = new Map<number, { pts: number[][]; h: number; shop: boolean }>()
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
  const x0 = cx * CHUNK
  const y0 = cy * CHUNK
  const inChunk = (x: number, y: number) => x >= x0 && x < x0 + CHUNK && y >= y0 && y < y0 + CHUNK
  const kept = (x: number, y: number, pad = 0, roads = false) => keep.some((k) => (!roads || k.roads !== false) && Math.hypot(x - k.x, y - k.y) < k.r + pad)
  const mine = segsNear(city, x0 + CHUNK / 2, y0 + CHUNK / 2, CHUNK * 0.75).filter((id) => {
    const s = city.segs[id]!
    return inChunk((s.ax + s.bx) / 2, (s.ay + s.by) / 2)
  })
  // Taken ground in this chunk (2 m cells): buildings never overlap.
  const taken = new Set<string>()
  const free = (x: number, y: number, r: number) => {
    for (let gx = Math.floor((x - r) / 2); gx <= Math.floor((x + r) / 2); gx++) for (let gy = Math.floor((y - r) / 2); gy <= Math.floor((y + r) / 2); gy++) if (taken.has(key(gx, gy))) return false
    return true
  }
  const take = (x: number, y: number, r: number) => {
    for (let gx = Math.floor((x - r) / 2); gx <= Math.floor((x + r) / 2); gx++) for (let gy = Math.floor((y - r) / 2); gy <= Math.floor((y + r) / 2); gy++) taken.add(key(gx, gy))
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
      const tint = paints[Math.floor(r() * paints.length)]!
      // The walls: windows and burglar bars for homes and offices; shopfronts on the ground floor.
      const mesh = kind === 'shop' || (onMain && kind !== 'church' && kind !== 'mosque' && kind !== 'shed' && r() < 0.5) ? shops : kind === 'shed' || kind === 'industrial' ? plain : walls
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
              [0, ground / 3.1],
              [len / 4, ground / 3.1],
              [len / 4, h / 3.1],
              [0, h / 3.1],
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
      drawn.set(i, { pts, h, shop: mesh === shops })
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
    const big = roads.filter((e) => city.edges[e]!.kind === 'major' || city.edges[e]!.kind === 'middle')
    if (big.length < 3 || kept(node.x, node.y, 10)) continue
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
      const back = ed.w / 2 + 3
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

  for (const id of mine) {
    const s = city.segs[id]!
    const mx = (s.ax + s.bx) / 2
    const my = (s.ay + s.by) / 2
    if (kept(mx, my, 0, true)) continue
    // The road: tarred (the big ones, with pavements and a dashed line) or laterite.
    if (s.kind === 'path') {
      // A footpath: a trodden strip of laterite.
      dirt.ground(s.ax, s.ay, s.bx, s.by, s.w, 0.025, '#e0c8b8')
    } else if (s.kind === 'minor') {
      dirt.ground(s.ax, s.ay, s.bx, s.by, s.w, 0.03, '#ffffff')
      dirt.disc(s.bx, s.by, s.w / 2, 0.03, '#ffffff')
      dirt.disc(s.ax, s.ay, s.w / 2, 0.03, '#ffffff')
    } else {
      pavement.ground(s.ax, s.ay, s.bx, s.by, s.w + PAVEMENT[s.kind] * 2, 0.05, '#ffffff')
      pavement.disc(s.bx, s.by, s.w / 2 + PAVEMENT[s.kind], 0.05, '#ffffff')
      pavement.disc(s.ax, s.ay, s.w / 2 + PAVEMENT[s.kind], 0.05, '#ffffff')
      asphalt.ground(s.ax, s.ay, s.bx, s.by, s.w, 0.07, '#ffffff')
      asphalt.disc(s.bx, s.by, s.w / 2, 0.07, '#ffffff')
      asphalt.disc(s.ax, s.ay, s.w / 2, 0.07, '#ffffff')
      // The dashed centre line: 3 m painted, 3 m not.
      for (let t = 1.5; t + 3 < s.len; t += 6) {
        const ax = s.ax + s.ux * t
        const ay = s.ay + s.uy * t
        marks.ground(ax, ay, ax + s.ux * 3, ay + s.uy * 3, 0.15, 0.075, '#f2f0e6')
      }
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
    // Wooden poles and wires along the big roads.
    if ((s.kind === 'major' || s.kind === 'middle') && rand() < 0.75) {
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
          if (clear(px, py, 0.5)) palm(plain, leaves, px, py, rand)
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
        if (free(px, py, 0.6) && clear(px, py, 0.6)) palm(plain, leaves, px, py, rand)
      }
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
  }
}

/** A coconut palm: its leaning trunk, its crown of arching fronds. */
function palm(trunk: Mesher, leaves: Mesher, x: number, y: number, rand: () => number) {
  const h = 7 + rand() * 4
  const lean = [(rand() - 0.5) * 1.6, (rand() - 0.5) * 1.6]
  trunk.post(x, y, 0.22, 0.15, 0, h, '#7a6650', 6, lean)
  const tx = x + lean[0]!
  const ty = y + lean[1]!
  const green = new Color()
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand()
    const len = 3.2 + rand() * 1.2
    green.setHSL(0.24 + rand() * 0.04, 0.45, 0.24 + rand() * 0.08)
    // Each frond: two quads, up and out then down, a leaf's width across.
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const wx = -uy * 0.45
    const wy = ux * 0.45
    const mid = [tx + ux * len * 0.5, h + 0.6, ty + uy * len * 0.5]
    const tip = [tx + ux * len, h - 1.2, ty + uy * len]
    const P = (p: number[], s: number) => [p[0]! + wx * s, p[1]!, -(p[2]! + wy * s)]
    const base = [tx, h, ty]
    leaves.quad([P(base, -0.3), P(base, 0.3), P(mid, 1), P(mid, -1)], 0, 1, 0, [[0, 0], [1, 0], [1, 0.5], [0, 0.5]], green)
    leaves.quad([P(mid, -1), P(mid, 1), P(tip, 0.2), P(tip, -0.2)], 0, 1, 0, [[0, 0.5], [1, 0.5], [1, 1], [0, 1]], green)
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
