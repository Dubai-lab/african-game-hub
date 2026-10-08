import { describe, expect, it } from 'vitest'
import { chooseShot } from './computer'
import { applyShot, type Ball, canPlaceCue, HEAD_STRING, type PoolState, rack, type Shot, simulate, TABLE, targets } from '../../../supabase/functions/_shared/pool'

// The physics and the rules of pool, as the server runs them.

const D = TABLE.r * 2
const shot = (dx: number, dy: number, power = 500, more: Partial<Shot> = {}): Shot => ({ dx: dx * 1_000_000, dy: dy * 1_000_000, power, spinX: 0, spinY: 0, ...more })
const at = (n: number, x: number, y: number): Ball => ({ n, x, y, in: false })
const sunk = (n: number): Ball => ({ n, x: 0, y: 0, in: true })
/** A position with the cue ball lined up on a ball that sits in front of the bottom-right pocket. */
const lineUp = (target: number, others: Ball[] = []): Ball[] => [at(0, 2250, 980), at(target, 2440, 1170), ...others]
const state = (over: Partial<PoolState>): PoolState => ({ variant: '8ball', balls: rack('8ball'), turn: 1, breakShot: false, ballInHand: false, solidsSeat: null, fouls: [0, 0], ...over })

describe('the table', () => {
  it('racks 15 balls and a cue ball for 8-ball, 9 and a cue ball for 9-ball, none overlapping, all on the table', () => {
    for (const [variant, count] of [['8ball', 16], ['9ball', 10]] as const) {
      const balls = rack(variant)
      expect(balls).toHaveLength(count)
      for (const a of balls) {
        expect(a.x).toBeGreaterThan(TABLE.r)
        expect(a.x).toBeLessThan(TABLE.w - TABLE.r)
        expect(a.y).toBeGreaterThan(TABLE.r)
        expect(a.y).toBeLessThan(TABLE.h - TABLE.r)
        for (const b of balls) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(D)
      }
    }
    // The 8 sits in the middle of the triangle, the 9 in the middle of the diamond, the 1 at the front.
    const eight = rack('8ball')
    expect(eight.find((b) => b.n === 8)!.y).toBe(TABLE.h / 2)
    expect(Math.min(...eight.filter((b) => b.n !== 0).map((b) => b.x))).toBe(eight.find((b) => b.n === 1)!.x)
    expect(rack('9ball').find((b) => b.n === 9)!.y).toBe(TABLE.h / 2)
  })

  it('lets the cue ball be placed only on the table, clear of other balls, and behind the line for a break', () => {
    const balls = rack('8ball')
    expect(canPlaceCue(balls, 400, 400, true)).toBe(true)
    expect(canPlaceCue(balls, HEAD_STRING + 50, 400, true)).toBe(false)
    expect(canPlaceCue(balls, HEAD_STRING + 50, 400, false)).toBe(true)
    expect(canPlaceCue(balls, 5, 400, false)).toBe(false)
    const one = balls.find((b) => b.n === 1)!
    expect(canPlaceCue(balls, one.x - 20, one.y, false)).toBe(false)
  })
})

