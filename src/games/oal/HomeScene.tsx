// One Africa Life: home in 3D (made by scripts/oal/makeHome.py: public/oal/home.v2.glb and
// ./homePlan.json): a family's house on its plot (the yard, the compound wall and gate, the
// street) or a rented room, walked by the player's own character with the camera behind, as in
// a game, kept off the walls and under the ceilings; the rooms lit by their lamps, the doors
// swinging open as the character comes to them. Its places: the bed, the kitchen, the table,
// the bathroom, the gate (out). Asleep, the character lies on the bed. Also the shops walked into
// the same way: the phone shop (its phones on show on their stands, picked up and carried to the
// counter, in the hand) and the networks' customer care offices (officers at their desks,
// customers waiting). Loaded only here.
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, type Group, LoopOnce, Matrix4, Mesh, MeshStandardMaterial, type Object3D, PMREMGenerator, Raycaster, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import { person, type Stick } from './ArrivalsScene'
import { CHARACTER_URL } from './character'
import plans from './homePlan.json'

export const HOME_URL = '/oal/home.v5.glb'
export type HomeKind = 'house' | 'room' | 'phoneshop' | 'starline' | 'citrus' | 'health'
export type HomePlace = 'bed' | 'kitchen' | 'table' | 'door' | 'bath' | 'counter' | 'desk' | 'ticket' | 'collect' | 'gate' | 'reception' | 'writing' | 'cashier'
type At = { x: number; y: number; face: number[]; z?: number; side?: number[] }
type Door = { name: string; x: number; y: number; yaw: number; swing: number; cx: number; cy: number }
/** A stand a phone is shown on (in a shop): where it stands, the way its screen faces, where to stand to look at it. */
type Display = { x: number; y: number; z: number; face: number[]; stand: number[] }
type HomePlan = {
  solids: number[][]
  places: Partial<Record<HomePlace, At>> & { door: At; bed: At }
  doors?: Door[]
  lights?: { x: number; y: number; z: number }[]
  inside?: number[][]
  ceiling?: number
  /** Staff at their work there (behind a counter or a desk), and customers sitting, waiting. */
  attendants?: At[]
  waiting?: At[]
  /** Police officers guarding the gate, in uniform. */
  guards?: At[]
  /** Where one sits: the seat, the way the sitter faces, the root's height; tight, no room in
   * front to sit down from (seated straight away). */
  seats?: Seat[]
  /** A compound's gate: its leaf, shut across the gap (solid) until opened, sliding along x. */
  gate?: { name: string; solid: number[]; slide: number }
  displays?: Display[]
}
type Seat = { x: number; y: number; face: number[]; z: number; tight?: boolean }
// How far in front of a seat the sitting-down movement starts (its hips go this far back).
const SIT_BACK = 0.47
const SEAT_NEAR = 0.75
/** A phone on show: its model, its colour, a keypad phone or a smartphone. */
export type ShownPhone = { id: string; colour: string; kind: 'basic' | 'smart' }
/** Something the character does where it stands: turned to a thing (a phone's stand, the desk's
 * fingerprint reader or camera), reaching out to it (taking, putting back, a finger on the
 * reader) or only looking. A new seq, a new gesture. */
export type Gesture = { reach: boolean; to: `display:${number}` | `place:${string}` | 'reader' | 'camera' | 'counter' | 'table'; seq: number }
/** In the hand: a phone, or a new phone in its box. */
export type Hold = { what: 'phone' | 'box'; phone: ShownPhone }
/** Lying on the shop's counter or the home's table: a phone, its box (shut, or open with the
 * phone in it), the phone on charge. */
export type Laid = { what: 'phone' | 'box' | 'open' | 'charging'; phone: ShownPhone; on: 'counter' | 'table' }
// At a network's middle desk: the fingerprint reader and the camera on its stalk.
// The phone shop's counter, where a phone is put down and its box handed over.
const MARKS: Record<string, [number, number]> = { reader: [0.5, 2.3], camera: [-0.6, 2.38], counter: [0.25, 2.1] }
// How high things lie: the shop's counter, a home's table.
const TOPS: Partial<Record<HomeKind, number>> = { phoneshop: 1.09, house: 0.77, room: 0.75 }

