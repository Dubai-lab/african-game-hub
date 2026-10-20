// One Africa Life: the town's traffic and its people on foot (./CityScene.tsx). Vehicles drive
// the real road network (./cityGen.ts: its graph), on the right, at town speeds: yellow taxis,
// kekehs, private cars, the odd bus (on the big roads) and police car, each with its driver;
// at a junction each goes on its own way, slowing behind whoever is ahead and stopping for the
// player in front of it. People walk the roadsides (the pavements of the tarred roads, the edges
// of the laterite ones), of every look, turning at the corners. Only what is round the player is
// there: what falls far behind comes back ahead, out of sight. Where each vehicle is, as a box,
// is kept for the player to walk against.
import { useFrame, useLoader } from '@react-three/fiber'
import { type RefObject, useMemo } from 'react'
import type { Object3D } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CATALOGUE, defaultAppearance, type Sex } from '../../../../supabase/functions/_shared/oal'
import { person } from '../ArrivalsScene'
import { CHARACTER_URL } from '../character'
import { buildVehicle, type Kind, type Moving, SIZE, SPEED, vehicleModels, VEHICLES_URL } from '../Traffic'
import type { City, Keep } from './cityGen'

const CARS = 26
const WALKERS = 16
const FAR = 330
const WALK_FAR = 170

type Edge = City['edges'][number]
/** On an edge, going from one of its nodes to the other, so far along it. */
type Going = { edge: number; from: number; to: number; s: number }

/** The edges by 100 m cell (of their middles), and which may be driven. */
function edgeIndex(city: City, keep: Keep[]) {
  const cells = new Map<string, number[]>()
  const usable: boolean[] = []
  city.edges.forEach((e, i) => {
    const a = city.nodes[e.a]!
    const b = city.nodes[e.b]!
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    // Not inside a street built by hand (it has its own traffic).
    const ok = !keep.some((k) => k.roads !== false && Math.hypot(mx - k.x, my - k.y) < k.r)
    usable.push(ok)
    if (!ok) return
    const k = `${Math.floor(mx / 100)},${Math.floor(my / 100)}`
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  })
  return { cells, usable }
}

function edgesNear(index: ReturnType<typeof edgeIndex>, x: number, y: number, r: number) {
  const out: number[] = []
  for (let cx = Math.floor((x - r) / 100); cx <= Math.floor((x + r) / 100); cx++)
    for (let cy = Math.floor((y - r) / 100); cy <= Math.floor((y + r) / 100); cy++) out.push(...(index.cells.get(`${cx},${cy}`) ?? []))
  return out
}

/** A place on an edge between two distances from a point (where to put someone out of the way):
 * how far along it, or null if none of it is there. */
function spotOn(city: City, edge: number, x: number, y: number, near: number, far: number, rand: () => number): number | null {
  const e = city.edges[edge]!
  const a = city.nodes[e.a]!
  const b = city.nodes[e.b]!
  for (let tries = 0; tries < 4; tries++) {
    const s = rand() * e.len
    const px = a.x + ((b.x - a.x) * s) / e.len
    const py = a.y + ((b.y - a.y) * s) / e.len
    const d = Math.hypot(px - x, py - y)
    if (d > near && d < far) return s
  }
  return null
}

/** Where on an edge (and which way) one going along it is, with a sideways offset (+ right). */
function placeOn(city: City, g: Going, side: number) {
  const a = city.nodes[g.from]!
  const b = city.nodes[g.to]!
  const e = city.edges[g.edge]!
  const t = Math.min(1, g.s / e.len)
  const ux = (b.x - a.x) / e.len
  const uy = (b.y - a.y) / e.len
  return { x: a.x + (b.x - a.x) * t + uy * side, y: a.y + (b.y - a.y) * t - ux * side, yaw: Math.atan2(uy, ux), ux, uy }
}

/** At a node: the next edge on (not back the way it came, unless there is no other). */
function onward(city: City, usable: boolean[], g: Going, rand: () => number, allowed: (e: Edge) => boolean, oneWays = true): Going | null {
  const node = city.nodes[g.to]!
  // Not the wrong way up a one-way road (people on foot may).
  const options = node.edges.filter((i) => i !== g.edge && usable[i] && allowed(city.edges[i]!) && (!oneWays || !city.edges[i]!.one || city.edges[i]!.a === g.to))
  const next = options.length ? options[Math.floor(rand() * options.length)]! : null
  if (next === null) return null
  const e = city.edges[next]!
  return { edge: next, from: g.to, to: e.a === g.to ? e.b : e.a, s: 0 }
}

