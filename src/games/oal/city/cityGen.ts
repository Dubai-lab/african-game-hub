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

export type RoadKind = 'major' | 'middle' | 'minor'
/** The town's map, as the map screen has it (metres east and north of its centre). */
export type TownMapData = {
  roads: Record<RoadKind, { p: number[]; n?: string }[]>
  water: number[][]
  wetland: number[][]
  rivers: { p: number[] }[]
  sea: number[]
  places: Record<string, { x: number; y: number; places?: Record<string, number[]> }>
}

export const ROAD_WIDTH: Record<RoadKind, number> = { major: 12, middle: 8, minor: 5.5 }
/** The kerb and pavement either side of a tarred road. */
const PAVEMENT: Record<RoadKind, number> = { major: 3, middle: 2, minor: 0 }
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
  edges: { a: number; b: number; len: number; kind: RoadKind; w: number }[]
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
  for (const kind of ['major', 'middle', 'minor'] as RoadKind[]) {
    for (const r of map.roads[kind] ?? []) {
      const p = r.p
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
          edges.push({ a, b, len, kind, w: ROAD_WIDTH[kind] })
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
            w: ROAD_WIDTH[kind],
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

/** A solid on the ground, to walk against: a turned rectangle's corners. */
export type Solid = number[][]

export type ChunkParts = {
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

export function buildChunk(city: City, cx: number, cy: number, keep: Keep[]): ChunkParts {
  const rand = seeded(cx * 73856093 ^ cy * 19349663)
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

  for (const id of mine) {
    const s = city.segs[id]!
    const mx = (s.ax + s.bx) / 2
    const my = (s.ay + s.by) / 2
    if (kept(mx, my, 0, true)) continue
    // The road: tarred (the big ones, with pavements and a dashed line) or laterite.
    if (s.kind === 'minor') {
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
    // Wooden poles and wires along the big roads.
    if (s.kind !== 'minor' && rand() < 0.75) {
      const side = rand() < 0.5 ? 1 : -1
      const off = s.w / 2 + PAVEMENT[s.kind] - 0.4
      const px = mx - s.uy * off * side
      const py = my + s.ux * off * side
      if (!kept(px, py)) {
        plain.post(px, py, 0.13, 0.1, 0, 9, '#5a4632')
        plain.box(px, py, Math.atan2(s.uy, s.ux) + Math.PI / 2, 1.6, 0.12, 8.2, 0.12, '#4a3a2a')
      }
    }
    // Along both sides: lots.
    for (const side of [1, -1]) {
      const nx = -s.uy * side
      const ny = s.ux * side
      const big = s.kind !== 'minor'
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
        const setback = big ? 3 + rand() * 3 : 2 + rand() * 3
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
  // Between the roads: the town's own houses, close together as a community builds them, each
  // turned to the nearest road, with paths between.
  for (let gx = x0 + 6; gx < x0 + CHUNK; gx += 13)
    for (let gy = y0 + 6; gy < y0 + CHUNK; gy += 13) {
      if (rand() > 0.78) continue
      const bx = gx + (rand() - 0.5) * 5
      const by = gy + (rand() - 0.5) * 5
      const w = 6.5 + rand() * 4
      const d = 6 + rand() * 3
      const r = Math.max(w, d) / 2
      if (!free(bx, by, r) || !clear(bx, by, r * 0.9 + 1.5)) continue
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
