import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { applyShot, type PoolState, rack, type Shot } from '../functions/_shared/pool'
import { createTestDb, type TestDb } from './testDb'

// Pool's database side: who may have a shot recorded and when, the shot clock, and that a
// finished game is settled. Shots are played out with the real physics and rules, exactly as
// the pool-action Edge Function does, then handed to the database the way it hands them over.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

const row = async (matchId: string) =>
  (await db.rows<Json>(`select variant, balls, turn, break_shot, ball_in_hand, solids_seat, fouls, misses, shot_no, phase, last_shot from public.pool_games where match_id = $1`, [matchId]))[0]!
const match = async (matchId: string) =>
  (await db.rows<{ status: string; result: string | null; end_reason: string | null; winner_id: string | null }>(`select status, result, end_reason, winner_id from public.matches where id = $1`, [matchId]))[0]!
const wallet = async (user: string) =>
  (await db.rows<{ bonus: number }>(`select bonus_balance::int as bonus from public.wallets where user_id = $1`, [users[user]]))[0]!.bonus

async function newGame(variant = '8ball', stake = 0) {
  const a = `pa${++n}`
  const b = `pb${n}`
  for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'GH', age_confirmed: true })
  const options = JSON.stringify({ variant })
  const pool = variant === '8ball' ? 'eight_ball' : 'nine_ball'
  await db.pg.query(`select public.join_match_queue($1, 'pool', $2, $3, $4)`, [users[a], stake, options, pool])
  const [joined] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'pool', $2, $3, $4) as r`, [users[b], stake, options, pool])
  const matchId = joined!.r.match_id as string
  const seats = await db.rows<{ user_id: string; seat: string }>(`select user_id, seat from public.match_players where match_id = $1`, [matchId])
  const by = (seat: string) => (seats.find((s) => s.seat === seat)!.user_id === users[a] ? a : b)
  return { matchId, one: by('1'), two: by('2') }
}

/** Plays a shot the way the Edge Function does: physics and rules, then the database. */
async function shoot(user: string, matchId: string, shot: Shot, shotNo?: number): Promise<Json> {
  const g = await row(matchId)
  const state: PoolState = {
    variant: g.variant,
    balls: g.balls.length > 0 ? g.balls : rack(g.variant),
    turn: Number(g.turn) as 1 | 2,
    breakShot: g.break_shot,
    ballInHand: g.ball_in_hand,
    solidsSeat: g.solids_seat ? (Number(g.solids_seat) as 1 | 2) : null,
    fouls: [g.fouls['1'], g.fouls['2']],
  }
  const played = applyShot(state, shot)!
  const next = { ...played.state, turn: String(played.state.turn), solidsSeat: played.state.solidsSeat === null ? null : String(played.state.solidsSeat), from: state.balls }
  const result = { ...played.result, winner: played.result.winner === null ? null : String(played.result.winner) }
  const [reply] = await db.rows<{ r: Json }>(`select public.pool_apply_shot($1, $2, $3, $4, $5, $6) as r`, [
    matchId, users[user], shotNo ?? g.shot_no, JSON.stringify(next), JSON.stringify(shot), JSON.stringify(result),
  ])
  return reply!.r
}
const breakShot: Shot = { dx: 1_000_000, dy: 0, power: 1000, spinX: 0, spinY: 0 }
const set = (matchId: string, fields: Json) =>
  db.pg.query(
    `update public.pool_games set ${Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ')} where match_id = $1`,
    [matchId, ...Object.values(fields).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))],
  )
const late = (matchId: string) => set(matchId, { deadline: new Date(Date.now() - 1000).toISOString() })

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
  it('a game is made for the variant asked for: seat 1 to break, cue ball in hand, the table not yet racked', async () => {
    const { matchId } = await newGame('9ball')
    expect(await row(matchId)).toMatchObject({ variant: '9ball', balls: [], turn: '1', break_shot: true, ball_in_hand: true, solids_seat: null, shot_no: 0, phase: 'play' })
  })

  it('refuses a variant that is not on offer, and makes no match', async () => {
    users.px = await db.createUser('px@example.com', { username: 'px1', country_code: 'GH', age_confirmed: true })
    users.py = await db.createUser('py@example.com', { username: 'py1', country_code: 'GH', age_confirmed: true })
    await db.pg.query(`select public.join_match_queue($1, 'pool', 0, '{"variant":"snooker"}', 'eight_ball')`, [users.px])
    await expect(db.pg.query(`select public.join_match_queue($1, 'pool', 0, '{"variant":"snooker"}', 'eight_ball')`, [users.py])).rejects.toThrow(/POOL_UNKNOWN_VARIANT/)
    await db.pg.exec(`delete from public.match_queue`)
  })
})

