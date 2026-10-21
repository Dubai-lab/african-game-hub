// One Africa Life: the player's own car (the family's, parked by the house's gate; later, the
// ones bought): walked up to, got into by its driver's door (opened, shut behind), driven as a car
// with an automatic gearbox is (its wheel, its pedals, P R N D, its handbrake, its indicators and
// lamps: on the screen, by the keys, by a gamepad or a steering wheel), as a car is (it goes where
// its front wheels point), stopped by what it meets (a wall, a building, another vehicle: never
// through it), seen from behind it or from the driver's seat, got out of where it stands.
import type { CarModel } from './cars'
import type { Drive } from './driving'

export type OwnCarPhase = 'parked' | 'entering' | 'driving' | 'leaving'
export type OwnCarView = 'outside' | 'inside'
export type Gear = 'P' | 'R' | 'N' | 'D'
export type Indicator = 'off' | 'left' | 'right' | 'hazard'

/** What the driver does (the screen's wheel and pedals, the keys, a gamepad or a steering wheel):
 * the wheel (-1 full left .. 1 full right), the accelerator and the brake (0 .. 1), the gear, the
 * handbrake, the indicators, the headlamps. */
export type Controls = { wheel: number; gas: number; brake: number; gear: Gear; handbrake: boolean; indicator: Indicator; lights: boolean }

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
  controls: Controls
  /** Its speed (km/h) and the engine's turning (0 idle .. 1), for the dials. */
  kmh: number
  rpm: number
  /** Sliding (the handbrake pulled at speed): the tyres heard. */
  sliding: boolean
  /** The indicators' flash (on, off). */
  blink: boolean
}

export const ownCar: OwnCar = { model: null, d: null, phase: 'parked', view: 'outside', t: 0, request: null, controls: { wheel: 0, gas: 0, brake: 0, gear: 'P', handbrake: false, indicator: 'off', lights: false }, kmh: 0, rpm: 0, sliding: false, blink: false }
// (For tests: where it is.)
if (typeof window !== 'undefined') (window as unknown as { oalOwnCar: OwnCar }).oalOwnCar = ownCar

const ACCEL = 3.6
const BRAKE = 8.5
const HANDBRAKE = 6
const REVERSE_TOP = 6
const TOP = 25
const MAX_STEER = 0.6

/**
 * One step of the player's driving, as a car with an automatic gearbox is driven: in D the
 * accelerator takes it on (less as it nears its top speed), in R back; in N it rolls; in P it
 * holds. The brake slows it (and holds it still); the handbrake locks the back wheels (pulled at
 * speed with the wheel turned, the back swings round). The wheel turns the front wheels (less at
 * speed, as a car's steering is). Returns its new heading and how far it goes.
 */
export function driveCar(d: Drive, dt: number, c: Controls) {
  const want = -c.wheel * MAX_STEER * (1 - Math.min(0.55, Math.abs(d.v) / 40))
  d.steer += Math.max(-2.2 * dt, Math.min(2.2 * dt, want - d.steer))
  const dir = c.gear === 'R' ? -1 : 1
  const drive = c.gear === 'D' || c.gear === 'R' ? c.gas : 0
  const top = c.gear === 'R' ? REVERSE_TOP : TOP
  // The engine's pull (forward in D, back in R), the brakes', the road's drag.
  if (drive > 0.02 && Math.sign(d.v || dir) === dir) d.v += dir * ACCEL * drive * Math.max(0, 1 - Math.abs(d.v) / (top * 1.1)) * dt
  else if (drive > 0.02) d.v += dir * BRAKE * 0.6 * drive * dt
  const stop = (rate: number) => (d.v -= Math.sign(d.v) * Math.min(Math.abs(d.v), rate * dt))
  if (c.brake > 0.02) stop(BRAKE * c.brake)
  if (c.handbrake) stop(HANDBRAKE)
  if (c.gear === 'P') stop(BRAKE * 2)
  if (drive <= 0.02) stop(0.9 + Math.abs(d.v) * 0.04)
  d.braking = c.brake > 0.05 || (c.handbrake && Math.abs(d.v) > 0.5)
  // Turning: as its front wheels point; the back let go (handbrake at speed): it swings round more.
  const sliding = c.handbrake && Math.abs(d.v) > 6 && Math.abs(d.steer) > 0.15
  d.yawRate = (d.v / d.L) * Math.tan(d.steer) * (sliding ? 1.7 : 1)
  return { yaw: d.yaw + d.yawRate * dt, dist: d.v * dt, sliding }
}

