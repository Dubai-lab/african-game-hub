import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Money through a match: escrow, payout, rake, refunds, ratings.
// Every test starts from fresh accounts, and the ledger integrity check runs after each one.

let db: TestDb
let users: Record<string, string> = {}
let serial = 0
const BLITZ = { time_control: '3+2' }
type Json = Record<string, unknown>

/** A new player with exactly this much bonus and cash. (Signup gives 1,000 bonus.) */
async function player(name: string, bonus = 1000, cash = 0) {
  const id = await db.createUser(`${name}-${++serial}@example.com`, { username: `${name}_${serial}`, country_code: 'KE', age_confirmed: true })
  if (bonus !== 1000) await db.pg.query(`select private.apply_ledger_entry($1, $2, 'bonus', 'adjustment')`, [id, bonus - 1000])
  if (cash !== 0) await db.pg.query(`select private.apply_ledger_entry($1, $2, 'cash', 'adjustment')`, [id, cash])
  users[name] = id
  return id
}

async function join(name: string, stake: number, options: Json = BLITZ, pool = 'blitz'): Promise<Json> {
  const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', $2, $3::jsonb, $4) as r`, [
    users[name],
    stake,
    JSON.stringify(options),
    pool,
  ])
  return row!.r
}

async function wallet(name: string) {
  const [row] = await db.rows<{ bonus: number; cash: number }>(
    `select bonus_balance::int as bonus, cash_balance::int as cash from public.wallets where user_id = $1`,
    [users[name]],
  )
  return row!
}

async function staked(a: string, b: string, stake: number) {
  expect(await join(a, stake)).toEqual({ status: 'queued' })
  const result = await join(b, stake)
  expect(result.status).toBe('matched')
  return result.match_id as string
}

const finish = async (matchId: string, result: 'win' | 'draw' | 'aborted', winner: string | null, reason: string) =>
  (await db.rows<{ r: boolean }>(`select private.finish_match($1, $2, $3, $4) as r`, [matchId, result, winner ? users[winner] : null, reason]))[0]!.r

const escrow = (matchId: string) =>
  db.rows(
    `select (select username from public.profiles p where p.id = e.user_id) like $2 || '%' as is_a,
            amount::int as amount, balance_type, status
       from public.escrow e where match_id = $1 order by 1 desc, balance_type`,
    [matchId, 'a'],
  )

const seatInfo = async (matchId: string, name: string) =>
  (
    await db.rows<{ tokens: number | null; before: number | null; after: number | null }>(
      `select tokens_change::int as tokens, rating_before as before, rating_after as after
         from public.match_players where match_id = $1 and user_id = $2`,
      [matchId, users[name]],
    )
  )[0]!

const revenue = (matchId: string) =>
  db.rows(`select amount::int as amount, cash_amount::int as cash from public.platform_revenue where match_id = $1`, [matchId])

const ledger = (name: string) =>
  db.rows(
    `select entry_type, balance_type, amount::int as amount from public.ledger_entries
      where user_id = $1 and entry_type <> 'signup_bonus' and entry_type <> 'adjustment' order by id`,
    [users[name]],
  )

beforeAll(async () => {
  db = await createTestDb()
}, 120_000)

afterAll(async () => {
  await db.close()
})

beforeEach(() => {
  users = {}
})

afterEach(async () => {
  await db.pg.exec(`select private.finish_match(id, 'aborted', null, 'test_cleanup') from public.matches where status = 'active'`)
  await db.pg.exec(`delete from public.match_queue`)
  expect(await db.integrityProblems()).toEqual([])
})