/** Where a home's table top is, by the place to stand at it. */
function tableAt(plan: HomePlan): [number, number] | null {
  const t = plan.places.table
  return t ? [t.x + t.face[0]! * 0.65, t.y + t.face[1]! * 0.65] : null
}
const PLANS = plans as unknown as Record<HomeKind, HomePlan>
const WALK_SPEED = 1.2
const RADIUS = 0.25
const NEAR = 1.3
const LOOK = 0.6

/** A phone as a thing: its body in its colour, its screen lit (a smartphone's the whole front, a
 * keypad phone's the top, its keys below), real size, the screen toward +z. */
export function phoneModel(p: ShownPhone, charging = false): Group {
  const smart = p.kind === 'smart'
  const [w, h, d] = smart ? [0.076, 0.162, 0.009] : [0.05, 0.118, 0.015]
  const body = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color: p.colour, roughness: 0.35, metalness: 0.3 }))
  const screenH = smart ? h * 0.92 : h * 0.36
  const screen = new Mesh(new BoxGeometry(w * 0.9, screenH, 0.001), new MeshStandardMaterial({ color: '#0a0f1e', emissive: charging ? '#2f8a4a' : smart ? '#3a6ad8' : '#8ab83a', emissiveIntensity: charging ? 0.5 : 0.9, roughness: 0.1 }))
  screen.position.set(0, smart ? 0 : h * 0.22, d / 2 + 0.0006)
  const group = body as unknown as Group
  group.userData.depth = d
  group.add(screen)
  if (!smart) {
    const keys = new Mesh(new BoxGeometry(w * 0.8, h * 0.4, 0.002), new MeshStandardMaterial({ color: '#c8c8c8', roughness: 0.5 }))
    keys.position.set(0, -h * 0.22, d / 2 + 0.001)
    group.add(keys)
  }
  return group
}

/** A phone's box: white card, the maker's colour round it, the phone pictured on its lid; open,
 * the lid off beside it and the phone in its tray. The lid toward +z. */
export function boxModel(p: ShownPhone, open = false): Group {
  const [w, h, d] = [0.1, 0.19, 0.05]
  const card = new MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.6 })
  const box = new Mesh(new BoxGeometry(w, h, open ? d - 0.01 : d), card) as unknown as Group
  box.userData.depth = d
  const band = new Mesh(new BoxGeometry(w + 0.002, 0.03, d + 0.002), new MeshStandardMaterial({ color: p.colour, roughness: 0.5 }))
  band.position.y = h * 0.32
  box.add(band)
  if (open) {
    const lid = new Mesh(new BoxGeometry(w, h, 0.01), card)
    lid.position.set(w + 0.03, 0, -d / 2 + 0.005)
    box.add(lid)
    const phone = phoneModel(p)
    phone.position.z = (d - 0.01) / 2 + 0.005
    box.add(phone)
  } else {
    const picture = new Mesh(new BoxGeometry(w * 0.6, h * 0.62, 0.002), new MeshStandardMaterial({ color: '#141418', emissive: '#1a2a6a', emissiveIntensity: 0.4 }))
    picture.position.set(0, -h * 0.06, d / 2 + 0.001)
    box.add(picture)
  }
  return box
}

/** What lies on the counter or the table, flat, its top up. */
function Lying({ laid, plan, kind }: { laid: Laid; plan: HomePlan; kind: HomeKind }) {
  const thing = useMemo(() => {
    const g = laid.what === 'phone' || laid.what === 'charging' ? phoneModel(laid.phone, laid.what === 'charging') : boxModel(laid.phone, laid.what === 'open')
    const at = laid.on === 'counter' ? MARKS.counter! : tableAt(plan)
    if (!at) return null
    const depth = (g.userData.depth as number) ?? 0.01
    g.rotation.set(-Math.PI / 2, 0, 0.4)
    g.position.set(at[0], (TOPS[kind] ?? 0.77) + depth / 2 + 0.002, -at[1])
    if (laid.what === 'charging') {
      // The charger in its socket's lead: a white plug block, and the cable to the phone.
      const plug = new Mesh(new BoxGeometry(0.04, 0.05, 0.03), new MeshStandardMaterial({ color: '#eeeeee', roughness: 0.5 }))
      plug.position.set(0.05, -0.32, 0)
      const cable = new Mesh(new BoxGeometry(0.004, 0.24, 0.004), new MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.5 }))
      cable.position.set(0.025, -0.2, 0)
      cable.rotation.z = 0.2
      g.add(plug, cable)
    }
    return g
  }, [laid, plan, kind])
  return thing ? <primitive object={thing} /> : null
}

