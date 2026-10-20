// One Africa Life: the town as one place, walked by the player's own character (as in a game:
// no screens between, no edge). Made in the browser from the town's real map (./cityGen.ts),
// chunk by chunk around the player as they go, the far ones let go; the streets built by hand
// (Tubman Boulevard at Sinkor) set into it where they are, with their traffic and people; the
// family's compound and the Ministry of Health where they are, each with its gate. The ground,
// the haze and the sky go on to the horizon. Loaded only here.
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  type Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Appearance } from '../../../../supabase/functions/_shared/oal'
import { person, type Stick } from '../ArrivalsScene'
import { CHARACTER_URL } from '../character'
import { type TownMap, useTownMap } from '../MapView'
import { TOWNS } from '../StreetScene'
import { keepOutOf, type Moving, Traffic } from '../Traffic'
import { CityTraffic, CityWalkers } from './CityTraffic'
import { type Destination, newRide, PASSENGER, type RidePhase, type RideState } from './ride'
import { buildChunk, buildCity, CHUNK, type City, type ChunkParts, type Keep, nearestRoad, segsNear, type Solid, type Tile, toSeg, type TownMapData, waterGeometry } from './cityGen'

const WALK_SPEED = 1.45
const RADIUS = 0.3
const NEAR = 2.6
// Chunks kept round the player (this many either side), and built one a frame.
const AROUND = 2

/** A place in the town: what, where, which way one faces it. */
export type CityPlace = { name: string; x: number; y: number; face: number[] }

// ---- Textures, drawn in code (nothing to download) --------------------------------------------

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true): Texture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')!
  draw(g, size)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 4
  return t
}

function noise(g: CanvasRenderingContext2D, s: number, base: string, spots: [string, number, number][]) {
  g.fillStyle = base
  g.fillRect(0, 0, s, s)
  let seed = 7
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (const [colour, count, size] of spots) {
    g.fillStyle = colour
    for (let i = 0; i < count; i++) {
      const w = size * (0.4 + r())
      g.globalAlpha = 0.25 + r() * 0.5
      g.fillRect(r() * s, r() * s, w, w * (0.5 + r()))
    }
  }
  g.globalAlpha = 1
}

/** Soft round patches (grass on laterite, darker earth): no hard edges, tiling. */
function blobs(g: CanvasRenderingContext2D, s: number, base: string, spots: [string, number, number][]) {
  g.fillStyle = base
  g.fillRect(0, 0, s, s)
  let seed = 11
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const c = new Color()
  for (const [colour, count, size] of spots) {
    c.set(colour)
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`
    for (let i = 0; i < count; i++) {
      const x = r() * s
      const y = r() * s
      const rad = size * (0.4 + r())
      const a = 0.25 + r() * 0.45
      // Drawn at each wrap too, so the tile repeats without a seam.
      for (const ox of [-s, 0, s])
        for (const oy of [-s, 0, s]) {
          const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad)
          grd.addColorStop(0, `rgba(${rgb},${a})`)
          grd.addColorStop(1, `rgba(${rgb},0)`)
          g.fillStyle = grd
          g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2)
        }
    }
  }
}

function useTextures() {
  return useMemo(() => {
    const ground = canvasTexture(512, (g, s) => blobs(g, s, '#94684a', [['#6f8a3a', 90, 60], ['#5f7f34', 50, 90], ['#a8774f', 260, 24], ['#7a5236', 300, 10], ['#86a04a', 120, 30]]))
    const dirt = canvasTexture(256, (g, s) => noise(g, s, '#9a5a38', [['#b06a42', 500, 5], ['#7a4428', 300, 4], ['#c08058', 200, 3]]))
    const asphalt = canvasTexture(256, (g, s) => noise(g, s, '#4a4a4c', [['#3a3a3c', 800, 3], ['#5a5a5c', 600, 2], ['#2e2e30', 60, 18]]))
    const pavement = canvasTexture(256, (g, s) => {
      noise(g, s, '#b8b0a2', [['#a49c8e', 500, 3], ['#c8c0b2', 300, 3], ['#8a6a4a', 60, 10]])
      g.strokeStyle = 'rgba(80,70,60,0.5)'
      g.lineWidth = 2
      for (let i = 0; i <= s; i += s / 4) {
        g.beginPath()
        g.moveTo(i, 0)
        g.lineTo(i, s)
        g.stroke()
      }
    })
    // A wall 4 m wide, 3 m high: plaster, a barred window, the dust splashed up its foot.
    const facade = canvasTexture(256, (g, s) => {
      noise(g, s, '#f2f2f2', [['#dcdcdc', 300, 6], ['#ffffff', 200, 8]])
      const grd = g.createLinearGradient(0, s, 0, s * 0.8)
      grd.addColorStop(0, 'rgba(150,90,60,0.55)')
      grd.addColorStop(1, 'rgba(150,90,60,0)')
      g.fillStyle = grd
      g.fillRect(0, s * 0.8, s, s * 0.2)
      const wx = s * 0.3
      const wy = s * 0.3
      const ww = s * 0.4
      const wh = s * 0.32
      g.fillStyle = '#1e2a30'
      g.fillRect(wx, wy, ww, wh)
      g.fillStyle = '#3a5060'
      g.fillRect(wx + 4, wy + 4, ww / 2 - 6, wh - 8)
      g.strokeStyle = '#141414'
      g.lineWidth = 3
      for (let i = 1; i < 6; i++) {
        g.beginPath()
        g.moveTo(wx + (ww * i) / 6, wy)
        g.lineTo(wx + (ww * i) / 6, wy + wh)
        g.stroke()
      }
      g.strokeStyle = '#9a9a96'
      g.lineWidth = 6
      g.strokeRect(wx - 3, wy - 3, ww + 6, wh + 6)
    })
    // Corrugated zinc, gone to rust in streaks.
    const zinc = canvasTexture(128, (g, s) => {
      g.fillStyle = '#d8d8d8'
      g.fillRect(0, 0, s, s)
      for (let i = 0; i < s; i += 8) {
        g.fillStyle = 'rgba(0,0,0,0.18)'
        g.fillRect(i, 0, 3, s)
      }
      noise(g, 0, '#000', [])
      let seed = 3
      const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(120,60,30,${0.15 + r() * 0.3})`
        g.fillRect(r() * s, r() * s, 4 + r() * 10, 20 + r() * 50)
      }
    })
    // A shopfront 4 m wide, a storey high: the painted sign board along the top, the steel
    // shutter rolled half up over the dark shop, its frame.
    const shopfront = canvasTexture(256, (g, s) => {
      noise(g, s, '#f2f2f2', [['#dcdcdc', 200, 6]])
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, s, s * 0.22)
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.fillRect(0, s * 0.22, s, 4)
      g.fillStyle = '#26221e'
      g.fillRect(s * 0.08, s * 0.3, s * 0.84, s * 0.7)
      // The shutter's slats, rolled down to half the opening.
      for (let y = s * 0.3; y < s * 0.62; y += 6) {
        g.fillStyle = y % 12 < 6 ? '#8e9092' : '#a6a8aa'
        g.fillRect(s * 0.08, y, s * 0.84, 6)
      }
      g.fillStyle = '#5a4a3a'
      g.fillRect(s * 0.15, s * 0.7, s * 0.7, s * 0.06)
      g.strokeStyle = '#4a4a4a'
      g.lineWidth = 6
      g.strokeRect(s * 0.08, s * 0.3, s * 0.84, s * 0.7)
    })
    return { ground, dirt, asphalt, pavement, facade, zinc, shopfront }
  }, [])
}

