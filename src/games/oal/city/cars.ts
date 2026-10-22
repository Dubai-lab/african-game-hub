// One Africa Life: the town's cars as they are drawn (public/oal/cars.v2.glb, made by
// scripts/oal/makePaidCars.py from the owner's car pack; ../carsPlan.v2.json where their parts
// are): an SUV coupe as a private car (in its owner's paint), a taxi, a police car. Each at full
// quality near (its inside, its doors on their hinges, its steering wheel), its outside alone far
// off (nobody sees in from there); its wheels turning as it rolls and the front two steered, its
// steering wheel turned with them, its body leaning a little in a bend and dipping as it brakes,
// its rear lamps lit as it slows, its headlamps at night, its driver at the wheel.
import { type AnimationClip, BoxGeometry, Color, Group, type Material, Mesh, MeshBasicMaterial, type MeshStandardMaterial, type Object3D, Quaternion, SpotLight, Vector3 } from 'three'
import { person } from '../ArrivalsScene'
import { lookKey, randomLook } from '../character'
import type { Appearance } from '../../../../supabase/functions/_shared/oal'
import { armsOf, FITS, grips, hipsAt, hold, legsOf, seat as sitIn } from './wheelHands'
import plans from '../carsPlan.v2.json'
import kekehPlans from '../kekehPlan.json'
import truckPlans from '../truckPlan.json'
import { stillFigure } from '../Traffic'
import type { Drive } from './driving'

export const CARS_URL = '/oal/cars.v2.glb'
/** The kekeh (scripts/oal/makeKekeh.py: its body from the owner's pictures, its wheels and steering made). */
export const KEKEH_URL = '/oal/kekeh.v1.glb'
export const KEKEH_PLAN = (kekehPlans as unknown as Record<string, { wheels: Record<string, { at: number[]; r: number; node: string }>; steer: string; handlebar: string; driver: number[]; passenger: number[]; size: number[]; wheelbase: number }>).kekeh!

/** Furniture City's delivery truck (scripts/oal/makeTruck.py): its cab's doors, its box's back
 * doors, its wheels (twin at the back), its steering wheel. */
export const TRUCK_URL = '/oal/truck.v1.glb'
export const TRUCK_PLAN = (truckPlans as unknown as Record<string, CarPlan & { cargo: { x0: number; x1: number; floor: number; wide: number } }>).truck!

export type CarModelName = 'suv' | 'suv_taxi' | 'suv_police'
type CarPlan = { wheels: Record<string, { at: number[]; r: number; node: string }>; doors: { name: string; side: string; front: boolean; open: number }[]; trunk: string | null; steer: string | null; needles?: string[]; driver: number[]; size: number[]; wheelbase: number }
export const CAR_PLANS = plans as unknown as Record<CarModelName | `${CarModelName}_far`, CarPlan>

/** Near this (metres from the camera), a car is drawn with its inside; farther, without it. */
const NEAR = 30

type Wheel = { pivot: Object3D; front: boolean }
/** A car drawn: its root (placed and turned as it drives), its lean, its parts that move. */
export type CarModel = {
  root: Group
  lean: Group
  model: CarModelName | 'kekeh' | 'truck'
  /** (Its wheels' own turn at rest, about the upright: the truck's are made a quarter turned.) */
  wheelYaw?: number
  /** What turns as it is steered, whole (a kekeh's front wheel, its fork and mudguard). */
  steerPivot?: Object3D | null
  near: Object3D
  far: Object3D | null
  wheels: Wheel[]
  farWheels: Wheel[]
  steering: Object3D | null
  doors: { pivot: Object3D; open: number; side: string; front: boolean; t: number }[]
  lamps: { head: { value: number }; brake: { value: number } }
  size: { len: number; wide: number; L: number; r: number }
}

// Paints Monrovia's private cars are seen in.
const PAINTS = ['#f0f0ee', '#c8c8c8', '#1c1c1e', '#1f2f5a', '#7a1a1a', '#d0c8b0', '#2a5a3a', '#8a8f96', '#b0b6ba', '#5a2a1c']