/** The phones on show, one on each stand, but the one carried (in the hand instead). */
function Shown({ plan, shelf, carrying }: { plan: HomePlan; shelf: ShownPhone[]; carrying: string | null }) {
  const phones = useMemo(
    () =>
      (plan.displays ?? []).flatMap((d, i) => {
        const p = shelf[i]
        if (!p) return []
        const g = phoneModel(p)
        g.position.set(d.x, d.z + (p.kind === 'smart' ? 0.081 : 0.059), -d.y)
        g.rotation.order = 'YXZ'
        g.rotation.y = Math.atan2(d.face[0]!, -d.face[1]!)
        g.rotation.x = -0.28
        return [{ id: p.id, g }]
      }),
    [plan, shelf],
  )
  return (
    <>
      {phones.map(({ id, g }) => (
        <primitive key={id} object={g} visible={id !== carrying} />
      ))}
    </>
  )
}

/** Out of every rectangle (walls, furniture) the walker is in or against. */
function collide(p: { x: number; y: number }, plan: HomePlan, extra: number[][] = []) {
  for (const [x0, y0, x1, y1] of [...plan.solids, ...extra] as [number, number, number, number][]) {
    if (p.x < x0 - RADIUS || p.x > x1 + RADIUS || p.y < y0 - RADIUS || p.y > y1 + RADIUS) continue
    const left = p.x - (x0 - RADIUS)
    const right = x1 + RADIUS - p.x
    const down = p.y - (y0 - RADIUS)
    const up = y1 + RADIUS - p.y
    const m = Math.min(left, right, down, up)
    if (m === left) p.x = x0 - RADIUS
    else if (m === right) p.x = x1 + RADIUS
    else if (m === down) p.y = y0 - RADIUS
    else p.y = y1 + RADIUS
  }
}

/** The home's scene, shared with the camera (for keeping it off the walls). */
const built: { current: Object3D | null } = { current: null }
/** Where the walker is, for the doors to open to. */
const walker = { current: { x: 0, y: 0 } }

function Home({ kind, gateOpen }: { kind: HomeKind; gateOpen: boolean }) {
  const gltf = useLoader(GLTFLoader, HOME_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const plan = PLANS[kind]
  const { home, doors, gate } = useMemo(() => {
    const home = gltf.scene.getObjectByName(kind)!.clone(true)
    home.position.set(0, 0, 0)
    const doors = (plan.doors ?? []).map((d) => ({ ...d, obj: home.getObjectByName(d.name) ?? null, open: 0 }))
    const leaf = plan.gate ? home.getObjectByName(plan.gate.name) : undefined
    return { home, doors, gate: leaf ? { obj: leaf, x: leaf.position.x, open: 0 } : null }
  }, [gltf, kind, plan])
  useEffect(() => {
    built.current = home
    return () => {
      built.current = null
    }
  }, [home])
  // A door swings open as the walker comes within a step and a half of it, and shuts after.
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    for (const d of doors) {
      if (!d.obj) continue
      const near = Math.hypot(walker.current.x - d.cx, walker.current.y - d.cy) < 1.6
      d.open += ((near ? 1 : 0) - d.open) * Math.min(1, dt * 4)
      d.obj.rotation.y = d.yaw + d.swing * d.open
    }
    // The gate slides open along its rail, and shut again.
    if (gate && plan.gate) {
      gate.open += ((gateOpen ? 1 : 0) - gate.open) * Math.min(1, dt * 1.5)
      gate.obj.position.x = gate.x + plan.gate.slide * gate.open
    }
  })
  return (
    <>
      <primitive object={home} />
      {(plan.lights ?? []).map((l, i) => (
        <pointLight key={i} position={[l.x, l.z, -l.y]} intensity={6} distance={7} decay={1.6} color="#ffe9c8" />
      ))}
    </>
  )
}