function useMaterials() {
  const tex = useTextures()
  return useMemo(
    () => ({
      ground: new MeshStandardMaterial({ map: tex.ground, roughness: 1 }),
      dirt: new MeshStandardMaterial({ map: tex.dirt, roughness: 1, vertexColors: true, side: DoubleSide }),
      asphalt: new MeshStandardMaterial({ map: tex.asphalt, roughness: 0.9, vertexColors: true, side: DoubleSide }),
      pavement: new MeshStandardMaterial({ map: tex.pavement, roughness: 0.95, vertexColors: true, side: DoubleSide }),
      marks: new MeshStandardMaterial({ color: '#f2f0e6', roughness: 0.8, vertexColors: true, side: DoubleSide }),
      walls: new MeshStandardMaterial({ map: tex.facade, roughness: 0.9, vertexColors: true, side: DoubleSide }),
      shops: new MeshStandardMaterial({ map: tex.shopfront, roughness: 0.85, vertexColors: true, side: DoubleSide }),
      land: new MeshStandardMaterial({ roughness: 1, vertexColors: true, side: DoubleSide }),
      roofs: new MeshStandardMaterial({ map: tex.zinc, roughness: 0.6, metalness: 0.3, vertexColors: true, side: DoubleSide }),
      plain: new MeshStandardMaterial({ roughness: 0.85, vertexColors: true, side: DoubleSide }),
      leaves: new MeshStandardMaterial({ roughness: 0.8, vertexColors: true, side: DoubleSide }),
      sea: new MeshStandardMaterial({ color: '#2f6a8a', roughness: 0.25, metalness: 0.1, side: DoubleSide }),
      water: new MeshStandardMaterial({ color: '#3a6a6a', roughness: 0.3, side: DoubleSide }),
      wet: new MeshStandardMaterial({ color: '#4a6a3a', roughness: 1, side: DoubleSide }),
    }),
    [tex],
  )
}
type Materials = ReturnType<typeof useMaterials>

// ---- The town, chunk by chunk ----------------------------------------------------------------

type Built = { group: Group; parts: ChunkParts }

/** The chunks round the player, built as they come near and let go behind. */
/** Disposes a chunk's meshes (its places and solids are only data). */
function disposeParts(parts: ChunkParts) {
  for (const k of Object.keys(parts) as (keyof ChunkParts)[]) {
    const v = parts[k] as { dispose?: () => void } | null
    if (v && !Array.isArray(v)) v.dispose?.()
  }
}

/** A town's real buildings, land and places, tile by tile (scripts/oal/makeCityData.py), where
 * there are tiles for it. */
const TILES: Record<string, string> = { Monrovia: '/oal/city/monrovia/t' }

