// One Africa Life: the traffic on a 3D street. Taxis (yellow), private cars, kekehs, the odd
// bus and police car (the owner's models, made light by scripts/oal/makeVehicles.py:
// public/oal/vehicles.v2.glb) drive the street's lanes (its plan's "lanes", on the right), at
// town speeds, slowing behind whoever is ahead and stopping for the player in front of them;
// at a lane's end, back to its start (out of sight, in the haze). Each has its driver at the
// wheel (a kekeh its rider), seated, of every look. Where each vehicle is, as a box, is kept for
// the player to walk against (./StreetScene.tsx).
import { useFrame, useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import { type AnimationClip, BufferAttribute, BufferGeometry, Color, Group, type Material, Matrix4, type Mesh, Mesh as MeshClass, type Object3D, type SkinnedMesh, Vector3 } from 'three'
import { packed } from './gltf'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { person } from './ArrivalsScene'
import { CROWD_URL, lookKey, randomLook } from './character'
import { buildCar, buildKekeh, type CarModel, CARS_URL, KEKEH_FAR_URL, KEKEH_URL, poseCar, randomPaint } from './city/cars'
import type { Drive } from './city/driving'

export const VEHICLES_URL = '/oal/vehicles.v2.glb'

export type Kind = 'taxi' | 'car' | 'kekeh' | 'bus' | 'police'
/** A vehicle's box on the map, for walking against: centre, heading, half length and width. */
export type Moving = { x: number; y: number; yaw: number; hl: number; hw: number }

const MODEL: Record<Kind, string> = { taxi: 'sedan', car: 'sedan', kekeh: 'kekeh', bus: 'bus', police: 'police_car' }
export const SIZE: Record<Kind, [number, number]> = { taxi: [4.6, 2.0], car: [4.6, 2.0], kekeh: [2.7, 1.4], bus: [7.6, 2.6], police: [4.9, 1.8] }
// Town speeds, metres a second (about 30, 25, 25, 30 km/h).
export const SPEED: Record<Kind, number> = { taxi: 8.5, car: 8.0, kekeh: 7.0, bus: 7.0, police: 8.5 }
const PAINTS: Record<Kind, string[]> = {
  taxi: ['#e9b51c'],
  car: ['#f0f0ee', '#c8c8c8', '#202020', '#1f2f5a', '#7a1a1a', '#d0c8b0', '#2a5a3a'],
  kekeh: ['#e8b41c', '#e8b41c', '#2a6ab8'],
  bus: [''],
  police: [''],
}

// Where the driver sits, in the vehicle's own frame (x ahead, y up, z to its right): on the
// left, as cars are driven on the right; a kekeh's rider in the middle, in front.
// (The sitting movement's seat is chair high: in a car the driver sits lower, below the roof.)
const SEAT: Record<Kind, [number, number, number]> = { taxi: [0.05, -0.24, -0.4], car: [0.05, -0.24, -0.4], police: [0.1, -0.26, -0.4], bus: [2.9, 0.6, -0.85], kekeh: [0.25, 0.12, 0] }

type Lane = { pts: [number, number][]; at: number[]; length: number }
type Car = { kind: Kind; lane: number; s: number; v: number; want: number; root: Object3D; model: CarModel | null; d: Drive | null }

/** A lane, the part of it within reach of the street's centre (what can be seen, and a little). */
function laneOf(points: number[][], reach: number): Lane {
  const inside = points.map((p) => Math.hypot(p[0]!, p[1]!) < reach)
  const first = inside.indexOf(true)
  const last = inside.lastIndexOf(true)
  const pts = (first < 0 ? points : points.slice(Math.max(0, first - 1), last + 2)).map((p) => [p[0]!, p[1]!] as [number, number])
  const at = [0]
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
  return { pts, at, length: at.at(-1)! }
}

/** Where s metres along a lane is, and which way it runs there. */
function pointAt(lane: Lane, s: number): { x: number; y: number; yaw: number } {
  let i = 1
  while (i < lane.at.length - 1 && lane.at[i]! < s) i++
  const a = lane.pts[i - 1]!
  const b = lane.pts[i]!
  const span = lane.at[i]! - lane.at[i - 1]! || 1
  const t = Math.max(0, Math.min(1, (s - lane.at[i - 1]!) / span))
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) }
}

/** The vehicles' models in their file, by name. */
export function vehicleModels(scene: Object3D) {
  return Object.fromEntries(['sedan', 'kekeh', 'bus', 'police_car'].map((n) => [n, scene.getObjectByName(n)!])) as Record<string, Object3D | undefined>
}