type Props = {
  kind: HomeKind
  appearance: Appearance
  /** Asleep: lying on the bed, not walking. */
  asleep: boolean
  stick: RefObject<Stick>
  /** The camera's turn round the character and its tilt (radians above the floor). */
  view?: RefObject<{ yaw: number; pitch: number }>
  onPlace: (place: HomePlace | null) => void
  /** In a phone shop: the phones on show (one to a stand, in order), the one picked up, and which
   * stand the character is at (looking at the phone on it). */
  shelf?: ShownPhone[]
  carrying?: string | null
  onDisplay?: (index: number | null) => void
  gesture?: Gesture | null
  /** In the hand; lying on the counter or the table; the shop's attendant reaching to the
   * counter (to box the phone: a new seq, again). */
  hold?: Hold | null
  laid?: Laid | null
  staffSeq?: number
  /** One of the staff (by its place in the plan's attendants) reaching across its counter: a new
   * seq, again. */
  staffAct?: { index: number; seq: number } | null
  /** A compound's gate, opened by its guards. */
  gateOpen?: boolean
  /** The place is drawn (its files fetched, the character in it). */
  onReady?: () => void
  /** Seated on this seat (by its place in the plan's seats), or standing; the seat the character
   * is by (to sit on). */
  seat?: number | null
  onSeat?: (index: number | null) => void
}

