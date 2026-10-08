// Game review: turning the engine's judgement of each position into a grade for each move.
// Pure functions, no engine in here, so every rule below is unit-tested.
//
// The measure throughout is "winning chances" (0 to 100 for the player who moved), not raw
// pawns: dropping from +9 to +6 costs nothing real, dropping from +1 to -2 costs the game.
import { Chess } from 'chess.js'
import { type Color, type PieceSymbol, type PlayedMove, START_FEN } from '../engine/chessLogic'
import type { Evaluation } from '../engine/stockfish'

export const GRADES = ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'] as const
export type Grade = (typeof GRADES)[number]

/** The engine's view of one position, always from White's side. */
export type PositionEval = {
  /** Centipawns for White; a forced mate is folded in as a very large number. */
  cp: number
  /** Moves until mate (positive: White mates), or null. */
  mate: number | null
  /** The engine's choice in this position ("e2e4"), or null when the game is over here. */
  bestMove: string | null
}

export type MoveReview = {
  ply: number
  color: Color
  grade: Grade
  /** Winning chances given up by this move, in percentage points (0 when nothing was lost). */
  loss: number
  /** What the engine would have played, when it differs from the move made. */
  better: { san: string; from: string; to: string } | null
  /** The position after the move, from White's side. */
  after: PositionEval
}

export type SideSummary = { accuracy: number; counts: Record<Grade, number> }
export type ReviewSummary = Record<Color, SideSummary>

const MATE_CP = 100_000
/**
 * The engine we ship (Stockfish 10) counts in bigger units than the usual "hundredths of a
 * pawn": it calls the starting position +0.98 where the accepted figure is about +0.3. Its
 * scores are brought onto the usual scale here, once, so everything after this line (winning
 * chances, grades, the number shown to the player) means what players expect it to mean.
 */
export const ENGINE_SCALE = 0.33
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** Converts what the engine said (from the side to move) into White's view. */
export function toWhiteView(evaluation: Evaluation, turn: Color): PositionEval {
  const sign = turn === 'w' ? 1 : -1
  if (evaluation.mate !== null) {
    // "mate 0" means the side to move is already mated. A nearer mate scores higher.
    const moves = evaluation.mate
    const forMover = (moves > 0 ? 1 : -1) * (MATE_CP - Math.abs(moves) * 100)
    return { cp: sign * forMover, mate: moves === 0 ? 0 : sign * moves, bestMove: evaluation.bestMove }
  }
  return { cp: sign * Math.round((evaluation.cp ?? 0) * ENGINE_SCALE), mate: null, bestMove: evaluation.bestMove }
}

/** A position where the game is over needs no engine: mate is lost for the side to move, the rest are level. */
export function finishedEval(fen: string): PositionEval | null {
  const chess = new Chess(fen)
  if (chess.isCheckmate()) return { cp: chess.turn() === 'w' ? -MATE_CP : MATE_CP, mate: 0, bestMove: null }
  if (chess.isGameOver()) return { cp: 0, mate: null, bestMove: null }
  return null
}

/** Winning chances for White, 0 to 100, from a centipawn score. */
export function winChance(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/** How precise one move was, 0 to 100, from the winning chances it gave up. */
export function moveAccuracy(loss: number): number {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669))
}

/**
 * Whether a move gave up material on purpose: the piece that moved now stands where a cheaper
 * piece can take it, or where it can be taken and nothing defends it, and the move did not
 * already win as much as it risks.
 */
function isSacrifice(fenBefore: string, move: PlayedMove): boolean {
  const before = new Chess(fenBefore)
  const mover = before.get(move.from)
  if (!mover || mover.type === 'p' || mover.type === 'k') return false
  const taken = before.get(move.to)
  const after = new Chess(move.fenAfter)
  const them: Color = move.color === 'w' ? 'b' : 'w'
  const attackers = after.attackers(move.to, them)
  if (attackers.length === 0) return false
  const risked = VALUE[after.get(move.to)?.type ?? mover.type] - (taken ? VALUE[taken.type] : 0)
  if (risked < 2) return false
  const cheapest = Math.min(...attackers.map((square) => VALUE[after.get(square)!.type] || 99))
  const defended = after.attackers(move.to, move.color).length > 0
  return cheapest < VALUE[mover.type] || !defended
}

/**
 * Grades every move of a game. `positions` holds the engine's view of each position: index 0 is
 * the start, index n the position after move n (so it is one longer than `played`).
 */
export function reviewGame(played: readonly PlayedMove[], positions: readonly PositionEval[]): MoveReview[] {
  const reviews: MoveReview[] = []
  for (let i = 0; i < played.length; i++) {
    const move = played[i]!
    const before = positions[i]
    const after = positions[i + 1]
    if (!before || !after) break

    const side = move.color === 'w' ? 1 : -1
    const chanceBefore = winChance(side * before.cp)
    const chanceAfter = winChance(side * after.cp)
    const loss = Math.max(0, chanceBefore - chanceAfter)
    const fenBefore = i === 0 ? START_FEN : played[i - 1]!.fenAfter
    const wasBest = before.bestMove === move.uci

    let grade: Grade
    if (wasBest || loss < 0.5) grade = 'best'
    else if (loss < 2) grade = 'excellent'
    else if (loss < 5) grade = 'good'
    else if (loss < 10) grade = 'inaccuracy'
    else if (loss < 20) grade = 'mistake'
    else grade = 'blunder'

    // Brilliant: the right move, and it gives up material to be right. Not handed out when the
    // game was already won or is still lost afterwards.
    if (grade === 'best' && chanceBefore < 92 && chanceAfter >= 50 && isSacrifice(fenBefore, move)) grade = 'brilliant'

    // Miss: the opponent had just gone wrong and this move let them off, without losing the
    // game outright (that is a blunder in its own right).
    const previous = reviews[i - 1]
    if ((grade === 'mistake' || grade === 'blunder') && previous && previous.loss >= 10 && chanceAfter >= 30) grade = 'miss'

    let better: MoveReview['better'] = null
    if (!wasBest && grade !== 'best' && before.bestMove) {
      try {
        const probe = new Chess(fenBefore)
        const best = probe.move({ from: before.bestMove.slice(0, 2), to: before.bestMove.slice(2, 4), promotion: before.bestMove[4] })
        better = { san: best.san, from: best.from, to: best.to }
      } catch {
        // An engine move that does not replay is simply not shown.
      }
    }

    reviews.push({ ply: move.ply, color: move.color, grade, loss, better, after })
  }
  return reviews
}

export function summarise(reviews: readonly MoveReview[]): ReviewSummary {
  const side = (color: Color): SideSummary => {
    const own = reviews.filter((r) => r.color === color)
    const counts = Object.fromEntries(GRADES.map((grade) => [grade, 0])) as Record<Grade, number>
    for (const review of own) counts[review.grade]++
    const accuracy = own.length === 0 ? 0 : own.reduce((sum, r) => sum + moveAccuracy(r.loss), 0) / own.length
    return { accuracy: Math.round(accuracy * 10) / 10, counts }
  }
  return { w: side('w'), b: side('b') }
}

/** The score as players write it: "+1.3", "-0.4", "M3" (White mates in 3), "-M2". */
export function formatEval(position: PositionEval): string {
  if (position.mate !== null) {
    if (position.mate === 0) return position.cp > 0 ? '1-0' : '0-1'
    return `${position.mate < 0 ? '-' : ''}M${Math.abs(position.mate)}`
  }
  const pawns = position.cp / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`
}