describe('escrow', () => {
  it('takes both stakes when the match is made, and only then', async () => {
    await player('amara')
    await player('bayo')
    expect(await join('amara', 100)).toEqual({ status: 'queued' })
    // Waiting costs nothing.
    expect(await wallet('amara')).toEqual({ bonus: 1000, cash: 0 })

    const matchId = (await join('bayo', 100)).match_id as string
    expect(await wallet('amara')).toEqual({ bonus: 900, cash: 0 })
    expect(await wallet('bayo')).toEqual({ bonus: 900, cash: 0 })
    expect(await escrow(matchId)).toEqual([
      { is_a: true, amount: 100, balance_type: 'bonus', status: 'held' },
      { is_a: false, amount: 100, balance_type: 'bonus', status: 'held' },
    ])
    expect(await ledger('amara')).toEqual([{ entry_type: 'stake', balance_type: 'bonus', amount: -100 }])
    const [m] = await db.rows(`select stake_amount::int as stake, settled from public.matches where id = $1`, [matchId])
    expect(m).toEqual({ stake: 100, settled: false })
  })

  it('spends bonus tokens before cash', async () => {
    await player('amara', 60, 500)
    await player('bayo', 0, 500)
    const matchId = await staked('amara', 'bayo', 100)
    expect(await wallet('amara')).toEqual({ bonus: 0, cash: 460 })
    expect(await wallet('bayo')).toEqual({ bonus: 0, cash: 400 })
    expect(await escrow(matchId)).toEqual([
      { is_a: true, amount: 60, balance_type: 'bonus', status: 'held' },
      { is_a: true, amount: 40, balance_type: 'cash', status: 'held' },
      { is_a: false, amount: 100, balance_type: 'cash', status: 'held' },
    ])
  })

  it('refuses a player who cannot afford the stake, and moves nothing', async () => {
    await player('amara', 30, 10)
    expect(await join('amara', 50)).toEqual({ status: 'error', code: 'INSUFFICIENT_BALANCE' })
    expect(await join('amara', 1000)).toEqual({ status: 'error', code: 'INSUFFICIENT_BALANCE' })
    expect(await db.rows(`select 1 from public.match_queue`)).toEqual([])
    expect(await wallet('amara')).toEqual({ bonus: 30, cash: 10 })
    // A free game is still open to them.
    expect(await join('amara', 0)).toEqual({ status: 'queued' })
  })

  it('makes no match when the waiting player can no longer pay: nobody is charged', async () => {
    await player('amara')
    await player('bayo')
    await player('chika')
    expect(await join('amara', 500)).toEqual({ status: 'queued' })
    // Amara's balance drops while she waits.
    await db.pg.query(`select private.apply_ledger_entry($1, -700, 'bonus', 'adjustment')`, [users.amara])

    expect(await join('bayo', 500)).toEqual({ status: 'queued' })
    expect(await db.rows(`select 1 from public.matches where status = 'active'`)).toEqual([])
    expect(await wallet('bayo')).toEqual({ bonus: 1000, cash: 0 })
    expect(await wallet('amara')).toEqual({ bonus: 300, cash: 0 })
    // Amara was dropped from the queue; Bayo is paired with the next player who can pay.
    const queued = await db.rows<{ user_id: string }>(`select user_id from public.match_queue`)
    expect(queued).toEqual([{ user_id: users.bayo }])
    expect((await join('chika', 500)).status).toBe('matched')
    expect(await wallet('bayo')).toEqual({ bonus: 500, cash: 0 })
  })

  it('requires the 18+ confirmation for staked games only', async () => {
    users.minor = await db.createUser(`unconfirmed-${++serial}@example.com`, { username: `unconfirmed_${serial}` })
    expect(await join('minor', 50)).toEqual({ status: 'error', code: 'AGE_NOT_CONFIRMED' })
    expect(await join('minor', 0)).toEqual({ status: 'queued' })
  })

  it('a stake cannot be spent twice: the tokens in escrow are gone from the wallet', async () => {
    await player('amara', 100)
    await player('bayo')
    await staked('amara', 'bayo', 100)
    expect(await wallet('amara')).toEqual({ bonus: 0, cash: 0 })
    // She is in a game, so asking again just returns that game; nothing more is taken.
    expect((await join('amara', 100)).status).toBe('matched')
    expect(await wallet('amara')).toEqual({ bonus: 0, cash: 0 })
    await expect(db.pg.query(`select private.take_stake(gen_random_uuid(), $1, 1)`, [users.amara])).rejects.toThrow(/INSUFFICIENT_BALANCE/)
  })
})

