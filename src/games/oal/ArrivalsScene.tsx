// One Africa Life: an airport's arrivals hall, in 3D, walked through by the player's own
// character: Roberts International (made by scripts/oal/makeAirport.py, RIA_EXPORT) and Kotoka
// (scripts/oal/makeKotoka.py, KOTOKA_EXPORT). Each is a file (public/oal/<airport>-arrivals.v1.glb)
// and a plan (./riaArrivals.json, ./kotokaArrivals.json: the booths and e-gates, their gates, and
// every solid part as a rectangle to walk against, in the terminal's frame, u along the hall and
// v across it from the landside; here x = u and z = -v).
//
// The player walks with the thumb (or the arrow keys), the camera following behind; a drag
// elsewhere on the screen turns it. Officers stand at the staffed booths. In front of one, the
// page offers to speak to them; when that officer admits the traveller, that booth's gate opens
// and the way out (on the landside) leads into the town.
//
// Loaded only here (three.js stays out of the rest of the app).
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef } from 'react'
import { type AnimationAction, type AnimationClip, AnimationMixer, type Object3D, PMREMGenerator, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { type Appearance, defaultAppearance } from '../../../supabase/functions/_shared/oal'
import { CHARACTER_URL, prepare } from './character'
import kotoka from './kotokaArrivals.json'
import ria from './riaArrivals.json'
const WALK_SPEED = 1.45
const RADIUS = 0.28

export type Booth = { n: number; u: number; staffed: boolean; gate: string; kind?: 'booth' | 'egate' }
export type Plan = {
  length: number
  width: number
  boothV: number
  booths: Booth[]
  spawn: { u: number; v: number }
  exit: { u0: number; u1: number; v1: number }
  solids: (number | string)[][]
}
/** Each airport's arrivals hall: its file, its plan, the colour its officers wear. */
export const HALLS: Record<'ROB' | 'ACC', { url: string; plan: Plan; uniform: string }> = {
  ROB: { url: '/oal/ria-arrivals.v1.glb', plan: ria as Plan, uniform: '#1d2b55' },
  ACC: { url: '/oal/kotoka-arrivals.v1.glb', plan: kotoka as Plan, uniform: '#22304a' },
}

type Solid = [number, number, number, number, string?]
export type Stick = { x: number; y: number }

/** The booth (staffed) or e-gate the player stands before, ready to be seen. */
function boothAt(plan: Plan, u: number, v: number): number | null {
  for (const b of plan.booths) {
    const reach = b.kind === 'egate' ? 0.7 : 1.1
    if ((b.staffed || b.kind === 'egate') && Math.abs(u - b.u) < reach && v > plan.boothV + 0.75 && v < plan.boothV + 2.3) return b.n
  }
  return null
}

/** Pushes a walker (a circle) out of every solid part it overlaps. */
function collide(plan: Plan, p: { u: number; v: number }, open: string | null) {
  for (const s of plan.solids as Solid[]) {
    if (s[4] && s[4] === open) continue
    const cu = Math.max(s[0], Math.min(p.u, s[2]))
    const cv = Math.max(s[1], Math.min(p.v, s[3]))
    const du = p.u - cu
    const dv = p.v - cv
    const d = Math.hypot(du, dv)
    if (d >= RADIUS) continue
    if (d > 1e-6) {
      p.u = cu + (du / d) * RADIUS
      p.v = cv + (dv / d) * RADIUS
    } else {
      // Inside: out by the nearest side.
      const out = [p.u - s[0], s[2] - p.u, p.v - s[1], s[3] - p.v]
      const i = out.indexOf(Math.min(...out))
      if (i === 0) p.u = s[0] - RADIUS
      else if (i === 1) p.u = s[2] + RADIUS
      else if (i === 2) p.v = s[1] - RADIUS
      else p.v = s[3] + RADIUS
    }
  }
}

type Person = { root: Object3D; mixer: AnimationMixer; actions: Record<string, AnimationAction> }

function person(source: Object3D, animations: AnimationClip[], appearance: Appearance, tint?: string): Person {
  const root = clone(source)
  prepare(root).apply(appearance, { outfitTint: tint })
  const mixer = new AnimationMixer(root)
  const actions: Record<string, AnimationAction> = {}
  for (const clip of animations) actions[clip.name] = mixer.clipAction(clip)
  return { root, mixer, actions }
}

function Hall({ open, url, plan }: { open: string | null; url: string; plan: Plan }) {
  const gltf = useLoader(GLTFLoader, url, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  useFrame((_, dt) => {
    // The admitted traveller's gate swings open toward the landside.
    for (const b of plan.booths) {
      const gate = gltf.scene.getObjectByName(b.gate)
      if (!gate) continue
      const goal = b.gate === open ? -Math.PI / 2 : 0
      gate.rotation.y += (goal - gate.rotation.y) * Math.min(1, dt * 3)
    }
  })
  return <primitive object={gltf.scene} />
}

function People({ airport, appearance, stick, look, paused, open, onNear, onExit, onPosition }: Props) {
  const { plan, uniform } = HALLS[airport]
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const keys = useRef(new Set<string>())
  const state = useRef({ u: plan.spawn.u, v: plan.spawn.v, facing: 0, speed: 0, near: null as number | null, left: false, told: 0 })

  const { player, officers } = useMemo(() => {
    const player = person(gltf.scene, gltf.animations, appearance)
    player.actions.idle?.play()
    player.actions.walk?.play()
    if (player.actions.walk) player.actions.walk.weight = 0
    // The officers at the staffed booths: the same people as the player's file, in navy.
    const base = defaultAppearance(appearance.sex)
    const officers = plan.booths
      .filter((b) => b.staffed)
      .map((b, i) => {
        const look: Appearance = {
          ...base,
          skin: [0.82, 0.68, 0.9, 0.75][i % 4]!,
          build: { weight: [0.3, -0.1, 0.5, 0.1][i % 4]!, muscle: 0.1, height: [0.2, -0.3, 0.1, 0.4][i % 4]! },
          outfit: appearance.sex === 'male' ? 'suit' : 'blouse_skirt',
          hair: appearance.sex === 'male' ? (i % 2 ? 'lowcut' : 'short') : 'bun',
        }
        const officer = person(gltf.scene, gltf.animations, look, uniform)
        officer.root.position.set(b.u, 0.12, -(plan.boothV - 1.0))
        officer.root.rotation.y = Math.PI
        const action = officer.actions[i % 2 ? 'idle' : 'talk'] ?? officer.actions.idle
        action?.play()
        if (action) action.time = i * 1.7
        return officer
      })
    return { player, officers }
  }, [gltf, appearance, plan, uniform])

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
  useFrame((_, rawDt) => {
    // Real time, even on a slow phone (a long frame is walked in short steps, each against the
    // walls), up to a quarter of a second.
    const dt = Math.min(rawDt, 0.25)
    const s = state.current
    const k = keys.current
    let x = stick.current?.x ?? 0
    let y = stick.current?.y ?? 0
    if (k.has('arrowup') || k.has('w')) y = 1
    if (k.has('arrowdown') || k.has('s')) y = -1
    if (k.has('arrowleft') || k.has('a')) x = -1
    if (k.has('arrowright') || k.has('d')) x = 1
    const yaw = look.current ?? 0
    // Forward is where the camera looks; in the hall's frame, (sin yaw, -cos yaw) in (u, v).
    let du = 0
    let dv = 0
    if (!paused) {
      du = Math.sin(yaw) * y + Math.cos(yaw) * x
      dv = -Math.cos(yaw) * y + Math.sin(yaw) * x
    }
    const amount = Math.min(1, Math.hypot(du, dv))
    if (amount > 0.05) {
      const n = Math.hypot(du, dv)
      const distance = amount * WALK_SPEED * dt
      const steps = Math.ceil(distance / 0.08)
      for (let i = 0; i < steps; i++) {
        s.u += ((du / n) * distance) / steps
        s.v += ((dv / n) * distance) / steps
        collide(plan, s, open)
      }
      // Walking into the barrier beside the open gate eases the traveller into its gap, as a
      // person steering by thumb would mean.
      const gate = open ? (plan.solids as Solid[]).find((x) => x[4] === open) : undefined
      if (gate && Math.abs(s.v - plan.boothV) < 1.4) {
        const middle = (gate[0] + gate[2]) / 2
        if (Math.abs(s.u - middle) < 1.8) s.u += (middle - s.u) * Math.min(1, dt * 6)
      }
      const want = Math.atan2(du, -dv)
      let turn = want - s.facing
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      s.facing += turn * Math.min(1, dt * 10)
    }
    s.speed += (amount - s.speed) * Math.min(1, dt * 8)
    player.root.position.set(s.u, 0.12, -s.v)
    player.root.rotation.y = s.facing
    if (player.actions.walk && player.actions.idle) {
      player.actions.walk.weight = s.speed
      player.actions.idle.weight = 1 - s.speed
      player.actions.walk.timeScale = 0.6 + s.speed * 0.5
    }
    player.mixer.update(dt)
    for (const o of officers) o.mixer.update(dt)

    s.told += dt
    if (s.told > 0.3) {
      s.told = 0
      onPosition?.(s.u, s.v)
    }
    const near = boothAt(plan, s.u, s.v)
    if (near !== s.near) {
      s.near = near
      onNear(near)
    }
    if (open && !s.left && s.v < plan.exit.v1 && s.u > plan.exit.u0 && s.u < plan.exit.u1) {
      s.left = true
      onExit()
    }

    // The camera: behind and a little above, kept inside the hall and under its ceiling.
    target.set(s.u, 1.55, -s.v)
    const back = paused ? 1.6 : 3.4
    const eu = Math.max(0.6, Math.min(plan.length - 0.6, s.u - Math.sin(yaw) * back))
    // (The corridor from the planes may lie beyond the hall's airside wall.)
    const ev = Math.max(0.6, Math.min(Math.max(plan.width - 0.6, plan.spawn.v + 3), s.v + Math.cos(yaw) * back))
    eye.set(eu, paused ? 1.75 : 2.3, -ev)
    camera.position.lerp(eye, Math.min(1, dt * 5))
    camera.lookAt(target)
  })

  return (
    <>
      <primitive object={player.root} />
      {officers.map((o, i) => (
        <primitive key={i} object={o.root} />
      ))}
    </>
  )
}

/** Soft reflections, from a room made in code (no download). */
function Studio() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.6
    pmrem.dispose()
  }, [gl, scene])
  return null
}

