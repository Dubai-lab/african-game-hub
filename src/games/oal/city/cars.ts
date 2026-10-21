// One Africa Life: the town's cars as they are drawn (public/oal/cars.v1.glb, made by
// scripts/oal/makeCars.py from the owner's car pack; ../carsPlan.json where their parts are): a
// car of its kind in its paint, its wheels turning as it rolls and the front two steered, its
// steering wheel turned with them, its body leaning a little in a bend and dipping as it brakes,
// its brake lights lit as it slows, its doors on their hinges, its driver at the wheel.
import { type AnimationClip, Color, Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three'
import { CATALOGUE, defaultAppearance } from '../../../../supabase/functions/_shared/oal'
import { person } from '../ArrivalsScene'
import plans from '../carsPlan.json'
import { stillFigure } from '../Traffic'
import type { Drive } from './driving'

export const CARS_URL = '/oal/cars.v1.glb'

export type CarModelName = 'sedan' | 'saloon' | 'hatch' | 'pickup'
type CarPlan = { wheels: Record<string, { at: number[]; r: number; node: string }>; doors: { name: string; side: string; front: boolean; open: number }[]; steer: string; driver: number[]; size: number[]; wheelbase: number }
export const CAR_PLANS = plans as unknown as Record<CarModelName, CarPlan>

/** A car drawn: its root (placed and turned as it drives), its lean, its parts that move. */
export type CarModel = {
  root: Group
  lean: Group
  model: CarModelName
  wheels: { pivot: Object3D; front: boolean }[]
  steering: Object3D | null
  doors: { pivot: Object3D; open: number; side: string; front: boolean; t: number }[]
  brake: MeshStandardMaterial | null
  size: { len: number; wide: number; L: number; r: number }
}

// Paints Monrovia's cars are seen in (the taxis all yellow; the police in navy).
const PAINTS = ['#f0f0ee', '#c8c8c8', '#1c1c1e', '#1f2f5a', '#7a1a1a', '#d0c8b0', '#2a5a3a', '#8a8f96', '#b0b6ba']

/** A car of a model in a paint, its driver seated (of the town's people, still: a phone's cost). */
export function buildCar(scene: Object3D, model: CarModelName, paint: string, people: { scene: Object3D; animations: AnimationClip[] } | null, rand: () => number): CarModel {
  const src = scene.getObjectByName(`car_${model}`)!
  const body = src.clone(true)
  const plan = CAR_PLANS[model]
  // Its own paint and its own brake lights (lit for it alone).
  let brake: MeshStandardMaterial | null = null
  const paintMat = new Map<Material, Material>()
  body.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const swap = (m: Material) => {
      if (m.name === 'paint') {
        if (!paintMat.has(m)) {
          const c = m.clone() as MeshStandardMaterial
          c.color = new Color(paint)
          paintMat.set(m, c)
        }
        return paintMat.get(m)!
      }
      if (m.name === 'brakelight') {
        brake ??= m.clone() as MeshStandardMaterial
        return brake
      }
      return m
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  const lean = new Group()
  lean.add(body)
  const root = new Group()
  root.add(lean)
  const wheels = Object.entries(plan.wheels).map(([k, w]) => ({ pivot: body.getObjectByName(w.node)!, front: k.startsWith('f') }))
  const steerPivot = body.getObjectByName(plan.steer)
  const steering = steerPivot?.children[0] ?? null
  const doors = plan.doors.map((d) => ({ pivot: body.getObjectByName(d.name)!, open: d.open, side: d.side, front: d.front, t: 0 })).filter((d) => d.pivot)
  // The driver: at the wheel, seated (the left seat: Liberia drives on the right).
  if (people) {
    const base = defaultAppearance('male')
    const look = { ...base, skin: 0.6 + rand() * 0.35, outfit: CATALOGUE.outfit.male[Math.floor(rand() * CATALOGUE.outfit.male.length)]!, hair: CATALOGUE.hair.male[Math.floor(rand() * CATALOGUE.hair.male.length)]! }
    const p = person(people.scene, people.animations, look)
    ;(p.actions.sit ?? p.actions.idle)?.play()
    p.mixer.update(0.5)
    const fig = stillFigure(p.root, `${look.outfit}|${look.hair}`)
    const [dx, , dz] = plan.driver
    fig.position.set(dx! - 0.12, 0.04, dz!)
    fig.rotation.y = Math.PI / 2
    fig.scale.setScalar(0.94)
    lean.add(fig)
  }
  const r = Object.values(plan.wheels)[0]?.r ?? 0.35
  return { root, lean, model, wheels, steering, doors, brake, size: { len: plan.size[0]!, wide: plan.size[2]!, L: plan.wheelbase, r } }
}

export function randomPaint(rand: () => number) {
  return PAINTS[Math.floor(rand() * PAINTS.length)]!
}

/** A car drawn where its driving has it: placed, turned, leaning; its wheels rolled and steered,
 * its steering wheel turned, its brake lights, its doors. */
export function poseCar(car: CarModel, d: Drive, ground: number, dt: number) {
  car.root.position.set(d.x, ground, -d.y)
  car.root.rotation.y = d.yaw
  // Leaning out of the bend (its turning times its speed), dipping its nose as it brakes.
  const roll = Math.max(-0.05, Math.min(0.05, -d.yawRate * d.v * 0.012))
  const pitch = d.braking ? Math.min(0.025, d.v * 0.004) : 0
  car.lean.rotation.x += (roll - car.lean.rotation.x) * Math.min(1, dt * 4)
  car.lean.rotation.z += (-pitch - car.lean.rotation.z) * Math.min(1, dt * 4)
  // (The parts keep the frame they were made in: a wheel's axle its x, its upright its y.)
  for (const w of car.wheels) {
    w.pivot.rotation.order = 'YXZ'
    w.pivot.rotation.y = w.front ? d.steer : 0
    w.pivot.rotation.x = d.spin
  }
  if (car.steering) car.steering.rotation.y = d.steer * 6
  if (car.brake) car.brake.emissiveIntensity = d.braking || d.v < 0.2 ? 2.2 : 0.25
  for (const door of car.doors) door.pivot.rotation.y = door.open * door.t * 1.15
}
