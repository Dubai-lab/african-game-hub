import { describe, expect, it } from 'vitest'
import { applyMove, initialState, legalPits, type OwareState } from '../../../supabase/functions/_shared/oware'
import { choosePit, LEVELS, levelById } from './computer'

// The practice opponent: it only ever plays a pit it may play, takes seeds when it can, and the
// stronger levels beat the weakest.

const at = (south: number[], north: number[], turn: 's' | 'n' = 's', stores = { s: 0, n: 0 }): OwareState => {
  const pits = [...south, ...north]
  return { pits, stores, turn, quietPlies: 0, history: [`${pits.join(',')}|${turn}`] }
}
const steady = () => 0.99

describe('the computer', () => {
  it('always plays a pit it may play, at every level', () => {
    for (const level of LEVELS) {
      const pit = choosePit(initialState(), level)
      expect(legalPits(initialState())).toContain(pit)
    }
  })

  it('takes seeds when they are there to take, looking one move ahead', () => {
    // Only South's sixth pit reaches North's row: its seed lands in North's first, making it two.
    // (Looking further, a strong player may well turn this down for something better later.)
    const state = at([1, 1, 1, 1, 1, 1], [1, 6, 6, 6, 6, 6], 's', { s: 5, n: 6 })
    expect(choosePit(state, { ...levelById('easy'), depth: 1, slip: 0 }, steady)).toBe(5)
  })

  it('feeds an empty row when it must', () => {
    const state = at([1, 1, 0, 0, 2, 1], [0, 0, 0, 0, 0, 0], 's', { s: 20, n: 22 })
    expect([4, 5]).toContain(choosePit(state, levelById('expert'), steady))
  })

  it('the strongest level beats the weakest', () => {
    let strongWins = 0
    for (let game = 0; game < 6; game++) {
      let state = initialState()
      let result = null
      // The strong side alternates between South and North.
      const strongSide = game % 2 === 0 ? 's' : 'n'
      while (!result) {
        const level = state.turn === strongSide ? { ...levelById('hard'), timeMs: 60 } : levelById('easy')
        const step = applyMove(state, choosePit(state, level)!)!
        state = step.state
        result = step.result
      }
      if (result.winner === strongSide) strongWins++
    }
    expect(strongWins).toBeGreaterThanOrEqual(5)
  }, 60_000)
})
