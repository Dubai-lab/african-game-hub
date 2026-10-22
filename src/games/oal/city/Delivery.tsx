// One Africa Life: Furniture City delivers. What the player bought goes on the store's truck
// (./cars.ts: buildTruck), which pulls out of the store's forecourt on Tubman Boulevard and drives
// the town's roads to the family's house (the shortest way, in the traffic, by its rules), pulls
// in at the kerb with its back by the gate and opens its back doors; its two men carry the things
// in, a carton at a time, through the gate, across the yard, in at the front door, and come back
// for the next. When the last is in, the things are home (the server is told: it keeps when they
// may be, and has them home anyway eight minutes after they were bought, whatever is seen); the
// back doors shut, the men get in, and it drives back to the store.
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import i18n from '@/core/i18n'
import { callFunction } from '@/core/lib/functions'
import { toast } from '@/core/ui/toast'
import { person } from '../ArrivalsScene'
import { CROWD_URL, randomLook, seeded } from '../character'
import { buildTruck, type CarModel, poseCar, TRUCK_URL } from './cars'
import { type City, groundHeight, type Leg, nearestNode, route, toSeg } from './cityGen'
import { extraVehicles, trafficNow } from './CityTraffic'
import { type Drive, drive, startDrive } from './driving'
import { storeToMap } from './FurnitureCity'
import { changed, homeStore } from './HomeThings'
import { cityNight } from './night'
import { playOnce } from './sound'

type Phase = 'none' | 'driving' | 'parked' | 'unloading' | 'closing' | 'leaving'

/** A man of the truck's: where on his way (the house's metres), carrying a carton or not. */
type Carrier = { root: Object3D; carton: Object3D; actions: Record<string, { play: () => unknown; stop: () => unknown; fadeIn: (s: number) => unknown; fadeOut: (s: number) => unknown; reset: () => unknown }>; mixer: { update: (dt: number) => void }; at: number; going: 1 | -1; carrying: boolean; rest: number; done: boolean; u: number; v: number; f: number; clip: string }

/** How it is going (the page's checks read it, and may hurry it). */
export const delivery = {
  phase: 'none' as Phase,
  /** Cartons still on the truck, and carried in. */
  left: 0,
  carried: 0,
  /** Where the truck is (town metres). */
  x: 0,
  y: 0,
  /** (For the end-to-end checks: driven this many times as fast.) */
  hurry: 1,
  /** (For the checks: each man's step on the way, which way, whether carrying, whether done.) */
  men: [] as Record<string, unknown>[],
  /** (For the checks: what the server said when told they were in.) */
  told: '',
}
if (typeof window !== 'undefined') (window as unknown as { oalDelivery: typeof delivery }).oalDelivery = delivery

/** The things on their way (bought, not yet home). */
const onTheWay = () => homeStore.things.filter((t) => t.arrives_at && Date.parse(t.arrives_at) > Date.now())

const drives = (e: City['edges'][number]) => e.kind !== 'path'
const TOP = 10
// The men's way in, in the house's metres: out of the gate, up the yard's path, onto the porch,
// in at the front door to the living room.
const WAY_IN: [number, number][] = [
  [0, -15.6],
  [0, -12.4],
  [-2.45, -6.6],
  [-2.45, -4.6],
  [-2.45, -3.3],
]

type Props = { city: City; toMap: (u: number, v: number) => [number, number]; fromMap: (x: number, y: number) => [number, number]; player: { current: { x: number; y: number } | null } }

/** The delivery: loaded only while there is one (the truck and its men cost nothing otherwise). */
export function Delivery(props: Props) {
  const [on, setOn] = useState(false)
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 1) return
    last.current = clock.elapsedTime
    const want = delivery.phase !== 'none' || onTheWay().length > 0
    if (want !== on) setOn(want)
  })
  return on ? (
    <Suspense fallback={null}>
      <Run {...props} />
    </Suspense>
  ) : null
}

