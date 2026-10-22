// One Africa Life: the player's things at the family's house (bought at Furniture City: the
// server's oal_things), drawn where they were put (in the house's own metres), walked against;
// the house's own furniture the family sold (oal_pieces_sold) gone from it. The page fetches
// them and arranges them (../HomeDesign.tsx); this draws them, and tells the page whether the
// player is in the house and where they stand (to put a thing in front of them).
import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Group, type Object3D } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { ItemId } from '../../../../supabase/functions/_shared/oalItems'
import plans from '../homePlan.json'
import { solidOf, type Solid } from './cityGen'
import { ITEM_SIZES, ITEMS_URL } from './FurnitureCity'
import { insideRooms, insideSolids } from './insides'

export type Thing = { id: number; item: ItemId; placed: boolean; x: number | null; y: number | null; rot: number | null; paid: number }
type HousePlan = { solids: number[][]; inside: number[][]; ceiling?: number; pieces: Record<string, { objects: string[]; solids: number[] }> }
export const HOUSE = (plans as unknown as Record<string, HousePlan>).house!

/** What the page and the scene share: the things, the pieces sold, a thing being moved (shown where
 * it would go before it is put), the player in the house and where (the house's metres, facing). */
export const homeStore = {
  things: [] as Thing[],
  sold: new Set<string>(),
  moving: null as null | { id: number; x: number; y: number; rot: number },
  version: 0,
  inside: false,
  at: [0, 0] as [number, number],
  facing: 0,
  onInside: undefined as undefined | ((inside: boolean) => void),
  /** (For the end-to-end checks: a point of the house on the map, the house's turn.) */
  toMap: undefined as undefined | ((u: number, v: number) => [number, number]),
  yaw: 0,
}
if (typeof window !== 'undefined') (window as unknown as { oalHome: typeof homeStore }).oalHome = homeStore

export function changed() {
  homeStore.version++
}

/** A thing's footprint in the house's metres (turned by quarter turns): x0, y0, x1, y1. */
export function footprintOf(item: ItemId, x: number, y: number, rot: number): [number, number, number, number] {
  const [sx, sy] = ITEM_SIZES[item].size
  const turned = Math.abs(Math.sin(rot)) > 0.5
  const hx = (turned ? sy : sx) / 2
  const hy = (turned ? sx : sy) / 2
  return [x - hx, y - hy, x + hx, y + hy]
}

/** Whether a thing fits there: in the house's rooms, clear of its walls and fittings (the pieces
 * sold no longer there), clear of the other things. */
export function fits(id: number, item: ItemId, x: number, y: number, rot: number) {
  const [x0, y0, x1, y1] = footprintOf(item, x, y, rot)
  const inRooms = HOUSE.inside.some((r) => x0 >= r[0]! - 0.05 && x1 <= r[2]! + 0.05 && y0 >= r[1]! - 0.05 && y1 <= r[3]! + 0.05)
  // (A thing across a doorway from one room to the next is still in the house.)
  const inHouse = inRooms || [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].every(([px, py]) => HOUSE.inside.some((r) => px! >= r[0]! - 0.05 && px! <= r[2]! + 0.05 && py! >= r[1]! - 0.05 && py! <= r[3]! + 0.05))
  if (!inHouse) return false
  const gone = new Set([...homeStore.sold].flatMap((p) => HOUSE.pieces[p]?.solids ?? []))
  const hit = (r: number[]) => x0 < r[2]! - 0.02 && x1 > r[0]! + 0.02 && y0 < r[3]! - 0.02 && y1 > r[1]! + 0.02
  if (HOUSE.solids.some((r, i) => !gone.has(i) && hit(r))) return false
  for (const t of homeStore.things) {
    if (t.id === id || !t.placed || t.x === null || t.y === null || t.rot === null) continue
    if (hit(footprintOf(t.item, t.x, t.y, t.rot))) return false
  }
  return true
}

export function HomeThings({ toMap, fromMap, yaw, player }: { toMap: (u: number, v: number) => [number, number]; fromMap: (x: number, y: number) => [number, number]; yaw: number; player: { current: { x: number; y: number; f?: number } | null } }) {
  const items = useLoader(GLTFLoader, ITEMS_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const group = useMemo(() => new Group(), [])
  const seen = useRef(-1)
  useFrame(() => {
    // (Set in the house: its own metres, turned as it is.)
    homeStore.toMap = toMap
    homeStore.yaw = yaw
    const [hx, hy] = toMap(0, 0)
    group.position.set(hx, 0, -hy)
    group.rotation.y = yaw
    // Where the player is: in the house (one of its rooms), where, facing which way.
    const p = player.current
    if (p) {
      const [u, v] = fromMap(p.x, p.y)
      const inside = HOUSE.inside.some((r) => u > r[0]! && u < r[2]! && v > r[1]! && v < r[3]!)
      homeStore.at = [u, v]
      // (The character faces (sin f, -cos f) on the map; the house is turned by its yaw.)
      if (p.f !== undefined) homeStore.facing = p.f - yaw
      if (inside !== homeStore.inside) {
        homeStore.inside = inside
        homeStore.onInside?.(inside)
        // In it, the camera under its ceiling (as in a business's room).
        if (inside) {
          const xs = HOUSE.inside.flatMap((r) => [r[0]!, r[2]!])
          const ys = HOUSE.inside.flatMap((r) => [r[1]!, r[3]!])
          const front = Math.min(...ys)
          const [mx, my] = toMap(0, front)
          insideRooms.set('house', { key: 'house', kind: 'house', name: '', cat: 'home', mx, my, nx: Math.sin(yaw), ny: -Math.cos(yaw), u0: Math.min(...xs), u1: Math.max(...xs), d: Math.max(...ys) - front, h: HOUSE.ceiling ?? 3, s: 1, f0: front })
        } else insideRooms.delete('house')
      }
    }
    if (seen.current === homeStore.version) return
    seen.current = homeStore.version
    // The things, where they are (the one being moved where it would go).
    group.clear()
    const solids: Solid[] = []
    for (const t of homeStore.things) {
      const m = homeStore.moving?.id === t.id ? homeStore.moving : t.placed ? { x: t.x!, y: t.y!, rot: t.rot! } : null
      if (!m) continue
      const src = items.scene.getObjectByName(`item_${t.item}`)
      if (!src) continue
      const thing: Object3D = src.clone(true)
      thing.position.set(m.x, t.item === 'chandelier' ? 2.7 - ITEM_SIZES[t.item].size[2] : 0.02, -m.y)
      thing.rotation.set(0, m.rot, 0)
      group.add(thing)
      if (t.item !== 'chandelier' && homeStore.moving?.id !== t.id) {
        const [x0, y0, x1, y1] = footprintOf(t.item, m.x, m.y, m.rot)
        solids.push(solidOf([toMap(x0, y0), toMap(x1, y0), toMap(x1, y1), toMap(x0, y1)]))
      }
    }
    insideSolids.set('home-things', solids)
  })
  useEffect(
    () => () => {
      insideSolids.delete('home-things')
      insideRooms.delete('house')
    },
    [],
  )
  return <primitive object={group} />
}
