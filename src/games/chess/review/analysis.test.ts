import { describe, expect, it } from 'vitest'
import { replay } from '../engine/chessLogic'
import { ENGINE_SCALE, finishedEval, formatEval, moveAccuracy, type PositionEval, reviewGame, summarise, toWhiteView, winChance } from './analysis'

const at = (cp: number, bestMove: string | null = null): PositionEval => ({ cp, mate: null, bestMove })

describe('reading the engine', () => {
  it('turns a score for the side to move into a score for White', () => {
    const scaled = Math.round(300 * ENGINE_SCALE)
    expect(toWhiteView({ cp: 300, mate: null, bestMove: 'e2e4' }, 'w')).toEqual({ cp: scaled, mate: null, bestMove: 'e2e4' })
    expect(toWhiteView({ cp: 300, mate: null, bestMove: 'e7e5' }, 'b')).toEqual({ cp: -scaled, mate: null, bestMove: 'e7e5' })
    // What this engine says about the starting position comes out near the accepted +0.3.
    expect(toWhiteView({ cp: 98, mate: null, bestMove: 'e2e4' }, 'w').cp).toBeGreaterThan(25)
    expect(toWhiteView({ cp: 98, mate: null, bestMove: 'e2e4' }, 'w').cp).toBeLessThan(40)
  })

  it('treats a forced mate as decisive, and a nearer mate as better', () => {
    const whiteMates = toWhiteView({ cp: null, mate: 3, bestMove: 'd1h5' }, 'w')
    expect(whiteMates.mate).toBe(3)
    expect(whiteMates.cp).toBeGreaterThan(90_000)
    expect(toWhiteView({ cp: null, mate: 1, bestMove: 'd1h5' }, 'w').cp).toBeGreaterThan(whiteMates.cp)
    // Black to move and mating: bad for White.
    expect(toWhiteView({ cp: null, mate: 2, bestMove: 'd8h4' }, 'b')).toMatchObject({ mate: -2 })
    expect(toWhiteView({ cp: null, mate: 2, bestMove: 'd8h4' }, 'b').cp).toBeLessThan(-90_000)
    // Black to move and being mated: good for White.
    expect(toWhiteView({ cp: null, mate: -2, bestMove: 'g8h8' }, 'b').cp).toBeGreaterThan(90_000)
  })

  it('needs no engine for a finished game', () => {
    const mate = replay(['f3', 'e5', 'g4', 'Qh4#']).played.at(-1)!.fenAfter
    expect(finishedEval(mate)).toMatchObject({ mate: 0, bestMove: null })
    expect(finishedEval(mate)!.cp).toBeLessThan(0)
    expect(finishedEval('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ cp: 0, mate: null, bestMove: null })
    expect(finishedEval(replay(['e4']).played[0]!.fenAfter)).toBeNull()
  })

  it('winning chances are level at 0 and flatten out when far ahead', () => {
    expect(winChance(0)).toBe(50)
    expect(winChance(100)).toBeGreaterThan(58)
    expect(winChance(100)).toBeLessThan(60)
    expect(winChance(600) - winChance(900)).toBeGreaterThan(-8)
    expect(winChance(-300)).toBeCloseTo(100 - winChance(300))
    expect(moveAccuracy(0)).toBeCloseTo(100, 2)
    expect(moveAccuracy(50)).toBeLessThan(10)
  })

  it('writes scores the way players do', () => {
    expect(formatEval(at(130))).toBe('+1.3')
    expect(formatEval(at(-45))).toBe('-0.5')
    expect(formatEval({ cp: 99_700, mate: 3, bestMove: null })).toBe('M3')
    expect(formatEval({ cp: -99_800, mate: -2, bestMove: null })).toBe('-M2')
    expect(formatEval({ cp: -100_000, mate: 0, bestMove: null })).toBe('0-1')
  })
})

describe('grading moves', () => {
  it('the engine’s own choice is best; small slips are excellent or good; big ones mistakes and blunders', () => {
    const { played } = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'd3', 'a6'])
    const positions = [
      at(30, 'e2e4'), // 1. e4 is the engine's move: best
      at(30, 'c7c5'), // 1... e5 loses nothing measurable: best
      at(32, 'g1f3'), // 2. Nf3: best
      at(32, 'b8c6'), // 2... Nc6: best
      at(30, 'f1b5'), // 3. Bc4 gives up about 1 point of chances: excellent
      at(20, 'g8f6'), // 3... h6 gives up about 4: good
      at(60, 'd2d4'), // 4. d3 gives up about 7: inaccuracy
      at(-20, 'g8f6'), // 4... a6 gives up about 27: blunder
      at(300),
    ]
    const grades = reviewGame(played, positions).map((r) => r.grade)
    expect(grades).toEqual(['best', 'best', 'best', 'best', 'excellent', 'good', 'inaccuracy', 'blunder'])
  })

  it('says what would have been better, in notation, only when the move was not best', () => {
    const { played } = replay(['e4', 'e5', 'Ke2'])
    const reviews = reviewGame(played, [at(30, 'e2e4'), at(30, 'e7e5'), at(30, 'g1f3'), at(-150)])
    expect(reviews[0]!.better).toBeNull()
    expect(reviews[2]).toMatchObject({ grade: 'mistake', better: { san: 'Nf3', from: 'g1', to: 'f3' } })
  })

  it('a miss: the opponent blundered and the reply let them off', () => {
    const { played } = replay(['e4', 'e5', 'Qh5', 'Ke7', 'a3'])
    // 2... Ke7 walks into mate in one (Qxe5#); 3. a3 misses it but White is still fine.
    const reviews = reviewGame(played, [at(30, 'e2e4'), at(30, 'e7e5'), at(20, 'g1f3'), at(0, 'b8c6'), { cp: 99_900, mate: 1, bestMove: 'h5e5' }, at(150)])
    expect(reviews[3]!.grade).toBe('blunder')
    expect(reviews[4]).toMatchObject({ grade: 'miss', better: { san: 'Qxe5#' } })
  })

  it('throwing the game away is a blunder, not a miss, whatever came before', () => {
    const { played } = replay(['e4', 'e5', 'Qh5', 'Ke7', 'Qxh7'])
    const reviews = reviewGame(played, [at(30), at(30), at(20), at(0), { cp: 99_900, mate: 1, bestMove: 'h5e5' }, at(-700)])
    expect(reviews[4]!.grade).toBe('blunder')
  })

  it('brilliant: the best move, and it leaves a piece to be taken', () => {
    // Légal's mate: 5. Nxe5 gives up the queen, and it is the engine's choice.
    const { played } = replay(['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5'])
    const positions = [at(30), at(30), at(30), at(30), at(40), at(40), at(40), at(40), at(250, 'f3e5'), at(260)]
    expect(reviewGame(played, positions).at(-1)!.grade).toBe('brilliant')
    // The same move in a position that was already won is just the best move.
    const won = positions.map((p, i) => (i >= 8 ? { ...p, cp: 900 } : p))
    expect(reviewGame(played, won).at(-1)!.grade).toBe('best')
  })

  it('an ordinary best move, a pawn push or a safe capture is never brilliant', () => {
    const { played } = replay(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3'])
    const reviews = reviewGame(played, [at(30, 'e2e4'), at(30, 'e7e5'), at(60, 'e4d5'), at(60, 'd8d5'), at(60, 'b1c3'), at(60)])
    expect(reviews.map((r) => r.grade)).toEqual(['best', 'good', 'best', 'best', 'best'])
  })

  it('stops at the last position it was given (analysis still running)', () => {
    const { played } = replay(['e4', 'e5', 'Nf3'])
    expect(reviewGame(played, [at(30), at(30)])).toHaveLength(1)
  })
})

describe('summary', () => {
  it('counts each side’s grades and averages accuracy per side', () => {
    const { played } = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'd3', 'a6'])
    const reviews = reviewGame(played, [at(30, 'e2e4'), at(30), at(32, 'g1f3'), at(32, 'b8c6'), at(30), at(20), at(60), at(-20), at(300)])
    const summary = summarise(reviews)
    expect(summary.w.counts).toMatchObject({ best: 2, excellent: 1, inaccuracy: 1, blunder: 0 })
    expect(summary.b.counts).toMatchObject({ best: 2, good: 1, blunder: 1 })
    expect(summary.w.accuracy).toBeGreaterThan(summary.b.accuracy)
    expect(summary.w.accuracy).toBeLessThanOrEqual(100)
    expect(summarise([]).w.accuracy).toBe(0)
  })
})