describe('settlement', () => {
  it('pays the winner the pot less the rake, and bonus-funded winnings stay bonus', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 100)
    expect(await finish(matchId, 'win', 'amara', 'checkmate')).toBe(true)

    // Pot 200, rake 10% = 20, payout 180.
    expect(await wallet('amara')).toEqual({ bonus: 1080, cash: 0 })
    expect(await wallet('bayo')).toEqual({ bonus: 900, cash: 0 })
    expect(await revenue(matchId)).toEqual([{ amount: 20, cash: 0 }])
    expect((await escrow(matchId)).map((e) => e.status)).toEqual(['paid_out', 'paid_out'])
    expect(await ledger('amara')).toEqual([
      { entry_type: 'stake', balance_type: 'bonus', amount: -100 },
      { entry_type: 'win_payout', balance_type: 'bonus', amount: 180 },
    ])
    expect((await seatInfo(matchId, 'amara')).tokens).toBe(80)
    expect((await seatInfo(matchId, 'bayo')).tokens).toBe(-100)
    const [m] = await db.rows(`select settled, settled_at is not null as stamped from public.matches where id = $1`, [matchId])
    expect(m).toEqual({ settled: true, stamped: true })
  })

  it('pays cash winnings as cash and records the rake as real revenue', async () => {
    await player('amara', 0, 1000)
    await player('bayo', 0, 1000)
    const matchId = await staked('amara', 'bayo', 250)
    await finish(matchId, 'win', 'bayo', 'resignation')
    // Pot 500, rake 50, payout 450.
    expect(await wallet('bayo')).toEqual({ bonus: 0, cash: 1200 })
    expect(await wallet('amara')).toEqual({ bonus: 0, cash: 750 })
    expect(await revenue(matchId)).toEqual([{ amount: 50, cash: 50 }])
  })

  it('splits a mixed pot so only the cash-funded share is paid as cash', async () => {
    await player('amara') // stakes 100 bonus
    await player('bayo', 0, 500) // stakes 100 cash
    const matchId = await staked('amara', 'bayo', 100)
    await finish(matchId, 'win', 'amara', 'checkmate')
    // Payout 180: half the pot was bonus, so 90 bonus and 90 cash. Amara cannot turn her free
    // tokens into more cash than her opponent actually put in.
    expect(await wallet('amara')).toEqual({ bonus: 990, cash: 90 })
    expect(await revenue(matchId)).toEqual([{ amount: 20, cash: 10 }])
  })

  it('follows the bonus-winnings setting', async () => {
    try {
      await db.pg.exec(`update public.platform_settings set bonus_winnings_policy = 'bonus_stake_returned'`)
      await player('amara')
      await player('bayo')
      const first = await staked('amara', 'bayo', 100)
      await finish(first, 'win', 'amara', 'checkmate')
      // Her own 100 bonus stake comes back as bonus; the other 80 is cash.
      expect(await wallet('amara')).toEqual({ bonus: 1000, cash: 80 })

      await db.pg.exec(`update public.platform_settings set bonus_winnings_policy = 'cash'`)
      await player('chika')
      await player('dayo')
      const second = await staked('chika', 'dayo', 100)
      await finish(second, 'win', 'chika', 'checkmate')
      expect(await wallet('chika')).toEqual({ bonus: 900, cash: 180 })
      // The platform paid 180 cash for a pot with no cash in it: recorded as a cost, not hidden.
      expect(await revenue(second)).toEqual([{ amount: 20, cash: -180 }])
    } finally {
      await db.pg.exec(`update public.platform_settings set bonus_winnings_policy = 'bonus_stays_bonus'`)
    }
  })

  it('rounds the rake down, so rake plus payout always equals the pot', async () => {
    try {
      await db.pg.exec(`update public.platform_settings set rake_bps = 750`)
      await player('amara')
      await player('bayo')
      const matchId = await staked('amara', 'bayo', 50)
      await finish(matchId, 'win', 'amara', 'checkmate')
      // 7.5% of 100 is 7.5: the platform takes 7, the winner 93.
      expect(await revenue(matchId)).toEqual([{ amount: 7, cash: 0 }])
      expect(await wallet('amara')).toEqual({ bonus: 1043, cash: 0 })
    } finally {
      await db.pg.exec(`update public.platform_settings set rake_bps = 1000`)
    }
  })

  it('a draw returns every stake to the balance it came from, with no rake', async () => {
    await player('amara', 60, 500)
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 100)
    await finish(matchId, 'draw', null, 'stalemate')
    expect(await wallet('amara')).toEqual({ bonus: 60, cash: 500 })
    expect(await wallet('bayo')).toEqual({ bonus: 1000, cash: 0 })
    expect(await revenue(matchId)).toEqual([])
    expect((await escrow(matchId)).map((e) => e.status)).toEqual(['refunded', 'refunded', 'refunded'])
    expect((await seatInfo(matchId, 'amara')).tokens).toBe(0)
    expect(await ledger('amara')).toEqual([
      { entry_type: 'stake', balance_type: 'bonus', amount: -60 },
      { entry_type: 'stake', balance_type: 'cash', amount: -40 },
      { entry_type: 'stake_refund', balance_type: 'bonus', amount: 60 },
      { entry_type: 'stake_refund', balance_type: 'cash', amount: 40 },
    ])
  })

  it('an aborted game refunds both stakes in full and leaves ratings alone', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 500)
    // Nobody moves for 31 seconds; the sweep calls the game off.
    await db.pg.query(`update public.chess_games set last_move_at = now() - interval '31 seconds' where match_id = $1`, [matchId])
    await db.pg.exec(`select private.sweep()`)
    const [m] = await db.rows(`select status, settled from public.matches where id = $1`, [matchId])
    expect(m).toEqual({ status: 'aborted', settled: true })
    expect(await wallet('amara')).toEqual({ bonus: 1000, cash: 0 })
    expect(await wallet('bayo')).toEqual({ bonus: 1000, cash: 0 })
    expect(await revenue(matchId)).toEqual([])
    expect(await db.rows(`select 1 from public.player_ratings where user_id in ($1, $2)`, [users.amara, users.bayo])).toEqual([])
    expect((await seatInfo(matchId, 'amara')).after).toBeNull()
  })

  it('a timeout found by the background sweep is paid out like any other win', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 100)
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    await db.pg.query(
      `update public.chess_games set ply = 2, fen = $2, turn = 'w', last_move_at = now() - interval '1 hour' where match_id = $1`,
      [matchId, fen],
    )
    await db.pg.exec(`select private.sweep()`)
    const [m] = await db.rows<{ end_reason: string; settled: boolean; winner: string }>(
      `select m.end_reason, m.settled, (select seat from public.match_players mp where mp.match_id = m.id and mp.user_id = m.winner_id) as winner
         from public.matches m where m.id = $1`,
      [matchId],
    )
    expect(m).toEqual({ end_reason: 'timeout', settled: true, winner: 'black' })
    const total = (await wallet('amara')).bonus + (await wallet('bayo')).bonus
    expect(total).toBe(1980)
  })

  it('is exactly-once: a retried or repeated settlement pays nothing more', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 100)
    expect(await finish(matchId, 'win', 'amara', 'checkmate')).toBe(true)

    // The same result again, a different result, and the settlement function called directly.
    expect(await finish(matchId, 'win', 'amara', 'checkmate')).toBe(false)
    expect(await finish(matchId, 'win', 'bayo', 'checkmate')).toBe(false)
    expect(await finish(matchId, 'draw', null, 'agreement')).toBe(false)
    for (let i = 0; i < 3; i++) {
      const [again] = await db.rows<{ r: boolean }>(`select private.settle_match($1) as r`, [matchId])
      expect(again!.r).toBe(false)
    }
    await db.pg.exec(`select private.sweep()`)

    expect(await wallet('amara')).toEqual({ bonus: 1080, cash: 0 })
    expect(await wallet('bayo')).toEqual({ bonus: 900, cash: 0 })
    expect(await revenue(matchId)).toEqual([{ amount: 20, cash: 0 }])
    expect(await db.rows(`select count(*)::int as n from public.ledger_entries where match_id = $1 and entry_type = 'win_payout'`, [matchId])).toEqual([{ n: 1 }])
    // Second line of defence: even if someone with database access forced the flag back, the
    // escrow rows are already released, so there is nothing left to pay out.
    await db.pg.query(`update public.matches set settled = false, settled_at = null where id = $1`, [matchId])
    await db.pg.query(`select private.settle_match($1)`, [matchId])
    expect(await wallet('amara')).toEqual({ bonus: 1080, cash: 0 })
    expect(await wallet('bayo')).toEqual({ bonus: 900, cash: 0 })
    expect(await revenue(matchId)).toEqual([{ amount: 20, cash: 0 }])
  })

  it('refuses to settle a match that is still being played', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 100)
    const [early] = await db.rows<{ r: boolean }>(`select private.settle_match($1) as r`, [matchId])
    expect(early!.r).toBe(false)
    expect(await wallet('amara')).toEqual({ bonus: 900, cash: 0 })
    expect((await escrow(matchId)).map((e) => e.status)).toEqual(['held', 'held'])
  })

  it('a free game moves no tokens at all', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 0)
    expect(await escrow(matchId)).toEqual([])
    await finish(matchId, 'win', 'amara', 'checkmate')
    expect(await wallet('amara')).toEqual({ bonus: 1000, cash: 0 })
    expect(await ledger('amara')).toEqual([])
    expect(await revenue(matchId)).toEqual([])
    expect((await seatInfo(matchId, 'amara')).tokens).toBe(0)
  })

  it('every token is accounted for across a run of games', async () => {
    await player('amara', 1000, 300)
    await player('bayo', 400, 900)
    const before = 1000 + 300 + 400 + 900
    const results: ['win' | 'draw' | 'aborted', string | null][] = [
      ['win', 'amara'], ['win', 'bayo'], ['draw', null], ['win', 'bayo'], ['aborted', null], ['win', 'amara'],
    ]
    let rake = 0
    for (const [index, [result, winner]] of results.entries()) {
      const matchId = await staked(index % 2 ? 'bayo' : 'amara', index % 2 ? 'amara' : 'bayo', [50, 100, 250, 100, 500, 250][index]!)
      await finish(matchId, result, winner, 'test')
      rake += Number((await revenue(matchId))[0]?.amount ?? 0)
    }
    const a = await wallet('amara')
    const b = await wallet('bayo')
    // What the two players hold, plus what the platform took, is exactly what they started with.
    expect(a.bonus + a.cash + b.bonus + b.cash + rake).toBe(before)
    expect(rake).toBe(10 + 20 + 20 + 50)
  })
})

