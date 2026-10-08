// The hub's own chess set. Every piece is generated here from a few numbers: a lathe profile
// (like a piece turned on a lathe) plus, for the knight and king, a simple extruded shape.
// There are no model files, so nothing to download and nothing borrowed from another set.
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type PieceKind = 'p' | 'r' | 'n' | 'b' | 'q' | 'k'
export type Side = 'w' | 'b'

// Mirrors the CSS tokens in src/index.css (WebGL cannot read CSS variables cheaply).
export const COLORS = {
  limewash: '#eef0fa',
  ink: '#0d1130',
  indigo: '#1f2a7a',
  indigoSoft: '#4455c7',
  maize: '#f5b700',
  hibiscus: '#d1264f',
  lightPiece: '#f6f7fd',
  darkPiece: '#0a0d2b',
} as const

const SEGMENTS = 28

/** [radius, height, band] — band 1 is the maize stripe, band 2 the thin hibiscus stripe. */
type ProfilePoint = [number, number, (1 | 2)?]

// Shared foot and collar. The collar carries the band, the one decorative motif.
const BASE: ProfilePoint[] = [
  [0, 0],
  [0.36, 0],
  [0.37, 0.06],
  [0.33, 0.12],
  [0.25, 0.2],
  [0.275, 0.2, 1],
  [0.275, 0.29, 1],
  [0.275, 0.291, 2],
  [0.275, 0.33, 2],
  [0.24, 0.331],
]

const BODIES: Record<PieceKind, ProfilePoint[]> = {
  p: [
    [0.2, 0.36],
    [0.14, 0.6],
    [0.2, 0.64],
    [0.12, 0.67],
    [0.15, 0.73],
    [0.175, 0.82],
    [0.15, 0.92],
    [0.08, 0.98],
    [0, 0.99],
  ],
  r: [
    [0.22, 0.36],
    [0.19, 0.8],
    [0.28, 0.85],
    [0.28, 1.06],
    [0.21, 1.06],
    [0.21, 0.97],
    [0, 0.97],
  ],
  b: [
    [0.2, 0.36],
    [0.13, 0.8],
    [0.2, 0.84],
    [0.12, 0.87],
    [0.16, 0.98],
    [0.165, 1.08],
    [0.12, 1.2],
    [0.05, 1.27],
    [0.075, 1.31],
    [0.055, 1.36],
    [0, 1.375],
  ],
  n: [
    [0.21, 0.36],
    [0.17, 0.6],
    [0.23, 0.64],
    [0.23, 0.68],
    [0, 0.68],
  ],
  q: [
    [0.22, 0.36],
    [0.14, 0.98],
    [0.22, 1.03],
    [0.15, 1.07],
    [0.25, 1.32],
    [0.2, 1.33],
    [0.1, 1.27],
    [0.075, 1.31],
    [0.085, 1.37],
    [0.055, 1.42],
    [0, 1.43],
  ],
  k: [
    [0.23, 0.36],
    [0.15, 1.02],
    [0.23, 1.07],
    [0.16, 1.11],
    [0.23, 1.34],
    [0.23, 1.42],
    [0.1, 1.46],
    [0, 1.46],
  ],
}

function paint(geometry: BufferGeometry, colorAt: (vertex: number) => Color): BufferGeometry {
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const c = colorAt(i)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  // Merging needs every part in the same form.
  return geometry.index ? geometry.toNonIndexed() : geometry
}

function turned(points: ProfilePoint[], body: Color, maize: Color, hibiscus: Color): BufferGeometry {
  const lathe = new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    SEGMENTS,
  )
  // LatheGeometry lays vertices out ring by ring, one per profile point.
  return paint(lathe, (i) => {
    const band = points[i % points.length]![2]
    return band === 1 ? maize : band === 2 ? hibiscus : body
  })
}

// The knight's head: an angled wedge, deliberately not a horse.
function knightHead(body: Color): BufferGeometry {
  const outline = new Shape()
  outline.moveTo(-0.18, 0.66)
  outline.lineTo(0.18, 0.66)
  outline.lineTo(0.19, 0.88)
  outline.lineTo(0.35, 1.04)
  outline.lineTo(0.2, 1.38)
  outline.lineTo(-0.03, 1.42)
  outline.lineTo(-0.21, 1.12)
  outline.lineTo(-0.07, 0.92)
  outline.closePath()
  const depth = 0.2
  const head = new ExtrudeGeometry(outline, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 })
  head.translate(0, 0, -depth / 2)
  // Drawn facing +x; turn it to face down the board (-z). Dark knights are rotated in the scene.
  head.rotateY(Math.PI / 2)
  return paint(head, () => body)
}

function kingCross(body: Color): BufferGeometry[] {
  const upright = new BoxGeometry(0.075, 0.3, 0.075)
  upright.translate(0, 1.6, 0)
  const bar = new BoxGeometry(0.23, 0.075, 0.075)
  bar.translate(0, 1.62, 0)
  return [paint(upright, () => body), paint(bar, () => body)]
}

const cache = new Map<string, BufferGeometry>()

/** One merged, vertex-coloured geometry per piece type and side, built once and shared. */
export function pieceGeometry(kind: PieceKind, side: Side): BufferGeometry {
  const key = kind + side
  const cached = cache.get(key)
  if (cached) return cached

  const body = new Color(side === 'w' ? COLORS.lightPiece : COLORS.darkPiece)
  const maize = new Color(COLORS.maize)
  const hibiscus = new Color(COLORS.hibiscus)

  const parts = [turned([...BASE, ...BODIES[kind]], body, maize, hibiscus)]
  if (kind === 'n') parts.push(knightHead(body))
  if (kind === 'k') parts.push(...kingCross(body))

  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts)
  if (!merged) throw new Error(`Could not build the ${kind} geometry`)
  cache.set(key, merged)
  return merged
}

// The position on show: an Italian Game after 1.e4 e5 2.Nf3 Nc6 3.Bc4. Black is about to
// answer 3...Nf6 (the knight on g8), after which it is White's (the visitor's) move.
export const POSITION: readonly string[] = [
  'wra1', 'wnb1', 'wbc1', 'wqd1', 'wke1', 'wrh1', 'wbc4', 'wnf3',
  'wpa2', 'wpb2', 'wpc2', 'wpd2', 'wpe4', 'wpf2', 'wpg2', 'wph2',
  'bra8', 'bbc8', 'bqd8', 'bke8', 'bbf8', 'bng8', 'brh8', 'bnc6',
  'bpa7', 'bpb7', 'bpc7', 'bpd7', 'bpe5', 'bpf7', 'bpg7', 'bph7',
]
export const MOVE = { from: 'g8', to: 'f6' } as const

/** Board square (e.g. "f6") to scene coordinates. White's back rank is nearest the camera. */
export function squareToXZ(square: string): [number, number] {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1]) - 1
  return [file - 3.5, 3.5 - rank]
}
