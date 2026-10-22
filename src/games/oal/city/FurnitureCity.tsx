// One Africa Life: Furniture City on Tubman Boulevard (public/oal/furniture-city.v2.glb, made by
// scripts/oal/makeFurnitureCity.py; ../furnitureCity.json its plan), walked into from the street
// and up its stairs to every floor: each floor's walls, railings and things on display walked
// against while on that floor, the camera under its ceiling, and before each thing on display a
// place to look at it (and buy it: ./ItemPanel.tsx). The things are the game's own
// (public/oal/items.v3.glb), as one buys and keeps them.
import { useFrame, useLoader } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Group, type Object3D } from 'three'
import { packed, useWarm } from '../gltf'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ItemId } from '../../../../supabase/functions/_shared/oalItems'
import plan from '../furnitureCity.json'
import itemsPlan from '../itemsPlan.json'
import { type City, groundHeight, solidOf, type Solid } from './cityGen'
import { type CityPlace, insidePlaces, insideRooms, insideSolids } from './insides'

export const STORE_URL = '/oal/furniture-city.v2.glb'
export const ITEMS_URL = '/oal/items.v3.glb'

type Stair = { x0: number; x1: number; y0: number; y1: number; from: number; to: number; up: number }
type Display = { item: ItemId; level: number; x: number; y: number; yaw: number; hang?: boolean }
const PLAN = plan as unknown as {
  W: number
  D: number
  levels: number[]
  ceilings: number[]
  solids: Record<string, number[][]>
  stairs: Stair[]
  displays: Display[]
  counter: { level: number; x: number; y: number; face: number[] }
}
export const ITEM_SIZES = itemsPlan as unknown as Record<ItemId, { size: [number, number, number]; at: number[] }>

/** Where it stands: on Tubman Boulevard's north side, east of Sinkor's shops (toward the family's
 * house), its front (the middle of it) set back from the road for its forecourt; its front faces
 * the road (its local y away from it). The road there runs at -21 degrees. */
const ROAD = -21 * (Math.PI / 180)
const X = [Math.cos(ROAD), Math.sin(ROAD)] as const
const Y = [-Math.sin(ROAD), Math.cos(ROAD)] as const
export const STORE = { x: 1574 + Y[0] * 18, y: -1570 + Y[1] * 18, yaw: ROAD }

/** A point of the store (its x across, its y back from its front) on the map, and back. */
export const storeToMap = (lx: number, ly: number): [number, number] => [STORE.x + X[0] * lx + Y[0] * ly, STORE.y + X[1] * lx + Y[1] * ly]
export const mapToStore = (x: number, y: number): [number, number] => {
  const dx = x - STORE.x
  const dy = y - STORE.y
  return [dx * X[0] + dy * X[1], dx * Y[0] + dy * Y[1]]
}

/** The ground cleared round it (the town's own buildings there give way), its forecourt with it. */
export const STORE_KEEP = (() => {
  const [x, y] = storeToMap(0, PLAN.D / 2 - 4)
  return { x, y, r: 21, roads: false }
})()

/** The player's floor in it (0 the shop's, 1 the first, 2 the second). */
export const storeWalker = { level: 0, inside: false, base: 0, loaded: false }
// (For the end-to-end checks: which floor the player is on.)
if (typeof window !== 'undefined') (window as unknown as { oalStore: typeof storeWalker }).oalStore = storeWalker

/** The floor's height under a point (in it, on its stairs, on its step), or null (not in it). */
export function storeGround(x: number, y: number): number | null {
  const [lx, ly] = mapToStore(x, y)
  if (Math.abs(lx) > PLAN.W / 2 + 2 || ly < -10 || ly > PLAN.D + 0.2 || (ly >= -0.6 && Math.abs(lx) > PLAN.W / 2 + 0.2)) {
    storeWalker.inside = false
    storeWalker.level = 0
    return null
  }
  if (ly < -0.6) {
    storeWalker.inside = false
    // (Its forecourt, a little over the town's ground.)
    return ly > -10 && Math.abs(lx) < PLAN.W / 2 + 2 ? storeWalker.base + 0.12 : null
  }
  if (ly < 0) {
    storeWalker.inside = false
    return storeWalker.base + 0.2
  }
  storeWalker.inside = true
  for (const s of PLAN.stairs) {
    if (lx < s.x0 || lx > s.x1 || ly < s.y0 || ly > s.y1) continue
    if (storeWalker.level !== s.from && storeWalker.level !== s.to) continue
    const t = s.up > 0 ? (ly - s.y0) / (s.y1 - s.y0) : (s.y1 - ly) / (s.y1 - s.y0)
    // (Near the top: on the floor above, its walls and railings round one; near the foot, below.)
    if (t > 0.85) storeWalker.level = s.to
    else if (t < 0.15) storeWalker.level = s.from
    return storeWalker.base + PLAN.levels[s.from]! + Math.max(0, Math.min(1, t)) * (PLAN.levels[s.to]! - PLAN.levels[s.from]!)
  }
  return storeWalker.base + PLAN.levels[storeWalker.level]!
}

/** A thing on display's footprint in the store's frame (turned by quarter turns). */
function footprint(d: Display): [number, number, number, number] {
  const [sx, sy] = ITEM_SIZES[d.item].size
  const turned = Math.abs(Math.sin(d.yaw)) > 0.5
  const hx = (turned ? sy : sx) / 2
  const hy = (turned ? sx : sy) / 2
  return [d.x - hx, d.y - hy, d.x + hx, d.y + hy]
}

const rect = (x0: number, y0: number, x1: number, y1: number): Solid => solidOf([storeToMap(x0, y0), storeToMap(x1, y0), storeToMap(x1, y1), storeToMap(x0, y1)])