describe('a shot', () => {
  it('comes out exactly the same every time it is played', () => {
    const a = simulate(rack('8ball'), shot(1, 0.013, 1000))
    const b = simulate(rack('8ball'), shot(1, 0.013, 1000))
    expect(JSON.stringify(a.balls)).toBe(JSON.stringify(b.balls))
    expect(a.steps).toBe(b.steps)
    // The slightest change of aim gives a different table: nothing is rounded away.
    const c = simulate(rack('8ball'), shot(1, 0.0131, 1000))
    expect(JSON.stringify(c.balls)).not.toBe(JSON.stringify(a.balls))
  })

  it('a hard break scatters the rack and every ball ends up at rest on the table or in a pocket', () => {
    const sim = simulate(rack('8ball'), shot(1, 0, 1000))
    expect(sim.firstHit).toBe(1)
    expect(sim.railAfterHit).toBe(true)
    const start = rack('8ball')
    const moved = sim.balls.filter((b, i) => b.in || Math.hypot(b.x - start[i]!.x, b.y - start[i]!.y) > D).length
    expect(moved).toBeGreaterThan(10)
    for (const ball of sim.balls) {
      if (ball.in) continue
      expect(ball.x).toBeGreaterThanOrEqual(TABLE.r)
      expect(ball.x).toBeLessThanOrEqual(TABLE.w - TABLE.r)
      expect(ball.y).toBeGreaterThanOrEqual(TABLE.r)
      expect(ball.y).toBeLessThanOrEqual(TABLE.h - TABLE.r)
    }
    for (const a of sim.balls) for (const b of sim.balls) if (a !== b && !a.in && !b.in) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(D - 0.01)
  })

  it('a straight shot pockets the ball in front of the pocket; a soft one that misses everything touches nothing', () => {
    const made = simulate(lineUp(3), shot(1, 1, 450))
    expect(made.firstHit).toBe(3)
    expect(made.pocketed).toContain(3)
    const missed = simulate(lineUp(3), shot(-1, 0, 120))
    expect(missed.firstHit).toBeNull()
    expect(missed.pocketed).toEqual([])
  })

  it('follow sends the cue ball on after the hit, draw brings it back', () => {
    // A full hit down the middle of the table, far from any pocket.
    const balls = [at(0, 700, 635), at(5, 1300, 635)]
    // (Soft enough that the object ball does not come back off the far rail into the cue ball.)
    const stun = simulate(balls, shot(1, 0, 160)).balls[0]!.x
    const follow = simulate(balls, shot(1, 0, 160, { spinY: 100 })).balls[0]!.x
    const draw = simulate(balls, shot(1, 0, 160, { spinY: -100 })).balls[0]!.x
    expect(follow).toBeGreaterThan(stun + 100)
    expect(draw).toBeLessThan(stun - 100)
  })

  it('reports what happened along the way, for drawing and sound, without changing the result', () => {
    const frames: number[] = []
    const knocks: string[] = []
    const watched = simulate(rack('9ball'), shot(1, 0, 900), (_balls, step) => frames.push(step), (event) => knocks.push(event.kind))
    expect(frames.length).toBeGreaterThan(100)
    expect(knocks).toContain('ball')
    expect(knocks).toContain('rail')
    expect(JSON.stringify(watched.balls)).toBe(JSON.stringify(simulate(rack('9ball'), shot(1, 0, 900)).balls))
  })
})

