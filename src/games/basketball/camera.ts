// The street basketball camera's turn, as the player's finger sets it, and what the stick means
// under it. Drawn in Court3D.tsx (Follow); turned in Controls.tsx.

/**
 * The camera, turned by the player's finger: `yaw` is the way it looks across the court (0 looks
 * down +z, π toward the basket), `pitch` how far it looks down. The camera sits behind the
 * player at this screen and turns around him, as in a third-person game.
 */
export type View = { yaw: number; pitch: number }
export const PITCH = { min: 0.1, max: 0.85, start: 0.3 } as const
export const newView = (): View => ({ yaw: Math.PI, pitch: PITCH.start })

/** A direction pushed on the screen (right, down) as a direction on the court, for the camera turned to `yaw`. */
export function screenToCourt(right: number, down: number, yaw: number): { x: number; z: number } {
  const ahead = { x: Math.sin(yaw), z: Math.cos(yaw) }
  const side = { x: -ahead.z, z: ahead.x }
  return { x: side.x * right - ahead.x * down, z: side.z * right - ahead.z * down }
}

/**
 * The end of a game, before the result: the camera close on the winners' faces as they
 * celebrate, then on the losers (milliseconds).
 */
export const ENDING = { winners: 3400, losers: 2800 } as const
export const ENDING_MS = ENDING.winners + ENDING.losers