/** A car's materials made its own: its paint (the private car's), its lamps (lit for it alone). */
function ownMaterials(body: Object3D, paint: string | null, lamps: CarModel['lamps']) {
  const made = new Map<Material, Material>()
  body.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const swap = (m: Material) => {
      if (made.has(m)) return made.get(m)!
      let c = m
      if (paint && m.name.startsWith('paint')) {
        // Its paint (the private car's: the taxi's body in a plain paint of its own).
        const p = m.clone() as MeshStandardMaterial
        p.color = new Color(paint)
        c = p
      } else if (m.name.startsWith('Headlights')) {
        // Its lamps: the white ones at night, the red ones (the rear's) as it brakes.
        const l = m.clone() as MeshStandardMaterial
        l.onBeforeCompile = (shader) => {
          shader.uniforms.headLit = lamps.head
          shader.uniforms.brakeLit = lamps.brake
          shader.fragmentShader = `uniform float headLit;\nuniform float brakeLit;\n${shader.fragmentShader}`.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
#ifdef USE_MAP
  vec4 lampTex = texture2D(map, vMapUv);
  float red = clamp((lampTex.r - max(lampTex.g, lampTex.b)) * 3.0, 0.0, 1.0);
  float bright = smoothstep(0.35, 0.8, max(lampTex.r, max(lampTex.g, lampTex.b)));
  totalEmissiveRadiance += lampTex.rgb * mix(headLit * bright, brakeLit, red) * 2.5;
#endif`,
          )
        }
        l.customProgramCacheKey = () => 'oal-car-lamps'
        c = l
      }
      made.set(m, c)
      return c
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
}

const wheelsOf = (body: Object3D, plan: CarPlan): Wheel[] => Object.entries(plan.wheels).map(([k, w]) => ({ pivot: body.getObjectByName(w.node)!, front: k.startsWith('f') }))

/** A car of a model (a private car in a paint), its driver seated (of the town's people, still). */
export function buildCar(scene: Object3D, model: CarModelName, paint: string | null, people: { scene: Object3D; animations: AnimationClip[] } | null, rand: () => number): CarModel {
  const plan = CAR_PLANS[model]
  const farPlan = CAR_PLANS[`${model}_far`]
  const lamps = { head: { value: 0 }, brake: { value: 0.15 } }
  const near = scene.getObjectByName(`car_${model}`)!.clone(true)
  const farSrc = scene.getObjectByName(`car_${model}_far`)
  const far = farSrc ? farSrc.clone(true) : null
  ownMaterials(near, model === 'suv' ? paint : null, lamps)
  if (far) {
    ownMaterials(far, model === 'suv' ? paint : null, lamps)
    far.visible = false
  }
  const lean = new Group()
  lean.add(near)
  if (far) lean.add(far)
  const root = new Group()
  root.add(lean)
  const steerPivot = plan.steer ? near.getObjectByName(plan.steer) : null
  const doors = plan.doors.map((d) => ({ pivot: near.getObjectByName(d.name)!, open: d.open, side: d.side, front: d.front, t: 0 })).filter((d) => d.pivot)
  // The driver: at the wheel, seated (the left seat: Liberia drives on the right).
  if (people) seatDriver(people, randomLook('male', rand, model === 'suv_police' ? ['shirt_jeans'] : undefined), lean, plan.driver, -0.18, steerPivot ?? null, 'wheel', model)
  const r = Object.values(plan.wheels)[0]?.r ?? 0.34
  return {
    root,
    lean,
    model,
    near,
    far,
    wheels: wheelsOf(near, plan),
    farWheels: far && farPlan ? wheelsOf(far, farPlan) : [],
    steering: steerPivot ?? null,
    doors,
    lamps,
    // (Its box the width of its body: its mirrors stand out of it.)
    size: { len: plan.size[0]!, wide: Math.min(plan.size[2]!, 1.96), L: plan.wheelbase, r },
  }
}

/** The kekeh: its driver at the handlebar (of the town's people, still). */
export function buildKekeh(scene: Object3D, people: { scene: Object3D; animations: AnimationClip[] } | null, rand: () => number): CarModel {
  const plan = KEKEH_PLAN
  const near = scene.getObjectByName('kekeh')!.clone(true)
  const lean = new Group()
  lean.add(near)
  const root = new Group()
  root.add(lean)
  const handle = near.getObjectByName(plan.handlebar)
  if (people) seatDriver(people, randomLook('male', rand), lean, plan.driver, 0.12, handle?.children[0] ?? null, 'bar', 'kekeh', 0.06, 'kekeh')
  return {
    root,
    lean,
    model: 'kekeh',
    near,
    far: null,
    steerPivot: near.getObjectByName(plan.steer) ?? null,
    wheels: Object.entries(plan.wheels).map(([k, w]) => ({ pivot: near.getObjectByName(w.node)!, front: false, key: k })),
    farWheels: [],
    steering: handle?.children[0] ?? null,
    doors: [],
    lamps: { head: { value: 0 }, brake: { value: 0 } },
    size: { len: plan.size[0]!, wide: plan.size[2]!, L: plan.wheelbase, r: Object.values(plan.wheels)[0]?.r ?? 0.226 },
  }
}