describe('8-ball', () => {
  it('the break: any ball may be hit; the table stays open; the breaker keeps it only if something drops', () => {
    const played = applyShot(state({ breakShot: true, ballInHand: true }), shot(1, 0, 1000))!
    expect(played.result.foul).toBeNull()
    expect(played.state.breakShot).toBe(false)
    expect(played.state.solidsSeat).toBeNull()
    const dropped = played.result.pocketed.filter((n) => n !== 0 && n !== 8).length > 0
    expect(played.state.turn).toBe(dropped ? 1 : 2)
    // Before the break every ball but the 8 is a fair target.
    expect(targets(state({})).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15])
  })

  it('open table: the first ball down gives the shooter that group and another shot', () => {
    const played = applyShot(state({ balls: lineUp(11, [at(2, 600, 300), at(8, 1200, 300)]) }), shot(1, 1, 450))!
    expect(played.result).toMatchObject({ pocketed: [11], foul: null, again: true })
    // Seat 1 pocketed a stripe, so seat 2 has the solids.
    expect(played.state.solidsSeat).toBe(2)
    expect(played.state.turn).toBe(1)
  })

  it('with groups decided: hitting the other group first is a foul and gives ball in hand', () => {
    const played = applyShot(state({ solidsSeat: 1, balls: lineUp(12, [at(2, 600, 300), at(8, 1200, 300)]) }), shot(1, 1, 450))!
    expect(played.result.foul).toBe('wrong_ball')
    expect(played.state).toMatchObject({ turn: 2, ballInHand: true })
  })

  it('pocketing your own ball keeps the table; missing passes it; a shot that reaches no rail is a foul', () => {
    const made = applyShot(state({ solidsSeat: 1, balls: lineUp(3, [at(8, 1200, 300), at(12, 600, 300)]) }), shot(1, 1, 450))!
    expect(made.state).toMatchObject({ turn: 1, ballInHand: false })

    // A hard hit down the table: the ball misses the pocket but reaches a rail.
    const missed = applyShot(state({ solidsSeat: 1, balls: [at(0, 700, 635), at(3, 1300, 600), at(8, 1200, 300)] }), shot(1, 0, 600))!
    expect(missed.result).toMatchObject({ foul: null, again: false })
    expect(missed.state).toMatchObject({ turn: 2, ballInHand: false })

    // A touch so soft that nothing reaches a cushion.
    const soft = applyShot(state({ solidsSeat: 1, balls: [at(0, 1100, 635), at(3, 1300, 635), at(8, 1200, 300)] }), shot(1, 0, 60))!
    expect(soft.result.foul).toBe('no_rail')
    expect(soft.state).toMatchObject({ turn: 2, ballInHand: true })
  })

  it('a scratch is a foul: the cue ball comes back and the opponent places it', () => {
    // Shooting the cue ball straight into the pocket behind the object ball.
    const played = applyShot(state({ solidsSeat: 1, balls: [at(0, 2440, 1170), at(3, 600, 300), at(8, 1200, 300)] }), shot(1, 1, 300))!
    expect(played.result.foul).toBe('scratch')
    expect(played.state).toMatchObject({ turn: 2, ballInHand: true })
    const cue = played.state.balls.find((b) => b.n === 0)!
    expect(cue.in).toBe(false)
    expect(canPlaceCue(played.state.balls, cue.x, cue.y, false)).toBe(true)
  })

  it('the 8: wins once your group is cleared; loses if pocketed early or with a foul; goes back up if it drops on the break', () => {
    const cleared = [1, 2, 3, 4, 5, 6, 7].map(sunk)
    const last = state({ solidsSeat: 1, balls: [...lineUp(8), ...cleared, at(12, 600, 300)] })
    // The 8 is a called shot: the bottom-right pocket is number 5.
    const win = applyShot(last, shot(1, 1, 450, { pocket: 5 }))!
    expect(win.result).toMatchObject({ winner: 1, reason: 'eight_ball' })
    // Into a pocket that was not the one called, it loses; with no pocket called, the shot is not played at all.
    expect(applyShot(last, shot(1, 1, 450, { pocket: 0 }))!.result).toMatchObject({ winner: 2, reason: 'eight_wrong_pocket' })
    expect(applyShot(last, shot(1, 1, 450))).toBeNull()
    expect(applyShot(last, shot(1, 1, 450, { pocket: 6 }))).toBeNull()
    expect(targets(state({ solidsSeat: 1, balls: [...lineUp(8), ...cleared, at(12, 600, 300)] }))).toEqual([8])

    const early = applyShot(state({ solidsSeat: 1, balls: [...lineUp(8), at(3, 600, 300)] }), shot(1, 1, 450))!
    expect(early.result).toMatchObject({ winner: 2, reason: 'eight_early' })

    // Seat 2 has stripes, all cleared, but hits a solid into the 8.
    const foul = applyShot(state({ turn: 2, solidsSeat: 1, balls: [at(0, 2100, 830), at(3, 2250, 980), at(8, 2440, 1170), ...[9, 10, 11, 12, 13, 14, 15].map(sunk)] }), shot(1, 1, 700, { pocket: 5 }))!
    if (foul.result.pocketed.includes(8)) expect(foul.result).toMatchObject({ winner: 1, reason: 'eight_foul' })
    else expect(foul.result.foul).toBe('wrong_ball')

    const onBreak = applyShot(state({ breakShot: true, ballInHand: true, balls: lineUp(8, [at(3, 600, 300)]) }), shot(1, 1, 450, { cue: { x: 400, y: 400 } }))
    // (From behind the line that shot does not reach; play it as a break from where the balls lie.)
    expect(onBreak).not.toBeNull()
    const breakEight = applyShot(state({ breakShot: true, ballInHand: false, balls: lineUp(8, [at(3, 600, 300)]) }), shot(1, 1, 450))!
    expect(breakEight.result).toMatchObject({ winner: null, respotted: [8] })
    expect(breakEight.state.balls.find((b) => b.n === 8)!.in).toBe(false)
  })

  it('ball in hand: the shot is refused if the cue ball is put somewhere it may not go', () => {
    const position = state({ ballInHand: true, balls: [at(0, 400, 400), at(3, 1300, 635), at(8, 1200, 300)] })
    expect(applyShot(position, shot(1, 0, 300, { cue: { x: 1300, y: 640 } }))).toBeNull()
    expect(applyShot(position, shot(1, 0, 300, { cue: { x: -50, y: 640 } }))).toBeNull()
    const placed = applyShot(position, shot(1, 0, 500, { cue: { x: 900, y: 635 } }))!
    expect(placed.result.firstHit).toBe(3)
    // Without ball in hand, a "placement" sent along with the shot is ignored.
    const ignored = applyShot({ ...position, ballInHand: false }, shot(1, 0, 500, { cue: { x: 900, y: 635 } }))!
    expect(ignored.result.firstHit).toBeNull()
  })

  it('refuses a shot that is not made of sensible whole numbers', () => {
    const position = state({})
    for (const bad of [{ dx: 0, dy: 0 }, { power: 0 }, { power: 1001 }, { power: 12.5 }, { spinX: 101 }, { dx: 1.5 }]) {
      expect(applyShot(position, { ...shot(1, 0), ...bad })).toBeNull()
    }
  })
})

