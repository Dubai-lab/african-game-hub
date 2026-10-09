// The computer opponent for practice games. It looks ahead through the same rules file the
// server judges with, and picks the line that leaves it best off. Nothing here is used in
// games between people.
import { type Board, type Cells, type Color, generate, play, rowOf, colOf, toCells } from '../../../supabase/functions/_shared/draughts'

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
  { id: 'easy', depth: 2, timeMs: 150, slip: 0.3 },
  { id: 'medium', depth: 4, timeMs: 300, slip: 0.06 },
  { id: 'hard', depth: 8, timeMs: 700, slip: 0 },
  { id: 'expert', depth: 18, timeMs: 1600, slip: 0 },
]
export const DEFAULT_LEVEL: LevelId = 'medium'
export const levelById = (id: unknown): Level => LEVELS.find((level) => level.id === id) ?? LEVELS[1]!

const MAN = 100
const KING = 290
const WON = 1_000_000

/** How good a position is for White: pieces first, then how far the men have come and how central they stand. */
function evaluate(cells: Cells): number {
  let score = 0
  let whiteMen = 0
  let blackMen = 0
  for (let i = 0; i < 50; i++) {
    const piece = cells[i]!
    if (piece === 0) continue
    const row = rowOf(i)
    const col = colOf(i)
    const central = 4 - Math.abs(col - 4.5) // 0.5 at the edge, 3.5 in the middle
    if (piece === 1) {
      whiteMen++
      // A man on its own back row keeps the opponent from crowning.
      score += MAN + (9 - row) * 3 + central * 2 + (row === 9 ? 8 : 0)
    } else if (piece === -1) {
      blackMen++
      score -= MAN + row * 3 + central * 2 + (row === 0 ? 8 : 0)
    } else if (piece === 2) score += KING + central
    else score -= KING + central
  }
  // With few men left, being a man up matters more.
  const men = whiteMen + blackMen
  if (men > 0 && men < 12) score += (whiteMen - blackMen) * (12 - men)
  return score
}

class OutOfTime extends Error {}

/**
 * The move the computer plays in this position, as the squares its piece visits (numbered
 * 1-50). Null only when it has no move at all.
 */
export function chooseMove(board: Board, turn: Color, level: Level, random: () => number = Math.random): number[] | null {
  const root = toCells(board)
  const moves = generate(root, turn)
  if (moves.length === 0) return null
  const numbered = (index: number) => moves[index]!.path.map((square) => square + 1)
  if (moves.length === 1) return numbered(0)
  if (random() < level.slip) return numbered(Math.floor(random() * moves.length))

  const deadline = Date.now() + level.timeMs
  let nodes = 0

  const search = (cells: Cells, side: Color, depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) throw new OutOfTime()
    const options = generate(cells, side)
    // No move is a loss; sooner is worse.
    if (options.length === 0) return -WON + ply
    // Never stop to judge a position in the middle of an exchange.
    if (depth <= 0 && options[0]!.captures.length === 0) return side === 'w' ? evaluate(cells) : -evaluate(cells)
    const other: Color = side === 'w' ? 'b' : 'w'
    let best = -Infinity
    for (const option of options) {
      const score = -search(play(cells, option).cells, other, depth - 1, -beta, -alpha, ply + 1)
      if (score > best) best = score
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best
  }

  // Start from a shuffled list, so equal moves are not always answered the same way.
  let order = moves.map((_, index) => index)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  let chosen = order[0]!
  const other: Color = turn === 'w' ? 'b' : 'w'
  try {
    for (let depth = 1; depth <= level.depth; depth++) {
      let best = -Infinity
      let bestIndex = order[0]!
      for (const index of order) {
        const score = -search(play(root, moves[index]!).cells, other, depth - 1, -Infinity, -best, 1)
        if (score > best) {
          best = score
          bestIndex = index
        }
      }
      chosen = bestIndex
      // The best move so far is looked at first next time round.
      order = [bestIndex, ...order.filter((index) => index !== bestIndex)]
      if (Math.abs(best) > WON - 1000) break
    }
  } catch (error) {
    if (!(error instanceof OutOfTime)) throw error
  }
  return numbered(chosen)
}