function Chunks({ city, keep, player, solids, town }: { city: City; keep: Keep[]; player: RefObject<{ x: number; y: number }>; solids: RefObject<Map<string, Solid[]>>; town: string }) {
  const mats = useMaterials()
  const built = useRef(new Map<string, Built>())
  // The tiles fetched (null: none there) and being fetched.
  const tiles = useRef(new Map<string, Tile | null>())
  const asked = useRef(new Set<string>())
  const root = useRef<Group>(null)
  useEffect(() => {
    const map = built.current
    return () => {
      for (const b of map.values()) disposeParts(b.parts)
      map.clear()
    }
  }, [])
  useFrame(() => {
    const group = root.current
    const at = player.current
    if (!group || !at) return
    const pcx = Math.floor(at.x / CHUNK)
    const pcy = Math.floor(at.y / CHUNK)
    // One new chunk a frame (the nearest missing), so walking never stutters.
    let want: [number, number] | null = null
    let best = Infinity
    for (let dx = -AROUND; dx <= AROUND; dx++)
      for (let dy = -AROUND; dy <= AROUND; dy++) {
        const k = `${pcx + dx},${pcy + dy}`
        if (built.current.has(k)) continue
        const d = dx * dx + dy * dy
        if (d < best) {
          best = d
          want = [pcx + dx, pcy + dy]
        }
      }
    // A town with tiles: its tile fetched first (the chunk built once it is here).
    const source = TILES[town]
    if (want && source) {
      const k = `${want[0]},${want[1]}`
      if (!tiles.current.has(k)) {
        if (!asked.current.has(k)) {
          asked.current.add(k)
          fetch(`${source}/${want[0]}_${want[1]}.v1.json`)
            .then((r) => (r.ok ? (r.json() as Promise<Tile>) : null))
            .catch(() => null)
            .then((t) => {
              tiles.current.set(k, t)
              asked.current.delete(k)
            })
        }
        // Meanwhile, the next nearest chunk whose tile is here.
        want = null
        let near = Infinity
        for (let dx = -AROUND; dx <= AROUND; dx++)
          for (let dy = -AROUND; dy <= AROUND; dy++) {
            const kk = `${pcx + dx},${pcy + dy}`
            if (built.current.has(kk)) continue
            if (!tiles.current.has(kk)) {
              if (!asked.current.has(kk)) {
                asked.current.add(kk)
                fetch(`${source}/${pcx + dx}_${pcy + dy}.v1.json`)
                  .then((r) => (r.ok ? (r.json() as Promise<Tile>) : null))
                  .catch(() => null)
                  .then((t) => {
                    tiles.current.set(kk, t)
                    asked.current.delete(kk)
                  })
              }
              continue
            }
            const d = dx * dx + dy * dy
            if (d < near) {
              near = d
              want = [pcx + dx, pcy + dy]
            }
          }
      }
    }
    if (want) {
      const [cx, cy] = want
      const parts = buildChunk(city, cx, cy, keep, source ? tiles.current.get(`${cx},${cy}`) : null)
      const g = new (group.constructor as new () => Group)()
      const add = (geo: ChunkParts[keyof ChunkParts], mat: keyof Materials) => {
        if (!geo || Array.isArray(geo)) return
        const m = new Mesh(geo, mats[mat])
        m.matrixAutoUpdate = false
        g.add(m)
      }
      add(parts.land, 'land')
      add(parts.dirt, 'dirt')
      add(parts.pavement, 'pavement')
      add(parts.asphalt, 'asphalt')
      add(parts.marks, 'marks')
      add(parts.walls, 'walls')
      add(parts.shops, 'shops')
      add(parts.roofs, 'roofs')
      add(parts.plain, 'plain')
      add(parts.leaves, 'leaves')
      group.add(g)
      const k = `${cx},${cy}`
      built.current.set(k, { group: g, parts })
      solids.current?.set(k, parts.solids)
    }
    // Let go of what is far behind.
    for (const [k, b] of built.current) {
      const [cx, cy] = k.split(',').map(Number) as [number, number]
      if (Math.abs(cx - pcx) > AROUND + 1 || Math.abs(cy - pcy) > AROUND + 1) {
        group.remove(b.group)
        disposeParts(b.parts)
        built.current.delete(k)
        solids.current?.delete(k)
      }
    }
  })
  return <group ref={root} />
}

/** The ground under everything, to the horizon, following the player (its texture fixed to the town). */
function Ground({ player }: { player: RefObject<{ x: number; y: number }> }) {
  const mats = useMaterials()
  const mesh = useMemo(() => {
    const g = new PlaneGeometry(3000, 3000)
    g.rotateX(-Math.PI / 2)
    const m = new Mesh(g, mats.ground)
    return m
  }, [mats])
  useFrame(() => {
    const p = player.current
    if (!p) return
    // Moved in steps of the texture's own size, so it never slides.
    const sx = Math.round(p.x / 400) * 400
    const sy = Math.round(p.y / 400) * 400
    mesh.position.set(sx, 0, -sy)
    const map = mats.ground.map!
    map.repeat.set(3000 / 14, 3000 / 14)
  })
  return <primitive object={mesh} />
}

/** The sea, the lagoons and swamps: built once, the whole town's. */
function Water({ city }: { city: City }) {
  const mats = useMaterials()
  const meshes = useMemo(
    () =>
      (['wet', 'water', 'sea'] as const)
        .map((w) => {
          const g = waterGeometry(city, w)
          return g ? new Mesh(g, mats[w]) : null
        })
        .filter(Boolean) as Mesh[],
    [city, mats],
  )
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  )
}

