// A chunk's parts between the worker that builds them and the page that draws them: each mesh
// as its plain arrays (moved across, not copied), the rest as it is; its walls' boxes found
// again on arrival (a message keeps only an array's items).
import { BufferAttribute, BufferGeometry } from 'three'
import { type ChunkParts, SIGNAL_LAMPS, type SignalLamp, solidOf } from './cityGen'

type Arrays = { p: Float32Array; n: Float32Array; uv: Float32Array; c: Float32Array } | null
const MESHES = ['glow', 'pools', 'land', 'shops', 'asphalt', 'dirt', 'pavement', 'marks', 'walls', 'roofs', 'plain', 'leaves'] as const

export type PackedParts = Omit<ChunkParts, (typeof MESHES)[number] | 'signalLamps'> & { meshes: Record<string, Arrays>; signalLamps: Partial<Record<SignalLamp, Arrays>> }

function pack(g: BufferGeometry | null | undefined, transfer: Transferable[]): Arrays {
  if (!g) return null
  const a = (name: string) => g.getAttribute(name).array as Float32Array
  const out = { p: a('position'), n: a('normal'), uv: a('uv'), c: a('color') }
  transfer.push(out.p.buffer, out.n.buffer, out.uv.buffer, out.c.buffer)
  return out
}

function unpack(a: Arrays): BufferGeometry | null {
  if (!a) return null
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(a.p, 3))
  g.setAttribute('normal', new BufferAttribute(a.n, 3))
  g.setAttribute('uv', new BufferAttribute(a.uv, 2))
  g.setAttribute('color', new BufferAttribute(a.c, 3))
  g.computeBoundingSphere()
  return g
}

export function packParts(parts: ChunkParts): { packed: PackedParts; transfer: Transferable[] } {
  const transfer: Transferable[] = []
  const meshes: Record<string, Arrays> = {}
  for (const k of MESHES) meshes[k] = pack(parts[k], transfer)
  const signalLamps: Partial<Record<SignalLamp, Arrays>> = {}
  for (const k of SIGNAL_LAMPS) signalLamps[k] = pack(parts.signalLamps[k], transfer)
  const { signs, signals, lamps, places, solids, trees } = parts
  return { packed: { signs, signals, lamps, places, trees, solids: solids.map((s) => [...s]), meshes, signalLamps }, transfer }
}

export function unpackParts(p: PackedParts): ChunkParts {
  const meshes = Object.fromEntries(MESHES.map((k) => [k, unpack(p.meshes[k] ?? null)])) as Record<(typeof MESHES)[number], BufferGeometry | null>
  const signalLamps = Object.fromEntries(SIGNAL_LAMPS.map((k) => [k, unpack(p.signalLamps[k] ?? null)])) as Partial<Record<SignalLamp, BufferGeometry | null>>
  return { signs: p.signs, signals: p.signals, lamps: p.lamps, places: p.places, trees: p.trees, solids: p.solids.map((s) => solidOf(s)), signalLamps, ...meshes }
}