/** The delivery truck, its driver at the wheel (of the town's people, still), in Furniture City's
 * overalls. */
export function buildTruck(scene: Object3D, people: { scene: Object3D; animations: AnimationClip[] } | null, rand: () => number): CarModel {
  const plan = TRUCK_PLAN
  const near = scene.getObjectByName('truck')!.clone(true)
  const lean = new Group()
  lean.add(near)
  const root = new Group()
  root.add(lean)
  // The steering wheel turned about its own axis (its column's up): a part of its own between.
  const column = near.getObjectByName(plan.steer!)
  const wheel = near.getObjectByName('truck_steering_wheel')
  let steering: Object3D | null = null
  if (column && wheel) {
    steering = new Group()
    column.add(steering)
    steering.add(wheel)
  }
  const doors = plan.doors.map((d) => ({ pivot: near.getObjectByName(d.name)!, open: d.open, side: d.side, front: d.front, t: 0 })).filter((d) => d.pivot)
  if (people) seatDriver(people, randomLook('male', rand, ['overalls']), lean, plan.driver, -0.18, steering, 'wheel', 'truck', DRIVER_HIPS, 'truck')
  return {
    root,
    lean,
    model: 'truck',
    near,
    far: null,
    wheelYaw: Math.PI / 2,
    wheels: wheelsOf(near, plan),
    farWheels: [],
    steering,
    doors,
    lamps: { head: { value: 0 }, brake: { value: 0 } },
    size: { len: plan.size[0]!, wide: 2.24, L: plan.wheelbase, r: Object.values(plan.wheels)[0]?.r ?? 0.41 },
  }
}

/** How far above the plan's seat point a driver's hips are. */
export const DRIVER_HIPS = 0.34

/** A driver at the wheel (or the handlebar), both hands on it: posed seated as at the wheel, the
 * arms bent to it, then frozen (a still figure costs a phone little). */
function seatDriver(people: { scene: Object3D; animations: AnimationClip[] }, look: Appearance, lean: Group, seat: number[], back: number, steering: Object3D | null, kind: 'wheel' | 'bar', key: string, hips = DRIVER_HIPS, fit = 'suv') {
  const p = person(people.scene, people.animations, look)
  ;(p.actions.drive ?? p.actions.sit ?? p.actions.idle)?.play()
  p.mixer.update(0.5)
  const [dx, dy, dz] = seat
  p.root.position.set(dx! - back, dy! - 0.42, dz!)
  p.root.rotation.y = Math.PI / 2
  p.root.scale.multiplyScalar(0.95)
  lean.add(p.root)
  lean.updateMatrixWorld(true)
  // In its seat, the feet on the floor at the pedals (a car's, as measured), else the hips at their height.
  if (FITS[fit]) sitIn(p.root, lean.matrixWorld, FITS[fit]!, legsOf(p.root))
  else hipsAt(p.root, dy! + hips)
  const arms = armsOf(p.root)
  if (arms && steering) {
    const right = new Vector3(0, 0, 1).transformDirection(lean.matrixWorld)
    hold(arms, steering, grips(steering, kind, right), right)
  }
  const fig = stillFigure(p.root, `${key}|${lookKey(look)}`)
  lean.remove(p.root)
  fig.position.copy(p.root.position)
  fig.rotation.copy(p.root.rotation)
  fig.scale.copy(p.root.scale)
  lean.add(fig)
}

export function randomPaint(rand: () => number) {
  return PAINTS[Math.floor(rand() * PAINTS.length)]!
}

/** A car drawn where its driving has it: placed, turned, leaning; near or far; its wheels rolled
 * and steered, its steering wheel turned, its lamps, its doors. */
