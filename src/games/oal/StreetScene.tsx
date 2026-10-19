// One Africa Life: Tubman Boulevard in Sinkor, Monrovia, in 3D, walked by the player's own
// character. Made by scripts/oal/makeStreet.py (STREET_EXPORT) from the real map: the street
// (public/oal/sinkor-street.v2.glb) and its plan (./sinkorStreet.json, metres east (x) and north
// (y) of the junction with 16th Street; here x = x and z = -y): every building, compound wall,
// kiosk, palm and pole as a shape to walk against, and the places on the street: Ma Hawa
// Cookshop, the phone shop, the money changer, the kekeh stop, the clinic. Standing at one, the
// page offers what can be done there. Other players out on the street walk it too.
//
// Loaded only here (three.js stays out of the rest of the app).
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useEffect, useMemo, useRef } from 'react'
import { PMREMGenerator, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type Appearance, defaultAppearance } from '../../../supabase/functions/_shared/oal'
import { person, type Stick } from './ArrivalsScene'
import { CHARACTER_URL } from './character'
import street from './sinkorStreet.json'

export const STREET_URL = '/oal/sinkor-street.v2.glb'
export type Place = 'cookshop' | 'phone' | 'changer' | 'kekeh' | 'clinic'
const WALK_SPEED = 1.45
const RADIUS = 0.3
const NEAR = 2.6

type Point = { x: number; y: number }
type Poly = { points: number[][]; minX: number; maxX: number; minY: number; maxY: number }
const POLYS: Poly[] = (street.solids as number[][][]).map((points) => ({
  points,
  minX: Math.min(...points.map((q) => q[0]!)) - 1,
  maxX: Math.max(...points.map((q) => q[0]!)) + 1,
  minY: Math.min(...points.map((q) => q[1]!)) - 1,
  maxY: Math.max(...points.map((q) => q[1]!)) + 1,
}))
const PLACES = street.places as Record<Place, { x: number; y: number; face: number[] }>

/** The yaw that looks along a direction on the map (forward is (sin yaw, -cos yaw) in x, y). */
export const yawFacing = (face: number[]) => Math.atan2(face[0]!, -face[1]!)
export const SPAWN_YAW = yawFacing(street.spawn.face)

function inside(p: Point, poly: number[][]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as [number, number]
    const [xj, yj] = poly[j] as [number, number]
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** Pushes a walker (a circle) out of every shape it overlaps, and keeps it within the street. */
function collide(p: Point) {
  for (const poly of POLYS) {
    if (p.x < poly.minX || p.x > poly.maxX || p.y < poly.minY || p.y > poly.maxY) continue
    let best = Infinity
    let cx = 0
    let cy = 0
    const pts = poly.points
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j] as [number, number]
      const [bx, by] = pts[i] as [number, number]
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)))
      const qx = ax + dx * t
      const qy = ay + dy * t
      const d = Math.hypot(p.x - qx, p.y - qy)
      if (d < best) {
        best = d
        cx = qx
        cy = qy
      }
    }
    const within = inside(p, pts)
    if (!within && best >= RADIUS) continue
    // Out by the nearest edge (through it, if inside).
    let nx = p.x - cx
    let ny = p.y - cy
    const len = Math.hypot(nx, ny) || 1
    nx /= len
    ny /= len
    if (within) {
      nx = -nx
      ny = -ny
    }
    p.x = cx + nx * RADIUS
    p.y = cy + ny * RADIUS
  }
  const reach = street.reach - 4
  const r = Math.hypot(p.x, p.y)
  if (r > reach) {
    p.x *= reach / r
    p.y *= reach / r
  }
}

function placeAt(p: Point): Place | null {
  for (const [name, at] of Object.entries(PLACES) as [Place, (typeof PLACES)[Place]][]) {
    if (Math.hypot(p.x - at.x, p.y - at.y) < NEAR) return name
  }
  return null
}

