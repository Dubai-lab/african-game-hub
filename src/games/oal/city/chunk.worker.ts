// One Africa Life: the city's chunks built away from the screen (a budget phone takes a few
// hundred milliseconds a chunk; on the main thread that is a stumble each time one is built).
// The town's map comes once; then each chunk asked for (its tile, what is kept) comes back as
// its meshes' plain arrays (moved, not copied) and its places, signs, lamps and walls.
import { buildChunk, buildCity, type City, type ChunkParts, type Keep, type Tile, type TownMapData } from './cityGen'
import { packParts } from './chunkPack'

let city: City | null = null

export type ChunkRequest = { type: 'map'; map: TownMapData } | { type: 'build'; cx: number; cy: number; keep: Keep[]; tile: Tile | null }

self.onmessage = (e: MessageEvent<ChunkRequest>) => {
  const msg = e.data
  if (msg.type === 'map') {
    city = buildCity(msg.map)
    return
  }
  if (!city) return
  const t0 = performance.now()
  let parts: ChunkParts | null = null
  try {
    parts = buildChunk(city, msg.cx, msg.cy, msg.keep, msg.tile)
  } catch (err) {
    self.postMessage({ type: 'failed', cx: msg.cx, cy: msg.cy, error: String(err) })
    return
  }
  const { packed, transfer } = packParts(parts)
  self.postMessage({ type: 'built', cx: msg.cx, cy: msg.cy, ms: performance.now() - t0, parts: packed }, { transfer })
}
