// One Africa Life: home, inside, in 3D (made by scripts/oal/makeHome.py: public/oal/home.v1.glb
// and ./homePlan.json): a family's house or a rented room, seen from above as a house is in a
// game, walked by the player's own character. Its places: the bed, the kitchen, the table, the
// door. Asleep, the character lies on the bed; awake, it walks. Loaded only here.
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef } from 'react'
import { PMREMGenerator, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import { person, type Stick } from './ArrivalsScene'
import { CHARACTER_URL } from './character'
import plans from './homePlan.json'

export const HOME_URL = '/oal/home.v1.glb'
export type HomeKind = 'house' | 'room'
export type HomePlace = 'bed' | 'kitchen' | 'table' | 'door'
type At = { x: number; y: number; face: number[]; z?: number; side?: number[] }
type HomePlan = { solids: number[][]; places: Record<HomePlace, At> }
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

function Home({ kind }: { kind: HomeKind }) {
  const gltf = useLoader(GLTFLoader, HOME_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const home = useMemo(() => {
    const root = gltf.scene.getObjectByName(kind)!.clone(true)
    root.position.set(0, 0, 0)
    return root
  }, [gltf, kind])
  return <primitive object={home} />
}

type Props = {
  kind: HomeKind
  appearance: Appearance
  /** Asleep: lying on the bed, not walking. */
  asleep: boolean
  stick: RefObject<Stick>
  onPlace: (place: HomePlace | null) => void
}

function Body({ kind, appearance, asleep, stick, onPlace }: Props) {
  const plan = PLANS[kind]
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const keys = useRef(new Set<string>())
  // In by the door, or out of bed.
  const start = plan.places.door
  const state = useRef({ x: start.x, y: start.y + 1.2, facing: Math.atan2(start.face[0]!, -start.face[1]!), speed: 0, place: null as HomePlace | null })
  const me = useMemo(() => {
    const p = person(gltf.scene, gltf.animations, appearance)
    p.actions.idle?.play()
    p.actions.walk?.play()
    if (p.actions.walk) p.actions.walk.weight = 0
    return p
  }, [gltf, appearance])
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
      // Up, beside the bed.
      const bed = plan.places.bed
      if (bed.side) state.current = { ...state.current, x: bed.side[0]!, y: bed.side[1]! }
    }
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
  const target = useMemo(() => new Vector3(), [])
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
        const steps = Math.ceil((amount * WALK_SPEED * dt) / 0.05)
        for (let i = 0; i < steps; i++) {
          s.x += (x / Math.hypot(x, y)) * ((amount * WALK_SPEED * dt) / steps)
          s.y += (y / Math.hypot(x, y)) * ((amount * WALK_SPEED * dt) / steps)
          collide(s, plan)
        }
        let turn = Math.atan2(x, -y) - s.facing
        turn = Math.atan2(Math.sin(turn), Math.cos(turn))
        s.facing += turn * Math.min(1, dt * 10)
      }
      s.speed += (amount - s.speed) * Math.min(1, dt * 8)
      me.root.position.set(s.x, 0.02, -s.y)
      me.root.rotation.y = s.facing
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
    // From above and to the south, as a house is seen in a game.
    const fx = asleep ? plan.places.bed.x : s.x
    const fy = asleep ? plan.places.bed.y : s.y
    target.set(fx, 0.6, -fy)
    camera.position.lerp(new Vector3(fx, 7.5, -(fy - 4.6)), Math.min(1, dt * 4))
    camera.lookAt(target)
  })
  return <primitive object={me.root} />
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
    <Canvas dpr={[1, 1.5]} camera={{ fov: 50, near: 0.1, far: 80, position: [0, 8, 5] }} gl={{ antialias: true }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#2a3050']} />
      <Sky />
      <hemisphereLight args={['#fff4e2', '#5a4a3c', 1.2]} />
      <directionalLight position={[-6, 12, 4]} intensity={1.8} color="#fff1dc" />
      <Suspense fallback={null}>
        <Home kind={props.kind} />
        <Body {...props} />
      </Suspense>
    </Canvas>
  )
}
