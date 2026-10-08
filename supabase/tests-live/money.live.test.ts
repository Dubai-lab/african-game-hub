// Money under real concurrency. Every test fires genuinely simultaneous requests at the hosted
// database or Edge Functions, then checks that no token was created, lost or spent twice.
// The ledger integrity check runs after every test.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  act,
  activeMatches,
  burst,
  integrityProblems,
  join,
  matchState,
  move,
  type Player,
  queued,
  ratings,
  resetTestAccounts,
  runSql,
  setBalance,
  signInPlayers,
  startGame,
  tokensHeldBy,
  wallet,
} from './live.ts'

let players: Player[]
let ada: Player, bola: Player, chidi: Player, dede: Player, efe: Player, femi: Player

beforeAll(async () => {
  players = await signInPlayers()
  ;[ada, bola, chidi, dede, efe, femi] = players as [Player, Player, Player, Player, Player, Player]
})

beforeEach(resetTestAccounts)

afterEach(async () => {
  expect(await integrityProblems()).toEqual([])
})

afterAll(resetTestAccounts)

/** Runs the same SQL many times at once; returns how many succeeded and the errors of the rest. */
async function sqlBurst(count: number, sql: string) {
  const outcomes = await Promise.allSettled(Array.from({ length: count }, () => runSql<Record<string, unknown>>(sql)))
  return {
    succeeded: outcomes.filter((o) => o.status === 'fulfilled') as PromiseFulfilledResult<Record<string, unknown>[]>[],
    errors: outcomes.filter((o) => o.status === 'rejected').map((o) => String((o as PromiseRejectedResult).reason?.message ?? o)),
  }
}

describe('double spending', () => {
  it('25 simultaneous debits of 100 against a wallet of 1,000: exactly 10 go through', async () => {
    const { succeeded, errors } = await sqlBurst(25, `select private.apply_ledger_entry('${ada.id}', -100, 'bonus', 'adjustment') as id`)
    expect(succeeded).toHaveLength(10)
    expect(errors).toHaveLength(15)
    expect(errors.every((e) => e.includes('INSUFFICIENT_BALANCE'))).toBe(true)
    expect(await wallet(ada)).toEqual({ bonus: 0, cash: 0 })
  })

  it('the same idempotency key sent 12 times at once credits once', async () => {
    const key = `live-test-${Date.now()}`
    const { succeeded, errors } = await sqlBurst(
      12,
      `select private.apply_ledger_entry('${ada.id}', 50, 'cash', 'adjustment', null, null, '${key}') as id`,
    )
    expect(succeeded).toHaveLength(1)
    expect(errors).toHaveLength(11)
    expect(await wallet(ada)).toEqual({ bonus: 1000, cash: 50 })
  })

  it('a player with exactly one stake cannot enter two matches at once', async () => {
    // Ada has 100 tokens. Two opponents are waiting, in two different queues, each for a
    // 100-token game. Ada asks to join both at the same instant, five times each.
    await setBalance(ada, 100)
    expect((await join(bola, 100, '3+2')).status).toBe('queued')
    expect((await join(chidi, 100, '5+0')).status).toBe('queued')

    const replies = await Promise.all([...Array(5).fill('3+2'), ...Array(5).fill('5+0')].map((tc: string) => join(ada, 100, tc)))
    expect(replies.every((r) => r.ok === true)).toBe(true)

    // She is in exactly one match, her 100 tokens are in escrow once, and nothing went negative.
    const matches = await activeMatches([ada, bola, chidi])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.players).toContain(ada.id)
    expect(new Set(replies.map((r) => r.match_id).filter(Boolean)).size).toBe(1)
    expect(await wallet(ada)).toEqual({ bonus: 0, cash: 0 })
    // The opponent she did not meet was not charged.
    const untouched = matches[0]!.players.includes(bola.id) ? chidi : bola
    expect(await wallet(untouched)).toEqual({ bonus: 1000, cash: 0 })
    expect(await tokensHeldBy([ada, bola, chidi])).toBe(2100)
  })

  it('a stake cannot be taken twice for one match even when asked 10 times at once', async () => {
    await setBalance(ada, 300)
    const { matchId } = await startGame(ada, bola, 100)
    // Straight at the internal function, as a bug or a retry storm might.
    const { succeeded, errors } = await sqlBurst(10, `select private.take_stake('${matchId}', '${ada.id}', 100)`)
    // The escrow table allows one row per match, player and balance type: all ten are refused.
    expect(succeeded).toHaveLength(0)
    expect(errors).toHaveLength(10)
    expect(await wallet(ada)).toEqual({ bonus: 200, cash: 0 })
    expect((await matchState(matchId)).held).toBe(200)
  })
})

