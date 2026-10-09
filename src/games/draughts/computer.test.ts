import { describe, expect, it } from 'vitest'
import { applyMove, type Board, initialState } from '../../../supabase/functions/_shared/draughts'
import { chooseMove, type Level } from './computer'

// The practice opponent: it must only ever play legal moves, see a simple win of material, and
// the stronger setting must really be stronger.

const position = (pieces: Partial<Record<'w' | 'W' | 'b' | 'B', number[]>>): Board => {
  const board = '.'.repeat(50).split('')
  for (const [piece, squares] of Object.entries(pieces)) for (const square of squares) board[square - 1] = piece
  return board.join('')
}
const level = (depth: number, slip = 0): Level => ({ id: 'hard', depth, timeMs: 60_000, slip })
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

describe('the computer', () => {
  it('has no move when it has no pieces, and plays the only move when there is one', () => {
    expect(chooseMove(position({ w: [33] }), 'b', level(4))).toBeNull()
    expect(chooseMove(position({ w: [33], b: [28] }), 'w', level(4))).toEqual([33, 22])
  })

  it('does not put a piece where it is simply taken for nothing', () => {
    // 33-28 or 33-29 would walk into the man on 23 or 24 with nothing behind to take back.
    const path = chooseMove(position({ w: [33, 48], b: [23, 24, 19, 20] }), 'w', level(4), seeded(3))!
    expect(path[0]).toBe(48)
  })

  it('looks before it leaps: does not walk into a capture of three', () => {
    // 27-22 looks like an exchange, but the man on 17 would take three in one move; 27-21
    // simply loses a man.
    const path = chooseMove(position({ w: [27, 31, 32], b: [18, 17, 3] }), 'w', level(4), seeded(5))!
    expect(path[0]).not.toBe(27)
  })

  it('plays whole games of legal moves, and the deeper search beats the careless one', () => {
    let strongWins = 0
    for (let game = 0; game < 4; game++) {
      const random = seeded(11 + game)
      const strong = game % 2 === 0 ? 'w' : 'b'
      let state = initialState()
      let result = null
      for (let ply = 0; ply < 300 && !result; ply++) {
        const path = chooseMove(state.board, state.turn, state.turn === strong ? level(5) : level(1, 0.3), random)!
        const step = applyMove(state, path)
        expect(step, `ply ${ply}: ${path.join('-')}`).not.toBeNull()
        state = step!.state
        result = step!.result
      }
      if (result?.winner === strong) strongWins++
      else expect(result?.winner ?? null, 'the careless side must not win').toBeNull()
    }
    expect(strongWins).toBeGreaterThanOrEqual(3)
  }, 120_000)
})
