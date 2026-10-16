import { describe, expect, it } from 'vitest'
import { applyMove, initialState, legalPits, notationOf, type OwareState, type Pits, replay, SEEDS, type Side, sow, START } from '../../../supabase/functions/_shared/oware'

// The rules of Oware (Abapa), checked one by one, and whole random games to show that seeds are
// never made or lost and that every game comes to an end.

/** A position from South's row and North's row, each written from its own owner's left. */
function at(south: number[], north: number[], turn: Side = 's', stores: Partial<Record<Side, number>> = {}): OwareState {
  const pits: Pits = [...south, ...north]
  return { pits, stores: { s: stores.s ?? 0, n: stores.n ?? 0 }, turn, quietPlies: 0, history: [`${pits.join(',')}|${turn}`] }
}

describe('setting out and sowing', () => {
  it('starts with four seeds in each of the twelve pits, South to move, with all six pits on offer', () => {
    const state = initialState()
    expect(state.pits).toEqual(START)
    expect(state.pits.reduce((a, b) => a + b, 0)).toBe(SEEDS)
    expect(state.turn).toBe('s')
    expect(legalPits(state)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('sows one seed into each following pit, anticlockwise, and passes the turn', () => {
    const step = applyMove(initialState(), 0)!
    expect(step.state.pits).toEqual([0, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4])
    expect(step.move.sown).toEqual([1, 2, 3, 4])
    expect(step.move.notation).toBe('a')
    expect(step.state.turn).toBe('n')
  })

  it('carries on from South\'s last pit into North\'s row, and from North\'s last pit back into South\'s', () => {
    expect(sow(START, 5).sown).toEqual([6, 7, 8, 9])
    expect(sow(START, 11).sown).toEqual([0, 1, 2, 3])
  })

  it('skips the pit it was emptied from when there are twelve seeds or more', () => {
    const pits = [12, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]
    const result = sow(pits, 0)
    expect(result.sown).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1])
    expect(result.pits[0]).toBe(0)
  })

  it('names pits a-f along South\'s row and A-F along North\'s', () => {
    expect([0, 5, 6, 11].map(notationOf)).toEqual(['a', 'f', 'A', 'F'])
  })
})

describe('capturing', () => {
  it('takes the last pit when the last seed makes it two or three', () => {
    // South's sixth pit holds one seed: it lands in North's first pit, which then holds two.
    const step = applyMove(at([3, 3, 3, 3, 3, 1], [1, 4, 4, 4, 4, 4]), 5)!
    expect(step.move.captured).toEqual([6])
    expect(step.move.taken).toBe(2)
    expect(step.state.stores.s).toBe(2)
    expect(step.state.pits[6]).toBe(0)
  })

  it('takes the pits before it as well, while they are the opponent\'s and hold two or three', () => {
    // Three seeds from South's sixth pit land in North's 1st, 2nd and 3rd pits: 2, 3, 2.
    const step = applyMove(at([4, 4, 4, 4, 4, 3], [1, 2, 1, 5, 5, 5]), 5)!
    expect(step.move.captured).toEqual([8, 7, 6])
    expect(step.move.taken).toBe(7)
  })

  it('stops at the first pit that does not hold two or three', () => {
    const step = applyMove(at([4, 4, 4, 4, 4, 3], [5, 2, 1, 5, 5, 5]), 5)!
    // North's first pit holds 6: only the second and third are taken.
    expect(step.move.captured).toEqual([8, 7])
  })

  it('never takes seeds from the mover\'s own row', () => {
    // North sows into South's row; South's pits behind the last one are not North's to take past the row.
    const step = applyMove(at([1, 2, 5, 5, 5, 5], [4, 4, 4, 4, 4, 2], 'n'), 11)!
    expect(step.move.captured).toEqual([1, 0])
    expect(step.state.stores.n).toBe(5)
  })

  it('takes nothing when it would take every seed the opponent has (grand slam)', () => {
    const step = applyMove(at([4, 4, 4, 4, 4, 2], [1, 1, 0, 0, 0, 0]), 5)!
    expect(step.move.grandSlam).toBe(true)
    expect(step.move.taken).toBe(0)
    expect(step.state.pits.slice(6)).toEqual([2, 2, 0, 0, 0, 0])
  })
})

describe('feeding', () => {
  it('must give seeds to an empty row when it can', () => {
    // North's row is empty: only South's sixth pit (one seed) and fifth pit (two) reach it.
    const state = at([1, 1, 0, 0, 2, 1], [0, 0, 0, 0, 0, 0], 's', { s: 20, n: 19 })
    expect(legalPits(state)).toEqual([4, 5])
    expect(applyMove(state, 0)).toBeNull()
  })

  it('ends the game when the empty row cannot be fed: each player takes what is in their own row', () => {
    // North empties their last pit into South's row; South then cannot reach North's empty row.
    const state = at([1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1], 'n', { s: 23, n: 23 })
    const step = applyMove(state, 11)!
    expect(step.result).toEqual({ winner: 's', reason: 'no_moves' })
    expect(step.state.stores).toEqual({ s: 25, n: 23 })
    expect(step.state.pits.every((seeds) => seeds === 0)).toBe(true)
  })
})

describe('winning and ending', () => {
  it('is won the moment a player has taken 25 seeds', () => {
    const step = applyMove(at([3, 3, 3, 3, 3, 1], [1, 4, 4, 4, 4, 4], 's', { s: 23 }), 5)!
    expect(step.result).toEqual({ winner: 's', reason: 'majority' })
  })

  it('is a draw at 24 each', () => {
    // North's last seed goes to South, whose two seeds then cannot reach North's empty row:
    // South takes them, and it is 24 each.
    const step = applyMove(at([0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1], 'n', { s: 22, n: 24 }), 11)!
    expect(step.result).toEqual({ winner: null, reason: 'no_moves' })
    expect(step.state.stores).toEqual({ s: 24, n: 24 })
  })

  it('refuses a pit of the wrong player, an empty pit, and anything that is not a pit', () => {
    const state = initialState()
    expect(applyMove(state, 6)).toBeNull()
    expect(applyMove(at([0, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4]), 0)).toBeNull()
    expect(applyMove(state, 1.5)).toBeNull()
    expect(applyMove(state, 12)).toBeNull()
  })

  it('replays a game, and refuses a record with a move that may not be played', () => {
    expect(replay([0, 6, 1])!.played.map((m) => m.notation)).toEqual(['a', 'A', 'b'])
    expect(replay([0, 0])).toBeNull()
  })
})

describe('whole games', () => {
  /** A small, repeatable source of chance, so a failing game can be played again. */
  function seeded(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
  }

  it('never makes or loses a seed, and always ends', () => {
    for (let game = 1; game <= 300; game++) {
      const random = seeded(game)
      let state = initialState()
      let result = null
      let plies = 0
      while (!result) {
        const options = legalPits(state)
        expect(options.length).toBeGreaterThan(0)
        const step = applyMove(state, options[Math.floor(random() * options.length)]!)!
        state = step.state
        result = step.result
        const total = state.pits.reduce((a, b) => a + b, 0) + state.stores.s + state.stores.n
        expect(total).toBe(SEEDS)
        expect(++plies).toBeLessThan(5000)
      }
      if (result.winner) expect(state.stores[result.winner]).toBeGreaterThan(SEEDS / 2 - 1)
    }
  })
})