type Car = { kind: Kind; root: Object3D; going: Going | null; v: number; want: number; yaw: number }

export function CityTraffic({ city, keep, player, moving }: { city: City; keep: Keep[]; player: RefObject<{ x: number; y: number }>; moving: RefObject<Moving[]> }) {
  const gltf = useLoader(GLTFLoader, VEHICLES_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const people = useLoader(GLTFLoader, CHARACTER_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const index = useMemo(() => edgeIndex(city, keep), [city, keep])
  const { cars, rand } = useMemo(() => {
    let seed = 99
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const models = vehicleModels(gltf.scene)
    const cars: Car[] = []
    for (let i = 0; i < CARS; i++) {
      const r = rand()
      const kind: Kind = r < 0.45 ? 'taxi' : r < 0.7 ? 'kekeh' : r < 0.9 ? 'car' : r < 0.96 ? 'bus' : 'police'
      const root = buildVehicle(models, people, kind, rand)
      if (!root) continue
      root.visible = false
      cars.push({ kind, root, going: null, v: 0, want: SPEED[kind] * (0.8 + rand() * 0.35), yaw: 0 })
    }
    return { cars, rand }
  }, [gltf, people])
  const allowed = (kind: Kind) => (e: Edge) => (kind === 'bus' ? e.kind !== 'minor' : true)

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    const p = player.current
    if (!p) return
    const boxes: Moving[] = []
    for (const car of cars) {
      // Far behind, or not yet out: put on a road round the player, out of sight.
      const here = car.going ? placeOn(city, car.going, city.edges[car.going.edge]!.w / 4) : null
      if (!here || Math.hypot(here.x - p.x, here.y - p.y) > FAR) {
        const near = edgesNear(index, p.x, p.y, 300).filter((i) => {
          const e = city.edges[i]!
          return allowed(car.kind)(e) && e.len >= 15
        })
        if (near.length === 0) {
          car.root.visible = false
          car.going = null
          continue
        }
        // The big roads are busier.
        const weighted = near.filter((i) => city.edges[i]!.kind !== 'minor' || car.kind === 'kekeh' || car.kind === 'taxi' || rand() < 0.4)
        const pickFrom = weighted.length ? weighted : near
        const edge = pickFrom[Math.floor(rand() * pickFrom.length)]!
        const e = city.edges[edge]!
        const at = spotOn(city, edge, p.x, p.y, 80, 250, rand)
        if (at === null) {
          car.root.visible = false
          car.going = null
          continue
        }
        const forward = e.one || rand() < 0.5
        car.going = { edge, from: forward ? e.a : e.b, to: forward ? e.b : e.a, s: forward ? at : e.len - at }
        car.v = car.want
        car.root.visible = true
        continue
      }
      const g = car.going!
      const e = city.edges[g.edge]!
      const [len, wide] = SIZE[car.kind]
      // Room ahead: the next vehicle the same way on the same edge; the player in the lane.
      let room = Infinity
      for (const other of cars) {
        if (other === car || !other.going) continue
        const og = other.going
        if (og.edge === g.edge && og.from === g.from) {
          const gap = og.s - g.s
          if (gap > 0) room = Math.min(room, gap - (len + SIZE[other.kind][0]) / 2)
        } else if (og.from === g.to && og.s < 6 && e.len - g.s < 10) room = Math.min(room, e.len - g.s + og.s - (len + SIZE[other.kind][0]) / 2)
      }
      const dx = p.x - here.x
      const dy = p.y - here.y
      const ahead = dx * here.ux + dy * here.uy
      const side = Math.abs(-dx * here.uy + dy * here.ux)
      if (ahead > 0 && side < wide / 2 + 0.9) room = Math.min(room, ahead - len / 2 - 0.8)
      // Slower on the small roads, round the corners.
      const limit = e.kind === 'minor' ? Math.min(car.want, 5.5) : car.want
      const target = room < 2 ? 0 : Math.min(limit, (room - 2) * 0.9)
      car.v += Math.max(-6 * dt, Math.min(2.5 * dt, target - car.v))
      car.v = Math.max(0, car.v)
      g.s += car.v * dt
      if (g.s >= e.len) {
        const next = onward(city, index.usable, g, rand, allowed(car.kind))
        if (next) {
          next.s = g.s - e.len
          car.going = next
        } else if (!e.one) {
          // A dead end: turned round.
          car.going = { edge: g.edge, from: g.to, to: g.from, s: 0 }
        } else {
          // The end of a one-way road with nowhere on: gone (it comes back elsewhere).
          car.going = null
          car.root.visible = false
          continue
        }
      }
      const at = placeOn(city, car.going!, city.edges[car.going!.edge]!.w / 4)
      let turn = at.yaw - car.yaw
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      car.yaw += turn * Math.min(1, dt * 6)
      car.root.position.set(at.x, 0.08, -at.y)
      car.root.rotation.y = car.yaw
      boxes.push({ x: at.x, y: at.y, yaw: car.yaw, hl: len / 2, hw: wide / 2 })
    }
    if (moving.current) moving.current.splice(0, moving.current.length, ...boxes)
  })
  return (
    <>
      {cars.map((c, i) => (
        <primitive key={i} object={c.root} />
      ))}
    </>
  )
}

