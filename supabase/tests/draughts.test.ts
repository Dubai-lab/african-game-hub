import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applyMove, replay, START } from '../functions/_shared/draughts'
import { createTestDb, type TestDb } from './testDb'

// Draughts' database side: who may have a move recorded and when, the clocks, draws and
// resignation, and that a finished game is settled. Moves are judged with the real rules,
// exactly as the draughts-action Edge Function does, then handed to the database the way it
// hands them over.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0
const CONTROL = { time_control: '3+2' }

const row = async (matchId: string) =>
  (await db.rows<Json>(`select board, turn, ply, white_time_ms::int as white_time_ms, black_time_ms::int as black_time_ms, increment_ms::int as increment_ms, draw_offer_by from public.draughts_games where match_id = $1`, [matchId]))[0]!
const match = async (matchId: string) =>
  (await db.rows<{ status: string; result: string | null; end_reason: string | null; winner_id: string | null }>(`select status, result, end_reason, winner_id from public.matches where id = $1`, [matchId]))[0]!
const wallet = async (user: string) =>
  (await db.rows<{ bonus: number; cash: number }>(`select bonus_balance::int as bonus, cash_balance::int as cash from public.wallets where user_id = $1`, [users[user]]))[0]!

async function newGame(stake = 0, options: Json = CONTROL) {
  const a = `da${++n}`
  const b = `db${n}`
  for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'RW', age_confirmed: true })
  await db.pg.query(`select public.join_match_queue($1, 'draughts', $2, $3, 'default')`, [users[a], stake, JSON.stringify(options)])
  const [joined] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'draughts', $2, $3, 'default') as r`, [users[b], stake, JSON.stringify(options)])
  const matchId = joined!.r.match_id as string
  const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
  const by = (seat: string) => (seats.find((s) => s.seat === seat)!.user_id === users[a] ? a : b)
  return { matchId, white: by('white'), black: by('black') }
}

/** Plays a move the way the Edge Function does: the stored game replayed, the move judged, then the database. */
async function move(user: string, matchId: string, path: number[], ply?: number): Promise<Json> {
  const [context] = await db.rows<{ c: Json | null }>(`select public.draughts_move_context($1, $2) as c`, [matchId, users[user]])
  if (!context!.c) return { ok: false, code: 'NOT_A_PLAYER' }
  const stored = replay(context!.c.paths)!
  const played = applyMove(stored.state, path)
  if (!played) return { ok: false, code: 'ILLEGAL_MOVE' }
  const [reply] = await db.rows<{ r: Json }>(`select public.draughts_apply_move($1, $2, $3, $4, $5, $6, $7, $8, $9) as r`, [
    matchId, users[user], ply ?? context!.c.ply, played.move.notation, JSON.stringify(played.move.path), JSON.stringify(played.move.captures),
    played.state.board, played.result?.reason ?? null, played.result?.winner ?? null,
  ])
  return reply!.r
}
const action = async (user: string, matchId: string, name: string) =>
  (await db.rows<{ r: Json }>(`select public.draughts_game_action($1, $2, $3) as r`, [matchId, users[user], name]))[0]!.r
/** Moves the game's clock back, as if that much time had passed. */
const wait = (matchId: string, seconds: number) =>
  db.pg.query(`update public.draughts_games set last_move_at = last_move_at - make_interval(secs => $2) where match_id = $1`, [matchId, seconds])

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
  it('draughts is live, for two players, with one rating', async () => {
    const [game] = await db.rows<Json>(`select status, min_players, max_players, rating_pools, options_schema from public.game_types where id = 'draughts'`)
    expect(game).toMatchObject({ status: 'live', min_players: 2, max_players: 2, rating_pools: ['default'] })
    expect(game!.options_schema.time_controls.map((c: Json) => c.id)).toEqual(['3+2', '5+3', '10+5', '15+10'])
  })

  it('a game is set out with twenty men each, White to move, and the clock that was asked for', async () => {
    const { matchId } = await newGame(0, { time_control: '5+3' })
    expect(await row(matchId)).toMatchObject({ board: START, turn: 'w', ply: 0, white_time_ms: 300_000, black_time_ms: 300_000, increment_ms: 3000, draw_offer_by: null })
  })

  it('a clock that is not on offer is refused, and nothing is left behind', async () => {
    const a = (users.dx1 = await db.createUser('dx1@example.com', { username: 'dx1', country_code: 'RW', age_confirmed: true }))
    const b = (users.dx2 = await db.createUser('dx2@example.com', { username: 'dx2', country_code: 'RW', age_confirmed: true }))
    await db.pg.query(`select public.join_match_queue($1, 'draughts', 0, '{"time_control": "1+0"}', 'default')`, [a])
    await expect(db.pg.query(`select public.join_match_queue($1, 'draughts', 0, '{"time_control": "1+0"}', 'default')`, [b])).rejects.toThrow(/DRAUGHTS_UNKNOWN_TIME_CONTROL/)
    expect(await db.rows(`select 1 from public.draughts_games g join public.match_players mp using (match_id) where mp.user_id in ($1, $2)`, [a, b])).toEqual([])
    await db.pg.query(`delete from public.match_queue where user_id in ($1, $2)`, [a, b])
  })
})

describe('moves', () => {
  it('are recorded in turn, with the board and the record kept', async () => {
    const { matchId, white, black } = await newGame()
    expect(await move(white, matchId, [32, 28])).toMatchObject({ ok: true, ply: 1, finished: false })
    expect(await move(black, matchId, [19, 23])).toMatchObject({ ok: true, ply: 2 })
    // White must take: it is the only move on offer.
    expect(await move(white, matchId, [31, 27])).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await move(white, matchId, [28, 19])).toMatchObject({ ok: true, ply: 3 })
    expect(await row(matchId)).toMatchObject({ turn: 'b', ply: 3 })
    expect(await db.rows(`select ply, notation, path, captures from public.draughts_moves where match_id = $1 order by ply`, [matchId])).toEqual([
      { ply: 1, notation: '32-28', path: [32, 28], captures: [] },
      { ply: 2, notation: '19-23', path: [19, 23], captures: [] },
      { ply: 3, notation: '28x19', path: [28, 19], captures: [23] },
    ])
  })

  it('out of turn, on an old position, or by someone else, are refused', async () => {
    const { matchId, white, black } = await newGame()
    expect((await db.rows<{ r: Json }>(`select public.draughts_apply_move($1, $2, 0, '20-25', '[20,25]', '[]', $3, null, null) as r`, [matchId, users[black], START]))[0]!.r).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await move(white, matchId, [32, 28], 5)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    const other = await newGame()
    expect(await move(other.white, matchId, [32, 28])).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(await row(matchId)).toMatchObject({ board: START, ply: 0 })
    expect(black).not.toBe(white)
  })

  it('cannot be made once the game is over', async () => {
    const { matchId, white, black } = await newGame()
    await move(white, matchId, [32, 28])
    await move(black, matchId, [19, 23])
    await action(white, matchId, 'resign')
    expect((await db.rows<{ r: Json }>(`select public.draughts_apply_move($1, $2, 2, '28x19', '[28,19]', '[23]', $3, null, null) as r`, [matchId, users[white], START]))[0]!.r).toEqual({ ok: false, code: 'GAME_OVER' })
  })
})

describe('clocks', () => {
  it('do not run until both players have moved; then the mover pays for their time and gets the increment', async () => {
    const { matchId, white, black } = await newGame()
    await wait(matchId, 10)
    await move(white, matchId, [32, 28])
    await wait(matchId, 10)
    await move(black, matchId, [19, 23])
    expect(await row(matchId)).toMatchObject({ white_time_ms: 180_000, black_time_ms: 180_000 })
    await wait(matchId, 20)
    await move(white, matchId, [28, 19])
    const after = await row(matchId)
    expect(after.white_time_ms).toBeGreaterThan(161_000)
    expect(after.white_time_ms).toBeLessThanOrEqual(162_000)
    expect(after.black_time_ms).toBe(180_000)
  })

  it('a player whose time runs out loses, whoever points it out', async () => {
    const { matchId, white, black } = await newGame()
    await move(white, matchId, [32, 28])
    await move(black, matchId, [19, 23])
    expect(await action(black, matchId, 'claim')).toEqual({ ok: true, clock: 'none' })
    await wait(matchId, 181)
    expect(await move(white, matchId, [28, 19])).toEqual({ ok: false, code: 'TIME_OUT' })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'timeout', winner_id: users[black] })
    expect((await row(matchId)).white_time_ms).toBe(0)
  })

  it('the background sweep ends a game both players have left', async () => {
    const { matchId, white, black } = await newGame()
    await move(white, matchId, [32, 28])
    await move(black, matchId, [19, 23])
    await wait(matchId, 200)
    await db.pg.exec(`select private.sweep()`)
    expect(await match(matchId)).toMatchObject({ status: 'finished', end_reason: 'timeout', winner_id: users[black] })
  })

  it('a game nobody starts is called off', async () => {
    const { matchId, white } = await newGame()
    await wait(matchId, 31)
    expect(await action(white, matchId, 'claim')).toEqual({ ok: true, clock: 'aborted' })
    expect(await match(matchId)).toMatchObject({ status: 'aborted', result: 'aborted', end_reason: 'no_first_move' })
  })
})

describe('ending by agreement', () => {
  it('leaving before both have moved calls the game off; after that it is a loss', async () => {
    const early = await newGame()
    await action(early.white, early.matchId, 'resign')
    expect(await match(early.matchId)).toMatchObject({ status: 'aborted', end_reason: 'aborted_by_player' })

    const { matchId, white, black } = await newGame()
    await move(white, matchId, [32, 28])
    await move(black, matchId, [19, 23])
    await action(black, matchId, 'resign')
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'resignation', winner_id: users[white] })
  })

  it('a draw must be offered by one player and accepted by the other; a move turns it down', async () => {
    const { matchId, white, black } = await newGame()
    expect(await action(white, matchId, 'offer_draw')).toEqual({ ok: false, code: 'TOO_EARLY' })
    await move(white, matchId, [32, 28])
    await move(black, matchId, [19, 23])
    expect(await action(white, matchId, 'offer_draw')).toEqual({ ok: true })
    expect(await action(white, matchId, 'accept_draw')).toEqual({ ok: false, code: 'NO_OFFER' })
    expect(await action(black, matchId, 'decline_draw')).toEqual({ ok: true })
    expect((await row(matchId)).draw_offer_by).toBeNull()

    await action(black, matchId, 'offer_draw')
    await move(white, matchId, [28, 19])
    expect((await row(matchId)).draw_offer_by).toBeNull()

    await action(white, matchId, 'offer_draw')
    expect(await action(black, matchId, 'accept_draw')).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'draw', end_reason: 'agreement', winner_id: null })
  })
})

describe('money and standing', () => {
  it('the winner of a staked game is paid the pot less the commission, once, and both ratings move', async () => {
    const { matchId, white, black } = await newGame(100)
    expect((await wallet(white)).bonus).toBe(900)
    await move(white, matchId, [32, 28])
    await move(black, matchId, [19, 23])
    // The move that ends the game, as the rules would report it.
    const [reply] = await db.rows<{ r: Json }>(`select public.draughts_apply_move($1, $2, 2, '28x19', '[28,19]', '[23]', $3, 'no_pieces', 'w') as r`, [matchId, users[white], START])
    expect(reply!.r).toMatchObject({ ok: true, finished: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'no_pieces', winner_id: users[white] })
    const won = await wallet(white)
    expect(won.bonus + won.cash).toBe(1080)
    expect((await wallet(black)).bonus).toBe(900)
    await db.pg.exec(`select private.sweep()`)
    const again = await wallet(white)
    expect(again.bonus + again.cash).toBe(1080)
    const ratings = await db.rows<{ user_id: string; rating: number; wins: number }>(`select user_id, rating, wins from public.player_ratings where game_type = 'draughts' and pool = 'default' and user_id in ($1, $2)`, [users[white], users[black]])
    expect(ratings.find((r) => r.user_id === users[white])).toMatchObject({ wins: 1 })
    expect(ratings.find((r) => r.user_id === users[white])!.rating).toBeGreaterThan(1200)
    expect(ratings.find((r) => r.user_id === users[black])!.rating).toBeLessThan(1200)
  })

  it('a drawn staked game gives both stakes back', async () => {
    const { matchId, white, black } = await newGame(100)
    await move(white, matchId, [32, 28])
    await move(black, matchId, [19, 23])
    await action(white, matchId, 'offer_draw')
    await action(black, matchId, 'accept_draw')
    for (const player of [white, black]) {
      const w = await wallet(player)
      expect(w.bonus + w.cash).toBe(1000)
    }
  })
})

describe('access', () => {
  it('players can read their game and write nothing; the functions are for the server only', async () => {
    const { matchId, white } = await newGame()
    const stranger = (users.dz = await db.createUser('dz@example.com', { username: 'dz', country_code: 'RW', age_confirmed: true }))
    expect(await db.as('authenticated', users[white]!, () => db.rows(`select ply from public.draughts_games where match_id = $1`, [matchId]))).toEqual([{ ply: 0 }])
    expect(await db.as('authenticated', stranger, () => db.rows(`select ply from public.draughts_games where match_id = $1`, [matchId]))).toEqual([])
    await expect(db.as('authenticated', users[white]!, () => db.rows(`update public.draughts_games set white_time_ms = 999999999 where match_id = $1 returning 1`, [matchId]))).rejects.toThrow(/permission denied/)
    await expect(
      db.as('authenticated', users[white]!, () => db.rows(`insert into public.draughts_moves (match_id, ply, notation, path, board_after, time_left_ms) values ($1, 1, '32-28', '[32,28]', $2, 1)`, [matchId, START])),
    ).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', users[white]!, () => db.rows(`select public.draughts_game_action($1, $2, 'resign')`, [matchId, users[white]]))).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', users[white]!, () => db.rows(`select public.draughts_apply_move($1, $2, 0, 'x', '[]', '[]', $3, 'no_pieces', 'w')`, [matchId, users[white], START]))).rejects.toThrow(/permission denied/)
  })
})