/** The sky: a dome, haze at the horizon (the fog's own colour) to blue overhead. */
function SkyDome() {
  const { camera } = useThree()
  const dome = useMemo(() => {
    const g = new SphereGeometry(900, 24, 12)
    const top = new Color('#5f93cf')
    const horizon = new Color('#c9d9e6')
    const colours: number[] = []
    const pos = g.attributes.position!
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 900)
      const c = horizon.clone().lerp(top, Math.pow(t, 0.6))
      colours.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
    return new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }))
  }, [])
  useFrame(() => dome.position.copy(camera.position))
  return <primitive object={dome} renderOrder={-1} />
}

function Light() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.4
    pmrem.dispose()
  }, [gl, scene])
  return null
}

// ---- Hubs and compounds -----------------------------------------------------------------------

/** A street built by hand, set into the town at its place (its own metres plus where it is). */
type Hub = { town: keyof typeof TOWNS; x: number; y: number }

/** Each hub's vehicles (in its own metres), for walking against. */
const hubTraffic = new Map<string, { current: Moving[] }>()

function HubStreet({ hub, player }: { hub: Hub; player: RefObject<{ x: number; y: number }> }) {
  const where = TOWNS[hub.town]
  const local = useRef({ x: 0, y: 0 })
  const moving = useMemo(() => {
    const m = { current: [] as Moving[] }
    hubTraffic.set(hub.town, m)
    return m
  }, [hub.town])
  useEffect(() => () => void hubTraffic.delete(hub.town), [hub.town])
  const gltf = useLoader(GLTFLoader, where.url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const scene = useMemo(() => gltf.scene.clone(true), [gltf])
  useFrame(() => {
    const p = player.current
    if (p && local.current) {
      local.current.x = p.x - hub.x
      local.current.y = p.y - hub.y
    }
  })
  return (
    <group position={[hub.x, 0.005, -hub.y]}>
      <primitive object={scene} />
      {where.plan.lanes && where.plan.lanes.length > 0 && (
        <Suspense fallback={null}>
          <Traffic lanes={where.plan.lanes} reach={where.plan.reach + 30} player={local} moving={moving} spacing={35} />
        </Suspense>
      )}
    </group>
  )
}

/** A compound the game places: its wall round, its gate to the road, what stands inside. */
export type Compound = { name: string; x: number; y: number; yaw: number; w: number; d: number; building: { w: number; d: number; h: number; colour: string; roof: 'hip' | 'flat' }; wall: string }

/** The hubs within reach of the player (loaded as they come near: each is a download). */
function NearHubs({ hubs, player }: { hubs: Hub[]; player: RefObject<{ x: number; y: number }> }) {
  const [near, setNear] = useState<string[]>([])
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 1) return
    last.current = clock.elapsedTime
    const p = player.current
    if (!p) return
    const now = hubs.filter((h) => Math.hypot(p.x - h.x, p.y - h.y) < TOWNS[h.town].plan.reach + 500).map((h) => h.town)
    if (now.join() !== near.join()) setNear(now)
  })
  return (
    <>
      {hubs
        .filter((h) => near.includes(h.town))
        .map((h) => (
          <Suspense key={h.town} fallback={null}>
            <HubStreet hub={h} player={player} />
          </Suspense>
        ))}
    </>
  )
}

// ---- The player -------------------------------------------------------------------------------

function pushOut(p: { x: number; y: number }, poly: number[][]) {
  // A circle out of a convex or concave polygon: by the nearest edge (through it if inside).
  let best = Infinity
  let cx = 0
  let cy = 0
  let within = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j] as [number, number]
    const [bx, by] = poly[i] as [number, number]
    if (ay > p.y !== by > p.y && p.x < ((bx - ax) * (p.y - ay)) / (by - ay) + ax) within = !within
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)))
    const qx = ax + dx * t
    const qy = ay + dy * t
    const d = Math.hypot(p.x - qx, p.y - qy)
    if (d < best) {
      best = d
      cx = qx
      cy = qy
    }
  }
  if (!within && best >= RADIUS) return
  let nx = p.x - cx
  let ny = p.y - cy
  const len = Math.hypot(nx, ny) || 1
  nx /= len
  ny /= len
  if (within) {
    nx = -nx
    ny = -ny
  }
  p.x = cx + nx * RADIUS
  p.y = cy + ny * RADIUS
}

type Props = {
  town: string
  /** Where the player starts: a point (town metres) facing (yaw: forward is (sin, -cos)), or at
   * a place (out of its door, facing the street), or where a hub street is entered. */
  start: { x: number; y: number; f: number } | { place: string }
  appearance: Appearance
  stick: RefObject<Stick>
  look: RefObject<number | null>
  pitch?: RefObject<number>
  paused: boolean
  onPlace: (place: string | null) => void
  onPosition?: (x: number, y: number, facing: number, moving: boolean) => void
  onReady?: (places: CityPlace[]) => void
  /** The street the player is on (its name on the map), as it changes. */
  onStreet?: (name: string | null) => void
  /** A ride waved down (shared with the page, which asks for it and pays). */
  ride?: RefObject<RideState>
  onRide?: (phase: RidePhase) => void
  /** Whether the player stands by a road a taxi or kekeh can stop on. */
  onRoadside?: (by: boolean) => void
  /** Where a ride can take one in this town (once the town is ready). */
  onDestinations?: (list: Destination[]) => void
}