function Street() {
  const gltf = useLoader(GLTFLoader, STREET_URL, (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  return <primitive object={gltf.scene} />
}

/** Another player out on the street: drawn walking toward where they last said they were. */
function Other({ entry }: { entry: OtherPlayer }) {
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(entry.appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const them = useMemo(() => {
    const p = person(gltf.scene, gltf.animations, entry.appearance)
    p.actions.idle?.play()
    p.actions.walk?.play()
    if (p.actions.walk) p.actions.walk.weight = 0
    p.root.position.set(entry.x, 0.05, -entry.y)
    return p
  }, [gltf, entry.appearance]) // eslint-disable-line react-hooks/exhaustive-deps
  const speed = useRef(0)
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.25)
    const pos = them.root.position
    const dx = entry.x - pos.x
    const dz = -entry.y - pos.z
    const far = Math.hypot(dx, dz)
    // Far behind (a jump, a slow phone): there at once; else walking there.
    if (far > 6) pos.set(entry.x, 0.05, -entry.y)
    else if (far > 0.02) {
      const step = Math.min(far, WALK_SPEED * 1.2 * dt)
      pos.x += (dx / far) * step
      pos.z += (dz / far) * step
    }
    const moving = far > 0.05 || entry.m
    speed.current += ((moving ? 1 : 0) - speed.current) * Math.min(1, dt * 8)
    let turn = entry.f - them.root.rotation.y
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    them.root.rotation.y += turn * Math.min(1, dt * 8)
    if (them.actions.walk && them.actions.idle) {
      them.actions.walk.weight = speed.current
      them.actions.idle.weight = 1 - speed.current
    }
    them.mixer.update(dt)
  })
  return <primitive object={them.root} />
}

function People({ appearance, stick, look, paused, onPlace, onPosition }: Props) {
  const gltf = useLoader(GLTFLoader, CHARACTER_URL(appearance.sex), (loader) => loader.setMeshoptDecoder(MeshoptDecoder))
  const { camera } = useThree()
  const keys = useRef(new Set<string>())
  // Arriving a few steps apart along the shoulder, so two players never stand in one another.
  const state = useRef(
    (() => {
      const along = (Math.random() - 0.5) * 6
      const f = street.spawn.face
      return { x: street.spawn.x + f[0]! * along, y: street.spawn.y + f[1]! * along, facing: SPAWN_YAW, speed: 0, place: null as Place | null, told: 0 }
    })(),
  )

  const { player, locals } = useMemo(() => {
    const player = person(gltf.scene, gltf.animations, appearance)
    player.actions.idle?.play()
    player.actions.walk?.play()
    if (player.actions.walk) player.actions.walk.weight = 0
    // People at the places, standing at their work and facing the street: the cook, the man at
    // the phone shop, the changer, a kekeh rider. (From the same file as the player.)
    const base = defaultAppearance(appearance.sex)
    const looks: [Place, Partial<Appearance>, string][] = [
      ['cookshop', { skin: 0.85, build: { weight: 0.5, muscle: 0, height: -0.2 }, outfit: appearance.sex === 'male' ? 'tee_jeans' : 'blouse_skirt' }, 'talk'],
      ['phone', { skin: 0.7, build: { weight: -0.1, muscle: 0.2, height: 0.2 }, outfit: appearance.sex === 'male' ? 'shirt_jeans' : 'tee_jeans' }, 'idle'],
      ['changer', { skin: 0.9, build: { weight: 0.2, muscle: 0.3, height: 0.1 }, outfit: appearance.sex === 'male' ? 'jacket_jeans' : 'sport' }, 'talk'],
      ['kekeh', { skin: 0.78, build: { weight: -0.2, muscle: 0.4, height: 0 }, outfit: appearance.sex === 'male' ? 'tee_jeans' : 'tee_shorts' }, 'idle'],
    ]
    const locals = looks.map(([place, patch, clip], i) => {
      const at = PLACES[place]
      const local = person(gltf.scene, gltf.animations, { ...base, ...patch, build: { ...base.build, ...patch.build } })
      // A step from where the player stops, toward the kiosk, looking back at the street.
      const x = at.x + at.face[0]! * 1.1
      const y = at.y + at.face[1]! * 1.1
      local.root.position.set(x, 0.05, -y)
      local.root.rotation.y = Math.atan2(-at.face[0]!, at.face[1]!)
      const action = local.actions[clip] ?? local.actions.idle
      action?.play()
      if (action) action.time = i * 1.3
      return local
    })
    return { player, locals }
  }, [gltf, appearance])

  // The camera starts looking along the street.
  useEffect(() => {
    if (look.current === null) (look as { current: number | null }).current = SPAWN_YAW
  }, [look])
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
    // Real time, even on a slow phone (a long frame walked in short steps), up to a quarter second.
    const dt = Math.min(rawDt, 0.25)
    const s = state.current
    const k = keys.current
    let x = stick.current?.x ?? 0
    let y = stick.current?.y ?? 0
    if (k.has('arrowup') || k.has('w')) y = 1
    if (k.has('arrowdown') || k.has('s')) y = -1
    if (k.has('arrowleft') || k.has('a')) x = -1
    if (k.has('arrowright') || k.has('d')) x = 1
    const yaw = look.current ?? SPAWN_YAW
    let dx = 0
    let dy = 0
    if (!paused) {
      dx = Math.sin(yaw) * y + Math.cos(yaw) * x
      dy = -Math.cos(yaw) * y + Math.sin(yaw) * x
    }
    const amount = Math.min(1, Math.hypot(dx, dy))
    if (amount > 0.05) {
      const n = Math.hypot(dx, dy)
      const distance = amount * WALK_SPEED * dt
      const steps = Math.ceil(distance / 0.08)
      for (let i = 0; i < steps; i++) {
        s.x += ((dx / n) * distance) / steps
        s.y += ((dy / n) * distance) / steps
        collide(s)
      }
      const want = Math.atan2(dx, -dy)
      let turn = want - s.facing
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      s.facing += turn * Math.min(1, dt * 10)
    }
    s.speed += (amount - s.speed) * Math.min(1, dt * 8)
    player.root.position.set(s.x, 0.05, -s.y)
    player.root.rotation.y = s.facing
    if (player.actions.walk && player.actions.idle) {
      player.actions.walk.weight = s.speed
      player.actions.idle.weight = 1 - s.speed
      player.actions.walk.timeScale = 0.6 + s.speed * 0.5
    }
    player.mixer.update(dt)
    for (const l of locals) l.mixer.update(dt)

    s.told += dt
    if (s.told > 0.25) {
      s.told = 0
      onPosition?.(s.x, s.y, s.facing, s.speed > 0.2)
    }
    const place = placeAt(s)
    if (place !== s.place) {
      s.place = place
      onPlace(place)
    }

    // The camera: behind and a little above.
    target.set(s.x, 1.55, -s.y)
    const back = paused ? 2.0 : 3.6
    eye.set(s.x - Math.sin(yaw) * back, paused ? 1.8 : 2.4, -(s.y + Math.cos(yaw) * back))
    camera.position.lerp(eye, Math.min(1, dt * 5))
    camera.lookAt(target)
  })

  return (
    <>
      <primitive object={player.root} />
      {locals.map((l, i) => (
        <primitive key={i} object={l.root} />
      ))}
    </>
  )
}

