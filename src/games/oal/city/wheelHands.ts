// One Africa Life: a driver's hands on what they steer with: on a car's steering wheel at ten and
// two, turning with it; on a kekeh's handlebar, at its grips. Each arm is bent to reach (its
// shoulder turned, its elbow bent, down and out, as a driver's are), after the seated pose.
import { Box3, type Bone, Matrix4, type Object3D, Quaternion, Vector3 } from 'three'

type Arm = { upper: Bone; lower: Bone; hand: Bone; side: 1 | -1 }
/** (A leg is bent the same way: the thigh, the shin, the foot.) */
export type Arms = { left: Arm; right: Arm }

const find = (root: Object3D, name: string) => (root.getObjectByName(`mixamorig${name}`) ?? root.getObjectByName(`mixamorig:${name}`)) as Bone | undefined

/** A person's arms (their bones), if the person has them. */
export function armsOf(root: Object3D): Arms | null {
  const arm = (side: 'Left' | 'Right'): Arm | null => {
    const upper = find(root, `${side}Arm`)
    const lower = find(root, `${side}ForeArm`)
    const hand = find(root, `${side}Hand`)
    return upper && lower && hand ? { upper, lower, hand, side: side === 'Left' ? -1 : 1 } : null
  }
  const left = arm('Left')
  const right = arm('Right')
  return left && right ? { left, right } : null
}

/** A person's legs (their bones), if the person has them. */
export function legsOf(root: Object3D): Arms | null {
  const leg = (side: 'Left' | 'Right'): Arm | null => {
    const upper = find(root, `${side}UpLeg`)
    const lower = find(root, `${side}Leg`)
    const hand = find(root, `${side}Foot`)
    return upper && lower && hand ? { upper, lower, hand, side: side === 'Left' ? -1 : 1 } : null
  }
  const left = leg('Left')
  const right = leg('Right')
  return left && right ? { left, right } : null
}

/** Where a driver sits in a vehicle, in its own frame (x ahead, y up, z to its right; from its
 * ground): the hips, and each foot (its ankle) on the floor at the pedals. Measured on the models
 * (the seat's cushion, the footwell's floor, the wheel). */
export type Fit = { hips: [number, number, number]; left: [number, number, number]; right: [number, number, number] }
export const FITS: Record<string, Fit> = {
  // The SUV coupe (the private car, the taxi, the police car): the cushion at 0.67 m, the footwell
  // floor at 0.39 m, the wheel's middle 0.6 m ahead of the seat's back, 1.04 m up.
  suv: { hips: [0.25, 0.76, -0.362], left: [0.88, 0.47, -0.46], right: [0.9, 0.47, -0.27] },
  // The delivery truck's cab: the cushion at 1.04 m, the floor at 0.62 m, the dashboard from
  // 2.65 m ahead, the wheel on its column at 2.58 m, 1.5 m up.
  truck: { hips: [1.86, 1.13, -0.5], left: [2.42, 0.7, -0.62], right: [2.45, 0.7, -0.38] },
}

const point = new Vector3()

/** Seated where the fit has the hips, the feet planted where it has them (`frame`: the vehicle's
 * world matrix). */
export function seat(root: Object3D, frame: Matrix4, fit: Fit, legs: Arms | null) {
  const hips = root.getObjectByName('mixamorigHips') ?? root.getObjectByName('mixamorig:Hips')
  if (!hips) return
  root.updateMatrixWorld(true)
  hips.getWorldPosition(hipsWorld)
  point.set(...fit.hips).applyMatrix4(frame)
  root.position.add(point.sub(hipsWorld))
  root.updateMatrixWorld(true)
  if (!legs) return
  const up = new Vector3(0, 1, 0)
  const ahead = new Vector3(1, 0, 0).transformDirection(frame)
  for (const leg of [legs.left, legs.right]) {
    const foot = new Vector3(...(leg === legs.left ? fit.left : fit.right)).applyMatrix4(frame)
    leg.upper.getWorldPosition(shoulder)
    // (The knee: up and ahead, as a driver's are.)
    pole.copy(shoulder).addScaledVector(up, 0.5).addScaledVector(ahead, 0.4)
    reach(leg, foot, pole)
  }
}

/** Sets a seated person's height so that their hips (as the pose has them) are at `y` (world):
 * every movement holds the hips at its own height, and a seat is where it is. */
export function hipsAt(root: Object3D, y: number) {
  const hips = root.getObjectByName('mixamorigHips') ?? root.getObjectByName('mixamorig:Hips')
  if (!hips) return
  root.updateMatrixWorld(true)
  hips.getWorldPosition(hipsWorld)
  root.position.y += y - hipsWorld.y
  root.updateMatrixWorld(true)
}
const hipsWorld = new Vector3()

/** Where the hands hold it, in the steering part's own frame: a wheel's rim at ten and two, or a
 * handlebar's two ends. Found once from its shape. */