export function poseCar(car: CarModel, d: Drive, ground: number, dt: number, camera?: { x: number; z: number }, night = 0) {
  car.root.position.set(d.x, ground, -d.y)
  car.root.rotation.y = d.yaw
  const close = !car.far || !camera || Math.hypot(camera.x - d.x, camera.z + d.y) < NEAR
  car.near.visible = close
  if (car.far) car.far.visible = !close
  // Leaning out of the bend (its turning times its speed), dipping its nose as it brakes.
  const roll = Math.max(-0.05, Math.min(0.05, -d.yawRate * d.v * 0.012))
  const pitch = d.braking ? Math.min(0.025, d.v * 0.004) : 0
  car.lean.rotation.x += (roll - car.lean.rotation.x) * Math.min(1, dt * 4)
  car.lean.rotation.z += (-pitch - car.lean.rotation.z) * Math.min(1, dt * 4)
  // (The parts keep the frame they were made in: a wheel's axle its x, its upright its y.)
  for (const w of close ? car.wheels : car.farWheels) {
    w.pivot.rotation.order = 'YXZ'
    w.pivot.rotation.y = (w.front ? d.steer : 0) + (car.wheelYaw ?? 0)
    w.pivot.rotation.x = d.spin
  }
  // A kekeh: its front wheel, fork and mudguard turned whole; its handlebar with them.
  if (car.steerPivot) car.steerPivot.rotation.y = d.steer
  if (close && car.steering) car.steering.rotation.y = car.steerPivot ? d.steer : d.steer * 6
  car.lamps.brake.value = d.braking || d.v < 0.2 ? 1 : 0.12
  car.lamps.head.value = night
  if (close) for (const door of car.doors) door.pivot.rotation.y = door.open * door.t * 1.15
}

/** What the driver's dashboard and lamps show (the player's own car). */
export type Dash = { kmh: number; rpm: number; indicator: 'off' | 'left' | 'right' | 'hazard'; lights: boolean; blink: boolean }

type DashParts = { needles: { pivot: Object3D; rest: Quaternion; full: number; of: 'kmh' | 'rpm' }[]; signals: { mesh: Mesh; side: 'left' | 'right' }[]; beam: SpotLight }
const dashParts = new WeakMap<CarModel, DashParts>()
const AMBER = new MeshBasicMaterial({ color: '#ffa31a', toneMapped: false })
const UP = new Vector3(0, 1, 0)
const turn = new Quaternion()

/** Its dashboard's needles turned (the speed's, the engine's), its indicators flashing at its four
 * corners, its headlamps lit and throwing their light down the road (the player's own car). */
export function dashCar(car: CarModel, dash: Dash, night: number) {
  let parts = dashParts.get(car)
  if (!parts) {
    const plan = CAR_PLANS[car.model as CarModelName]
    // (A needle keeps the pack's frame: it lies along its x, turned about the dial's face, its y.)
    const needles = (plan?.needles ?? []).flatMap((name) => {
      const pivot = car.near.getObjectByName(name)
      return pivot ? [{ pivot, rest: pivot.quaternion.clone(), full: name.endsWith('rpm') ? 4.2 : 4.4, of: (name.endsWith('rpm') ? 'rpm' : 'kmh') as 'kmh' | 'rpm' }] : []
    })
    const { len, wide } = car.size
    const signals: DashParts['signals'] = []
    for (const ahead of [1, -1])
      for (const side of ['left', 'right'] as const) {
        const m = new Mesh(new BoxGeometry(0.04, 0.05, 0.16), AMBER)
        m.position.set(ahead * len * 0.47, ahead > 0 ? 0.8 : 1.02, (side === 'left' ? -1 : 1) * wide * 0.36)
        m.visible = false
        car.lean.add(m)
        signals.push({ mesh: m, side })
      }
    const beam = new SpotLight('#fff4dc', 0, 38, 0.55, 0.5, 1.2)
    beam.position.set(len * 0.5, 0.8, 0)
    beam.target.position.set(len * 0.5 + 12, 0, 0)
    car.lean.add(beam, beam.target)
    parts = { needles, signals, beam }
    dashParts.set(car, parts)
  }
  for (const n of parts.needles) {
    const of = n.of === 'kmh' ? Math.min(1, dash.kmh / 200) : Math.min(1, dash.rpm)
    // (Clockwise as the driver sees it.)
    n.pivot.quaternion.copy(n.rest).multiply(turn.setFromAxisAngle(UP, -of * n.full))
  }
  for (const sg of parts.signals) sg.mesh.visible = dash.blink && (dash.indicator === 'hazard' || dash.indicator === sg.side)
  const lit = dash.lights ? 1 : 0
  car.lamps.head.value = Math.max(night, lit)
  parts.beam.intensity = lit * (8 + night * 30)
}