describe('simultaneous matchmaking', () => {
  it('two players each tapping Find match 10 times at once end up in one match, charged once', async () => {
    const replies = await Promise.all([...burstOf(10, () => join(ada, 250)), ...burstOf(10, () => join(bola, 250))])
    expect(replies.every((r) => r.ok === true)).toBe(true)

    // Late arrivals may have been told "queued"; one more check-in each, as the app does.
    await Promise.all([join(ada, 250), join(bola, 250)])
    const matches = await activeMatches([ada, bola])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ stake: 250, players: [ada.id, bola.id].sort() })
    expect(await queued([ada, bola])).toEqual([])
    expect(await wallet(ada)).toEqual({ bonus: 750, cash: 0 })
    expect(await wallet(bola)).toEqual({ bonus: 750, cash: 0 })
    expect((await matchState(matches[0]!.match_id)).held).toBe(500)
  })

  it('six players joining at the same instant make three matches, nobody twice, every stake exact', async () => {
    await Promise.all(players.flatMap((p) => burstOf(3, () => join(p, 100))))
    // The app checks in every few seconds while searching; do the same until everyone is seated.
    for (let round = 0; round < 6 && (await queued(players)).length > 0; round++) {
      await Promise.all(players.map((p) => join(p, 100)))
    }

    const matches = await activeMatches(players)
    expect(matches).toHaveLength(3)
    const seated = matches.flatMap((m) => m.players)
    expect(seated).toHaveLength(6)
    expect(new Set(seated).size).toBe(6)
    expect(await queued(players)).toEqual([])
    for (const p of players) expect(await wallet(p)).toEqual({ bonus: 900, cash: 0 })
    expect(await tokensHeldBy(players)).toBe(6000)
  })

  it('players who cannot pay are never matched, however many requests arrive together', async () => {
    await setBalance(ada, 40)
    await setBalance(bola, 40)
    const replies = await Promise.all([
      ...burstOf(6, () => join(ada, 50)),
      ...burstOf(6, () => join(bola, 50)),
      ...burstOf(3, () => join(chidi, 50)),
      ...burstOf(3, () => join(dede, 50)),
    ])
    await Promise.all([join(chidi, 50), join(dede, 50)])

    expect(replies.slice(0, 12).every((r) => r.code === 'INSUFFICIENT_BALANCE')).toBe(true)
    const matches = await activeMatches([ada, bola, chidi, dede])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.players).toEqual([chidi.id, dede.id].sort())
    expect(await wallet(ada)).toEqual({ bonus: 40, cash: 0 })
    expect(await wallet(bola)).toEqual({ bonus: 40, cash: 0 })
  })
})

