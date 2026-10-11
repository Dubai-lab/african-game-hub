import { describe, expect, it } from 'vitest'
import { act, canPlay, CARDS_EACH, type CheckUpState, chooseAction, deal, DECK, handTotal, isPlain, isSound, leave, nextSeat, playable, playing, timeout, WHOT } from '../../../supabase/functions/_shared/checkup'

/** The same "chance" every run, so a failing game can be played again. */
function chance(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A table set by hand. Cards not named go to the market. */
function table(hands: Record<string, string[]>, top: string, extra: Partial<CheckUpState> = {}): CheckUpState {
  const seats = Object.keys(hands)
  const used = [...Object.values(hands).flat(), top]
  const market = [...DECK]
  for (const card of used) market.splice(market.indexOf(card), 1)
  return { seats, out: [], hands, market, top, called: null, turn: seats[0]!, pending: null, moveNo: 0, missed: Object.fromEntries(seats.map((s) => [s, 0])), over: null, ...extra }
}
const ok = (played: ReturnType<typeof act>) => {
  if (!played.ok) throw new Error(`refused: ${played.code}`)
  return played
}

describe('the pack', () => {
  it('has 54 cards: 12 circles, 12 triangles, 9 crosses, 9 squares, 7 stars and 5 Whot', () => {
    expect(DECK).toHaveLength(54)
    const of = (letter: string) => DECK.filter((card) => card[0] === letter).length
    expect([of('c'), of('t'), of('x'), of('s'), of('r'), of('w')]).toEqual([12, 12, 9, 9, 7, 5])
    // No circle 6 or 9, no cross 4, no star 10.
    for (const missing of ['c6', 'c9', 't6', 'x4', 'x8', 's12', 'r10', 'r14']) expect(DECK).not.toContain(missing)
    expect(new Set(DECK.filter((card) => card !== WHOT)).size).toBe(49)
  })

  it('counts a star double and a Whot card as 20', () => {
    expect(handTotal(['c7', 'x14'])).toBe(21)
    expect(handTotal(['r8'])).toBe(16)
    expect(handTotal(['r1', 'r2', WHOT])).toBe(26)
    expect(handTotal([])).toBe(0)
  })
})

describe('the deal', () => {
  it('gives six cards each from a shuffled pack and starts on a plain card', () => {
    for (const players of [2, 3, 4]) {
      const seats = ['1', '2', '3', '4'].slice(0, players)
      const state = deal(seats, chance(players))
      for (const seat of seats) expect(state.hands[seat]).toHaveLength(CARDS_EACH)
      expect(state.market).toHaveLength(54 - players * CARDS_EACH - 1)
      expect(isPlain(state.top)).toBe(true)
      expect(state.turn).toBe('1')
      expect(isSound(state)).toBe(true)
    }
    // Two shuffles are not the same deal.
    expect(deal(['1', '2'], chance(1)).hands).not.toEqual(deal(['1', '2'], chance(2)).hands)
  })
})

describe('what may be played', () => {
  const on = (top: string, extra: Partial<CheckUpState> = {}) => ({ top, called: null, pending: null, ...extra })
  it('the same shape, the same number, or a Whot card', () => {
    expect(canPlay(on('c7'), 'c3')).toBe(true)
    expect(canPlay(on('c7'), 'x7')).toBe(true)
    expect(canPlay(on('c7'), 'r7')).toBe(true)
    expect(canPlay(on('c7'), WHOT)).toBe(true)
    expect(canPlay(on('c7'), 't3')).toBe(false)
  })

  it('after a Whot card, only the shape that was called (or another Whot)', () => {
    const called = on(WHOT, { called: 's' })
    expect(canPlay(called, 's3')).toBe(true)
    expect(canPlay(called, 'c3')).toBe(false)
    expect(canPlay(called, WHOT)).toBe(true)
    expect(playable(called, ['c1', 's10', 't5', WHOT])).toEqual(['s10', WHOT])
  })

  it('with cards waiting to be picked, only the same number passes them on', () => {
    const picking = on('c2', { pending: { number: 2, count: 2 } })
    expect(canPlay(picking, 't2')).toBe(true)
    // Not the same shape, not a Whot card, not a pick three.
    expect(canPlay(picking, 'c7')).toBe(false)
    expect(canPlay(picking, WHOT)).toBe(false)
    expect(canPlay(picking, 'c5')).toBe(false)
  })
})

describe('playing', () => {
  it('a plain card passes the turn; a card that does not match is refused', () => {
    const state = table({ a: ['c3', 't10'], b: ['x7', 's1'] }, 'c7')
    expect(act(state, 'b', { type: 'play', card: 'x7' })).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(act(state, 'a', { type: 'play', card: 't10' })).toEqual({ ok: false, code: 'CARD_NOT_ALLOWED' })
    expect(act(state, 'a', { type: 'play', card: 'x7' })).toEqual({ ok: false, code: 'NOT_YOUR_CARD' })
    const played = ok(act(state, 'a', { type: 'play', card: 'c3' }))
    expect(played.state.top).toBe('c3')
    expect(played.state.hands.a).toEqual(['t10'])
    expect(played.state.turn).toBe('b')
    expect(played.state.moveNo).toBe(1)
    // The table given was not changed.
    expect(state.hands.a).toEqual(['c3', 't10'])
  })

  it('going to market draws one card and passes the turn', () => {
    const state = table({ a: ['t10'], b: ['x7'] }, 'c7')
    const next = state.market.at(-1)!
    const drew = ok(act(state, 'a', { type: 'draw' }))
    expect(drew.state.hands.a).toEqual(['t10', next])
    expect(drew.state.turn).toBe('b')
    // What was drawn is nobody else's business.
    expect(drew.event).toEqual({ seat: 'a', kind: 'draw', drew: 1 })
  })

  it('1, hold on: the same player plays again', () => {
    const played = ok(act(table({ a: ['c1', 'c3'], b: ['x7'] }, 'c7'), 'a', { type: 'play', card: 'c1' }))
    expect(played.state.turn).toBe('a')
  })

  it('2, pick two: the next player draws two, or passes them on with a 2 of their own', () => {
    let state = ok(act(table({ a: ['c2', 'c3'], b: ['t2', 'x7'], c: ['s2', 's3'] }, 'c7'), 'a', { type: 'play', card: 'c2' })).state
    expect(state.pending).toEqual({ number: 2, count: 2 })
    expect(state.turn).toBe('b')
    // b defends: four for c.
    state = ok(act(state, 'b', { type: 'play', card: 't2' })).state
    expect(state.pending).toEqual({ number: 2, count: 4 })
    // c defends too: six for a, who has no 2 and must go to market for all of them.
    state = ok(act(state, 'c', { type: 'play', card: 's2' })).state
    expect(state.pending).toEqual({ number: 2, count: 6 })
    expect(act(state, 'a', { type: 'play', card: 'c3' })).toEqual({ ok: false, code: 'CARD_NOT_ALLOWED' })
    const drew = ok(act(state, 'a', { type: 'draw' }))
    expect(drew.event.drew).toBe(6)
    expect(drew.state.hands.a).toHaveLength(7)
    expect(drew.state.pending).toBeNull()
    expect(drew.state.turn).toBe('b')
  })

  it('5, pick three: three at a time, defended only with a 5', () => {
    let state = ok(act(table({ a: ['c5', 'c3'], b: ['t5', 't2'] }, 'c7'), 'a', { type: 'play', card: 'c5' })).state
    expect(state.pending).toEqual({ number: 5, count: 3 })
    expect(act(state, 'b', { type: 'play', card: 't2' })).toEqual({ ok: false, code: 'CARD_NOT_ALLOWED' })
    state = ok(act(state, 'b', { type: 'play', card: 't5' })).state
    expect(state.pending).toEqual({ number: 5, count: 6 })
    expect(ok(act(state, 'a', { type: 'draw' })).event.drew).toBe(6)
  })

  it('8, suspension: the next player misses a turn', () => {
    const three = ok(act(table({ a: ['c8', 'c3'], b: ['x7'], c: ['s3'] }, 'c7'), 'a', { type: 'play', card: 'c8' }))
    expect(three.event.skipped).toBe('b')
    expect(three.state.turn).toBe('c')
    // With two players it comes straight back.
    expect(ok(act(table({ a: ['c8', 'c3'], b: ['x7'] }, 'c7'), 'a', { type: 'play', card: 'c8' })).state.turn).toBe('a')
  })

  it('14, general market: everyone else draws one, and the same player plays again', () => {
    const played = ok(act(table({ a: ['c14', 'c3'], b: ['x7'], c: ['s3'] }, 'c7'), 'a', { type: 'play', card: 'c14' }))
    expect(played.event.market).toEqual(['b', 'c'])
    expect(played.state.hands.b).toHaveLength(2)
    expect(played.state.hands.c).toHaveLength(2)
    expect(played.state.hands.a).toEqual(['c3'])
    expect(played.state.turn).toBe('a')
  })

  it('20, Whot: goes on anything, and the shape to follow must be called', () => {
    const state = table({ a: [WHOT, 'c3'], b: ['x7', 't4'] }, 's10')
    expect(act(state, 'a', { type: 'play', card: WHOT })).toEqual({ ok: false, code: 'CALL_A_SHAPE' })
    const played = ok(act(state, 'a', { type: 'play', card: WHOT, call: 't' }))
    expect(played.state.called).toBe('t')
    expect(played.event).toEqual({ seat: 'a', kind: 'play', card: WHOT, call: 't' })
    expect(act(played.state, 'b', { type: 'play', card: 'x7' })).toEqual({ ok: false, code: 'CARD_NOT_ALLOWED' })
    const answered = ok(act(played.state, 'b', { type: 'play', card: 't4' }))
    // The call is spent once it has been answered.
    expect(answered.state.called).toBeNull()
  })
})

describe('how a game ends', () => {
  it('the first player to play their last card wins, whatever the card', () => {
    const won = ok(act(table({ a: ['c2'], b: ['x7', 's3'] }, 'c7'), 'a', { type: 'play', card: 'c2' }))
    expect(won.state.over).toEqual({ reason: 'finished', winner: 'a', totals: { a: 0, b: 10 } })
    // Nobody is left owing cards.
    expect(won.state.pending).toBeNull()
    expect(act(won.state, 'b', { type: 'draw' })).toEqual({ ok: false, code: 'GAME_OVER' })
  })

  it('when the market is finished the cards are counted and the lowest count wins', () => {
    const state = table({ a: ['t10', 'r8'], b: ['x7', 's3'] }, 'c7')
    state.market = ['c1']
    const last = ok(act(state, 'a', { type: 'draw' }))
    // a holds 10 + 16 (a star counts double) + 1; b holds 10.
    expect(last.state.over).toEqual({ reason: 'market', winner: 'b', totals: { a: 27, b: 10 } })
  })

  it('level lowest counts are a draw', () => {
    const state = table({ a: ['t10'], b: ['x7', 's3', 'c1'] }, 'c7')
    state.market = ['c1']
    state.hands.b = ['x7', 's3', 'x1']
    const last = ok(act(state, 'a', { type: 'draw' }))
    expect(last.state.over).toEqual({ reason: 'market', winner: null, totals: { a: 11, b: 11 } })
  })

  it('a general market that empties the market ends the game there', () => {
    const state = table({ a: ['c14', 'c3'], b: ['x7'], c: ['s3'] }, 'c7')
    state.market = ['t1']
    const played = ok(act(state, 'a', { type: 'play', card: 'c14' }))
    // Only b could draw: there was one card.
    expect(played.event.market).toEqual(['b'])
    expect(played.state.over?.reason).toBe('market')
    expect(played.state.over?.totals).toEqual({ a: 3, b: 8, c: 3 })
    expect(played.state.over?.winner).toBeNull()
  })
})

describe('time running out, and leaving', () => {
  it('the first time, the game goes to market for the player; the next time in a row, they are out', () => {
    let state = table({ a: ['t10'], b: ['x7'], c: ['s3'] }, 'c7')
    const first = ok(timeout(state))
    expect(first.event).toEqual({ seat: 'a', kind: 'timeout', drew: 1 })
    expect(first.state.missed.a).toBe(1)
    expect(first.state.turn).toBe('b')
    state = ok(act(first.state, 'b', { type: 'draw' })).state
    state = ok(act(state, 'c', { type: 'draw' })).state
    // a's turn again, and again nothing: out. The others play on.
    const second = ok(timeout(state))
    expect(second.event).toEqual({ seat: 'a', kind: 'out' })
    expect(second.state.out).toEqual(['a'])
    expect(second.state.hands.a).toEqual([])
    expect(second.state.turn).toBe('b')
    expect(second.state.over).toBeNull()
    expect(playing(second.state)).toEqual(['b', 'c'])
  })

  it('playing in between wipes the slate', () => {
    let state = ok(timeout(table({ a: ['t10', 'c3'], b: ['x7'] }, 'c7'))).state
    state = ok(act(state, 'b', { type: 'draw' })).state
    state = ok(act(state, 'a', { type: 'play', card: 'c3' })).state
    expect(state.missed.a).toBe(0)
  })

  it('a player who leaves takes the cards they owed with them, and the last one left wins', () => {
    let state = ok(act(table({ a: ['c2', 'c3'], b: ['x7'], c: ['s3'] }, 'c7'), 'a', { type: 'play', card: 'c2' })).state
    // b owes two cards and leaves instead.
    state = ok(leave(state, 'b')).state
    expect(state.pending).toBeNull()
    expect(state.turn).toBe('c')
    expect(nextSeat(state, 'c')).toBe('a')
    // Someone who leaves when it is not their turn does not disturb it.
    const gone = ok(leave(state, 'a'))
    expect(gone.state.over).toEqual({ reason: 'last_standing', winner: 'c', totals: { c: 3 } })
  })
})

describe('whole games', () => {
  it('the practice opponent only ever plays what the rules allow, and every game ends', () => {
    for (let game = 0; game < 300; game++) {
      const seats = ['1', '2', '3', '4'].slice(0, 2 + (game % 3))
      let state = deal(seats, chance(game + 1))
      let turns = 0
      while (!state.over) {
        const played = act(state, state.turn, chooseAction(state, state.turn))
        if (!played.ok) throw new Error(`game ${game}: the computer was refused (${played.code})`)
        state = played.state
        expect(isSound(state)).toBe(true)
        if (++turns > 2000) throw new Error(`game ${game} did not end`)
      }
      const { winner, reason, totals } = state.over
      if (reason === 'finished') expect(state.hands[winner!]).toEqual([])
      else {
        expect(state.market).toEqual([])
        const lowest = Math.min(...Object.values(totals))
        if (winner) expect(totals[winner]).toBe(lowest)
        else expect(Object.values(totals).filter((t) => t === lowest).length).toBeGreaterThan(1)
      }
    }
  })
})