describe('ratings', () => {
  it('move after a win, per rating pool, and count the game', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 0)
    await finish(matchId, 'win', 'amara', 'checkmate')

    // Equal ratings, K = 40 for new players: +20 and -20.
    expect(await seatInfo(matchId, 'amara')).toMatchObject({ before: 1200, after: 1220 })
    expect(await seatInfo(matchId, 'bayo')).toMatchObject({ before: 1200, after: 1180 })
    const rows = await db.rows(
      `select pool, rating, games_played as games, wins, losses, draws from public.player_ratings where user_id = $1`,
      [users.amara],
    )
    // Only the blitz rating exists: bullet and rapid are untouched.
    expect(rows).toEqual([{ pool: 'blitz', rating: 1220, games: 1, wins: 1, losses: 0, draws: 0 }])
  })

  it('reward an upset more than an expected win, and a draw between equals changes nothing', async () => {
    await player('amara')
    await player('bayo')
    // Amara is rated far above Bayo in rapid.
    await db.pg.query(
      `insert into public.player_ratings (user_id, game_type, pool, rating, games_played, wins) values ($1, 'chess', 'rapid', 1600, 30, 30)`,
      [users.amara],
    )
    expect(await join('amara', 0, { time_control: '10+0' }, 'rapid')).toEqual({ status: 'queued' })
    const upset = (await join('bayo', 0, { time_control: '10+0' }, 'rapid')).match_id as string
    await finish(upset, 'win', 'bayo', 'checkmate')
    const winner = await seatInfo(upset, 'bayo')
    const loser = await seatInfo(upset, 'amara')
    // Bayo (1200, new, K = 40) beat a 1600: nearly the full 40. Amara (established, K = 20) loses about 18.
    expect(winner.after! - winner.before!).toBe(36)
    expect(loser.after! - loser.before!).toBe(-18)

    await player('chika')
    await player('dayo')
    const drawn = await staked('chika', 'dayo', 0)
    await finish(drawn, 'draw', null, 'agreement')
    expect(await seatInfo(drawn, 'chika')).toMatchObject({ before: 1200, after: 1200 })
    const [stats] = await db.rows(`select games_played as games, draws from public.player_ratings where user_id = $1`, [users.chika])
    expect(stats).toEqual({ games: 1, draws: 1 })
  })

  it('pair the closest-rated player first', async () => {
    await player('strong')
    await player('weak')
    await player('seeker')
    await db.pg.query(
      `insert into public.player_ratings (user_id, game_type, pool, rating) values ($1, 'chess', 'blitz', 1900), ($2, 'chess', 'blitz', 1250), ($3, 'chess', 'blitz', 1300)`,
      [users.strong, users.weak, users.seeker],
    )
    // Two players already waiting (written straight into the queue, since joining normally
    // would pair them with each other). The stronger one has waited longer.
    await db.pg.query(
      `insert into public.match_queue (user_id, game_type, stake_amount, options, rating, rating_pool, joined_at)
       values ($1, 'chess', 0, '{"time_control":"3+2"}', 1900, 'blitz', now() - interval '20 seconds'),
              ($2, 'chess', 0, '{"time_control":"3+2"}', 1250, 'blitz', now())`,
      [users.strong, users.weak],
    )
    const result = await join('seeker', 0)
    expect(result.status).toBe('matched')
    const opponents = await db.rows<{ user_id: string }>(
      `select user_id from public.match_players where match_id = $1 and user_id <> $2`,
      [result.match_id, users.seeker],
    )
    expect(opponents).toEqual([{ user_id: users.weak }])
  })
})