function Walker({ props, city, start, compounds, hubs, places, solids, player }: { props: Props; city: City; start: { x: number; y: number; f: number }; compounds: Compound[]; hubs: Hub[]; places: CityPlace[]; solids: RefObject<Map<string, Solid[]>>; player: RefObject<{ x: number; y: number }> }) {
  const { appearance, stick, look, pitch, paused, onPlace, onPosition, onStreet } = props
  const street = useRef<string | null | undefined>(undefined)
  const first = useRef(true)
  const roadside = useRef<boolean | undefined>(undefined)
  const seated = useRef(false)
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const keys = useRef(new Set<string>())
  const state = useRef({ x: start.x, y: start.y, facing: start.f, speed: 0, place: null as string | null, told: 0 })
  const me = useMemo(() => {
    const p = person(gltf.scene, gltf.animations, appearance)
    p.actions.idle?.play()
    p.actions.walk?.play()
    if (p.actions.walk) p.actions.walk.weight = 0
    return p
  }, [gltf, appearance])
  useEffect(() => {
    if (look.current === null) (look as { current: number | null }).current = state.current.facing
  }, [look])
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase())
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  const target = useMemo(() => new Vector3(), [])
  const eye = useMemo(() => new Vector3(), [])
  const collide = (s: { x: number; y: number }) => {
    // The vehicles of the streets built by hand (in their own metres).
    for (const h of hubs) {
      const where = TOWNS[h.town]
      const lx = s.x - h.x
      const ly = s.y - h.y
      if (Math.hypot(lx, ly) > where.plan.reach + 10) continue
      const local = { x: lx, y: ly }
      keepOutOf(local, hubTraffic.get(h.town)?.current ?? [], RADIUS)
      for (const poly of where.polys) {
        if (local.x < poly.minX || local.x > poly.maxX || local.y < poly.minY || local.y > poly.maxY) continue
        pushOut(local, poly.points)
      }
      s.x = local.x + h.x
      s.y = local.y + h.y
    }
    keepOutOf(s, cityMoving.current, RADIUS)
    const cx = Math.floor(s.x / CHUNK)
    const cy = Math.floor(s.y / CHUNK)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const poly of solids.current?.get(`${cx + dx},${cy + dy}`) ?? []) {
          const bb = poly.bb
          if (bb ? s.x < bb[0] - 1 || s.x > bb[2] + 1 || s.y < bb[1] - 1 || s.y > bb[3] + 1 : Math.abs(poly[0]![0]! - s.x) > 20 || Math.abs(poly[0]![1]! - s.y) > 20) continue
          pushOut(s, poly)
        }
    for (const c of compounds) for (const poly of compoundSolids(c)) pushOut(s, poly)
  }
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.25)
    const s = state.current
    const r = props.ride?.current
    // In the vehicle: seated in the back, the town going by; the camera behind the vehicle.
    if (r && (r.phase === 'riding' || r.phase === 'arrived')) {
      const [sx, sy, sz] = PASSENGER[r.kind]
      const c = Math.cos(r.pos.yaw)
      const sn = Math.sin(r.pos.yaw)
      // Ahead (c, sn) and to the right (sn, -c) on the map.
      const px = r.pos.x + c * sx + sn * sz
      const py = r.pos.y + sn * sx - c * sz
      if (!seated.current) {
        seated.current = true
        me.actions.walk && (me.actions.walk.weight = 0)
        me.actions.idle && (me.actions.idle.weight = 0)
        me.actions.wave?.stop()
        me.actions.sit?.reset().play()
      }
      me.root.position.set(px, 0.08 + sy, -py)
      me.root.rotation.y = r.pos.yaw + Math.PI / 2
      me.mixer.update(dt)
      s.x = r.pos.x
      s.y = r.pos.y
      if (player.current) {
        player.current.x = s.x
        player.current.y = s.y
      }
      target.set(r.pos.x, 1.3, -r.pos.y)
      eye.set(r.pos.x - c * 7.5, 3.4, -(r.pos.y - sn * 7.5))
      camera.position.lerp(eye, Math.min(1, dt * 3))
      camera.lookAt(target)
      return
    }
    if (seated.current) {
      // Out on the kerb, standing again.
      seated.current = false
      me.actions.sit?.stop()
      if (r?.exit) {
        s.x = r.exit.x
        s.y = r.exit.y
        s.facing = r.exit.f
        r.exit = null
      }
    }
    // Waving down the ride as it comes.
    const waving = r?.phase === 'coming' && me.actions.wave
    if (waving && !me.actions.wave!.isRunning()) me.actions.wave!.reset().play()
    if (!waving && me.actions.wave?.isRunning()) me.actions.wave.stop()
    const k = keys.current
    let x = stick.current?.x ?? 0
    let y = stick.current?.y ?? 0
    if (k.has('arrowup') || k.has('w')) y = 1
    if (k.has('arrowdown') || k.has('s')) y = -1
    if (k.has('arrowleft') || k.has('a')) x = -1
    if (k.has('arrowright') || k.has('d')) x = 1
    const yaw = look.current ?? start.f
    let dx = 0
    let dy = 0
    if (!paused) {
      dx = Math.sin(yaw) * y - Math.cos(yaw) * x
      dy = -Math.cos(yaw) * y - Math.sin(yaw) * x
    }
    const amount = Math.min(1, Math.hypot(dx, dy))
    if (amount > 0.05) {
      const n = Math.hypot(dx, dy)
      const distance = amount * WALK_SPEED * dt
      const steps = Math.ceil(distance / 0.08)
      for (let i = 0; i < steps; i++) {
        s.x += ((dx / n) * distance) / steps
        s.y += ((dy / n) * distance) / steps
        collide(s)
      }
      let turn = Math.atan2(dx, -dy) - s.facing
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      s.facing += turn * Math.min(1, dt * 10)
    }
    s.speed += (amount - s.speed) * Math.min(1, dt * 8)
    me.root.position.set(s.x, 0.05, -s.y)
    me.root.rotation.y = s.facing
    if (player.current) {
      player.current.x = s.x
      player.current.y = s.y
    }
    if (me.actions.walk && me.actions.idle) {
      const w = waving ? 0 : 1
      me.actions.walk.weight = s.speed * w
      me.actions.idle.weight = (1 - s.speed) * w
      me.actions.walk.timeScale = 0.6 + s.speed * 0.5
    }
    me.mixer.update(dt)
    s.told += dt
    if (s.told > 0.25) {
      s.told = 0
      onPosition?.(s.x, s.y, s.facing, s.speed > 0.2)
      const name = namedRoad(city, s.x, s.y)
      // By a road a vehicle can pull in on (within a few metres of its edge).
      const road = nearestRoad(city, s.x, s.y, 30)
      const by = Boolean(road && road.d < road.seg.w / 2 + 6)
      if (by !== roadside.current) {
        roadside.current = by
        props.onRoadside?.(by)
      }
      if (name !== street.current) {
        street.current = name
        onStreet?.(name)
      }
    }
    let near: string | null = null
    for (const p of places) if (Math.hypot(s.x - p.x, s.y - p.y) < NEAR) near = p.name
    if (near !== s.place) {
      s.place = near
      onPlace(near)
    }
    // As in a game: the camera goes round the character at a fixed distance (turned by a drag
    // sideways, raised or lowered by a drag up or down), always looking at the character; it
    // never comes in close.
    const tilt = pitch?.current ?? 0
    const elev = Math.max(-0.12, Math.min(1.15, 0.3 - tilt * 0.75))
    const back = paused ? 3.4 : 4.6
    const flat = Math.cos(elev) * back
    target.set(s.x, 1.45 + Math.max(0, -elev) * 2 + Math.max(0, tilt - 0.6) * 1.5, -s.y)
    eye.set(s.x - Math.sin(yaw) * flat, Math.max(0.35, 1.45 + Math.sin(elev) * back), -(s.y + Math.cos(yaw) * flat))
    // Never inside a wall: pulled in to the first solid between the character and the camera.
    let pull = 1
    const ex = eye.x
    const ey = -eye.z
    const ccx = Math.floor(s.x / CHUNK)
    const ccy = Math.floor(s.y / CHUNK)
    for (let ddx = -1; ddx <= 1; ddx++)
      for (let ddy = -1; ddy <= 1; ddy++)
        for (const poly of solids.current?.get(`${ccx + ddx},${ccy + ddy}`) ?? []) {
          const bb = poly.bb
          if (bb ? Math.max(s.x, ex) < bb[0] || Math.min(s.x, ex) > bb[2] || Math.max(s.y, ey) < bb[1] || Math.min(s.y, ey) > bb[3] : Math.abs(poly[0]![0]! - s.x) > 16 || Math.abs(poly[0]![1]! - s.y) > 16) continue
          pull = Math.min(pull, segmentHit(s.x, s.y, ex, ey, poly))
        }
    if (pull < 1) {
      // A wall between: in front of it if that is not too close; else up over the character's
      // head, looking down on them (never in on them).
      const t = pull - 0.08
      if (t * back >= 2.2) {
        eye.x = s.x + (ex - s.x) * t
        eye.z = -(s.y + (ey - s.y) * t)
      } else {
        const high = Math.max(elev, 1.0)
        const f2 = Math.cos(high) * 2.6
        eye.set(s.x - Math.sin(yaw) * f2, 1.45 + Math.sin(high) * 4.4, -(s.y + Math.cos(yaw) * f2))
      }
    }
    // First seen: there at once (not flying in from the town's centre).
    if (first.current) {
      first.current = false
      camera.position.copy(eye)
    } else camera.position.lerp(eye, Math.min(1, dt * 5))
    camera.lookAt(target)
  })
  return <primitive object={me.root} />
}