type Props = {
  /** Which airport's hall. */
  airport: keyof typeof HALLS
  appearance: Appearance
  /** The thumb stick, -1 to 1 each way (y forward). */
  stick: RefObject<Stick>
  /** Where the camera looks, as an angle (a drag turns it). */
  look: RefObject<number>
  /** No walking while speaking to an officer. */
  paused: boolean
  /** The gate opened for the traveller (by the officer who admitted them). */
  open: string | null
  onNear: (booth: number | null) => void
  onExit: () => void
  /** Where the traveller stands (u, v), a few times a second. */
  onPosition?: (u: number, v: number) => void
}

export default function ArrivalsScene(props: Props) {
  const { url, plan } = HALLS[props.airport]
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 60, near: 0.05, far: 900, position: [plan.spawn.u, 2.3, -(plan.spawn.v + 3)] }} gl={{ antialias: true, toneMappingExposure: 1.05 }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#bcd4ea']} />
      <Studio />
      <hemisphereLight args={['#f4f6ff', '#6b6a66', 1.1]} />
      <directionalLight position={[30, 60, 40]} intensity={1.6} color="#fff3e4" />
      <ambientLight intensity={0.25} />
      <Suspense fallback={null}>
        <Hall open={props.open} url={url} plan={plan} />
        <People {...props} />
      </Suspense>
    </Canvas>
  )
}
