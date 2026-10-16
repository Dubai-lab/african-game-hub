// The computer opponent for practice games. It looks ahead through the same rules file the
// server judges with, and picks the line that leaves it best off. Nothing here is used in games
// between people.
import { applyMove, legalPits, type OwareState, type Side } from '../../../supabase/functions/_shared/oware'

export type LevelId = 'easy' | 'medium' | 'hard' | 'expert'
export type Level = {
  id: LevelId
  /** How many moves ahead it looks, at most. */
  depth: number
  /** How long it may think, at most. */
  timeMs: number
  /** How often it plays any move at all instead of its best. */
  slip: number
}

export const LEVELS: Level[] = [
  { id: 'easy', depth: 2, timeMs: 120, slip: 0.35 },
  { id: 'medium', depth: 4, timeMs: 250, slip: 0.08 },
  { id: 'hard', depth: 8, timeMs: 600, slip: 0 },
  { id: 'expert', depth: 16, timeMs: 1500, slip: 0 },
]
export const DEFAULT_LEVEL: LevelId = 'medium'
export const levelById = (id: unknown): Level => LEVELS.find((level) => level.id === id) ?? LEVELS[1]!

const WON = 1_000_000

/** How good a position is for the side to move: seeds taken first, then seeds kept at home to play with. */
function evaluate(state: OwareState, side: Side): number {
  const them: Side = side === 's' ? 'n' : 's'
  const home = (who: Side) => state.pits.slice(who === 's' ? 0 : 6, who === 's' ? 6 : 12).reduce((a, b) => a + b, 0)
  return (state.stores[side] - state.stores[them]) * 100 + (home(side) - home(them)) * 3
}

class OutOfTime extends Error {}

/** The pit the computer plays in this position. Null only when it has no move at all. */
export function choosePit(state: OwareState, level: Level, random: () => number = Math.random): number | null {
  const moves = legalPits(state)
  if (moves.length === 0) return null
  if (moves.length === 1) return moves[0]!
  if (random() < level.slip) return moves[Math.floor(random() * moves.length)]!

  const deadline = Date.now() + level.timeMs
  let nodes = 0

  const search = (position: OwareState, depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new OutOfTime()
    if (depth <= 0) return evaluate(position, position.turn)
    let best = -Infinity
    for (const pit of legalPits(position)) {
      const step = applyMove(position, pit)!
      let score: number
      if (step.result) {
        // A won game is worth the most, and sooner is better; a draw is worth nothing.
        const mover = position.turn
        score = step.result.winner === null ? 0 : step.result.winner === mover ? WON - ply : -WON + ply
      } else {
        score = -search(step.state, depth - 1, -beta, -alpha, ply + 1)
      }
      if (score > best) best = score
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best
  }

  // Start from a shuffled list, so equal moves are not always answered the same way.
  let order = [...moves]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  let chosen = order[0]!
  try {
    for (let depth = 1; depth <= level.depth; depth++) {
      let best = -Infinity
      let bestPit = order[0]!
      for (const pit of order) {
        const step = applyMove(state, pit)!
        const score = step.result
          ? step.result.winner === null
            ? 0
            : step.result.winner === state.turn
              ? WON
              : -WON
          : -search(step.state, depth - 1, -Infinity, -best, 1)
        if (score > best) {
          best = score
          bestPit = pit
        }
      }
      chosen = bestPit
      // The best move so far is looked at first next time round.
      order = [bestPit, ...order.filter((pit) => pit !== bestPit)]
      if (Math.abs(best) > WON - 1000) break
    }
  } catch (error) {
    if (!(error instanceof OutOfTime)) throw error
  }
  return chosen
}