/** A floor's walls, railings, the stairs' sides and ends, the things on display (not those hung). */
function solidsOf(level: number): Solid[] {
  const out = (PLAN.solids[String(level)] ?? []).map((r) => rect(r[0]!, r[1]!, r[2]!, r[3]!))
  // (A flight's high end, met from the floor at its foot: not walked up into from there.)
  for (const s of PLAN.stairs) {
    if (s.from !== level) continue
    if (s.up > 0) out.push(rect(s.x0, s.y1, s.x1, s.y1 + 0.3))
    else out.push(rect(s.x0, s.y0 - 0.3, s.x1, s.y0))
  }
  for (const d of PLAN.displays) if (d.level === level && !d.hang) out.push(rect(...footprint(d)))
  return out
}

/** Before each thing on display (on the floor one is on): the place to look at it. */
function placesOf(level: number): CityPlace[] {
  return PLAN.displays
    .filter((d) => d.level === level && !d.hang)
    .map((d, i) => {
      const [sx, sy] = ITEM_SIZES[d.item].size
      const reach = (Math.abs(Math.sin(d.yaw)) > 0.5 ? sx : sy) / 2 + 0.8
      // (Its front: the side away from its back, turned with it.)
      const fx = Math.sin(d.yaw)
      const fy = -Math.cos(d.yaw)
      const [x, y] = storeToMap(d.x + fx * reach, d.y + fy * reach)
      const [ox, oy] = storeToMap(d.x, d.y)
      return { name: `item:${d.item}:${level}:${i}`, x, y, face: [ox - x, oy - y] }
    })
}

/** The store's rooms, for the camera (each floor's ceiling over it). */
function roomOf(level: number) {
  const [mx, my] = storeToMap(0, 0)
  return { key: 'store', kind: 'store', name: 'Furniture City', cat: 'store', mx, my, nx: -Y[0], ny: -Y[1], u0: -PLAN.W / 2, u1: PLAN.W / 2, d: PLAN.D, h: PLAN.ceilings[level]! - PLAN.levels[level]!, s: 1, f0: 0 }
}

/** A model that never moves: its place worked out once, not again each frame. */
export function freeze(root: Object3D) {
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    o.matrixAutoUpdate = false
  })
  root.matrixWorldAutoUpdate = false
}

export function FurnitureCity({ city, player }: { city: City; player: RefObject<{ x: number; y: number }> }) {
  const store = useLoader(GLTFLoader, STORE_URL, packed)
  const root = useMemo(() => {
    const r = store.scene.clone(true)
    const base = groundHeight(city, STORE.x, STORE.y)
    storeWalker.base = base
    storeWalker.loaded = true
    r.position.set(STORE.x, base, -STORE.y)
    r.rotation.y = STORE.yaw
    r.traverse((o) => {
      o.castShadow = false
      o.receiveShadow = true
    })
    return r
  }, [store, city])
  useWarm([root])
  // (Fixed in place once it is in the scene.)
  useEffect(() => freeze(root), [root])
  // Its furniture on display only while one is near enough to see it (its file loaded then).
  const [displays, setDisplays] = useState(false)
  const lastLook = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastLook.current < 1) return
    lastLook.current = clock.elapsedTime
    const p = player.current
    if (!p) return
    const want = Math.hypot(p.x - STORE.x, p.y - STORE.y) < (displays ? 110 : 90)
    if (want !== displays) setDisplays(want)
  })
  // Its floor's walls and places while one is there (or about it); its rooms for the camera.
  useFrame(() => {
    const key = storeWalker.inside ? storeWalker.level : -1
    if (key === lastLevel) return
    lastLevel = key
    const level = Math.max(0, key)
    insideSolids.set('store', solidsOf(level))
    insidePlaces.set('store', storeWalker.inside ? placesOf(level) : [])
    if (storeWalker.inside) insideRooms.set('store', roomOf(level))
    else insideRooms.delete('store')
  })
  useEffect(
    () => () => {
      insideSolids.delete('store')
      insidePlaces.delete('store')
      insideRooms.delete('store')
      lastLevel = -2
    },
    [],
  )
  return (
    <>
      <primitive object={root} />
      {displays && (
        <Suspense fallback={null}>
          <Displays root={root} />
        </Suspense>
      )}
    </>
  )
}
let lastLevel = -2

/** The things on display: the game's own, each where the plan has it (in the store, fixed). */
function Displays({ root }: { root: Object3D }) {
  const items = useLoader(GLTFLoader, ITEMS_URL, packed)
  const group = useMemo(() => {
    const g = new Group()
    for (const d of PLAN.displays) {
      const src = items.scene.getObjectByName(`item_${d.item}`)
      if (!src) continue
      const thing: Object3D = src.clone(true)
      const h = ITEM_SIZES[d.item].size[2]
      thing.position.set(d.x, d.hang ? PLAN.ceilings[d.level]! - h : PLAN.levels[d.level]!, -d.y)
      thing.rotation.set(0, d.yaw, 0)
      g.add(thing)
    }
    return g
  }, [items])
  useWarm([group])
  useEffect(() => {
    root.add(group)
    freeze(group)
    return () => {
      root.remove(group)
    }
  }, [root, group])
  return null
}

/** Furniture City while within sight of it (loaded as one comes near, as the landmarks are). */
export function NearStore({ city, player }: { city: City; player: RefObject<{ x: number; y: number }> }) {
  const [near, setNear] = useState(false)
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 1) return
    last.current = clock.elapsedTime
    const p = player.current
    if (!p) return
    const now = Math.hypot(p.x - STORE.x, p.y - STORE.y) < 550
    if (now !== near) setNear(now)
  })
  return near ? (
    <Suspense fallback={null}>
      <FurnitureCity city={city} player={player} />
    </Suspense>
  ) : null
}
