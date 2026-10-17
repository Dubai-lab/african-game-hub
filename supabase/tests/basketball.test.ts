import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Street basketball's database side: matches found for one against one and two against two,
// the sides dealt, the result taken once from the game server (and only a result the rules
// allow), matches called off, the ratings, and nobody able to write any of it from the app.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

beforeAll(async () => {
  db = await createTestDb()
}, 120_000)

afterEach(async () => {
  expect(await db.integrityProblems()).toEqual([])
})

afterAll(async () => {
  await db.close()
})

const match = async (matchId: string) =>
  (await db.rows<{ status: string; result: string | null; end_reason: string | null; winner_id: string | null; rating_pool: string; settled: boolean }>(
    `select status, result, end_reason, winner_id, rating_pool, settled from public.matches where id = $1`,
    [matchId],
  ))[0]!
const court = async (matchId: string) => (await db.rows<Json>(`select * from public.basketball_games where match_id = $1`, [matchId]))[0]!
const call = async (sql: string, params: unknown[]) => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r

/** A match found through the queue for `players` players. Returns it and who sits where. */
async function newMatch(players: 2 | 4) {
  const names = Array.from({ length: players }, () => `bb${++n}`)
  for (const name of names) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'RW', age_confirmed: true })
  const pool = players === 2 ? 'default' : 'unrated'
  let outcome: Json = {}
  for (const name of names) {
    outcome = await call(`public.join_match_queue($1, 'basketball', 0, $2, $3, $4)`, [users[name], JSON.stringify({ players }), pool, players])
  }
  expect(outcome.status).toBe('matched')
  const matchId = outcome.match_id as string
  const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1 order by seat`, [matchId])
  const at = (seat: string) => seats.find((s) => s.seat === seat)!.user_id
  return { matchId, seats, at }
}

describe('finding a match', () => {
  it('one against one: two players, sides a1 and b1, a seed, rated', async () => {
    const { matchId, seats } = await newMatch(2)
    expect(seats.map((s) => s.seat)).toEqual(['a1', 'b1'])
    const game = await court(matchId)
    expect(game.team_size).toBe(1)
    expect(Number.isInteger(game.seed)).toBe(true)
    expect((await match(matchId)).rating_pool).toBe('default')
  })

  it('two against two: four players, two a side', async () => {
    const { matchId, seats } = await newMatch(4)
    expect(seats.map((s) => s.seat)).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect((await court(matchId)).team_size).toBe(2)
    expect((await match(matchId)).rating_pool).toBe('unrated')
  })

  it('only free matches, and only one or two a side', async () => {
    const id = await db.createUser(`bbx${++n}@example.com`, { username: `bbx${n}`, country_code: 'RW', age_confirmed: true })
    expect((await call(`public.join_match_queue($1, 'basketball', 50, $2, 'default', 2)`, [id, JSON.stringify({ players: 2 })])).code).toBe('STAKE_NOT_ALLOWED')
    expect((await call(`public.join_match_queue($1, 'basketball', 0, $2, 'default', 6)`, [id, JSON.stringify({ players: 6 })])).code).toBe('OPTIONS_NOT_ALLOWED')
  })
})

describe('the game server', () => {
  it('is told who plays where, and only for a player of the match', async () => {
    const { matchId, at } = await newMatch(2)
    const context = await call(`public.basketball_court_context($1, $2)`, [matchId, at('b1')])
    expect(context).toMatchObject({ status: 'active', team_size: 1, seat: 'b1' })
    expect(context.players.map((p: Json) => p.seat)).toEqual(['a1', 'b1'])
    const stranger = await db.createUser(`bbs${++n}@example.com`, { username: `bbs${n}`, country_code: 'RW' })
    expect(await call(`public.basketball_court_context($1, $2)`, [matchId, stranger])).toBeNull()
  })

  it('records a game played out, once, and the core settles and rates it', async () => {
    const { matchId, at } = await newMatch(2)
    expect(await call(`public.basketball_alive($1, true)`, [matchId])).toBe(true)
    expect(await call(`public.basketball_finish($1, 'b', 7, 11, 'played')`, [matchId])).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', winner_id: at('b1'), end_reason: 'played', settled: true })
    expect(await court(matchId)).toMatchObject({ score_a: 7, score_b: 11, winning_side: 'b' })
    // Twice is refused: the result is taken once.
    expect(await call(`public.basketball_finish($1, 'a', 11, 7, 'played')`, [matchId])).toMatchObject({ ok: false, code: 'MATCH_NOT_ACTIVE' })
    const ratings = await db.rows<{ user_id: string; rating: number; wins: number }>(
      `select user_id, rating, wins from public.player_ratings where game_type = 'basketball' and user_id = any($1)`,
      [[at('a1'), at('b1')]],
    )
    expect(ratings.find((r) => r.user_id === at('b1'))!.rating).toBeGreaterThan(1200)
    expect(ratings.find((r) => r.user_id === at('a1'))!.rating).toBeLessThan(1200)
  })

  it('takes no result the rules do not allow', async () => {
    const { matchId } = await newMatch(2)
    for (const [side, a, b, reason] of [
      ['a', 10, 4, 'played'],
      ['a', 11, 12, 'played'],
      ['c', 11, 3, 'played'],
      ['a', 11, 3, 'because'],
      ['a', 99, 3, 'abandoned'],
    ] as const) {
      expect(await call(`public.basketball_finish($1, $2, $3, $4, $5)`, [matchId, side, a, b, reason])).toMatchObject({ ok: false, code: 'BAD_RESULT' })
    }
    // A side that left loses at any score.
    expect(await call(`public.basketball_finish($1, 'a', 3, 5, 'abandoned')`, [matchId])).toEqual({ ok: true })
  })

  it('two against two: the side wins, nobody is rated', async () => {
    const { matchId, at } = await newMatch(4)
    expect(await call(`public.basketball_finish($1, 'a', 11, 9, 'played')`, [matchId])).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', winner_id: at('a1'), settled: true })
    const rated = await db.rows(`select 1 from public.player_ratings where game_type = 'basketball' and user_id = any($1)`, [[at('a1'), at('a2'), at('b1'), at('b2')]])
    expect(rated).toHaveLength(0)
  })

  it('a match nobody plays, or one the server lost, is called off', async () => {
    const { matchId } = await newMatch(2)
    expect(await call(`public.basketball_abort($1, 'no_show')`, [matchId])).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'aborted', end_reason: 'no_show', settled: true })

    const lost = await newMatch(2)
    await call(`public.basketball_alive($1, true)`, [lost.matchId])
    await db.pg.query(`update public.basketball_games set seen_at = now() - interval '2 minutes' where match_id = $1`, [lost.matchId])
    await db.pg.query(`select private.basketball_sweep()`)
    expect(await match(lost.matchId)).toMatchObject({ status: 'aborted', end_reason: 'server_lost' })
  })
})

describe('nobody writes it from the app', () => {
  it('a player can read their match but not change it, nor call the server functions', async () => {
    const { matchId, at } = await newMatch(2)
    const player = at('a1')
    const seen = await db.as('authenticated', player, () => db.rows(`select score_a from public.basketball_games where match_id = $1`, [matchId]))
    expect(seen).toHaveLength(1)
    await expect(db.as('authenticated', player, () => db.rows(`update public.basketball_games set score_a = 11 where match_id = $1`, [matchId]))).rejects.toThrow()
    expect((await court(matchId)).score_a).toBe(0)
    await expect(db.as('authenticated', player, () => db.rows(`select public.basketball_finish($1, 'a', 11, 0, 'played')`, [matchId]))).rejects.toThrow()
    await expect(db.as('authenticated', player, () => db.rows(`select public.basketball_abort($1, 'no_show')`, [matchId]))).rejects.toThrow()
  })
})
