// One Africa Life: home in 3D (made by scripts/oal/makeHome.py: public/oal/home.v2.glb and
// ./homePlan.json): a family's house on its plot (the yard, the compound wall and gate, the
// street) or a rented room, walked by the player's own character with the camera behind, as in
// a game, kept off the walls and under the ceilings; the rooms lit by their lamps, the doors
// swinging open as the character comes to them. Its places: the bed, the kitchen, the table,
// the bathroom, the gate (out). Asleep, the character lies on the bed. Loaded only here.
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef } from 'react'
import { type Object3D, PMREMGenerator, Raycaster, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import { person, type Stick } from './ArrivalsScene'
import { CHARACTER_URL } from './character'
import plans from './homePlan.json'

export const HOME_URL = '/oal/home.v3.glb'
export type HomeKind = 'house' | 'room' | 'phoneshop'
export type HomePlace = 'bed' | 'kitchen' | 'table' | 'door' | 'bath' | 'counter'
type At = { x: number; y: number; face: number[]; z?: number; side?: number[] }
type Door = { name: string; x: number; y: number; yaw: number; swing: number; cx: number; cy: number }
type HomePlan = { solids: number[][]; places: Partial<Record<HomePlace, At>> & { door: At; bed: At }; doors?: Door[]; lights?: { x: number; y: number; z: number }[]; inside?: number[][]; ceiling?: number; attendant?: At }
const PLANS = plans as unknown as Record<HomeKind, HomePlan>
const WALK_SPEED = 1.2
const RADIUS = 0.25
const NEAR = 1.3

/** Out of every rectangle (walls, furniture) the walker is in or against. */
function collide(p: { x: number; y: number }, plan: HomePlan) {
  for (const [x0, y0, x1, y1] of plan.solids as [number, number, number, number][]) {
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

function Home({ kind }: { kind: HomeKind }) {
  const gltf = useLoader(GLTFLoader, HOME_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const plan = PLANS[kind]
  const { home, doors } = useMemo(() => {
    const home = gltf.scene.getObjectByName(kind)!.clone(true)
    home.position.set(0, 0, 0)
    const doors = (plan.doors ?? []).map((d) => ({ ...d, obj: home.getObjectByName(d.name) ?? null, open: 0 }))
    return { home, doors }
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
}

function Body({ kind, appearance, asleep, stick, view, onPlace }: Props) {
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
  // Someone at their work there (the shop's attendant behind the counter), facing the room.
  const staff = useMemo(() => {
    const at = plan.attendant
    if (!at) return null
    const p = person(gltf.scene, gltf.animations, { ...appearance, skin: 0.85, outfit: appearance.sex === 'male' ? 'shirt_jeans' : 'blouse_skirt' })
    ;(p.actions.talk ?? p.actions.idle)?.play()
    p.root.position.set(at.x, 0.02, -at.y)
    p.root.rotation.y = Math.atan2(at.face[0]!, -at.face[1]!)
    return p
  }, [gltf, appearance, plan])
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
          collide(s, plan)
        }
        let turn = Math.atan2(mx, -my) - s.facing
        turn = Math.atan2(Math.sin(turn), Math.cos(turn))
        s.facing += turn * Math.min(1, dt * 10)
      }
      s.speed += (amount - s.speed) * Math.min(1, dt * 8)
      me.root.position.set(s.x, 0.02, -s.y)
      me.root.rotation.y = s.facing
      walker.current = { x: s.x, y: s.y }
      if (me.actions.walk && me.actions.idle) {
        me.actions.walk.weight = s.speed
        me.actions.idle.weight = 1 - s.speed
      }
      let near: HomePlace | null = null
      for (const [name, at] of Object.entries(plan.places) as [HomePlace, At][]) {
        const spot = name === 'bed' && at.side ? { x: at.side[0]!, y: at.side[1]! } : at
        if (Math.hypot(s.x - spot.x, s.y - spot.y) < NEAR) near = name
      }
      if (near !== s.place) {
        s.place = near
        onPlace(near)
      }
    }
    me.mixer.update(dt)
    staff?.mixer.update(dt)
    // From above and to the south, as a house is seen in a game.
    const fx = asleep ? plan.places.bed.x : s.x
    const fy = asleep ? plan.places.bed.y : s.y
    // Behind the character at a turn and a tilt, as in a game: in the house a few steps back and
    // under the ceiling, outside farther; never through a wall (pulled in to what is between).
    const turnBy = view?.current?.yaw ?? 0
    const tilt = view?.current?.pitch ?? 0.35
    const indoors = (plan.inside ?? []).some(([x0, y0, x1, y1]) => fx > x0! && fx < x1! && fy > y0! && fy < y1!)
    const dist = asleep ? 3.2 : indoors ? 2.7 : 4.2
    const flatDist = Math.cos(tilt) * dist
    target.set(fx, asleep ? 0.6 : 1.45, -fy)
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
        const back = Math.max(0.3, hit.distance - 0.25)
        want.copy(target).add(want.clone().sub(target).normalize().multiplyScalar(back))
        // Too close behind to see past the character: up over its shoulder instead.
        if (back < 1.2) want.y = Math.min(target.y + 0.9, (indoors && plan.ceiling ? plan.ceiling - 0.25 : target.y + 0.9))
      }
    }
    camera.position.lerp(want, Math.min(1, dt * 6))
    camera.lookAt(target)
  })
  return (
    <>
      <primitive object={me.root} />
      {staff && <primitive object={staff.root} />}
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
        <Home kind={props.kind} />
        <Body {...props} />
      </Suspense>
    </Canvas>
  )
}