/** The nearest stretch of road to a point: its edge, how far along, which side the point is. */
function roadAt(city: City, x: number, y: number) {
  let best: { edge: number; t: number; d: number; right: number } | null = null
  city.edges.forEach((e, i) => {
    if (!drives(e)) return
    const a = city.nodes[e.a]!
    const b = city.nodes[e.b]!
    if (Math.min(Math.hypot(a.x - x, a.y - y), Math.hypot(b.x - x, b.y - y)) > e.len + 80) return
    const seg = { ax: a.x, ay: a.y, bx: b.x, by: b.y, ux: (b.x - a.x) / e.len, uy: (b.y - a.y) / e.len, len: e.len, w: e.w, kind: e.kind, road: 0, edge: i, t0: 0, elen: e.len, one: e.one }
    const n = toSeg(seg, x, y)
    if (!best || n.d < best.d) best = { edge: i, t: n.t, d: n.d, right: ((x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)) / e.len }
  })
  return best as { edge: number; t: number; d: number; right: number } | null
}

/** The leg along a road's edge that has a point on its right (its kerb side), and how far along
 * it the point is (the other way only if the road is one-way). */
function legBeside(city: City, at: { edge: number; t: number; right: number }) {
  const e = city.edges[at.edge]!
  const forward = e.one || at.right > 0
  return { leg: { edge: at.edge, from: forward ? e.a : e.b, to: forward ? e.b : e.a } as Leg, s: forward ? at.t : e.len - at.t }
}

