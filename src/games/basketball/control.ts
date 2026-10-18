// Practice two against two: the player controls one of their side's two players at a time,
// the computer plays the other.
import type { Game } from '../../../supabase/functions/_shared/basketball'

/** The player's side in practice. */
export const MY_TEAM = 0

/**
 * Who the player controls on their side, as in a football game: whoever has the ball when the
 * side has it (a pass caught hands the controls over, the buttons still held); when the other
 * side wins it, the one nearest the ball handler, to defend. Otherwise the same as before.
 */
export function controlled(game: Game, current: number, before: number | null): number {
  const holder = game.ball.holder
  if (holder === null || holder === before) return current
  const carrier = game.players.find((p) => p.id === holder)!
  if (carrier.team === MY_TEAM) return holder
  const mine = game.players.filter((p) => p.team === MY_TEAM)
  return mine.reduce((a, b) => (Math.hypot(a.x - carrier.x, a.z - carrier.z) <= Math.hypot(b.x - carrier.x, b.z - carrier.z) ? a : b)).id
}