export type Grips = { left: Vector3; right: Vector3 }
const gripsOf = new WeakMap<Object3D, Grips>()

export function grips(pivot: Object3D, kind: 'wheel' | 'bar', carRight: Vector3): Grips {
  const known = gripsOf.get(pivot)
  if (known) return known
  pivot.updateWorldMatrix(true, true)
  const toPivot = new Matrix4().copy(pivot.matrixWorld).invert()
  const box = new Box3()
  const part = new Box3()
  pivot.traverse((o) => {
    const mesh = o as Object3D & { geometry?: { boundingBox: Box3 | null; computeBoundingBox: () => void } }
    if (!mesh.geometry) return
    mesh.geometry.computeBoundingBox()
    part.copy(mesh.geometry.boundingBox!).applyMatrix4(new Matrix4().multiplyMatrices(toPivot, o.matrixWorld))
    box.union(part)
  })
  const centre = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  // Its frame's "up" and "right" as the driver sees them (the world's up, the car's right), in its plane.
  const toLocal = (v: Vector3) => v.clone().transformDirection(toPivot)
  let out: Grips
  if (kind === 'wheel') {
    // (A wheel turns about its frame's y: its rim is in x and z.)
    const flat = (v: Vector3) => v.setY(0).normalize()
    const up = flat(toLocal(new Vector3(0, 1, 0)))
    const right = flat(toLocal(carRight))
    const r = Math.max(size.x, size.z) * 0.46
    const at = (s: number) => centre.clone().addScaledVector(up, r * 0.5).addScaledVector(right, r * 0.866 * s)
    out = { left: at(-1), right: at(1) }
  } else {
    // A bar's grips: its two ends along its longest way.
    const axis = size.x >= size.y && size.x >= size.z ? new Vector3(1, 0, 0) : size.y >= size.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
    const half = (axis.x ? size.x : axis.y ? size.y : size.z) * 0.42
    const a = centre.clone().addScaledVector(axis, half)
    const b = centre.clone().addScaledVector(axis, -half)
    const right = toLocal(carRight)
    out = a.clone().sub(b).dot(right) > 0 ? { left: b, right: a } : { left: a, right: b }
  }
  gripsOf.set(pivot, out)
  return out
}

const a = new Vector3()
const b = new Vector3()
const c = new Vector3()
const want = new Vector3()
const elbow = new Vector3()
const q = new Quaternion()
const world = new Quaternion()
const parentWorld = new Quaternion()

/** Turns a bone so that its child (at `from`, world) points to `to` (world). */
function aim(bone: Bone, from: Vector3, to: Vector3) {
  bone.getWorldPosition(a)
  const cur = from.clone().sub(a).normalize()
  const goal = to.clone().sub(a).normalize()
  q.setFromUnitVectors(cur, goal)
  bone.getWorldQuaternion(world)
  world.premultiply(q)
  bone.parent!.getWorldQuaternion(parentWorld)
  bone.quaternion.copy(parentWorld.invert().multiply(world))
  bone.updateWorldMatrix(false, true)
}

/** One arm to a point (world): its elbow bent toward `pole` (world). */
function reach(arm: Arm, target: Vector3, pole: Vector3) {
  arm.upper.getWorldPosition(a)
  arm.lower.getWorldPosition(b)
  arm.hand.getWorldPosition(c)
  const upperLen = a.distanceTo(b)
  const lowerLen = b.distanceTo(c)
  want.copy(target).sub(a)
  const dist = Math.max(0.05, Math.min(upperLen + lowerLen - 0.002, want.length()))
  const dir = want.normalize()
  const cos = (upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * dist)
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
  const bend = pole.clone().sub(a)
  bend.addScaledVector(dir, -bend.dot(dir)).normalize()
  elbow.copy(a).addScaledVector(dir, cos * upperLen).addScaledVector(bend, sin * upperLen)
  aim(arm.upper, b, elbow)
  arm.lower.getWorldPosition(b)
  arm.hand.getWorldPosition(c)
  aim(arm.lower, c, target)
}

const gripWorld = new Vector3()
const pole = new Vector3()
const shoulder = new Vector3()

/** Both hands on it (after the pose for this frame): `down` and `out` (world) where the elbows go. */
export function hold(arms: Arms, pivot: Object3D, g: Grips, carRight: Vector3) {
  pivot.updateWorldMatrix(true, false)
  for (const arm of [arms.left, arms.right]) {
    gripWorld.copy(arm === arms.left ? g.left : g.right).applyMatrix4(pivot.matrixWorld)
    arm.upper.getWorldPosition(shoulder)
    // (The elbow: down, and out to its side.)
    pole.copy(shoulder).add(new Vector3(0, -0.35, 0)).addScaledVector(carRight, 0.25 * arm.side)
    reach(arm, gripWorld, pole)
  }
}
