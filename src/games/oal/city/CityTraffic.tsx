// One Africa Life: the town's traffic and its people on foot (./CityScene.tsx). Vehicles drive
// the real road network (./cityGen.ts: its graph), on the right, at town speeds: yellow taxis,
// kekehs, private cars, the odd bus (on the big roads) and police car, each with its driver;
// at a junction each goes on its own way, slowing behind whoever is ahead and stopping for the
// player in front of it. People walk the roadsides (the pavements of the tarred roads, the edges
// of the laterite ones), of every look, turning at the corners. Only what is round the player is
// there: what falls far behind comes back ahead, out of sight. Where each vehicle is, as a box,
// is kept for the player to walk against.
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, useEffect, useMemo } from 'react'
import { type Object3D, Vector3 } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type Sex } from '../../../../supabase/functions/_shared/oal'
import { person } from '../ArrivalsScene'
import { CROWD_URL, randomLook } from '../character'
import { buildVehicle, type Kind, type Moving, SIZE, SPEED, vehicleModels, VEHICLES_URL } from '../Traffic'
import { CARS_URL, type CarModel, type CarModelName, buildCar, buildKekeh, KEKEH_URL, poseCar, randomPaint } from './cars'
import { cityNight } from './night'
import { ownCar } from './ownCar'
import { type Engine, engine, playOnce } from './sound'
import { type City, groundHeight, type Keep, type Leg, nearestNode, route, toSeg } from './cityGen'
import { type Around, type Box, boxOf, type Drive, drive, overlaps, startDrive } from './driving'
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

/** Vehicles driven by others than the traffic (Furniture City's truck): kept clear of, as any
 * other; and what the traffic is, each frame, for them to keep clear of. */
export const extraVehicles = new Set<{ d: Drive | null }>()
export const trafficNow: { all: Around['others'] } = { all: [] }

type Car = { kind: Kind; root: Object3D; model: CarModel | null; d: Drive | null; size: { len: number; wide: number; L: number; r: number; top: number } }

/** The player's own car among the others (it is never one of the traffic's). */
const ownCarEntry = { kind: 'car', root: null, model: null, d: null, size: { len: 4.5, wide: 1.96, L: 2.5, r: 0.34, top: 0 } } as unknown as Car

/** The next leg on from the end of one (not back the way it came, unless there is no other). */
function nextLeg(city: City, usable: boolean[], leg: Leg, rand: () => number, allowed: (e: Edge) => boolean): Leg | null {
  const g = onward(city, usable, { ...leg, s: 0 }, rand, allowed)
  return g ? { edge: g.edge, from: g.from, to: g.to } : null
}

/** A vehicle's size and speed, its model's (a car of the new kind) or its kind's (a kekeh, a bus). */
function sizeOf(kind: Kind, model: CarModel | null, rand: () => number) {
  const top = SPEED[kind] * (0.85 + rand() * 0.3)
  if (model) return { ...model.size, top }
  const [len, wide] = SIZE[kind]
  return { len, wide, L: len * 0.62, r: kind === 'kekeh' ? 0.22 : 0.45, top }
}

