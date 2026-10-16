import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applyMove, replay, START } from '../functions/_shared/oware'
import { createTestDb, type TestDb } from './testDb'

// Oware's database side: who may have a move recorded and when, that every seed stays counted,
// the clocks, draws and resignation, and that a finished game is settled. Moves are judged with
// the real rules, exactly as the oware-action Edge Function does, then handed to the database
// the way it hands them over.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0
const CONTROL = { time_control: '3+2' }

const row = async (matchId: string) =>
  (
    await db.rows<Json>(
      `select pits, store_south, store_north, turn, ply, south_time_ms::int as south_time_ms, north_time_ms::int as north_time_ms, increment_ms::int as increment_ms, draw_offer_by from public.oware_games where match_id = $1`,
      [matchId],
    )
  )[0]!
const match = async (matchId: string) =>
  (await db.rows<{ status: string; result: string | null; end_reason: string | null; winner_id: string | null }>(`select status, result, end_reason, winner_id from public.matches where id = $1`, [matchId]))[0]!
const wallet = async (user: string) =>
  (await db.rows<{ bonus: number; cash: number }>(`select bonus_balance::int as bonus, cash_balance::int as cash from public.wallets where user_id = $1`, [users[user]]))[0]!

async function newGame(stake = 0, options: Json = CONTROL) {
  const a = `oa${++n}`
  const b = `ob${n}`
  for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
  await db.pg.query(`select public.join_match_queue($1, 'oware', $2, $3, 'default')`, [users[a], stake, JSON.stringify(options)])
  const [joined] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'oware', $2, $3, 'default') as r`, [users[b], stake, JSON.stringify(options)])
  const matchId = joined!.r.match_id as string
  const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
  const by = (seat: string) => (seats.find((s) => s.seat === seat)!.user_id === users[a] ? a : b)
  return { matchId, south: by('south'), north: by('north') }
}

/** The arguments of public.oware_apply_move after `ply` moves, as the Edge Function builds them. */
async function judged(user: string, matchId: string, pit: number) {
  const [context] = await db.rows<{ c: Json | null }>(`select public.oware_move_context($1, $2) as c`, [matchId, users[user]])
  if (!context!.c) return null
  const stored = replay(context!.c.moves)!
  const played = applyMove(stored.state, pit)
  return { context: context!.c, played }
}

/** Plays a move the way the Edge Function does: the stored game replayed, the pit judged, then the database. */
async function move(user: string, matchId: string, pit: number, ply?: number): Promise<Json> {
  const judgement = await judged(user, matchId, pit)
  if (!judgement) return { ok: false, code: 'NOT_A_PLAYER' }
  const { context, played } = judgement
  if (!played) return { ok: false, code: 'ILLEGAL_MOVE' }
  const [reply] = await db.rows<{ r: Json }>(`select public.oware_apply_move($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as r`, [
    matchId, users[user], ply ?? context.ply, played.move.pit, played.move.notation, played.move.taken,
    played.state.pits, played.state.stores.s, played.state.stores.n, played.result?.reason ?? null, played.result?.winner ?? null,
  ])
  return reply!.r
}
const apply = async (user: string, matchId: string, ply: number, pit: number, pits: number[], south: number, north: number, reason: string | null = null, winner: string | null = null) =>
  (await db.rows<{ r: Json }>(`select public.oware_apply_move($1, $2, $3, $4, 'a', 0, $5, $6, $7, $8, $9) as r`, [matchId, users[user], ply, pit, pits, south, north, reason, winner]))[0]!.r
const action = async (user: string, matchId: string, name: string) =>
  (await db.rows<{ r: Json }>(`select public.oware_game_action($1, $2, $3) as r`, [matchId, users[user], name]))[0]!.r
/** Moves the game's clock back, as if that much time had passed. */
const wait = (matchId: string, seconds: number) =>
  db.pg.query(`update public.oware_games set last_move_at = last_move_at - make_interval(secs => $2) where match_id = $1`, [matchId, seconds])

beforeAll(async () => {
  db = await createTestDb()
}, 120_000)

afterEach(async () => {
  await db.pg.exec(`select private.finish_match(id, 'aborted', null, 'test_cleanup') from public.matches where status = 'active'`)
  expect(await db.integrityProblems()).toEqual([])
})

afterAll(async () => {
  await db.close()
})

describe('starting', () => {
  it('Oware is live, for two players, with one rating and three clocks', async () => {
    const [game] = await db.rows<Json>(`select status, min_players, max_players, rating_pools, options_schema from public.game_types where id = 'oware'`)
    expect(game).toMatchObject({ status: 'live', min_players: 2, max_players: 2, rating_pools: ['default'] })
    expect(game!.options_schema.time_controls.map((c: Json) => c.id)).toEqual(['3+2', '5+3', '10+5'])
  })

  it('a game is set out with four seeds in every pit, South to move, and the clock that was asked for', async () => {
    const { matchId } = await newGame(0, { time_control: '5+3' })
    expect(await row(matchId)).toMatchObject({ pits: START, store_south: 0, store_north: 0, turn: 's', ply: 0, south_time_ms: 300_000, north_time_ms: 300_000, increment_ms: 3000, draw_offer_by: null })
  })

  it('a clock that is not on offer is refused, and nothing is left behind', async () => {
    const a = (users.ox1 = await db.createUser('ox1@example.com', { username: 'ox1', country_code: 'GH', age_confirmed: true }))
    const b = (users.ox2 = await db.createUser('ox2@example.com', { username: 'ox2', country_code: 'GH', age_confirmed: true }))
    await db.pg.query(`select public.join_match_queue($1, 'oware', 0, '{"time_control": "1+0"}', 'default')`, [a])
    await expect(db.pg.query(`select public.join_match_queue($1, 'oware', 0, '{"time_control": "1+0"}', 'default')`, [b])).rejects.toThrow(/OWARE_UNKNOWN_TIME_CONTROL/)
    expect(await db.rows(`select 1 from public.oware_games g join public.match_players mp using (match_id) where mp.user_id in ($1, $2)`, [a, b])).toEqual([])
    await db.pg.query(`delete from public.match_queue where user_id in ($1, $2)`, [a, b])
  })
})

describe('moves', () => {
  it('are recorded in turn, with the board and the record kept', async () => {
    const { matchId, south, north } = await newGame()
    expect(await move(south, matchId, 2)).toMatchObject({ ok: true, ply: 1, finished: false })
    expect(await move(north, matchId, 8)).toMatchObject({ ok: true, ply: 2 })
    // North's pits are not South's to play.
    expect(await move(south, matchId, 7)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await row(matchId)).toMatchObject({ pits: [5, 4, 0, 5, 5, 5, 5, 4, 0, 5, 5, 5], turn: 's', ply: 2 })
    expect((await row(matchId)).pits).toEqual(replay([2, 8])!.state.pits)
    expect(await db.rows(`select ply, pit, notation, taken from public.oware_moves where match_id = $1 order by ply`, [matchId])).toEqual([
      { ply: 1, pit: 2, notation: 'c', taken: 0 },
      { ply: 2, pit: 8, notation: 'C', taken: 0 },
    ])
  })

  it('out of turn, on an old position, or by someone else, are refused', async () => {
    const { matchId, south, north } = await newGame()
    expect(await apply(north, matchId, 0, 6, [4, 4, 4, 4, 4, 4, 0, 5, 5, 5, 5, 4], 0, 0)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await move(south, matchId, 0, 5)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    const other = await newGame()
    expect(await move(other.south, matchId, 0)).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(await row(matchId)).toMatchObject({ pits: START, ply: 0 })
  })

  it('a board that does not hold all 48 seeds, a pit of the other player, or a store going down, is refused', async () => {
    const { matchId, south } = await newGame()
    // A seed made out of nothing.
    expect(await apply(south, matchId, 0, 0, [0, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4], 0, 0)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    // Seeds put in a store that nobody captured.
    expect(await apply(south, matchId, 0, 0, [0, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4], 4, 0)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await apply(south, matchId, 0, 7, [4, 4, 4, 4, 4, 4, 4, 0, 5, 5, 5, 5], 0, 0)).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await row(matchId)).toMatchObject({ pits: START, ply: 0 })
  })

  it('cannot be made once the game is over', async () => {
    const { matchId, south, north } = await newGame()
    await move(south, matchId, 0)
    await move(north, matchId, 6)
    await action(south, matchId, 'resign')
    expect(await move(south, matchId, 1)).toEqual({ ok: false, code: 'GAME_OVER' })
  })
})

describe('clocks', () => {
  it('do not run until both players have moved; then the mover pays for their time and gets the increment', async () => {
    const { matchId, south, north } = await newGame()
    await wait(matchId, 10)
    await move(south, matchId, 0)
    await wait(matchId, 10)
    await move(north, matchId, 6)
    expect(await row(matchId)).toMatchObject({ south_time_ms: 180_000, north_time_ms: 180_000 })
    await wait(matchId, 20)
    await move(south, matchId, 1)
    const after = await row(matchId)
    expect(after.south_time_ms).toBeGreaterThan(161_000)
    expect(after.south_time_ms).toBeLessThanOrEqual(162_000)
    expect(after.north_time_ms).toBe(180_000)
  })

  it('a player whose time runs out loses, whoever points it out', async () => {
    const { matchId, south, north } = await newGame()
    await move(south, matchId, 0)
    await move(north, matchId, 6)
    expect(await action(north, matchId, 'claim')).toEqual({ ok: true, clock: 'none' })
    await wait(matchId, 181)
    expect(await move(south, matchId, 1)).toEqual({ ok: false, code: 'TIME_OUT' })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'timeout', winner_id: users[north] })
    expect((await row(matchId)).south_time_ms).toBe(0)
  })

  it('the background sweep ends a game both players have left', async () => {
    const { matchId, south, north } = await newGame()
    await move(south, matchId, 0)
    await move(north, matchId, 6)
    await wait(matchId, 200)
    await db.pg.exec(`select private.sweep()`)
    expect(await match(matchId)).toMatchObject({ status: 'finished', end_reason: 'timeout', winner_id: users[north] })
  })

  it('a game nobody starts is called off', async () => {
    const { matchId, south } = await newGame()
    await wait(matchId, 31)
    expect(await action(south, matchId, 'claim')).toEqual({ ok: true, clock: 'aborted' })
    expect(await match(matchId)).toMatchObject({ status: 'aborted', result: 'aborted', end_reason: 'no_first_move' })
  })
})

describe('ending', () => {
  it('a whole game played through to its end is recorded with the right result', async () => {
    const { matchId, south, north } = await newGame()
    // Each side plays its first non-empty pit until the rules end the game.
    let reply: Json = { finished: false }
    for (let plies = 0; !reply.finished && plies < 2000; plies++) {
      const state = await row(matchId)
      const player = state.turn === 's' ? south : north
      const judgement = await judged(player, matchId, 0)
      const options = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((pit) => applyMove(replay(judgement!.context.moves)!.state, pit))
      reply = await move(player, matchId, options[0]!)
      expect(reply.ok).toBe(true)
    }
    const end = await row(matchId)
    expect(end.store_south + end.store_north + (end.pits as number[]).reduce((a: number, b: number) => a + b, 0)).toBe(48)
    const result = await match(matchId)
    expect(result.status).toBe('finished')
    expect(['majority', 'no_moves', 'repetition', 'no_captures']).toContain(result.end_reason)
    if (result.result === 'win') expect(result.winner_id).toBe(end.store_south > end.store_north ? users[south] : users[north])
    else expect(end.store_south).toBe(end.store_north)
  })

  it('leaving before both have moved calls the game off; after that it is a loss', async () => {
    const early = await newGame()
    await action(early.south, early.matchId, 'resign')
    expect(await match(early.matchId)).toMatchObject({ status: 'aborted', end_reason: 'aborted_by_player' })

    const { matchId, south, north } = await newGame()
    await move(south, matchId, 0)
    await move(north, matchId, 6)
    await action(north, matchId, 'resign')
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'resignation', winner_id: users[south] })
  })

  it('a draw must be offered by one player and accepted by the other; a move turns it down', async () => {
    const { matchId, south, north } = await newGame()
    expect(await action(south, matchId, 'offer_draw')).toEqual({ ok: false, code: 'TOO_EARLY' })
    await move(south, matchId, 0)
    await move(north, matchId, 6)
    expect(await action(south, matchId, 'offer_draw')).toEqual({ ok: true })
    expect(await action(south, matchId, 'accept_draw')).toEqual({ ok: false, code: 'NO_OFFER' })
    expect(await action(north, matchId, 'decline_draw')).toEqual({ ok: true })

    await action(north, matchId, 'offer_draw')
    await move(south, matchId, 1)
    expect((await row(matchId)).draw_offer_by).toBeNull()

    await action(south, matchId, 'offer_draw')
    expect(await action(north, matchId, 'accept_draw')).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'draw', end_reason: 'agreement', winner_id: null })
  })
})

describe('money and standing', () => {
  it('the winner of a staked game is paid the pot less the commission, once, and both ratings move', async () => {
    const { matchId, south, north } = await newGame(100)
    expect((await wallet(south)).bonus).toBe(900)
    await move(south, matchId, 0)
    await move(north, matchId, 6)
    // The move that ends the game, as the rules would report it (every seed now in a store).
    expect(await apply(south, matchId, 2, 1, Array(12).fill(0), 25, 23, 'majority', 's')).toMatchObject({ ok: true, finished: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'majority', winner_id: users[south] })
    const won = await wallet(south)
    expect(won.bonus + won.cash).toBe(1080)
    expect((await wallet(north)).bonus).toBe(900)
    await db.pg.exec(`select private.sweep()`)
    const again = await wallet(south)
    expect(again.bonus + again.cash).toBe(1080)
    const ratings = await db.rows<{ user_id: string; rating: number; wins: number }>(`select user_id, rating, wins from public.player_ratings where game_type = 'oware' and pool = 'default' and user_id in ($1, $2)`, [users[south], users[north]])
    expect(ratings.find((r) => r.user_id === users[south])).toMatchObject({ wins: 1 })
    expect(ratings.find((r) => r.user_id === users[south])!.rating).toBeGreaterThan(1200)
    expect(ratings.find((r) => r.user_id === users[north])!.rating).toBeLessThan(1200)
  })

  it('a drawn staked game gives both stakes back', async () => {
    const { matchId, south, north } = await newGame(100)
    await move(south, matchId, 0)
    await move(north, matchId, 6)
    await action(south, matchId, 'offer_draw')
    await action(north, matchId, 'accept_draw')
    for (const player of [south, north]) {
      const w = await wallet(player)
      expect(w.bonus + w.cash).toBe(1000)
    }
  })
})

describe('access', () => {
  it('players can read their game and write nothing; the functions are for the server only', async () => {
    const { matchId, south } = await newGame()
    const stranger = (users.oz = await db.createUser('oz@example.com', { username: 'oz', country_code: 'GH', age_confirmed: true }))
    expect(await db.as('authenticated', users[south]!, () => db.rows(`select ply from public.oware_games where match_id = $1`, [matchId]))).toEqual([{ ply: 0 }])
    expect(await db.as('authenticated', stranger, () => db.rows(`select ply from public.oware_games where match_id = $1`, [matchId]))).toEqual([])
    await expect(db.as('authenticated', users[south]!, () => db.rows(`update public.oware_games set store_south = 25 where match_id = $1 returning 1`, [matchId]))).rejects.toThrow(/permission denied/)
    await expect(
      db.as('authenticated', users[south]!, () => db.rows(`insert into public.oware_moves (match_id, ply, pit, notation, pits_after, time_left_ms) values ($1, 1, 0, 'a', $2, 1)`, [matchId, START])),
    ).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', users[south]!, () => db.rows(`select public.oware_game_action($1, $2, 'resign')`, [matchId, users[south]]))).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', users[south]!, () => db.rows(`select public.oware_apply_move($1, $2, 0, 0, 'a', 0, $3, 25, 0, 'majority', 's')`, [matchId, users[south], START]))).rejects.toThrow(/permission denied/)
  })
})