function Run({ city, toMap, fromMap, player }: Props) {
  const file = useLoader(GLTFLoader, TRUCK_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const crowd = useLoader(GLTFLoader, CROWD_URL('male'), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const { truck, men, group } = useMemo(() => {
    const rand = seeded(4417)
    const truck: CarModel = buildTruck(file.scene, crowd, rand)
    truck.root.visible = false
    const group = new Group()
    group.add(truck.root)
    // The cartons: brown board, taped.
    const board = new MeshStandardMaterial({ color: '#b48a58', roughness: 0.9 })
    const tape = new MeshStandardMaterial({ color: '#8a6a3c', roughness: 0.6 })
    const men: Carrier[] = [0, 1].map((i) => {
      const p = person(crowd.scene, crowd.animations, randomLook('male', seeded(7 + i * 53), ['overalls']))
      const carton = new Group()
      carton.add(new Mesh(new BoxGeometry(0.62, 0.46, 0.42), board))
      const strip = new Mesh(new BoxGeometry(0.1, 0.465, 0.425), tape)
      carton.add(strip)
      // (Held at the chest, in the man's own frame: his model is scaled, the carton is not.)
      const k = 1 / (p.root.scale.x || 1)
      carton.scale.setScalar(k)
      carton.position.set(0, 1.02 * k, 0.36 * k)
      carton.visible = false
      p.root.add(carton)
      p.root.visible = false
      group.add(p.root)
      return { root: p.root, carton, actions: p.actions as unknown as Carrier['actions'], mixer: p.mixer, at: 0, going: 1, carrying: false, rest: 0, done: true, u: 0, v: 0, f: 0, clip: '' }
    })
    return { truck, men, group }
  }, [file, crowd])
  const state = useMemo(() => ({ v: { d: null as Drive | null }, stopS: 0, wait: 0, back: 0, sending: false, home: null as null | { leg: Leg; s: number }, way: [] as [number, number][], since: 0 }), [])
  useEffect(() => {
    extraVehicles.add(state.v)
    return () => {
      extraVehicles.delete(state.v)
      delivery.phase = 'none'
    }
  }, [state])

  /** Each man's clip (carrying, walking, standing), faded one into the next. */
  const play = (m: Carrier, clip: string) => {
    if (m.clip === clip) return
    const next = m.actions[clip] ?? m.actions.walk
    if (!next) return
    const prev = m.clip ? m.actions[m.clip] : null
    next.reset()
    next.play()
    next.fadeIn(0.25)
    prev?.fadeOut(0.25)
    m.clip = clip
  }

  /** The way from the truck's back to the living room, on the map. */
  const wayFrom = (d: Drive) => {
    const ux = Math.cos(d.yaw)
    const uy = Math.sin(d.yaw)
    // Behind it, a step to the kerb side (its right).
    const rx = d.x - ux * (d.len / 2 + 0.8) + uy * 0.6
    const ry = d.y - uy * (d.len / 2 + 0.8) - ux * 0.6
    return [fromMap(rx, ry), ...WAY_IN] as [number, number][]
  }

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    const p = player.current
    const v = state.v
    const pending = onTheWay()
    // A delivery to make: from the store's forecourt, the way to the house.
    if (delivery.phase === 'none') {
      if (!pending.length) return
      const [sx, sy] = storeToMap(0, -10)
      const start = roadAt(city, sx, sy)
      const [gx, gy] = toMap(0, -15.6)
      const gate = roadAt(city, gx, gy)
      if (!start || !gate) return
      const out = legBeside(city, start)
      const home = legBeside(city, gate)
      const e = city.edges[home.leg.edge]!
      // Its back by the gate (it stops with its front where it is told: its length on, and a little).
      state.stopS = Math.min(e.len - 2, home.s + truck.size.len + 0.4)
      const way = out.leg.edge === home.leg.edge && out.leg.from === home.leg.from && out.s < state.stopS ? [] : route(city, out.leg.to, home.leg.from, drives)
      if (!way) return
      v.d = startDrive(city, way.length || out.leg.edge !== home.leg.edge ? [out.leg, ...way, home.leg] : [out.leg], out.s, { ...truck.size, top: TOP }, 0)
      state.home = home
      truck.root.visible = true
      for (const door of truck.doors) door.t = 0
      delivery.phase = 'driving'
      delivery.left = 0
      delivery.carried = 0
    }
    const d = v.d
    if (!d) return
    delivery.x = d.x
    delivery.y = d.y
    const seconds = Date.now() / 1000
    const others = trafficNow.all.filter((o) => o.d !== d && Math.abs(o.box.x - d.x) < 45 && Math.abs(o.box.y - d.y) < 45)
    if (delivery.phase === 'driving' || delivery.phase === 'leaving') {
      const lastLeg = d.leg === d.legs.length - 1
      const stopAt = delivery.phase === 'driving' && lastLeg ? state.stopS - d.s : undefined
      // Far from the player (unseen, nothing round it): driven faster, it is still the same way.
      const far = !p || Math.hypot(d.x - p.x, d.y - p.y) > 250
      const steps = Math.max(1, Math.round((far ? 3 : 1) * delivery.hurry))
      let going = true
      for (let i = 0; i < steps && going; i++) going = drive(city, d, dt, { others: far ? [] : others, seconds, stopAt, eager: far })
      if (delivery.phase === 'driving' && stopAt !== undefined && stopAt < 0.8 && d.v < 0.2) {
        delivery.phase = 'parked'
        state.wait = 0
        playOnce('doorOpen', [d.x, 1.2, -d.y], 0.8)
      }
      // Back at the store (or out of sight on its way): done.
      if (delivery.phase === 'leaving' && (!going || (state.since += dt) > 60 && (!p || Math.hypot(d.x - p.x, d.y - p.y) > 120))) {
        truck.root.visible = false
        v.d = null
        delivery.phase = 'none'
        return
      }
    }
    // Pulled in: its back doors open, its men out.
    if (delivery.phase === 'parked') {
      state.wait += dt
      for (const door of truck.doors) if (!door.front) door.t = Math.min(1, state.wait / 1.5)
      if (state.wait > 1.6) {
        delivery.left = pending.length
        state.way = wayFrom(d)
        men.forEach((m, i) => {
          m.done = false
          m.carrying = false
          m.going = 1
          m.at = 0
          m.rest = 0.5 + i * 2.5
          const [u, vv] = state.way[0]!
          m.u = u
          m.v = vv
          m.root.visible = true
        })
        delivery.phase = 'unloading'
      }
    }
    if (delivery.phase === 'unloading') {
      const way = state.way
      for (const m of men) {
        if (m.done) continue
        if (m.rest > 0) {
          m.rest -= dt
          play(m, 'idle')
          // At the truck's back, his hands empty: the next carton, if any is left.
          if (m.rest <= 0 && m.going === 1 && m.at === 0) {
            if (delivery.left > 0) {
              delivery.left--
              m.carrying = true
              m.carton.visible = true
            } else {
              m.done = true
              m.root.visible = false
            }
          }
        } else {
          // Along the way (in carrying, out empty), at walking pace.
          const speed = (m.carrying ? 1.05 : 1.35) * delivery.hurry
          let step = speed * dt
          while (step > 0) {
            const next = m.at + m.going
            if (next < 0 || next >= way.length) break
            const [tu, tv] = way[next]!
            const du = tu - m.u
            const dv = tv - m.v
            const n = Math.hypot(du, dv)
            if (n <= step) {
              m.u = tu
              m.v = tv
              m.at = next
              step -= n
              continue
            }
            m.u += (du / n) * step
            m.v += (dv / n) * step
            const [ax, ay] = toMap(m.u, m.v)
            const [bx, by] = toMap(m.u + du, m.v + dv)
            m.f = Math.atan2(bx - ax, -(by - ay))
            step = 0
          }
          play(m, m.carrying ? 'carry' : 'walk')
          // In the living room: the carton put down; back out for the next.
          if (m.going === 1 && m.at === way.length - 1) {
            m.carrying = false
            m.carton.visible = false
            delivery.carried++
            m.going = -1
            m.rest = 1.2
          } else if (m.going === -1 && m.at === 0) {
            m.going = 1
            m.rest = 1.0
          }
        }
        const [x, y] = toMap(m.u, m.v)
        m.root.position.set(x, 0.05 + groundHeight(city, x, y), -y)
        let turn = m.f - m.root.rotation.y
        turn = Math.atan2(Math.sin(turn), Math.cos(turn))
        m.root.rotation.y += turn * Math.min(1, dt * 8)
        if (p && Math.hypot(x - p.x, y - p.y) < 90) m.mixer.update(dt * delivery.hurry)
      }
      delivery.men = men.map((m) => ({ at: m.at, going: m.going, carrying: m.carrying, done: m.done, u: m.u, v: m.v, x: m.root.position.x, z: m.root.position.z, seen: m.root.visible, p: p ? [p.x, p.y] : null }))
      homeStore.carriers = men.filter((m) => m.root.visible).map((m) => [m.u, m.v])
      // All carried in, the men back: the things are home (no sooner than the server allows).
      if (men.every((m) => m.done) && !state.sending) {
        const earliest = Math.max(0, ...pending.map((t) => Date.parse(t.bought_at) + 62_000))
        if (Date.now() >= earliest) {
          state.sending = true
          void (async () => {
            try {
              const reply = await callFunction<{ received: number }>('oal-home', { action: 'receive_things' })
              delivery.told = reply.ok ? 'ok' : (reply.code ?? 'refused')
              if (reply.ok) {
                for (const t of homeStore.things) if (t.arrives_at && Date.parse(t.bought_at) + 60_000 <= Date.now()) t.arrives_at = null
                changed()
                homeStore.onDelivered?.()
                if (delivery.carried > 0) toast.success(i18n.t('oal.store.delivered', { count: delivery.carried }))
              }
            } catch (e) {
              delivery.told = String(e)
              // (Not told: the server has them home on its own, a little later.)
            } finally {
              state.sending = false
              state.wait = 0
              homeStore.carriers = []
              delivery.phase = 'closing'
            }
          })()
        }
      }
    }
    // Its back doors shut, it drives back to the store.
    if (delivery.phase === 'closing') {
      state.wait += dt
      for (const door of truck.doors) if (!door.front) door.t = Math.max(0, 1 - state.wait / 1.5)
      if (state.wait > 1.8) {
        playOnce('doorClose', [d.x, 1.2, -d.y], 0.8)
        const [sx, sy] = storeToMap(0, -10)
        const target = nearestNode(city, sx, sy, drives)
        const here = d.legs[d.leg]!
        const back = target === null ? null : route(city, here.to, target, drives)
        d.legs = [...d.legs.slice(0, d.leg + 1), ...(back ?? [])]
        state.since = 0
        delivery.phase = 'leaving'
      }
    }
    poseCar(truck, d, 0.03 + groundHeight(city, d.x, d.y), dt, { x: camera.position.x, z: camera.position.z }, cityNight.value)
  })
  return <primitive object={group} />
}