/** How far along a segment (0..1) it first crosses a polygon's edge (1: not at all). */
function segmentHit(ax: number, ay: number, bx: number, by: number, poly: number[][]) {
  let best = 1
  const rx = bx - ax
  const ry = by - ay
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [cx, cy] = poly[j] as [number, number]
    const [dx, dy] = poly[i] as [number, number]
    const sx = dx - cx
    const sy = dy - cy
    const den = rx * sy - ry * sx
    if (Math.abs(den) < 1e-9) continue
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den
    const u = ((cx - ax) * ry - (cy - ay) * rx) / den
    if (t > 0 && t < best && u >= 0 && u <= 1) best = t
  }
  return best
}

/** The name of the nearest named road (within 150 m), for the chip. */
function namedRoad(city: City, x: number, y: number): string | null {
  let best: { d: number; name: string } | null = null
  for (const id of segsNear(city, x, y, 150)) {
    const sg = city.segs[id]!
    if (!sg.name) continue
    // Measured from the road's edge, so a wide road one stands on wins over a lane near by.
    const d = toSeg(sg, x, y).d - sg.w / 2
    if (d < 150 && (!best || d < best.d)) best = { d, name: sg.name }
  }
  return best?.name ?? null
}

/** The town's own traffic (town metres). */
const cityMoving: { current: Moving[] } = { current: [] }