/** Which of the cars a kind is drawn as: the taxis, the sedan; the police, a pickup; others, any. */
function modelFor(kind: Kind, rand: () => number): { model: CarModelName; paint: string | null } | null {
  if (kind === 'taxi') return { model: 'suv_taxi', paint: null }
  if (kind === 'police') return { model: 'suv_police', paint: null }
  if (kind === 'car') return { model: 'suv', paint: randomPaint(rand) }
  return null
}

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
  const carsFile = useLoader(GLTFLoader, CARS_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const kekehFile = useLoader(GLTFLoader, KEKEH_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const people = useLoader(GLTFLoader, CROWD_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const index = useMemo(() => edgeIndex(city, keep), [city, keep])
  const stats = useMemo(() => {
    try {
      return !!localStorage.getItem('oal-stats')
    } catch {
      return false
    }
  }, [])
  const { cars, rand, hire } = useMemo(() => {
    let seed = 99
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const models = vehicleModels(gltf.scene)
    // A vehicle of a kind: a car of the new kind (its wheels, its steering), else the old model.
    const make = (kind: Kind): Car | null => {
      const m = modelFor(kind, rand)
      const model = m ? buildCar(carsFile.scene, m.model, m.paint, people, rand) : kind === 'kekeh' ? buildKekeh(kekehFile.scene, people, rand) : null
      const root = model ? model.root : buildVehicle(models, people, kind, rand)
      if (!root) return null
      root.visible = false
      return { kind, root, model, d: null, size: sizeOf(kind, model, rand) }
    }
    const cars: Car[] = []
    for (let i = 0; i < CARS; i++) {
      const r = rand()
      const kind: Kind = r < 0.45 ? 'taxi' : r < 0.7 ? 'kekeh' : r < 0.9 ? 'car' : r < 0.96 ? 'bus' : 'police'
      const car = make(kind)
      if (car) cars.push(car)
    }
    // The vehicles that come when waved down: a taxi and a kekeh, kept apart from the rest.
    const hire = { taxi: make('taxi')!, kekeh: make('kekeh')! }
    return { cars, rand, hire }
  }, [gltf, carsFile, kekehFile, people])
  const allowed = (kind: Kind) => (e: Edge) => e.kind !== 'path' && (kind === 'bus' ? e.kind !== 'minor' : true)
  // The engines heard (the nearest few), which police drive with their sirens on, the horns' and
  // tyres' rests, the last speeds (to hear a hard stop).
  const engines = useMemo(() => new Map<Car, Engine>(), [])
  const sirens = useMemo(() => new Set(cars.filter((c) => c.kind === 'police' && rand() < 0.4)), [cars, rand])
  const cooldown = useMemo(() => new Map<Car, number>(), [])
  const lastV = useMemo(() => new Map<Car, number>(), [])
  useEffect(
    () => () => {
      for (const e of engines.values()) e.stop()
      engines.clear()
    },
    [engines],
  )
  // Vehicles keep to the roads (not the footpaths).
  const drives = (e: Edge) => e.kind !== 'path'
  const say = (r: RideState, phase: RidePhase) => {
    r.phase = phase
    onRide(phase)
  }
  /** Draws a vehicle where its driving has it (a car: its wheels, its steering, its lean). */
  const { camera } = useThree()
  const look = useMemo(() => new Vector3(), [])
  const pose = (car: Car, dt: number) => {
    const d = car.d!
    const ground = 0.03 + groundHeight(city, d.x, d.y)
    if (car.model) poseCar(car.model, d, ground, dt, { x: camera.position.x, z: camera.position.z }, cityNight.value)
    else {
      car.root.position.set(d.x, ground + 0.05, -d.y)
      car.root.rotation.y = d.yaw
    }
  }
  /** The hired vehicle: waved down, coming, waiting, driving the player, pulled in. */
  const hired = (dt: number, p: { x: number; y: number }, others: Around['others'], boxes: Moving[]) => {
    const r = ride.current
    if (!r) return
    const req = r.request
    r.request = null
    const car = hire[r.kind]
    if (req?.type === 'hail' && r.phase === 'none') {
      r.kind = req.kind
      const h = hire[r.kind]
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
      const first = { edge: best.edge, from: forward ? e.a : e.b, to: forward ? e.b : e.a }
      // From a way back along its road (the road before, if this one is short).
      h.d = startDrive(city, [first], Math.max(0, at - 90), h.size, 8)
      r.legs = [first]
      r.stop = at
      r.to = null
      r.exit = null
      h.root.visible = true
      say(r, 'coming')
    }
    if (req?.type === 'cancel' && (r.phase === 'coming' || r.phase === 'waiting')) {
      car.root.visible = false
      car.d = null
      say(r, 'none')
      return
    }
    if (req?.type === 'go' && r.phase === 'waiting' && car.d) {
      // The shortest way there by road, from where the vehicle stands.
      const here = car.d.legs[car.d.leg]!
      const target = nearestNode(city, req.to.x, req.to.y, drives)
      const way = target === null ? null : route(city, here.to, target, drives)
      if (!way) return
      car.d.legs = [...car.d.legs.slice(0, car.d.leg + 1), ...way]
      r.stop = Infinity
      r.to = req.to
      playOnce('doorClose', [car.d.x, 0.8, -car.d.y], 0.8)
      say(r, 'riding')
    }
    if (req?.type === 'out' && r.phase === 'arrived') {
      if (car.d) playOnce('doorOpen', [car.d.x, 0.8, -car.d.y], 0.8)
      say(r, 'none')
      // It drives off (gone, a little later).
      setTimeout(() => {
        car.root.visible = false
        car.d = null
      }, 1500)
      return
    }
    if (r.phase === 'none' || !car.d) return
    const d = car.d
    // Where it stops: by the player (coming); at the end of the way (riding: the last leg's end).
    const last = d.leg === d.legs.length - 1
    let stopAt: number | undefined
    if (r.phase === 'coming' && last) stopAt = r.stop - d.s
    if (r.phase === 'riding' && last) stopAt = city.edges[d.legs[d.leg]!.edge]!.len - d.s - 3
    if (r.phase === 'waiting' || r.phase === 'arrived') stopAt = 0
    const fast = r.fast && r.phase === 'riding'
    for (let i = 0; i < (fast ? 3 : 1); i++) drive(city, d, dt, { others, seconds: Date.now() / 1000, stopAt, eager: fast })
    if (stopAt !== undefined && stopAt < 0.6 && d.v < 0.2) {
      if (r.phase === 'coming') say(r, 'waiting')
      else if (r.phase === 'riding') {
        // Pulled in: the passenger steps out on the kerb side, facing on.
        const ux = Math.cos(d.yaw)
        const uy = Math.sin(d.yaw)
        r.exit = { x: d.x + uy * 2.2, y: d.y - ux * 2.2, f: Math.atan2(ux, -uy) }
        say(r, 'arrived')
      }
    }
    // Metres left: the rest of this leg and the legs after it.
    let left = city.edges[d.legs[d.leg]!.edge]!.len - d.s
    for (let i = d.leg + 1; i < d.legs.length; i++) left += city.edges[d.legs[i]!.edge]!.len
    r.left = r.phase === 'riding' ? left : 0
    r.pos = { x: d.x, y: d.y, yaw: d.yaw }
    pose(car, dt)
    boxes.push({ x: d.x, y: d.y, yaw: d.yaw, hl: car.size.len / 2, hw: car.size.wide / 2 })
  }

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    const p = player.current
    if (!p) return
    const boxes: Moving[] = []
    const seconds = Date.now() / 1000
    // Every vehicle as the others see it (for keeping their distance, never meeting).
    const all: { car: Car; box: Box; v: number; d?: Drive }[] = []
    for (const c of [...cars, hire.taxi, hire.kekeh]) if (c.d && c.root.visible) all.push({ car: c, box: boxOf(c.d), v: c.d.v, d: c.d })
    // The player's own car (standing or driven): kept clear of as any other.
    if (ownCar.d && ownCar.model) all.push({ car: ownCarEntry, box: boxOf(ownCar.d), v: ownCar.d.v })
    for (const x of extraVehicles)
      if (x.d) {
        all.push({ car: x as unknown as Car, box: boxOf(x.d), v: x.d.v, d: x.d })
        boxes.push({ x: x.d.x, y: x.d.y, yaw: x.d.yaw, hl: x.d.len / 2, hw: x.d.wide / 2 })
      }
    trafficNow.all = all
    const othersOf = (me: Car) => all.filter((o) => o.car !== me && Math.abs(o.box.x - me.d!.x) < 45 && Math.abs(o.box.y - me.d!.y) < 45)
    // While riding, the town is round the vehicle (the player is in it).
    camera.getWorldDirection(look)
    const hiredCar = hire[ride.current?.kind ?? 'taxi']
    hired(dt, p, hiredCar.d ? othersOf(hiredCar) : [], boxes)
    for (const car of cars) {
      // Far behind, or not yet out: put on a road round the player, out of sight.
      // (Or stuck a long while in a knot of traffic: taken off the road where it is not seen go,
      // behind the camera or well off, and another comes on elsewhere.)
      const stuck = car.d ? Math.max(car.d.held, car.d.wait ?? 0) : 0
      const unseen = car.d ? Math.hypot(car.d.x - p.x, car.d.y - p.y) > 60 || (car.d.x - camera.position.x) * look.x + (-car.d.y - camera.position.z) * look.z < 0 : false
      const far = !car.d || Math.hypot(car.d.x - p.x, car.d.y - p.y) > FAR || (stuck > 15 && unseen) || (stuck > 45 && Math.hypot(car.d.x - camera.position.x, -car.d.y - camera.position.z) > 25)
      if (far) {
        const near = edgesNear(index, p.x, p.y, 300).filter((i) => {
          const e = city.edges[i]!
          return allowed(car.kind)(e) && e.len >= 15
        })
        // The big roads are busier.
        const weighted = near.filter((i) => city.edges[i]!.kind !== 'minor' || car.kind === 'kekeh' || car.kind === 'taxi' || rand() < 0.4)
        const pickFrom = weighted.length ? weighted : near
        const edge = pickFrom.length ? pickFrom[Math.floor(rand() * pickFrom.length)]! : null
        const at = edge === null ? null : spotOn(city, edge, p.x, p.y, 80, 250, rand)
        if (edge === null || at === null) {
          car.root.visible = false
          car.d = null
          continue
        }
        const e = city.edges[edge]!
        const forward = e.one || rand() < 0.5
        const leg = { edge, from: forward ? e.a : e.b, to: forward ? e.b : e.a }
        const d = startDrive(city, [leg], forward ? at : e.len - at, car.size, car.size.top * 0.8)
        // (Not where another already is.)
        if (all.some((o) => overlaps(boxOf(d), o.box, 1))) continue
        car.d = d
        car.root.visible = true
        continue
      }
      const d = car.d!
      // Its way ahead: a few legs on, chosen at each junction as it comes (the next turn known).
      while (d.legs.length - d.leg < 4) {
        const next = nextLeg(city, index.usable, d.legs[d.legs.length - 1]!, rand, allowed(car.kind))
        if (!next) break
        d.legs.push(next)
      }
      if (d.leg > 4) {
        d.legs.splice(0, d.leg)
        d.leg = 0
      }
      const going = drive(city, d, dt, { others: othersOf(car), player: p, seconds })
      if (!going) {
        // The end of its way (a dead end): gone; it comes back elsewhere.
        car.d = null
        car.root.visible = false
        continue
      }
      pose(car, dt)
      boxes.push({ x: d.x, y: d.y, yaw: d.yaw, hl: car.size.len / 2, hw: car.size.wide / 2 })
    }
    if (moving.current) moving.current.splice(0, moving.current.length, ...boxes)
    // Heard: the nearest vehicles' engines (a few: the rest are the town's hum), their horns when
    // held up, their tyres when they stop hard.
    const heard = [...cars, hire.taxi, hire.kekeh].filter((c) => c.d && c.root.visible).sort((a, b) => Math.hypot(a.d!.x - camera.position.x, -a.d!.y - camera.position.z) - Math.hypot(b.d!.x - camera.position.x, -b.d!.y - camera.position.z)).slice(0, 6)
    for (const [c, eng] of engines) if (!heard.includes(c)) {
      eng.stop()
      engines.delete(c)
    }
    for (const c of heard) {
      const d = c.d!
      let eng = engines.get(c)
      if (!eng) {
        const made = engine()
        if (!made) continue
        engines.set(c, made)
        eng = made
      }
      const at: [number, number, number] = [d.x, 0.7, -d.y]
      eng.set(at, d.v, d.braking ? 0 : d.v < d.top - 0.5 ? 0.6 : 0.2, c.kind === 'kekeh' ? 'kekeh' : 'car', c.kind === 'police' && sirens.has(c))
      const last = lastV.get(c) ?? d.v
      // Hard on the brakes from speed: the tyres.
      if (last - d.v > 7.5 * dt && last > 7 && (cooldown.get(c) ?? 0) < seconds) {
        playOnce('screech', at, 0.7)
        cooldown.set(c, seconds + 4)
      }
      // Held up a while (by a vehicle, by someone in the road): the horn, now and then.
      if (d.held > 2.5 && (cooldown.get(c) ?? 0) < seconds && rand() < 0.02) {
        playOnce('horn', at, 0.8, c.kind === 'kekeh' ? 1.5 : 0.95 + rand() * 0.15)
        cooldown.set(c, seconds + 7)
      }
      lastV.set(c, d.v)
    }
    // (For tests: how the traffic is going.)
    if (stats) {
      const out = cars.filter((c) => c.d && c.root.visible).map((c) => c.d!)
      ;(window as unknown as { oalTraffic: unknown }).oalTraffic = {
        out: out.length,
        moving: out.filter((d) => d.v > 0.5).length,
        held: out.filter((d) => d.held > 3).length,
        longestHeld: Math.max(0, ...out.map((d) => d.held)),
        meanSpeed: out.reduce((a, d) => a + d.v, 0) / Math.max(1, out.length),
        passing: out.filter((d) => d.wantOffset < 0).length,
        overlapping: out.filter((d, i) => out.some((o, j) => j !== i && overlaps(boxOf(d), boxOf(o), 0))).length,
      }
    }
    // What is hidden is not worked out either (a driver's every bone, each frame, adds up).
    for (const car of [...cars, hire.taxi, hire.kekeh]) car.root.matrixWorldAutoUpdate = car.root.visible
  })
  return (
    <>
      {cars.map((c, i) => (
        <primitive key={i} object={c.root} />
      ))}
      <primitive object={hire.taxi.root} />
      <primitive object={hire.kekeh.root} />
    </>
  )
}

type Walker = { root: Object3D; mixer: { update: (dt: number) => void }; going: Going | null; side: number; speed: number; yaw: number }

/** People on foot along the roadsides. */
export function CityWalkers({ city, keep, player }: { city: City; keep: Keep[]; player: RefObject<{ x: number; y: number }> }) {
  const men = useLoader(GLTFLoader, CROWD_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const women = useLoader(GLTFLoader, CROWD_URL('female'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const index = useMemo(() => edgeIndex(city, keep), [city, keep])
  const { walkers, rand } = useMemo(() => {
    let seed = 41
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const walkers: Walker[] = []
    for (let i = 0; i < WALKERS; i++) {
      const female = i % 2 === 1
      const file = female ? women : men
      const s: Sex = female ? 'female' : 'male'
      const p = person(file.scene, file.animations, randomLook(s, rand))
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
    for (const w of walkers) w.root.matrixWorldAutoUpdate = w.root.visible
  })
  return (
    <>
      {walkers.map((w, i) => (
        <primitive key={i} object={w.root} />
      ))}
    </>
  )
}
