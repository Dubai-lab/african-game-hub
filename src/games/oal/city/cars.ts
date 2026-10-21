// One Africa Life: the town's cars as they are drawn (public/oal/cars.v2.glb, made by
// scripts/oal/makePaidCars.py from the owner's car pack; ../carsPlan.v2.json where their parts
// are): an SUV coupe as a private car (in its owner's paint), a taxi, a police car. Each at full
// quality near (its inside, its doors on their hinges, its steering wheel), its outside alone far
// off (nobody sees in from there); its wheels turning as it rolls and the front two steered, its
// steering wheel turned with them, its body leaning a little in a bend and dipping as it brakes,
// its rear lamps lit as it slows, its headlamps at night, its driver at the wheel.
import { type AnimationClip, Color, Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three'
import { CATALOGUE, defaultAppearance } from '../../../../supabase/functions/_shared/oal'
import { person } from '../ArrivalsScene'
import plans from '../carsPlan.v2.json'
import { stillFigure } from '../Traffic'
import type { Drive } from './driving'

export const CARS_URL = '/oal/cars.v2.glb'

export type CarModelName = 'suv' | 'suv_taxi' | 'suv_police'
type CarPlan = { wheels: Record<string, { at: number[]; r: number; node: string }>; doors: { name: string; side: string; front: boolean; open: number }[]; trunk: string | null; steer: string | null; driver: number[]; size: number[]; wheelbase: number }
export const CAR_PLANS = plans as unknown as Record<CarModelName | `${CarModelName}_far`, CarPlan>

/** Near this (metres from the camera), a car is drawn with its inside; farther, without it. */
const NEAR = 30

type Wheel = { pivot: Object3D; front: boolean }
/** A car drawn: its root (placed and turned as it drives), its lean, its parts that move. */
export type CarModel = {
  root: Group
  lean: Group
  model: CarModelName
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
// The pack's body colour in its texture (the private car's dark paint), which a paint replaces.
const BODY = new Color('#202021')

/** A car's materials made its own: its paint (the private car's), its lamps (lit for it alone). */
function ownMaterials(body: Object3D, paint: string | null, lamps: CarModel['lamps']) {
  const made = new Map<Material, Material>()
  body.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const swap = (m: Material) => {
      if (made.has(m)) return made.get(m)!
      let c = m
      if (paint && m.name.startsWith('Details')) {
        // The body's colour in the texture replaced by the paint (its maps' shine and wear kept).
        const p = m.clone() as MeshStandardMaterial
        const paintColour = { value: new Color(paint) }
        const bodyColour = { value: BODY.clone() }
        p.onBeforeCompile = (shader) => {
          shader.uniforms.paintColour = paintColour
          shader.uniforms.bodyColour = bodyColour
          shader.fragmentShader = `uniform vec3 paintColour;\nuniform vec3 bodyColour;\n${shader.fragmentShader}`.replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  float bodyness = 1.0 - smoothstep(0.004, 0.011, distance(sampledDiffuseColor.rgb, bodyColour));
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, paintColour, bodyness);
  diffuseColor *= sampledDiffuseColor;
#endif`,
          )
        }
        p.customProgramCacheKey = () => 'oal-car-paint'
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
  if (people) {
    const base = defaultAppearance('male')
    const look = { ...base, skin: 0.6 + rand() * 0.35, outfit: CATALOGUE.outfit.male[Math.floor(rand() * CATALOGUE.outfit.male.length)]!, hair: CATALOGUE.hair.male[Math.floor(rand() * CATALOGUE.hair.male.length)]! }
    const p = person(people.scene, people.animations, look)
    ;(p.actions.sit ?? p.actions.idle)?.play()
    p.mixer.update(0.5)
    const fig = stillFigure(p.root, `${look.outfit}|${look.hair}`)
    const [dx, dy, dz] = plan.driver
    fig.position.set(dx! - 0.1, dy! - 0.42, dz!)
    fig.rotation.y = Math.PI / 2
    fig.scale.setScalar(0.95)
    lean.add(fig)
  }
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
    w.pivot.rotation.y = w.front ? d.steer : 0
    w.pivot.rotation.x = d.spin
  }
  if (close && car.steering) car.steering.rotation.y = d.steer * 6
  car.lamps.brake.value = d.braking || d.v < 0.2 ? 1 : 0.12
  car.lamps.head.value = night
  if (close) for (const door of car.doors) door.pivot.rotation.y = door.open * door.t * 1.15
}
