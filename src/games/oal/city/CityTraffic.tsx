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
import { type City, groundHeight, type Keep, nearestNode, route, toSeg } from './cityGen'
import type { RidePhase, RideState } from './ride'

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

export function CityTraffic({
  city,
  keep,
  player,
  moving,
  ride,
  onRide,
}: {
  city: City
  keep: Keep[]
  player: RefObject<{ x: number; y: number }>
  moving: RefObject<Moving[]>
  /** A ride the player has hailed (one vehicle of its own, a taxi or a kekeh, driven for them). */
  ride: RefObject<RideState>
  onRide: (phase: RidePhase) => void
}) {
  const gltf = useLoader(GLTFLoader, VEHICLES_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const people = useLoader(GLTFLoader, CHARACTER_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const index = useMemo(() => edgeIndex(city, keep), [city, keep])
  const { cars, rand, hire } = useMemo(() => {
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
    // The vehicles that come when waved down: a taxi and a kekeh, kept apart from the rest.
    const hire = { taxi: buildVehicle(models, people, 'taxi', rand)!, kekeh: buildVehicle(models, people, 'kekeh', rand)! }
    hire.taxi.visible = false
    hire.kekeh.visible = false
    return { cars, rand, hire }
  }, [gltf, people])
  const allowed = (kind: Kind) => (e: Edge) => e.kind !== 'path' && (kind === 'bus' ? e.kind !== 'minor' : true)

  // Vehicles keep to the roads (not the footpaths).
  const drives = (e: Edge) => e.kind !== 'path'
  const say = (r: RideState, phase: RidePhase) => {
    r.phase = phase
    onRide(phase)
  }
  /** The hired vehicle: waved down, coming, waiting, driving the player, pulled in. */
  const hired = (dt: number, p: { x: number; y: number }, boxes: Moving[]) => {
    const r = ride.current
    if (!r) return
    const req = r.request
    r.request = null
    const car = hire[r.kind]
    if (req?.type === 'hail' && r.phase === 'none') {
      r.kind = req.kind
      // The road nearest the player: a vehicle comes along it (on the player's side, unless the
      // road is one-way), from a way back.
      let best: { edge: number; t: number; d: number } | null = null
      for (const i of edgesNear(index, p.x, p.y, 60)) {
        const e = city.edges[i]!
        const a = city.nodes[e.a]!
        const b = city.nodes[e.b]!
        const seg = { ax: a.x, ay: a.y, bx: b.x, by: b.y, ux: (b.x - a.x) / e.len, uy: (b.y - a.y) / e.len, len: e.len, w: e.w, kind: e.kind, road: 0, edge: i, t0: 0, elen: e.len, one: e.one }
        const n = toSeg(seg, p.x, p.y)
        if (!best || n.d < best.d) best = { edge: i, t: n.t, d: n.d }
      }
      if (!best) return
      const e = city.edges[best.edge]!
      const a = city.nodes[e.a]!
      const b = city.nodes[e.b]!
      const right = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / e.len
      const forward = e.one || right > 0
      const at = forward ? best.t : e.len - best.t
      r.legs = [{ edge: best.edge, from: forward ? e.a : e.b, to: forward ? e.b : e.a }]
      r.leg = 0
      r.s = Math.max(0, at - 90)
      r.stop = at
      r.v = 8
      r.to = null
      r.exit = null
      hire[r.kind].visible = true
      say(r, 'coming')
    }
    if (req?.type === 'cancel' && (r.phase === 'coming' || r.phase === 'waiting')) {
      car.visible = false
      say(r, 'none')
      return
    }
    if (req?.type === 'go' && r.phase === 'waiting') {
      // The shortest way there by road, from where the vehicle stands.
      const here = r.legs[r.leg]!
      const target = nearestNode(city, req.to.x, req.to.y, drives)
      const way = target === null ? null : route(city, here.to, target, drives)
      if (!way) return
      r.legs = [here, ...way]
      r.leg = 0
      r.stop = Infinity
      r.to = req.to
      say(r, 'riding')
    }
    if (req?.type === 'out' && r.phase === 'arrived') {
      say(r, 'none')
      // It drives off (gone, a little later).
      setTimeout(() => (car.visible = false), 1500)
      return
    }
    if (r.phase === 'none') return
    const leg = r.legs[r.leg]
    if (!leg) return
    const e = city.edges[leg.edge]!
    const end = r.leg === r.legs.length - 1 ? Math.min(r.stop, e.len) : Infinity
    if (r.phase === 'coming' || r.phase === 'riding') {
      const top = (e.kind === 'minor' ? 7 : 11) * (r.fast && r.phase === 'riding' ? 3 : 1)
      const toEnd = end === Infinity ? Infinity : end - r.s
      const want = Math.min(top, toEnd === Infinity ? top : Math.max(0, toEnd * 1.1))
      r.v += Math.max(-7 * dt, Math.min(3 * dt * (r.fast ? 3 : 1), want - r.v))
      r.v = Math.max(0, r.v)
      r.s += r.v * dt
      if (r.s >= e.len && r.leg < r.legs.length - 1) {
        r.s -= e.len
        r.leg++
      } else if (toEnd < 0.4 && r.v < 0.3) {
        r.v = 0
        if (r.phase === 'coming') say(r, 'waiting')
        else {
          // Pulled in: the passenger steps out on the kerb side, facing on.
          const at = placeOn(city, { ...leg, s: r.s }, e.w / 4)
          r.exit = { x: at.x + at.uy * (e.w / 4 + 1.8), y: at.y - at.ux * (e.w / 4 + 1.8), f: Math.atan2(at.ux, -at.uy) }
          say(r, 'arrived')
        }
      }
    }
    const cur = r.legs[r.leg]!
    const at = placeOn(city, { ...cur, s: r.s }, city.edges[cur.edge]!.w / 4)
    let turn = at.yaw - r.pos.yaw
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    r.pos = { x: at.x, y: at.y, yaw: r.pos.yaw + turn * Math.min(1, dt * 6) }
    // Metres left: the rest of this edge and the legs after it.
    let left = city.edges[cur.edge]!.len - r.s
    for (let i = r.leg + 1; i < r.legs.length; i++) left += city.edges[r.legs[i]!.edge]!.len
    r.left = r.phase === 'riding' ? left : 0
    car.position.set(r.pos.x, 0.08 + groundHeight(city, r.pos.x, r.pos.y), -r.pos.y)
    car.rotation.y = r.pos.yaw
    const [len, wide] = SIZE[r.kind]
    boxes.push({ x: r.pos.x, y: r.pos.y, yaw: r.pos.yaw, hl: len / 2, hw: wide / 2 })
  }

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    const p = player.current
    if (!p) return
    const boxes: Moving[] = []
    // While riding, the town is round the vehicle (the player is in it).
    hired(dt, p, boxes)
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
      car.root.position.set(at.x, 0.08 + groundHeight(city, at.x, at.y), -at.y)
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
      <primitive object={hire.taxi} />
      <primitive object={hire.kekeh} />
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
      w.root.position.set(at.x, 0.06 + groundHeight(city, at.x, at.y), -at.y)
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