function Body(props: Props) {
  const { kind, appearance, asleep, stick, view, onPlace, shelf, carrying, onDisplay, gesture, hold, laid, staffSeq, staffAct, gateOpen, seat, onSeat } = props
  const plan = PLANS[kind]
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const keys = useRef(new Set<string>())
  // In by the door, or out of bed.
  const start = plan.places.door
  const state = useRef({ x: start.x + start.face[0]! * 0.8, y: start.y + start.face[1]! * 0.8, facing: Math.atan2(start.face[0]!, -start.face[1]!), speed: 0, place: null as HomePlace | null })
  const me = useMemo(() => {
    const p = person(gltf.scene, gltf.animations, appearance)
    p.actions.idle?.play()
    p.actions.walk?.play()
    if (p.actions.walk) p.actions.walk.weight = 0
    return p
  }, [gltf, appearance])
  // People at their work there (the shop's attendant behind the counter, the officers at their
  // desks), facing the room; customers sitting, waiting their turn. Each their own skin and
  // clothes.
  const others = useMemo(() => {
    const skins = [0.85, 0.7, 0.9, 0.6, 0.78, 0.95, 0.66]
    const outfits = appearance.sex === 'male' ? ['shirt_jeans', 'tee_jeans'] : ['blouse_skirt', 'tee_jeans']
    const make = (at: At, k: number, sitting: boolean, uniform?: string) => {
      const outfit = uniform ? (appearance.sex === 'male' ? 'suit' : 'blouse_skirt') : outfits[k % outfits.length]!
      const p = person(gltf.scene, gltf.animations, { ...appearance, skin: skins[k % skins.length]!, outfit }, uniform)
      if (sitting) {
        ;(p.actions.sit ?? p.actions.idle)?.play()
        p.mixer.update(0.4 + k * 0.3)
      } else (p.actions.talk ?? p.actions.idle)?.play()
      p.root.position.set(at.x, sitting ? -0.02 : 0.02, -at.y)
      p.root.rotation.y = Math.atan2(at.face[0]!, -at.face[1]!)
      return { p, sitting }
    }
    return [
      ...(plan.attendants ?? []).map((at, k) => make(at, k, false)),
      ...(plan.waiting ?? []).map((at, k) => make(at, k + 3, true)),
      // The Liberia National Police's dark blue.
      ...(plan.guards ?? []).map((at, k) => make(at, k + 1, false, '#1a2440')),
    ]
  }, [gltf, appearance, plan])
  // What is in the right hand.
  const held = useMemo(() => (hold ? (hold.what === 'box' ? boxModel(hold.phone) : phoneModel(hold.phone)) : null), [hold])
  // One of the staff reaching to the counter: boxing the phone, taking a form, handing over.
  const reachBy = staffAct ?? (staffSeq ? { index: 0, seq: staffSeq } : null)
  useEffect(() => {
    const staff = reachBy ? others[reachBy.index]?.p : undefined
    const pick = staff?.actions.pick
    if (!reachBy || !staff || !pick) return
    const talk = staff.actions.talk ?? staff.actions.idle
    talk?.stop()
    pick.reset()
    pick.setLoop(LoopOnce, 1)
    pick.clampWhenFinished = true
    pick.play()
    const id = setTimeout(() => {
      pick.stop()
      talk?.play()
    }, pick.getClip().duration * 1000)
    return () => clearTimeout(id)
  }, [reachBy?.seq, reachBy?.index, others])
  // The right hand and its fingers' roots: the phone lies in the palm, its back to it, along the
  // fingers, its screen out.
  const bones = useMemo(() => {
    const find = (end: string) => {
      let found: Object3D | null = null
      me.root.traverse((o) => {
        if (!found && o.name.endsWith(end)) found = o
      })
      return found as Object3D | null
    }
    return { hand: find('RightHand'), middle: find('RightHandMiddle1'), index: find('RightHandIndex1'), pinky: find('RightHandPinky1'), thumb: find('RightHandThumb1') }
  }, [me])
  const grip = useMemo(() => ({ h: new Vector3(), m: new Vector3(), i: new Vector3(), p: new Vector3(), t: new Vector3(), x: new Vector3(), y: new Vector3(), z: new Vector3(), m4: new Matrix4() }), [])
  const display = useRef<number | null>(null)
  // A gesture under way: until when (on this scene's clock), the way to face, the reach.
  const clock = useRef(0)
  const doing = useRef<{ until: number; yaw: number; reach: boolean } | null>(null)
  useEffect(() => {
    if (!gesture) return
    const s = state.current
    const d = gesture.to.startsWith('display:') ? plan.displays?.[Number(gesture.to.slice(8))] : undefined
    const spot = gesture.to.startsWith('place:') ? plan.places[gesture.to.slice(6) as HomePlace] : undefined
    const [tx, ty] = d
      ? [d.x, d.y]
      : spot
        ? [spot.x + spot.face[0]! * 0.8, spot.y + spot.face[1]! * 0.8]
        : ((gesture.to === 'table' ? tableAt(plan) : MARKS[gesture.to as string]) ?? [s.x, s.y + 1])
    const pick = me.actions.pick
    let length = 0.9
    if (gesture.reach && pick) {
      pick.reset()
      pick.setLoop(LoopOnce, 1)
      pick.clampWhenFinished = true
      pick.weight = 1
      pick.play()
      length = pick.getClip().duration
    }
    doing.current = { until: clock.current + length, yaw: Math.atan2(tx - s.x, -(ty - s.y)), reach: gesture.reach && Boolean(pick) }
  }, [gesture, me, plan])
  // Sitting down and standing up: from in front of the seat, the hips back onto it (or straight
  // onto a seat with no room in front), then the seated pose; up again, a step forward.
  const sitting = useRef<{ index: number; phase: 'down' | 'sat' | 'up'; until: number } | null>(null)
  const nearSeat = useRef<number | null>(null)
  const playOnce = (name: string) => {
    const a = me.actions[name]
    if (!a) return 0
    a.reset()
    a.setLoop(LoopOnce, 1)
    a.clampWhenFinished = true
    a.weight = 1
    a.play()
    return a.getClip().duration
  }
  useEffect(() => {
    const s = state.current
    const seats = plan.seats ?? []
    const was = sitting.current
    if (seat !== null && seat !== undefined && seats[seat] && was?.index !== seat) {
      const at = seats[seat]!
      s.facing = Math.atan2(at.face[0]!, -at.face[1]!)
      if (at.tight || !me.actions.sitDown) {
        s.x = at.x
        s.y = at.y
        me.actions.sit?.reset().play()
        sitting.current = { index: seat, phase: 'sat', until: 0 }
      } else {
        s.x = at.x + at.face[0]! * SIT_BACK
        s.y = at.y + at.face[1]! * SIT_BACK
        sitting.current = { index: seat, phase: 'down', until: clock.current + playOnce('sitDown') }
      }
    } else if ((seat === null || seat === undefined) && was && was.phase !== 'up') {
      const at = seats[was.index]!
      me.actions.sit?.stop()
      if (at.tight || !me.actions.standUp) {
        s.x = at.x + at.face[0]! * 0.6
        s.y = at.y + at.face[1]! * 0.6
        sitting.current = null
      } else {
        s.x = at.x
        s.y = at.y
        sitting.current = { index: was.index, phase: 'up', until: clock.current + playOnce('standUp') }
      }
    }
  }, [seat, me, plan])
  // Asleep: on the bed, lying the way it lies, the sleeping movement only.
  useEffect(() => {
    const sleep = me.actions.sleep
    if (asleep) {
      for (const a of Object.values(me.actions)) a.stop()
      sleep?.play()
    } else {
      sleep?.stop()
      me.actions.idle?.play()
      me.actions.walk?.play()
      if (me.actions.walk) me.actions.walk.weight = 0
      // Woken (not when the home first opens): up, beside the bed.
      const bed = plan.places.bed
      if (wasAsleep.current && bed.side) state.current = { ...state.current, x: bed.side[0]!, y: bed.side[1]! }
    }
    wasAsleep.current = asleep
  }, [asleep, me, plan])
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
  const wasAsleep = useRef(asleep)
  // Here (the Suspense above has its files): drawn from the next frame.
  useEffect(() => {
    const id = requestAnimationFrame(() => props.onReady?.())
    return () => cancelAnimationFrame(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const target = useMemo(() => new Vector3(), [])
  const want = useMemo(() => new Vector3(), [])
  const ray = useMemo(() => new Raycaster(), [])
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.25)
    const s = state.current
    if (asleep) {
      const bed = plan.places.bed
      // Lying along the bed, the head to its head end (the sleeping movement lies across the
      // character's own facing).
      me.root.position.set(bed.x, bed.z ?? 0.55, -bed.y)
      me.root.rotation.y = Math.atan2(bed.face[1]!, -bed.face[0]!) + Math.PI / 2
    } else {
      // The stick and the keys move on the map as the camera sees it: up is north (away), right east.
      let x = stick.current?.x ?? 0
      let y = stick.current?.y ?? 0
      const k = keys.current
      if (k.has('arrowup') || k.has('w')) y = 1
      if (k.has('arrowdown') || k.has('s')) y = -1
      if (k.has('arrowleft') || k.has('a')) x = -1
      if (k.has('arrowright') || k.has('d')) x = 1
      clock.current += dt
      const sat = sitting.current
      if (sat && sat.phase !== 'sat' && clock.current >= sat.until) {
        const at = plan.seats![sat.index]!
        if (sat.phase === 'down') {
          me.actions.sitDown?.stop()
          s.x = at.x
          s.y = at.y
          me.actions.sit?.reset().play()
          sitting.current = { ...sat, phase: 'sat' }
        } else {
          me.actions.standUp?.stop()
          s.x = at.x + at.face[0]! * (SIT_BACK + 0.01)
          s.y = at.y + at.face[1]! * (SIT_BACK + 0.01)
          sitting.current = null
        }
      }
      const busy = doing.current
      if (busy && clock.current >= busy.until) {
        if (busy.reach) me.actions.pick?.stop()
        doing.current = null
      }
      if (sitting.current) {
        x = 0
        y = 0
      }
      if (doing.current) {
        x = 0
        y = 0
        let turn = doing.current.yaw - s.facing
        turn = Math.atan2(Math.sin(turn), Math.cos(turn))
        s.facing += turn * Math.min(1, dt * 8)
      }
      const amount = Math.min(1, Math.hypot(x, y))
      if (amount > 0.05) {
        // As the camera faces: up on the stick is away from it, right is its right.
        const yaw = view?.current?.yaw ?? 0
        const mx = x * Math.cos(yaw) - y * Math.sin(yaw)
        const my = x * Math.sin(yaw) + y * Math.cos(yaw)
        const n = Math.hypot(mx, my)
        const steps = Math.ceil((amount * WALK_SPEED * dt) / 0.05)
        for (let i = 0; i < steps; i++) {
          s.x += (mx / n) * ((amount * WALK_SPEED * dt) / steps)
          s.y += (my / n) * ((amount * WALK_SPEED * dt) / steps)
          collide(s, plan, plan.gate && !gateOpen ? [plan.gate.solid] : [])
        }
        let turn = Math.atan2(mx, -my) - s.facing
        turn = Math.atan2(Math.sin(turn), Math.cos(turn))
        s.facing += turn * Math.min(1, dt * 10)
      }
      s.speed += (amount - s.speed) * Math.min(1, dt * 8)
      const seated = sitting.current
      // On the seat (and its height) while seated; on the floor sitting down and standing up.
      const lift = seated?.phase === 'sat' ? (plan.seats![seated.index]!.z ?? 0) : seated ? (plan.seats![seated.index]!.z ?? 0) * 0.5 : 0
      me.root.position.set(s.x, 0.02 + lift, -s.y)
      me.root.rotation.y = s.facing
      // The seat the character is by, standing (to sit on).
      let by: number | null = null
      if (!seated && !doing.current)
        (plan.seats ?? []).forEach((at, i) => {
          const fx = at.x + at.face[0]! * (at.tight ? 0.3 : SIT_BACK)
          const fy = at.y + at.face[1]! * (at.tight ? 0.3 : SIT_BACK)
          if (Math.hypot(s.x - fx, s.y - fy) < SEAT_NEAR && (by === null || Math.hypot(s.x - fx, s.y - fy) < Math.hypot(s.x - plan.seats![by]!.x, s.y - plan.seats![by]!.y))) by = i
        })
      if (by !== nearSeat.current) {
        nearSeat.current = by
        onSeat?.(by)
      }
      walker.current = { x: s.x, y: s.y }
      if (me.actions.walk && me.actions.idle) {
        const reaching = doing.current?.reach || sitting.current ? 1 : 0
        me.actions.walk.weight = s.speed * (1 - reaching)
        me.actions.idle.weight = (1 - s.speed) * (1 - reaching)
      }
      let near: HomePlace | null = null
      for (const [name, at] of Object.entries(plan.places) as [HomePlace, At][]) {
        // (Shops and offices have no bed: the plan's is a stand-in.)
        if (name === 'bed' && kind !== 'house' && kind !== 'room') continue
        const spot = name === 'bed' && at.side ? { x: at.side[0]!, y: at.side[1]! } : at
        if (Math.hypot(s.x - spot.x, s.y - spot.y) < NEAR) near = name
      }
      if (near !== s.place) {
        s.place = near
        onPlace(near)
      }
      // At a stand, looking at the phone on it.
      let at: number | null = null
      ;(plan.displays ?? []).forEach((d, i) => {
        if (shelf?.[i] && Math.hypot(s.x - d.stand[0]!, s.y - d.stand[1]!) < LOOK) at = i
      })
      if (at !== display.current) {
        display.current = at
        onDisplay?.(at)
      }
    }
    me.mixer.update(dt)
    for (const o of others) if (!o.sitting) o.p.mixer.update(dt)
    const { hand, middle, index, pinky, thumb } = bones
    if (held && hand && middle && index && pinky && thumb) {
      const g = grip
      me.root.updateMatrixWorld(true)
      hand.getWorldPosition(g.h)
      middle.getWorldPosition(g.m)
      index.getWorldPosition(g.i)
      pinky.getWorldPosition(g.p)
      thumb.getWorldPosition(g.t)
      // Along the fingers (y), across the knuckles, out of the palm (z: the thumb's side).
      g.y.subVectors(g.m, g.h).normalize()
      g.x.subVectors(g.i, g.p).normalize()
      g.z.crossVectors(g.x, g.y).normalize()
      if (g.t.sub(g.h).dot(g.z) < 0) g.z.negate()
      g.x.crossVectors(g.y, g.z).normalize()
      const depth = (held.userData.depth as number) ?? 0.01
      g.m4.makeBasis(g.x, g.y, g.z)
      g.m4.setPosition(g.h.addScaledVector(g.y, 0.065).addScaledVector(g.z, depth / 2 + 0.014))
      held.matrixAutoUpdate = false
      held.matrix.copy(g.m4)
      held.matrixWorldNeedsUpdate = true
    }
    // From above and to the south, as a house is seen in a game.
    const fx = asleep ? plan.places.bed.x : s.x
    const fy = asleep ? plan.places.bed.y : s.y
    // Behind the character at a turn and a tilt, as in a game: in the house a few steps back and
    // under the ceiling, outside farther; never through a wall (pulled in to what is between).
    const turnBy = view?.current?.yaw ?? 0
    const tilt = view?.current?.pitch ?? 0.35
    const indoors = (plan.inside ?? []).some(([x0, y0, x1, y1]) => fx > x0! && fx < x1! && fy > y0! && fy < y1!)
    const dist = asleep ? 3.2 : indoors ? 3.3 : 4.6
    // A wider view indoors, as a game has it (the rooms are small).
    const fov = indoors ? 72 : 60
    if ((camera as { fov?: number }).fov !== fov) {
      ;(camera as unknown as { fov: number; updateProjectionMatrix: () => void }).fov = fov
      ;(camera as unknown as { updateProjectionMatrix: () => void }).updateProjectionMatrix()
    }
    const flatDist = Math.cos(tilt) * dist
    target.set(fx, asleep ? 0.6 : sitting.current?.phase === 'sat' ? 1.05 : 1.45, -fy)
    want.set(fx + Math.sin(turnBy) * flatDist, target.y + Math.sin(tilt) * dist, -(fy - Math.cos(turnBy) * flatDist))
    if (indoors && plan.ceiling) want.y = Math.min(want.y, plan.ceiling - 0.25)
    if (built.current) {
      ray.set(target, want.clone().sub(target).normalize())
      ray.far = target.distanceTo(want)
      // What is solid between (not glass, not the mosquito net: whatever can be seen through).
      const hit = ray.intersectObject(built.current, true).find((h) => {
        const m = (h.object as unknown as { material?: { transparent?: boolean } }).material
        return h.distance > 0.2 && !(m && !Array.isArray(m) && m.transparent)
      })
      if (hit) {
        const back = hit.distance - 0.25
        const dir = want.clone().sub(target).normalize()
        if (back >= 1.6) want.copy(target).add(dir.multiplyScalar(back))
        else {
          // No room behind: up under the ceiling (or over the head outside), a little behind,
          // looking down on the character, never in on them.
          dir.y = 0
          dir.normalize()
          want.copy(target).add(dir.multiplyScalar(Math.max(0.5, back)))
          want.y = indoors && plan.ceiling ? plan.ceiling - 0.12 : target.y + 2.4
        }
      }
    }
    // Ever so close (a corner): the character not drawn, rather than filling the view.
    me.root.visible = camera.position.distanceTo(target) > 0.7 || asleep
    camera.position.lerp(want, Math.min(1, dt * 6))
    camera.lookAt(target)
  })
  return (
    <>
      <primitive object={me.root} />
      {others.map((o, i) => (
        <primitive key={i} object={o.p.root} />
      ))}
      {held && <primitive object={held} />}
      {laid && <Lying laid={laid} plan={plan} kind={kind} />}
      {plan.displays && shelf && <Shown plan={plan} shelf={shelf} carrying={carrying ?? null} />}
    </>
  )
}

function Sky() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.6
    pmrem.dispose()
  }, [gl, scene])
  return null
}

export default function HomeScene(props: Props) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 60, near: 0.05, far: 160, position: [0, 3, 14] }} gl={{ antialias: true }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#a9c9ea']} />
      <fog attach="fog" args={['#c4d6e6', 40, 120]} />
      <Sky />
      <hemisphereLight args={['#eaf2ff', '#7a5a3c', 0.9]} />
      <directionalLight position={[-30, 50, 20]} intensity={2.0} color="#fff1dc" />
      <Suspense fallback={null}>
        <Home kind={props.kind} gateOpen={props.gateOpen ?? false} />
        <Body {...props} />
      </Suspense>
    </Canvas>
  )
}
