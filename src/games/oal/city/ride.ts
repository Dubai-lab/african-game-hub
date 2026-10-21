// One Africa Life: a ride in town, as it happens (./CityTraffic.tsx drives it, ./CityScene.tsx
// seats the player, ../Street.tsx asks and pays). At the roadside the player waves down a taxi
// or a kekeh; one comes along the road and pulls in beside them; the driver asks where to; the
// fare paid, the player gets in and is driven there by the roads (the shortest way, one-way
// roads the right way), seen all the way; pulled in near the place, the player gets out.
import type { Leg } from './cityGen'

export type RideKind = 'taxi' | 'kekeh'
export type RidePhase = 'none' | 'coming' | 'waiting' | 'riding' | 'arrived'

/** Where the town's rides can take one (a place's name and its point on the map). */
export type Destination = { name: string; x: number; y: number }

/** What the page asks of the ride (read and cleared by the traffic each frame). */
export type RideRequest = { type: 'hail'; kind: RideKind } | { type: 'go'; to: Destination } | { type: 'cancel' } | { type: 'out' }

export type RideState = {
  phase: RidePhase
  kind: RideKind
  request: RideRequest | null
  /** The hired vehicle: its route (legs), where on it, where it stops on the last. */
  legs: Leg[]
  leg: number
  s: number
  stop: number
  v: number
  /** Where the vehicle is now, for the camera and the seat. */
  pos: { x: number; y: number; yaw: number }
  to: Destination | null
  /** Metres left to drive. */
  left: number
  /** Driven three times as fast (still seen). */
  fast: boolean
  /** Where the player steps out (town metres, facing). */
  exit: { x: number; y: number; f: number } | null
}

export const newRide = (): RideState => ({ phase: 'none', kind: 'taxi', request: null, legs: [], leg: 0, s: 0, stop: 0, v: 0, pos: { x: 0, y: 0, yaw: 0 }, to: null, left: 0, fast: false, exit: null })

/** Where the passenger sits, in the vehicle's own frame (x ahead, y up, z to its right). */
export const PASSENGER: Record<RideKind, [number, number, number]> = { taxi: [-0.69, -0.03, 0.38], kekeh: [-0.55, 0.22, 0] }
