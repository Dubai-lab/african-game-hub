// One Africa Life: the player's own car (the family's, parked by the house's gate; later, the
// ones bought): walked up to, got into by its driver's door (opened, shut behind), driven with
// the stick (up: on; down: brake, then back; left and right: steer), as a car is (it goes where
// its front wheels point), stopped by what it meets (a wall, a building, another vehicle: never
// through it), seen from behind it or from the driver's seat, got out of where it stands.
import type { CarModel } from './cars'
import type { Drive } from './driving'

export type OwnCarPhase = 'parked' | 'entering' | 'driving' | 'leaving'
export type OwnCarView = 'outside' | 'inside'

export type OwnCar = {
  model: CarModel | null
  /** Where it is and how it goes (as the town's cars: ./driving.ts's Drive). */
  d: Drive | null
  phase: OwnCarPhase
  view: OwnCarView
  /** The door's swing (seconds into getting in or out). */
  t: number
  /** What the page asks (read and cleared by the walker each frame). */
  request: 'in' | 'out' | 'view' | 'horn' | null
  /** Told the page when its phase changes. */
  onPhase?: (phase: OwnCarPhase) => void
}

export const ownCar: OwnCar = { model: null, d: null, phase: 'parked', view: 'outside', t: 0, request: null }
// (For tests: where it is.)
if (typeof window !== 'undefined') (window as unknown as { oalOwnCar: OwnCar }).oalOwnCar = ownCar

const ACCEL = 3.4
const BRAKE = 8
const REVERSE = 4.5
const TOP = 22
const MAX_STEER = 0.6

/** One step of the player's driving: the stick's throttle (+ on, - brake then back) and steering. */
export function driveOwn(d: Drive, dt: number, throttle: number, steer: number) {
  const want = -steer * MAX_STEER * (1 - Math.min(0.55, Math.abs(d.v) / 40))
  d.steer += Math.max(-1.8 * dt, Math.min(1.8 * dt, want - d.steer))
  if (throttle > 0.05) {
    if (d.v < -0.2) d.v = Math.min(0, d.v + BRAKE * throttle * dt)
    else d.v = Math.min(TOP, d.v + ACCEL * throttle * (1 - d.v / (TOP * 1.15)) * dt)
  } else if (throttle < -0.05) {
    if (d.v > 0.2) d.v = Math.max(0, d.v + BRAKE * throttle * dt)
    else d.v = Math.max(-REVERSE, d.v + ACCEL * 0.7 * throttle * dt)
  } else {
    // Rolling to a stop (the road's drag).
    d.v -= Math.sign(d.v) * Math.min(Math.abs(d.v), 1.1 * dt + Math.abs(d.v) * 0.04 * dt)
  }
  d.braking = (throttle < -0.05 && d.v > 0.1) || (throttle > 0.05 && d.v < -0.1)
  d.yawRate = (d.v / d.L) * Math.tan(d.steer)
  return { yaw: d.yaw + d.yawRate * dt, dist: d.v * dt }
}

/** Points round a car's outline (corners, the middles of its sides), for what it may hit. */
export function outline(x: number, y: number, yaw: number, len: number, wide: number) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const out: [number, number][] = []
  for (const u of [-0.5, -0.25, 0, 0.25, 0.5])
    for (const v of [-0.5, 0.5]) {
      const a = u * len
      const b = v * wide
      out.push([x + c * a - s * b, y + s * a + c * b])
    }
  out.push([x + c * len * 0.5, y + s * len * 0.5], [x - c * len * 0.5, y - s * len * 0.5])
  return out
}