/** A vehicle of a kind: its model in a paint of its kind, its driver seated at the wheel. */
export function buildVehicle(models: Record<string, Object3D | undefined>, people: { scene: Object3D; animations: AnimationClip[] }, kind: Kind, rand: () => number): Object3D | null {
  const model = models[MODEL[kind]]
  if (!model) return null
  const root = model.clone(true)
  const paint = pick(PAINTS[kind], rand())
  if (paint) {
    root.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m: Material) => {
        if (!m.name.startsWith('paint')) return m
        const c = m.clone() as Material & { color: Color }
        c.color = new Color(paint)
        return c
      })
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0]!
    })
  }
  // The driver: seated at the wheel, posed once (a still figure costs a phone little).
  const look = randomLook('male', rand, kind === 'police' ? ['shirt_jeans'] : undefined)
  const driver = person(people.scene, people.animations, look)
  const sit = driver.actions.sit ?? driver.actions.idle
  sit?.play()
  driver.mixer.update(0.5)
  const [sx, sy, sz] = SEAT[kind]
  const still = stillFigure(driver.root, lookKey(look))
  still.position.set(sx, sy, sz)
  still.rotation.y = Math.PI / 2
  still.scale.setScalar(0.94)
  root.add(still)
  return root
}

// The seated figures' shapes, by their look (outfit, hair): made once, shared by every driver
// who looks so (each keeps the colours of their own skin and clothes).
const stillShapes = new Map<string, BufferGeometry[]>()

/** A posed person made still: what it shows, baked in its pose as plain meshes (no skeleton to
 * work out each frame, no skinning to draw), in the person's own frame. */
export function stillFigure(person: Object3D, look: string): Object3D {
  person.updateMatrixWorld(true)
  const toPerson = new Matrix4().copy(person.matrixWorld).invert()
  const shown: SkinnedMesh[] = []
  person.traverse((o) => {
    const m = o as SkinnedMesh
    if (!m.isSkinnedMesh) return
    for (let up: Object3D | null = o; up && up !== person; up = up.parent) if (!up.visible) return
    shown.push(m)
  })
  let shapes = stillShapes.get(look)
  if (!shapes) {
    const v = new Vector3()
    shapes = shown.map((m) => {
      m.skeleton.update()
      const src = m.geometry
      const n = src.getAttribute('position').count
      const pos = new Float32Array(n * 3)
      const into = new Matrix4().multiplyMatrices(toPerson, m.matrixWorld)
      for (let i = 0; i < n; i++) {
        m.getVertexPosition(i, v)
        v.applyMatrix4(into)
        pos[i * 3] = v.x
        pos[i * 3 + 1] = v.y
        pos[i * 3 + 2] = v.z
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(pos, 3))
      for (const name of ['uv', 'color']) {
        const a = src.getAttribute(name)
        if (a) g.setAttribute(name, a)
      }
      if (src.index) g.setIndex(src.index)
      g.computeVertexNormals()
      g.computeBoundingSphere()
      return g
    })
    stillShapes.set(look, shapes)
  }
  const out = new Group()
  shown.forEach((m, i) => out.add(new MeshClass(shapes[i]!, m.material)))
  return out
}

function pick<T>(list: T[], r: number) {
  return list[Math.floor(r * list.length) % list.length]!
}