/** A compound's walls (with the gate's gap), as solids. */
function compoundSolids(c: Compound): Solid[] {
  const cs = Math.cos(c.yaw)
  const sn = Math.sin(c.yaw)
  const at = (u: number, v: number) => [c.x + cs * u - sn * v, c.y + sn * u + cs * v]
  const rect = (u0: number, v0: number, u1: number, v1: number) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
  const W = c.w / 2
  const D = c.d / 2
  const B = c.building
  return [
    rect(-W, D - 0.15, W, D + 0.15),
    rect(-W - 0.15, -D, -W + 0.15, D),
    rect(W - 0.15, -D, W + 0.15, D),
    // The front, either side of the gate (2 m either side of the middle).
    rect(-W, -D - 0.15, -2, -D + 0.15),
    rect(2, -D - 0.15, W, -D + 0.15),
    rect(-B.w / 2, -B.d / 2 + 1, B.w / 2, B.d / 2 + 1),
  ]
}

function CompoundModel({ c }: { c: Compound }) {
  const mats = useMaterials()
  const meshes = useMemo(() => {
    // Boxes, the colours of the town's own houses: the walls round, the gate's pillars, the house.
    const parts: Mesh[] = []
    const cs = Math.cos(c.yaw)
    const sn = Math.sin(c.yaw)
    const box = (u: number, v: number, w: number, d: number, z: number, h: number, mat: MeshStandardMaterial, colour: string) => {
      const m = new Mesh(new BoxGeometry(w, h, d), mat.clone())
      ;(m.material as MeshStandardMaterial).color = new Color(colour)
      ;(m.material as MeshStandardMaterial).vertexColors = false
      m.position.set(c.x + cs * u - sn * v, z + h / 2, -(c.y + sn * u + cs * v))
      m.rotation.y = c.yaw
      parts.push(m)
    }
    const W = c.w / 2
    const D = c.d / 2
    box(0, D, c.w, 0.3, 0, 2.4, mats.plain, c.wall)
    box(-W, 0, 0.3, c.d, 0, 2.4, mats.plain, c.wall)
    box(W, 0, 0.3, c.d, 0, 2.4, mats.plain, c.wall)
    box((-W - 2) / 2, -D, W - 2, 0.3, 0, 2.4, mats.plain, c.wall)
    box((W + 2) / 2, -D, W - 2, 0.3, 0, 2.4, mats.plain, c.wall)
    box(-2.1, -D, 0.5, 0.5, 0, 2.8, mats.plain, c.wall)
    box(2.1, -D, 0.5, 0.5, 0, 2.8, mats.plain, c.wall)
    const B = c.building
    box(0, 1, B.w, B.d, 0, B.h, mats.walls, B.colour)
    if (B.roof === 'hip') box(0, 1, B.w + 1, B.d + 1, B.h, 0.25, mats.roofs, '#8a3a24')
    else box(0, 1, B.w + 0.3, B.d + 0.3, B.h, 0.6, mats.plain, B.colour)
    return parts
  }, [c, mats])
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  )
}

// ---- The scene ---------------------------------------------------------------------------------

/** The streets built by hand in each town, where they are on its map. */
function hubsOf(town: string, map: TownMap): Hub[] {
  if (town !== 'Monrovia') return []
  const out: Hub[] = []
  for (const t of ['sinkor', 'waterside'] as const) {
    const at = map.places[t]
    if (at) out.push({ town: t, x: at.x, y: at.y })
  }
  return out
}

/** The game's own compounds in each town, at their places on its map: the family's house, the
 * Ministry of Health. */
function compoundsOf(town: string, map: TownMap, city: City): Compound[] {
  if (town !== 'Monrovia') return []
  const out: Compound[] = []
  const home = map.places.home
  if (home) out.push(compoundAt(city, 'home', home.x, home.y, 22, 20, { w: 12, d: 10, h: 3.2, colour: '#e8d6a6', roof: 'hip' }, '#d8d0c0'))
  const health = map.places.health
  if (health) out.push(compoundAt(city, 'health', health.x, health.y, 30, 28, { w: 15, d: 11, h: 6.9, colour: '#e9e0c6', roof: 'flat' }, '#d8d0c0'))
  return out
}