/** Soft light all round, from a room made in code (no download). */
function Sky() {
  const { gl, scene } = useThree()
  useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.45
    pmrem.dispose()
  }, [gl, scene])
  return null
}

/** Another player, as they last said: how they look, where they are, which way, walking or not. */
export type OtherPlayer = { name: string; appearance: Appearance; x: number; y: number; f: number; m: boolean }

type Props = {
  appearance: Appearance
  /** The others out on the street, by id (positions change in place, without re-rendering). */
  others: RefObject<Map<string, OtherPlayer>>
  /** Their ids, as they come and go. */
  present: string[]
  stick: RefObject<Stick>
  /** Where the camera looks, as an angle (a drag turns it); null until the scene sets it. */
  look: RefObject<number | null>
  /** No walking while dealing at a place. */
  paused: boolean
  onPlace: (place: Place | null) => void
  onPosition?: (x: number, y: number, facing: number, moving: boolean) => void
}

export default function StreetScene(props: Props) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: 60, near: 0.1, far: 160, position: [street.spawn.x, 2.4, -(street.spawn.y - 3)] }} gl={{ antialias: true, toneMappingExposure: 1.0 }} style={{ touchAction: 'none' }}>
      <color attach="background" args={['#a9c9ea']} />
      <fog attach="fog" args={['#c4d6e6', 70, 155]} />
      <Sky />
      <hemisphereLight args={['#eaf2ff', '#7a5a3c', 1.0]} />
      <directionalLight position={[-60, 90, 40]} intensity={2.2} color="#fff1dc" />
      <Suspense fallback={null}>
        <Street />
        <People {...props} />
        {props.present.map((id) => {
          const entry = props.others.current?.get(id)
          return entry ? (
            <Suspense key={id} fallback={null}>
              <Other entry={entry} />
            </Suspense>
          ) : null
        })}
      </Suspense>
    </Canvas>
  )
}