/** The keys (on a computer) and a gamepad or steering wheel (its standard mapping), as controls. */
export function readInputs(c: Controls, keys: Set<string>, dt: number, v: number) {
  const k = (...names: string[]) => names.some((n) => keys.has(n))
  // The keys: up the accelerator (into D from P or N; from R once stopped), down the brake (held
  // stopped, into R), left and right turn the wheel (back to the middle let go), space the handbrake.
  const up = k('arrowup', 'w')
  const down = k('arrowdown', 's')
  if (up) {
    if (c.gear === 'P' || c.gear === 'N' || (c.gear === 'R' && Math.abs(v) < 0.3)) c.gear = 'D'
    c.gas = c.gear === 'D' ? Math.min(1, c.gas + dt * 3) : 0
    c.brake = c.gear === 'R' ? 1 : 0
  } else if (down) {
    if (c.gear === 'R') c.gas = Math.min(1, c.gas + dt * 3), (c.brake = 0)
    else if (Math.abs(v) < 0.3 && c.gear === 'D') c.gear = 'R'
    else (c.brake = 1), (c.gas = 0)
  } else if (keyPedal) {
    c.gas = 0
    c.brake = 0
  }
  keyPedal = up || down
  const steerKey = (k('arrowright', 'd') ? 1 : 0) - (k('arrowleft', 'a') ? 1 : 0)
  if (steerKey) c.wheel = Math.max(-1, Math.min(1, c.wheel + steerKey * dt * 2.2))
  else if (keySteer) c.wheel -= Math.sign(c.wheel) * Math.min(Math.abs(c.wheel), dt * 3)
  keySteer = steerKey !== 0 || (keySteer && Math.abs(c.wheel) > 0.01)
  if (k(' ')) c.handbrake = true
  else if (keyHand) c.handbrake = false
  keyHand = k(' ')
  // A gamepad, or a steering wheel and its pedals (the standard mapping: the left stick or the
  // wheel, the right trigger the accelerator, the left the brake, A the handbrake, the shoulders
  // the gears down and up).
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
  for (const pad of pads) {
    if (!pad) continue
    const x = pad.axes[0] ?? 0
    const gas = pad.buttons[7]?.value ?? 0
    const brake = pad.buttons[6]?.value ?? 0
    const shift = (pad.buttons[5]?.pressed ? 1 : 0) - (pad.buttons[4]?.pressed ? 1 : 0)
    if (shift && !padShift) {
      const order: Gear[] = ['P', 'R', 'N', 'D']
      c.gear = order[Math.max(0, Math.min(3, order.indexOf(c.gear) + shift))]!
    }
    padShift = shift !== 0
    if (Math.abs(x) > 0.08 || gas > 0.02 || brake > 0.02) padUsed = true
    if (!padUsed) continue
    c.wheel = Math.abs(x) > 0.05 ? x : 0
    c.gas = gas
    c.brake = brake
    c.handbrake = Boolean(pad.buttons[0]?.pressed)
    if (gas > 0.1 && (c.gear === 'P' || c.gear === 'N')) c.gear = 'D'
  }
}
let keyPedal = false
let keySteer = false
let keyHand = false
let padUsed = false
let padShift = false

/** The gears by key (P, R, N, and F for drive), the lamps (L), the indicators (Q, E; X both). */
export function keyCommand(c: Controls, key: string) {
  const g: Record<string, Gear> = { p: 'P', r: 'R', n: 'N', f: 'D' }
  if (g[key]) c.gear = g[key]
  if (key === 'l') c.lights = !c.lights
  if (key === 'q') c.indicator = c.indicator === 'left' ? 'off' : 'left'
  if (key === 'e') c.indicator = c.indicator === 'right' ? 'off' : 'right'
  if (key === 'x') c.indicator = c.indicator === 'hazard' ? 'off' : 'hazard'
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