describe('9-ball', () => {
  const nine = (over: Partial<PoolState>): PoolState => state({ variant: '9ball', balls: rack('9ball'), ...over })

  it('the lowest ball on the table must be hit first', () => {
    expect(targets(nine({}))).toEqual([1])
    expect(targets(nine({ balls: [at(0, 400, 400), sunk(1), sunk(2), at(3, 900, 300), at(9, 1500, 300)] }))).toEqual([3])
    const wrong = applyShot(nine({ balls: lineUp(5, [at(2, 600, 300), at(9, 1200, 300)]) }), shot(1, 1, 450))!
    expect(wrong.result.foul).toBe('wrong_ball')
    expect(wrong.state).toMatchObject({ turn: 2, ballInHand: true, fouls: [1, 0] })
  })

  it('any ball pocketed on a legal shot keeps the table, and the 9 wins it whenever it drops legally', () => {
    const made = applyShot(nine({ balls: lineUp(2, [at(5, 600, 300), at(9, 1200, 300)]) }), shot(1, 1, 450))!
    expect(made.result).toMatchObject({ pocketed: [2], foul: null, again: true })
    expect(made.state.turn).toBe(1)
    // The 9 is the only ball left: it is the lowest, and pocketing it wins.
    const won = applyShot(nine({ balls: lineUp(9, [sunk(1), sunk(2)]) }), shot(1, 1, 450))!
    expect(won.result).toMatchObject({ winner: 1, reason: 'nine_ball' })
  })

  it('the 9 pocketed on a foul goes back on its spot and the game goes on', () => {
    // The lowest ball is the 2, far away; the shooter knocks the 9 in directly.
    const played = applyShot(nine({ balls: lineUp(9, [at(2, 600, 300)]) }), shot(1, 1, 450))!
    expect(played.result).toMatchObject({ foul: 'wrong_ball', respotted: [9], winner: null })
    expect(played.state.balls.find((b) => b.n === 9)!.in).toBe(false)
    expect(played.state).toMatchObject({ turn: 2, ballInHand: true })
  })

  it('three fouls in a row lose the game; a clean shot in between clears the count', () => {
    const position = nine({ fouls: [2, 0], balls: lineUp(5, [at(2, 600, 300), at(9, 1200, 300)]) })
    const third = applyShot(position, shot(1, 1, 450))!
    expect(third.result).toMatchObject({ winner: 2, reason: 'three_fouls' })
    const clean = applyShot(nine({ fouls: [2, 0], balls: lineUp(2, [at(5, 600, 300), at(9, 1200, 300)]) }), shot(1, 1, 450))!
    expect(clean.state.fouls).toEqual([0, 0])
  })
})

describe('the computer', () => {
  it('breaks legally, and always offers a shot the rules allow, at every level', () => {
    for (const variant of ['8ball', '9ball'] as const) {
      for (const level of ['easy', 'medium', 'hard'] as const) {
        let game = state({ variant, balls: rack(variant), turn: 2, breakShot: true, ballInHand: true })
        // A dozen shots of a game the computer plays against itself.
        for (let i = 0; i < 12; i++) {
          const played = applyShot(game, chooseShot(game, level))
          expect(played).not.toBeNull()
          if (played!.result.winner !== null) break
          game = played!.state
        }
      }
    }
  })

  it('at its strongest it pockets a ball that sits in front of a pocket, and calls the right pocket for the 8', () => {
    const easy = applyShot(state({ turn: 2, solidsSeat: 2, balls: [at(0, 1800, 700), at(3, 2380, 1110), at(8, 1200, 300), at(12, 600, 300)] }), chooseShot(state({ turn: 2, solidsSeat: 2, balls: [at(0, 1800, 700), at(3, 2380, 1110), at(8, 1200, 300), at(12, 600, 300)] }), 'hard'))!
    expect(easy.result).toMatchObject({ pocketed: [3], foul: null, again: true })

    const last = state({ turn: 2, solidsSeat: 2, ballInHand: true, balls: [at(0, 600, 600), at(8, 2380, 1110), at(12, 600, 300), ...[1, 2, 3, 4, 5, 6, 7].map(sunk)] })
    const call = chooseShot(last, 'hard')
    expect(call.pocket).toBe(5)
    expect(applyShot(last, call)!.result).toMatchObject({ winner: 2, reason: 'eight_ball' })
  })
})