type Walker = { root: Object3D; mixer: { update: (dt: number) => void }; going: Going | null; side: number; speed: number; yaw: number }

/** People on foot along the roadsides. */
export function CityWalkers({ city, keep, player }: { city: City; keep: Keep[]; player: RefObject<{ x: number; y: number }> }) {
  const men = useLoader(GLTFLoader, CHARACTER_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const women = useLoader(GLTFLoader, CHARACTER_URL('female'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const index = useMemo(() => edgeIndex(city, keep), [city, keep])
  const { walkers, rand } = useMemo(() => {
    let seed = 41
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const walkers: Walker[] = []
    for (let i = 0; i < WALKERS; i++) {
      const female = i % 2 === 1
      const file = female ? women : men
      const s: Sex = female ? 'female' : 'male'
      const base = defaultAppearance(s)
      const pickOf = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!
      const p = person(file.scene, file.animations, { ...base, skin: 0.55 + rand() * 0.4, outfit: pickOf(CATALOGUE.outfit[s]), hair: pickOf(CATALOGUE.hair[s]) })
      p.actions.walk?.play()
      if (p.actions.walk) p.actions.walk.time = rand() * 2
      p.root.visible = false
      walkers.push({ root: p.root, mixer: p.mixer, going: null, side: rand() < 0.5 ? 1 : -1, speed: 1.15 + rand() * 0.35, yaw: 0 })
    }
    return { walkers, rand }
  }, [men, women])
  const everywhere = () => true
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    const p = player.current
    if (!p) return
    for (const w of walkers) {
      const e0 = w.going ? city.edges[w.going.edge]! : null
      const off = e0 ? (e0.w / 2 + (e0.kind === 'minor' ? 0.7 : 1.4)) * w.side : 0
      const here = w.going ? placeOn(city, w.going, off) : null
      if (!here || Math.hypot(here.x - p.x, here.y - p.y) > WALK_FAR) {
        const near = edgesNear(index, p.x, p.y, 200).filter((i) => city.edges[i]!.len > 10)
        if (!near.length) {
          w.root.visible = false
          w.going = null
          continue
        }
        const edge = near[Math.floor(rand() * near.length)]!
        const e = city.edges[edge]!
        const at = spotOn(city, edge, p.x, p.y, 18, 120, rand)
        if (at === null) {
          w.root.visible = false
          w.going = null
          continue
        }
        const forward = rand() < 0.5
        w.going = { edge, from: forward ? e.a : e.b, to: forward ? e.b : e.a, s: forward ? at : e.len - at }
        w.root.visible = true
        continue
      }
      const g = w.going!
      const e = city.edges[g.edge]!
      g.s += w.speed * dt
      if (g.s >= e.len) {
        const next = onward(city, index.usable, g, rand, everywhere, false)
        w.going = next ? { ...next, s: g.s - e.len } : { edge: g.edge, from: g.to, to: g.from, s: 0 }
        if (!next) w.side = -w.side
      }
      const ng = w.going!
      const ne = city.edges[ng.edge]!
      const at = placeOn(city, ng, (ne.w / 2 + (ne.kind === 'minor' ? 0.7 : 1.4)) * w.side)
      // Walking along (ux, uy) on the map: the character's yaw (forward is (sin, -cos)).
      const want = Math.atan2(at.ux, -at.uy)
      let turn = want - w.yaw
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      w.yaw += turn * Math.min(1, dt * 6)
      w.root.position.set(at.x, 0.06, -at.y)
      w.root.rotation.y = w.yaw
      // Only the near ones are moved frame by frame (the far ones are small).
      if (Math.hypot(at.x - p.x, at.y - p.y) < 80) w.mixer.update(dt)
    }
  })
  return (
    <>
      {walkers.map((w, i) => (
        <primitive key={i} object={w.root} />
      ))}
    </>
  )
}