describe('integrity check', () => {
  it('notices a settled match that still holds a stake', async () => {
    await player('amara')
    await player('bayo')
    const matchId = await staked('amara', 'bayo', 100)
    await finish(matchId, 'draw', null, 'agreement')
    await db.pg.query(`update public.escrow set status = 'held', released_at = null where match_id = $1 and user_id = $2`, [matchId, users.amara])
    const problems = (await db.integrityProblems()).map((p) => p.check_name)
    expect(problems).toContain('escrow_stuck_after_settlement')
    expect(problems).toContain('escrow_conservation')

    // The scheduled check records what it found.
    const [found] = await db.rows<{ n: number }>(`select private.check_integrity() as n`)
    expect(found!.n).toBeGreaterThanOrEqual(2)
    const [alert] = await db.rows<{ names: string[] }>(
      `select array(select jsonb_array_elements(problems) ->> 'check_name') as names from private.integrity_alerts order by id desc limit 1`,
    )
    expect(alert!.names).toContain('escrow_stuck_after_settlement')
    await db.pg.query(`update public.escrow set status = 'refunded', released_at = now() where match_id = $1`, [matchId])
    // Once repaired, the check is quiet again and adds no alert.
    const [clean] = await db.rows<{ n: number }>(`select private.check_integrity() as n`)
    expect(clean!.n).toBe(0)
    expect(await db.rows(`select count(*)::int as n from private.integrity_alerts`)).toEqual([{ n: 1 }])
  })
})