export default function CityScene(props: Props) {
  const map = useTownMap(props.town)
  const city = useMemo(() => (map.data ? buildCity(map.data as unknown as TownMapData) : null), [map.data])
  const hubs = useMemo(() => (map.data ? hubsOf(props.town, map.data) : []), [map.data, props.town])
  const compounds = useMemo(() => (map.data && city ? compoundsOf(props.town, map.data, city) : []), [map.data, city, props.town])
  const keep = useMemo<Keep[]>(
    () => [...hubs.map((h) => ({ x: h.x, y: h.y, r: TOWNS[h.town].plan.reach + 4 })), ...compounds.map((c) => ({ x: c.x, y: c.y, r: Math.max(c.w, c.d) / 2 + 3, roads: false }))],
    [hubs, compounds],
  )
  // The places: the hubs' own (in town metres), the compounds' gates.
  const places = useMemo<CityPlace[]>(() => {
    const out: CityPlace[] = []
    // A hub's own places (Sinkor's by their names; any other hub's as "hub:place").
    for (const h of hubs) for (const [name, at] of Object.entries(TOWNS[h.town].places)) out.push({ name: h.town === 'sinkor' ? name : `${h.town}:${name}`, x: at!.x + h.x, y: at!.y + h.y, face: at!.face })
    // The places the game has no building for yet (the job board, the embassies, the motor park):
    // by the road nearest them.
    for (const name of ['jobs', 'visa', 'station']) {
      const at = map.data?.places[name]
      if (!at || !city) continue
      const road = nearestRoad(city, at.x, at.y, 200)
      if (!road) continue
      let nx = at.x - road.px
      let ny = at.y - road.py
      const n = Math.hypot(nx, ny) || 1
      nx /= n
      ny /= n
      const off = road.seg.w / 2 + 2.5
      out.push({ name, x: road.px + nx * off, y: road.py + ny * off, face: [nx, ny] })
    }
    for (const c of compounds) {
      const cs = Math.cos(c.yaw)
      const sn = Math.sin(c.yaw)
      // Just outside the gate.
      const u = 0
      const v = -c.d / 2 - 1.2
      out.push({ name: c.name, x: c.x + cs * u - sn * v, y: c.y + sn * u + cs * v, face: [-sn, cs] })
    }
    return out
  }, [hubs, compounds, map.data, city])
  useEffect(() => props.onReady?.(places), [places]) // eslint-disable-line react-hooks/exhaustive-deps
  // Where a ride can take one: the family's gate, the hubs where they are entered, the Ministry,
  // the job board, the embassies, the motor park.
  useEffect(() => {
    if (!city) return
    const list: Destination[] = []
    const of = (name: string) => places.find((p) => p.name === name)
    for (const name of ['home', 'sinkor', 'health', 'waterside', 'jobs', 'visa', 'station']) {
      const hub = hubs.find((h) => h.town === name)
      if (hub) {
        const sp = TOWNS[hub.town].plan.spawn
        list.push({ name, x: sp.x + hub.x, y: sp.y + hub.y })
      } else {
        const p = of(name)
        if (p) list.push({ name, x: p.x, y: p.y })
      }
    }
    props.onDestinations?.(list)
  }, [places, hubs, city]) // eslint-disable-line react-hooks/exhaustive-deps
  // Where to start: the point given; out of a place's door (a step toward the street, facing it);
  // where a hub street is entered.
  const start = useMemo(() => {
    const given = props.start
    if ('x' in given) return given
    if (given.place.startsWith('enter:')) {
      const h = hubs.find((x) => x.town === given.place.slice(6))
      if (h) {
        const sp = TOWNS[h.town].plan.spawn
        return { x: sp.x + h.x, y: sp.y + h.y, f: TOWNS[h.town].spawnYaw }
      }
    }
    const at = places.find((p) => p.name === given.place)
    if (!at) return null
    return { x: at.x - at.face[0]! * 1.0, y: at.y - at.face[1]! * 1.0, f: Math.atan2(-at.face[0]!, at.face[1]!) }
  }, [props.start, places, hubs])
  const player = useRef({ x: 0, y: 0 })
  if (start && player.current.x === 0 && player.current.y === 0) player.current = { x: start.x, y: start.y }
  const solids = useRef(new Map<string, Solid[]>())
  const ownRide = useRef<RideState>(newRide())
  const ride = props.ride ?? ownRide
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 60, near: 0.1, far: 700, position: [0, 2.4, 3] }} gl={{ antialias: true }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#c9d9e6']} />
      <fog attach="fog" args={['#c9d9e6', 110, 480]} />
      <Light />
      <SkyDome />
      <hemisphereLight args={['#eaf2ff', '#7a5a3c', 1.0]} />
      <directionalLight position={[-60, 90, 40]} intensity={2.2} color="#fff1dc" />
      {city && (
        <>
          <Ground player={player} />
          <Water city={city} />
          <Chunks city={city} keep={keep} player={player} solids={solids} town={props.town} />
          {compounds.map((c) => (
            <CompoundModel key={c.name} c={c} />
          ))}
          <Suspense fallback={null}>
            <NearHubs hubs={hubs} player={player} />
            <CityTraffic city={city} keep={keep} player={player} moving={cityMoving} ride={ride} onRide={(p) => props.onRide?.(p)} />
            <CityWalkers city={city} keep={keep} player={player} />
            {start && <Walker props={props} city={city} start={start} compounds={compounds} hubs={hubs} places={places} solids={solids} player={player} />}
          </Suspense>
        </>
      )}
    </Canvas>
  )
}

/** Where a compound stands: by the road nearest a point on the map, its gate to that road. */
export function compoundAt(city: City, name: string, x: number, y: number, w: number, d: number, building: Compound['building'], wall = '#d8d0c0'): Compound {
  const road = nearestRoad(city, x, y, 120)
  if (!road) return { name, x, y, yaw: 0, w, d, building, wall }
  // From the road toward the point: the compound's front faces the road.
  let nx = x - road.px
  let ny = y - road.py
  const n = Math.hypot(nx, ny) || 1
  nx /= n
  ny /= n
  const off = road.seg.w / 2 + 2.5 + d / 2
  const cx = road.px + nx * off
  const cy = road.py + ny * off
  // Local v points from the gate (front, -v) back into the compound: v = (nx, ny).
  const yaw = Math.atan2(ny, nx) - Math.PI / 2
  return { name, x: cx, y: cy, yaw, w, d, building, wall }
}