export function Traffic({ lanes, reach, player, moving, spacing = 35 }: { lanes: number[][][]; reach: number; player: { current: { x: number; y: number } }; moving: { current: Moving[] }; spacing?: number }) {
  const gltf = useLoader(GLTFLoader, VEHICLES_URL, packed)
  const people = useLoader(GLTFLoader, CROWD_URL('male'), packed)
  const carsFile = useLoader(GLTFLoader, CARS_URL, packed)
  const kekehFile = useLoader(GLTFLoader, KEKEH_URL, packed)
  const kekehFar = useLoader(GLTFLoader, KEKEH_FAR_URL, packed)
  const { cars, roads, group } = useMemo(() => {
    const roads = lanes.map((l) => laneOf(l, reach)).filter((l) => l.length > 40)
    const models = vehicleModels(gltf.scene)
    const cars: Car[] = []
    // A fixed seed: the same street each visit (and the same for everyone).
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    roads.forEach((lane, li) => {
      // A car every so many metres, as busy as the street is.
      const count = Math.max(1, Math.floor(lane.length / spacing))
      for (let k = 0; k < count; k++) {
        const r = rand()
        const kind: Kind = r < 0.42 ? 'taxi' : r < 0.67 ? 'car' : r < 0.88 ? 'kekeh' : r < 0.95 ? 'bus' : 'police'
        // The town's own (the cars of the owner's pack, the kekeh made from pictures); the bus as it was.
        const model = kind === 'kekeh' ? buildKekeh(kekehFile.scene, people, rand, kekehFar.scene) : kind === 'bus' ? null : buildCar(carsFile.scene, kind === 'taxi' ? 'suv_taxi' : kind === 'police' ? 'suv_police' : 'suv', kind === 'car' ? randomPaint(rand) : null, people, rand)
        const root = model ? model.root : buildVehicle(models, people, kind, rand)
        if (!root) continue
        const s0 = ((k + rand() * 0.5) / count) * lane.length
        const at0 = pointAt(lane, s0)
        const d = model ? ({ x: at0.x, y: at0.y, yaw: at0.yaw, v: 0, steer: 0, yawRate: 0, spin: 0, braking: false, L: model.size.L, r: model.size.r } as unknown as Drive) : null
        cars.push({ kind, lane: li, s: s0, v: SPEED[kind], want: SPEED[kind] * (0.85 + rand() * 0.3), root, model, d })
      }
    })
    const group = cars.map((c) => c.root)
    return { cars, roads, group }
  }, [gltf, carsFile, kekehFile, kekehFar, people, lanes, reach, spacing])

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1)
    const boxes: Moving[] = []
    const p = player.current
    for (const car of cars) {
      const lane = roads[car.lane]!
      const [len, wide] = SIZE[car.kind]
      const here = pointAt(lane, car.s)
      // How much room ahead: the next car in the lane, and the player if in the lane's way.
      let room = Infinity
      for (const other of cars) {
        if (other === car || other.lane !== car.lane) continue
        const gap = other.s - car.s
        if (gap > 0 && gap < room) room = gap - (len + SIZE[other.kind][0]) / 2
      }
      const fx = Math.cos(here.yaw)
      const fy = Math.sin(here.yaw)
      const dx = p.x - here.x
      const dy = p.y - here.y
      const ahead = dx * fx + dy * fy
      const side = Math.abs(-dx * fy + dy * fx)
      if (ahead > 0 && side < wide / 2 + 0.9) room = Math.min(room, ahead - len / 2 - 0.6)
      // Slow toward a stop two metres short of what is ahead; else back up to speed.
      const target = room < 2 ? 0 : Math.min(car.want, (room - 2) * 0.9)
      car.v += Math.max(-6 * dt, Math.min(2.5 * dt, target - car.v))
      car.v = Math.max(0, car.v)
      car.s += car.v * dt
      if (car.s > lane.length) car.s -= lane.length
      const at = pointAt(lane, car.s)
      if (car.model && car.d) {
        // Steered into the lane's bend as a car turns (no faster than its wheels allow), its
        // wheels rolled, its front steered, its body leaning.
        const d = car.d
        let diff = at.yaw - d.yaw
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        const most = (Math.max(car.v, 1) / d.L) * Math.tan(0.6) * dt
        const turn = Math.max(-most, Math.min(most, diff))
        d.yaw = Math.atan2(Math.sin(d.yaw + turn), Math.cos(d.yaw + turn))
        d.yawRate = turn / Math.max(dt, 1e-3)
        d.steer += (Math.atan((d.yawRate * d.L) / Math.max(car.v, 0.5)) - d.steer) * Math.min(1, dt * 6)
        d.v = car.v
        d.braking = target < car.v - 0.3
        d.spin += (car.v * dt) / d.r
        d.x = at.x
        d.y = at.y
        poseCar(car.model, d, 0.03, dt, { x: p.x, z: -p.y })
      } else {
        car.root.position.set(at.x, 0.03, -at.y)
        car.root.rotation.y = at.yaw
      }
      // Drawn only within sight (the far ones still drive on, unseen in the haze).
      car.root.visible = Math.abs(at.x - p.x) < SEEN && Math.abs(at.y - p.y) < SEEN
      car.root.matrixWorldAutoUpdate = car.root.visible
      boxes.push({ x: at.x, y: at.y, yaw: at.yaw, hl: len / 2, hw: wide / 2 })
    }
    moving.current = boxes
  })

  return (
    <>
      {group.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
    </>
  )
}

/** How far off a vehicle is drawn (metres either way). */
const SEEN = 150

/** Pushes a walker (radius r) out of any vehicle box it is in. */
export function keepOutOf(p: { x: number; y: number }, boxes: Moving[], r: number) {
  for (const b of boxes) {
    const c = Math.cos(b.yaw)
    const s = Math.sin(b.yaw)
    const dx = p.x - b.x
    const dy = p.y - b.y
    const u = dx * c + dy * s
    const v = -dx * s + dy * c
    const hl = b.hl + r
    const hw = b.hw + r
    if (Math.abs(u) >= hl || Math.abs(v) >= hw) continue
    // Out by the nearer side.
    if (hl - Math.abs(u) < hw - Math.abs(v)) {
      const nu = Math.sign(u || 1) * hl
      p.x = b.x + nu * c - v * s
      p.y = b.y + nu * s + v * c
    } else {
      const nv = Math.sign(v || 1) * hw
      p.x = b.x + u * c - nv * s
      p.y = b.y + u * s + nv * c
    }
  }
}