describe('settlement', () => {
  it('30 conflicting results arriving at once: one is recorded and paid, exactly once', async () => {
    const { matchId } = await startGame(ada, bola, 500)
    const outcomes = await Promise.all([
      ...burstOf(8, () => runSql<{ r: boolean }>(`select private.finish_match('${matchId}', 'win', '${ada.id}', 'checkmate') as r`)),
      ...burstOf(8, () => runSql<{ r: boolean }>(`select private.finish_match('${matchId}', 'win', '${bola.id}', 'resignation') as r`)),
      ...burstOf(6, () => runSql<{ r: boolean }>(`select private.finish_match('${matchId}', 'draw', null, 'agreement') as r`)),
      ...burstOf(8, () => runSql<{ r: boolean }>(`select private.settle_match('${matchId}') as r`)),
    ])
    // Exactly one of the 22 finish attempts won; every other request was told "already done".
    expect(outcomes.slice(0, 22).filter((rows) => rows[0]!.r)).toHaveLength(1)

    const state = await matchState(matchId)
    expect(state.settled).toBe(true)
    expect(state.held).toBe(0)
    const [a, b] = [await wallet(ada), await wallet(bola)]
    if (state.result === 'draw') {
      expect([state.payouts, state.refunds, state.revenue_rows]).toEqual([0, 2, 0])
      expect([a.bonus, b.bonus]).toEqual([1000, 1000])
    } else {
      // Pot 1,000, rake 100, payout 900: the winner ends on 1,400 and the loser on 500.
      expect([state.payouts, state.refunds, state.revenue_rows, state.rake]).toEqual([1, 0, 1, 100])
      const winner = state.winner_id === ada.id ? a : b
      const loser = state.winner_id === ada.id ? b : a
      expect([winner.bonus, loser.bonus]).toEqual([1400, 500])
    }
    expect(a.bonus + b.bonus + state.rake).toBe(2000)
  })

  it('both players resigning, offering and claiming in the same instant still gives one result', async () => {
    const { matchId, white, black } = await startGame(ada, bola, 100)
    expect((await move(white, matchId, 'e2e4', 0)).ok).toBe(true)
    expect((await move(black, matchId, 'e7e5', 1)).ok).toBe(true)

    await Promise.all([
      ...burstOf(4, () => act(white, matchId, 'resign')),
      ...burstOf(4, () => act(black, matchId, 'resign')),
      ...burstOf(3, () => act(white, matchId, 'claim')),
      ...burstOf(3, () => act(black, matchId, 'offer_draw')),
      ...burstOf(3, () => act(white, matchId, 'accept_draw')),
    ])

    const state = await matchState(matchId)
    expect(state.status).toBe('finished')
    expect(state.settled).toBe(true)
    expect(state.held).toBe(0)
    expect(state.payouts + state.refunds / 2).toBe(1)
    const [a, b] = [await wallet(ada), await wallet(bola)]
    expect(a.bonus + b.bonus + state.rake).toBe(2000)
    // Ratings were applied once: the two changes cancel out for two new players.
    const after = await ratings([ada, bola], 'blitz')
    expect(after.map((r) => r.games_played)).toEqual([1, 1])
    expect(after[0]!.rating + after[1]!.rating).toBe(2400)
  })

  it('an aborted staked game refunds both players once, even if the clock is checked 20 times at once', async () => {
    const { matchId, white, black } = await startGame(ada, bola, 250)
    await runSql(`update public.chess_games set last_move_at = now() - interval '40 seconds' where match_id = '${matchId}'`)
    const replies = await Promise.all([...burstOf(10, () => act(white, matchId, 'claim')), ...burstOf(10, () => act(black, matchId, 'claim'))])
    expect(replies.filter((r) => r.clock === 'aborted')).toHaveLength(1)

    const state = await matchState(matchId)
    expect([state.status, state.result, state.settled, state.refunds, state.payouts, state.revenue_rows]).toEqual([
      'aborted', 'aborted', true, 2, 0, 0,
    ])
    expect(await wallet(ada)).toEqual({ bonus: 1000, cash: 0 })
    expect(await wallet(bola)).toEqual({ bonus: 1000, cash: 0 })
    expect(await ratings([ada, bola], 'blitz')).toEqual([])
  })

  it('a drawn staked game played through the real functions returns both stakes, no rake', async () => {
    await setBalance(ada, 60, 500) // will stake 60 bonus + 40 cash
    const { matchId, white, black } = await startGame(ada, bola, 100)
    await move(white, matchId, 'e2e4', 0)
    await move(black, matchId, 'e7e5', 1)
    expect((await act(white, matchId, 'offer_draw')).ok).toBe(true)
    const answers = await burst(6, () => act(black, matchId, 'accept_draw'))
    expect(answers.filter((r) => r.ok === true)).toHaveLength(1)

    const state = await matchState(matchId)
    expect([state.result, state.end_reason, state.revenue_rows, state.payouts]).toEqual(['draw', 'agreement', 0, 0])
    // Each stake went back to the balance it came from.
    expect(await wallet(ada)).toEqual({ bonus: 60, cash: 500 })
    expect(await wallet(bola)).toEqual({ bonus: 1000, cash: 0 })
  })

  it('three staked games finishing at the same moment are each settled correctly', async () => {
    const games = await Promise.all([startGame(ada, bola, 100, '1+0'), startGame(chidi, dede, 250, '3+2'), startGame(efe, femi, 500, '5+0')])
    const before = await tokensHeldBy(players)
    expect(before).toBe(6000)

    await Promise.all(games.flatMap((g) => burstOf(3, () => act(g.white, g.matchId, 'resign'))))
    // Nobody had moved, so each was called off: all six players are back on 1,000.
    for (const g of games) expect((await matchState(g.matchId)).status).toBe('aborted')
    for (const p of players) expect(await wallet(p)).toEqual({ bonus: 1000, cash: 0 })

    // Again, this time played to a decisive result in all three at once.
    const second = await Promise.all([startGame(ada, bola, 100, '1+0'), startGame(chidi, dede, 250, '3+2'), startGame(efe, femi, 500, '5+0')])
    await Promise.all(second.map((g) => move(g.white, g.matchId, 'e2e4', 0)))
    await Promise.all(second.map((g) => move(g.black, g.matchId, 'e7e5', 1)))
    await Promise.all(second.flatMap((g) => [...burstOf(3, () => act(g.white, g.matchId, 'resign')), ...burstOf(2, () => act(g.black, g.matchId, 'claim'))]))

    let rake = 0
    for (const [index, g] of second.entries()) {
      const state = await matchState(g.matchId)
      const stake = [100, 250, 500][index]!
      expect([state.result, state.end_reason, state.winner_id, state.payouts, state.revenue_rows]).toEqual(['win', 'resignation', g.black.id, 1, 1])
      expect(state.rake).toBe((stake * 2) / 10)
      expect(await wallet(g.black)).toEqual({ bonus: 1000 + stake * 2 - state.rake - stake, cash: 0 })
      expect(await wallet(g.white)).toEqual({ bonus: 1000 - stake, cash: 0 })
      rake += state.rake
    }
    expect((await tokensHeldBy(players)) + rake).toBe(6000)
  })
})

function burstOf<T>(count: number, request: () => Promise<T>): Promise<T>[] {
  return Array.from({ length: count }, request)
}