describe('recording shots', () => {
  it('only the player whose turn it is, on the position now stored', async () => {
    const { matchId, one, two } = await newGame()
    expect(await shoot(two, matchId, breakShot)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await shoot(one, matchId, breakShot, 5)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    users.nosy = users.nosy ?? (await db.createUser('poolnosy@example.com', { username: 'poolnosy', country_code: 'GH', age_confirmed: true }))
    expect(await shoot('nosy', matchId, breakShot)).toEqual({ ok: false, code: 'NOT_A_PLAYER' })

    expect(await shoot(one, matchId, breakShot)).toEqual({ ok: true })
    const g = await row(matchId)
    expect(g.balls).toHaveLength(16)
    expect(g).toMatchObject({ shot_no: 1, break_shot: false })
    expect(g.last_shot).toMatchObject({ no: 0, seat: '1', shot: breakShot })
    expect(g.last_shot.from).toHaveLength(16)
    // The same request arriving again (a retry) is now out of date and changes nothing.
    expect(await shoot(g.turn === '1' ? one : two, matchId, breakShot, 0)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect((await db.rows(`select 1 from public.pool_shots where match_id = $1`, [matchId])).length).toBe(1)
  })

  it('a winning shot ends the match and pays the pot, once', async () => {
    const { matchId, one, two } = await newGame('9ball', 100)
    await set(matchId, { acted: { 1: true, 2: true }, break_shot: false, ball_in_hand: false, balls: [
      { n: 0, x: 2250, y: 980, in: false }, { n: 9, x: 2440, y: 1170, in: false },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((b) => ({ n: b, x: 0, y: 0, in: true })),
    ] })
    expect(await shoot(one, matchId, { dx: 1_000_000, dy: 1_000_000, power: 450, spinX: 0, spinY: 0 })).toEqual({ ok: true })
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'nine_ball', winner_id: users[one] })
    expect(await row(matchId)).toMatchObject({ phase: 'over' })
    expect(await wallet(one)).toBe(1080)
    expect(await wallet(two)).toBe(900)
    const ratings = await db.rows<{ pool: string; rating: number }>(`select pool, rating from public.player_ratings where game_type = 'pool' order by rating`)
    expect(ratings).toEqual([{ pool: 'nine_ball', rating: 1180 }, { pool: 'nine_ball', rating: 1220 }])
    // Nothing more can be recorded.
    const [again] = await db.rows<{ r: Json }>(`select public.pool_apply_shot($1, $2, 1, '{}', '{}', '{}') as r`, [matchId, users[two]])
    expect(again!.r).toEqual({ ok: false, code: 'GAME_OVER' })
  })
})

describe('the shot clock and leaving', () => {
  it('a game nobody breaks is called off and the stakes go back', async () => {
    const { matchId, one, two } = await newGame('8ball', 250)
    await late(matchId)
    await db.pg.exec(`select private.sweep()`)
    expect(await match(matchId)).toMatchObject({ status: 'aborted', end_reason: 'no_first_move' })
    expect(await wallet(one)).toBe(1000)
    expect(await wallet(two)).toBe(1000)
  })

  it('running out of time gives the opponent ball in hand; the third time in a row loses the game', async () => {
    const { matchId, one, two } = await newGame('8ball', 100)
    await set(matchId, { acted: { 1: true, 2: true }, turn: '1', ball_in_hand: false })
    await late(matchId)
    const [claimed] = await db.rows<{ r: Json }>(`select public.pool_game_action($1, $2, 'claim') as r`, [matchId, users[two]])
    expect(claimed!.r).toEqual({ ok: true })
    let g = await row(matchId)
    expect(g).toMatchObject({ turn: '2', ball_in_hand: true, shot_no: 1 })
    expect(g.misses).toEqual({ 1: 1 })
    expect(g.last_shot.result).toEqual({ foul: 'time' })

    // A claim made before the clock has run out does nothing.
    await db.rows(`select public.pool_game_action($1, $2, 'claim')`, [matchId, users[one]])
    expect((await row(matchId)).shot_no).toBe(1)

    await set(matchId, { turn: '1', misses: { 1: 2 } })
    await late(matchId)
    await db.pg.exec(`select private.sweep()`)
    expect(await match(matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'timeout', winner_id: users[two] })
    expect(await wallet(two)).toBe(1080)
    g = await row(matchId)
    expect(g.phase).toBe('over')
  })

  it('resigning before both have played calls the game off; afterwards it is a loss', async () => {
    const first = await newGame('8ball', 100)
    await db.rows(`select public.pool_game_action($1, $2, 'resign')`, [first.matchId, users[first.two]])
    expect(await match(first.matchId)).toMatchObject({ status: 'aborted', end_reason: 'aborted_by_player' })

    const second = await newGame('8ball', 100)
    await set(second.matchId, { acted: { 1: true, 2: true } })
    await db.rows(`select public.pool_game_action($1, $2, 'resign')`, [second.matchId, users[second.two]])
    expect(await match(second.matchId)).toMatchObject({ status: 'finished', result: 'win', end_reason: 'resignation', winner_id: users[second.one] })
    expect(await wallet(second.two)).toBe(900)
  })
})

describe('access', () => {
  it('players read their own game; nobody writes it or calls the server functions directly', async () => {
    const { matchId, one } = await newGame()
    const read = (user: string) => db.as('authenticated', users[user]!, () => db.rows(`select turn from public.pool_games where match_id = $1`, [matchId]))
    expect(await read(one)).toEqual([{ turn: '1' }])
    expect(await read('nosy')).toEqual([])
    await expect(db.as('authenticated', users[one]!, () => db.rows(`update public.pool_games set turn = '1', balls = '[]' where match_id = $1 returning 1`, [matchId]))).rejects.toThrow()
    await expect(
      db.as('authenticated', users[one]!, () => db.rows(`select public.pool_apply_shot($1, $2, 0, '{}', '{}', '{"winner":"1","reason":"eight_ball"}')`, [matchId, users[one]])),
    ).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', users[one]!, () => db.rows(`select public.pool_game_action($1, $2, 'resign')`, [matchId, users[one]]))).rejects.toThrow(/permission denied/)
  })
})
