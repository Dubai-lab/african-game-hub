import { describe, expect, it } from 'vitest'
import { winnerPayout } from './payout'

describe('winnerPayout', () => {
  it('pays the pot less a 10% rake', () => {
    expect(winnerPayout(100, 1000)).toEqual({ pot: 200, rake: 20, payout: 180 })
    expect(winnerPayout(1000, 1000)).toEqual({ pot: 2000, rake: 200, payout: 1800 })
  })

  it('rounds the rake down so no token is ever invented', () => {
    // 7.5% of 100 is 7.5: the platform takes 7, the winner 93. Rake + payout always equals the pot.
    const { pot, rake, payout } = winnerPayout(50, 750)
    expect({ pot, rake, payout }).toEqual({ pot: 100, rake: 7, payout: 93 })
    expect(rake + payout).toBe(pot)
  })

  it('handles free games and games with more than two players', () => {
    expect(winnerPayout(0, 1000)).toEqual({ pot: 0, rake: 0, payout: 0 })
    expect(winnerPayout(100, 1000, 4)).toEqual({ pot: 400, rake: 40, payout: 360 })
  })
})
