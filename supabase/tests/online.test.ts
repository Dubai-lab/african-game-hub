import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// The database half of online play: matchmaking, turn order, server clocks, timeouts, aborts,
// draws and resignation. Chess legality itself is checked by chess.js in the Edge Function;
// here moves are recorded as the Edge Function would record them.

let db: TestDb
const users: Record<string, string> = {}
const BLITZ = { time_control: '3+2' }

const FEN_AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const FEN_AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const FEN_AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

type Json = Record<string, unknown>

async function join(user: string, options: Json = BLITZ, stake = 0, pool = 'blitz'): Promise<Json> {
  const [row] = await db.rows<{ r: Json }>(`select public.join_match_queue($1, 'chess', $2, $3::jsonb, $4) as r`, [
    users[user],
    stake,
    JSON.stringify(options),
    pool,
  ])
  return row!.r
}

async function move(matchId: string, user: string, ply: number, san: string, fen: string, end: string | null = null, winner: string | null = null) {
  const [row] = await db.rows<{ r: Json }>(
    `select public.chess_apply_move($1, $2, $3, $4, 'a1a1', $5, $6, $7) as r`,
    [matchId, users[user], ply, san, fen, end, winner],
  )
  return row!.r
}

async function action(matchId: string, user: string, name: string) {
  const [row] = await db.rows<{ r: Json }>(`select public.chess_game_action($1, $2, $3) as r`, [matchId, users[user], name])
  return row!.r
}

async function match(matchId: string) {
  const [row] = await db.rows<Json>(
    `select m.status, m.result, m.end_reason,
            (select mp.seat from public.match_players mp where mp.match_id = m.id and mp.user_id = m.winner_id) as winner
       from public.matches m where m.id = $1`,
    [matchId],
  )
  return row!
}

/** Pairs two fresh players and returns the match with who got which colour. */
async function newGame(a: string, b: string, options: Json = BLITZ) {
  expect(await join(a, options)).toEqual({ status: 'queued' })
  const result = await join(b, options)
  expect(result.status).toBe('matched')
  const matchId = result.match_id as string
  const seats = await db.rows<{ user_id: string; seat: string }>(
    `select user_id, seat from public.match_players where match_id = $1`,
    [matchId],
  )
  const name = (id: string) => Object.keys(users).find((k) => users[k] === id)!
  const white = name(seats.find((s) => s.seat === 'white')!.user_id)
  const black = name(seats.find((s) => s.seat === 'black')!.user_id)
  return { matchId, white, black }
}

/** Plays 1.e4 e5 so that both clocks are live and White is to move at ply 2. */
async function opened(a: string, b: string) {
  const game = await newGame(a, b)
  expect((await move(game.matchId, game.white, 0, 'e4', FEN_AFTER_E4)).ok).toBe(true)
  expect((await move(game.matchId, game.black, 1, 'e5', FEN_AFTER_E5)).ok).toBe(true)
  return game
}

const rewind = (matchId: string, interval: string) =>
  db.pg.query(`update public.chess_games set last_move_at = now() - $2::interval where match_id = $1`, [matchId, interval])

async function finishAll() {
  await db.pg.exec(`select private.finish_match(id, 'aborted', null, 'test_cleanup') from public.matches where status = 'active'`)
  await db.pg.exec(`delete from public.match_queue`)
}

beforeAll(async () => {
  db = await createTestDb()
  for (const name of ['ada', 'bola', 'chidi', 'dede', 'outsider']) {
    users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'NG', age_confirmed: true })
  }
}, 120_000)

afterAll(async () => {
  await db.close()
})

afterEach(async () => {
  await finishAll()
  expect(await db.integrityProblems()).toEqual([])
})

describe('matchmaking', () => {
  it('pairs two players on the same game, stake, time control and rating pool', async () => {
    const { matchId, white, black } = await newGame('ada', 'bola')
    expect(new Set([white, black])).toEqual(new Set(['ada', 'bola']))
    expect(await match(matchId)).toMatchObject({ status: 'active', result: null })

    const [game] = await db.rows(
      `select fen, turn, ply, white_time_ms::int as w, black_time_ms::int as b, increment_ms::int as inc
         from public.chess_games where match_id = $1`,
      [matchId],
    )
    expect(game).toEqual({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      turn: 'w',
      ply: 0,
      w: 180_000,
      b: 180_000,
      inc: 2000,
    })
    expect(await db.rows(`select 1 from public.match_queue`)).toEqual([])
    const [m] = await db.rows(`select rating_pool, stake_amount::int as stake, options from public.matches where id = $1`, [matchId])
    expect(m).toEqual({ rating_pool: 'blitz', stake: 0, options: BLITZ })
  })

  it('does not pair players who chose different things', async () => {
    expect(await join('ada', { time_control: '3+2' }, 0, 'blitz')).toEqual({ status: 'queued' })
    expect(await join('bola', { time_control: '5+0' }, 0, 'blitz')).toEqual({ status: 'queued' })
    expect(await join('chidi', { time_control: '10+0' }, 0, 'rapid')).toEqual({ status: 'queued' })
    expect(await db.rows(`select 1 from public.matches where status = 'active'`)).toEqual([])
    // A fourth player wanting 5+0 is paired with the one waiting for 5+0, not whoever came first.
    const result = await join('dede', { time_control: '5+0' }, 0, 'blitz')
    expect(result.status).toBe('matched')
    const players = await db.rows<{ user_id: string }>(`select user_id from public.match_players where match_id = $1`, [result.match_id])
    expect(new Set(players.map((p) => p.user_id))).toEqual(new Set([users.bola, users.dede]))
  })

  it('never puts one player in two games, and sends a returning player back to their game', async () => {
    const { matchId } = await newGame('ada', 'bola')
    expect(await join('ada')).toEqual({ status: 'matched', match_id: matchId })
    expect(await join('ada', { time_control: '5+0' })).toEqual({ status: 'matched', match_id: matchId })
    // Chidi is waiting; Ada, who is busy, must not be offered to him.
    expect(await join('chidi')).toEqual({ status: 'queued' })
    expect(await db.rows(`select count(*)::int as n from public.matches where status = 'active'`)).toEqual([{ n: 1 }])
  })

  it('does not pair with someone who stopped checking in, and a player cannot face themselves', async () => {
    expect(await join('ada')).toEqual({ status: 'queued' })
    expect(await join('ada')).toEqual({ status: 'queued' })
    await db.pg.query(`update public.match_queue set heartbeat_at = now() - interval '50 seconds' where user_id = $1`, [users.ada])
    expect(await join('bola')).toEqual({ status: 'queued' })
    // Ada comes back (her next check-in) and now the two are paired.
    expect((await join('ada')).status).toBe('matched')
  })

  it('refuses banned players and choices the game does not offer', async () => {
    expect(await join('ada', BLITZ, 77)).toEqual({ status: 'error', code: 'STAKE_NOT_ALLOWED' })
    expect(await join('ada', BLITZ, 0, 'hyperbullet')).toEqual({ status: 'error', code: 'BAD_RATING_POOL' })
    await db.pg.query(`update public.profile_private set is_banned = true where user_id = $1`, [users.outsider])
    expect(await join('outsider')).toEqual({ status: 'error', code: 'BANNED' })
    await db.pg.query(`update public.profile_private set is_banned = false where user_id = $1`, [users.outsider])
    expect(await db.rows(`select 1 from public.match_queue`)).toEqual([])
  })

  it('leaving the queue removes the entry', async () => {
    await join('ada')
    await db.pg.query(`select public.leave_match_queue($1)`, [users.ada])
    expect(await db.rows(`select 1 from public.match_queue`)).toEqual([])
    expect(await join('bola')).toEqual({ status: 'queued' })
  })
})

describe('moves', () => {
  it('enforce turn order, the expected position and who is playing', async () => {
    const { matchId, white, black } = await newGame('ada', 'bola')
    expect(await move(matchId, black, 0, 'e5', FEN_AFTER_E5)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await move(matchId, 'outsider', 0, 'e4', FEN_AFTER_E4)).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    // A request built on an older view of the game (a retry, a second tab) is refused.
    expect(await move(matchId, white, 1, 'e4', FEN_AFTER_E4)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })

    expect(await move(matchId, white, 0, 'e4', FEN_AFTER_E4)).toMatchObject({ ok: true, ply: 1, finished: false })
    // The very same request sent again cannot play a second move.
    expect(await move(matchId, white, 0, 'e4', FEN_AFTER_E4)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await move(matchId, black, 1, 'e5', FEN_AFTER_E5)).toMatchObject({ ok: true, ply: 2 })

    const moves = await db.rows(`select ply, san from public.chess_moves where match_id = $1 order by ply`, [matchId])
    expect(moves).toEqual([
      { ply: 1, san: 'e4' },
      { ply: 2, san: 'e5' },
    ])
    const [ctx] = await db.rows<{ c: Json }>(`select public.chess_move_context($1, $2) as c`, [matchId, users[white]])
    expect(ctx!.c).toEqual({ status: 'active', color: 'w', fen: FEN_AFTER_E5, ply: 2, turn: 'w', sans: ['e4', 'e5'] })
    const [none] = await db.rows<{ c: Json | null }>(`select public.chess_move_context($1, $2) as c`, [matchId, users.outsider])
    expect(none!.c).toBeNull()
  })

  it('run the clocks on server time: first moves are free, then time is charged and the increment added', async () => {
    const { matchId, white, black } = await newGame('ada', 'bola')
    await rewind(matchId, '12 seconds')
    const first = await move(matchId, white, 0, 'e4', FEN_AFTER_E4)
    expect(first).toMatchObject({ ok: true, white_time_ms: 180_000, black_time_ms: 180_000 })
    await rewind(matchId, '9 seconds')
    expect(await move(matchId, black, 1, 'e5', FEN_AFTER_E5)).toMatchObject({ ok: true, white_time_ms: 180_000, black_time_ms: 180_000 })

    // From here White's clock is running. Ten seconds pass on the server.
    await rewind(matchId, '10 seconds')
    const third = await move(matchId, white, 2, 'Nf3', FEN_AFTER_NF3)
    expect(third.ok).toBe(true)
    // 180s - 10s + 2s increment, give or take the time the test itself took.
    expect(third.white_time_ms as number).toBeGreaterThan(171_500)
    expect(third.white_time_ms as number).toBeLessThanOrEqual(172_000)
    expect(third.black_time_ms).toBe(180_000)
    const [stored] = await db.rows<{ t: number }>(
      `select time_left_ms::int as t from public.chess_moves where match_id = $1 and ply = 3`,
      [matchId],
    )
    expect(stored!.t).toBe(third.white_time_ms)
  })

  it('refuse a move made after the player’s time ran out, and award the game', async () => {
    const { matchId, white, black } = await opened('ada', 'bola')
    await rewind(matchId, '4 minutes')
    expect(await move(matchId, white, 2, 'Nf3', FEN_AFTER_NF3)).toEqual({ ok: false, code: 'TIME_OUT' })
    expect(await match(matchId)).toEqual({ status: 'finished', result: 'win', end_reason: 'timeout', winner: 'black' })
    expect(await db.rows(`select 1 from public.chess_moves where match_id = $1 and ply = 3`, [matchId])).toEqual([])
    const [clock] = await db.rows(`select white_time_ms::int as w from public.chess_games where match_id = $1`, [matchId])
    expect(clock).toEqual({ w: 0 })
    // Nothing more can be played.
    expect(await move(matchId, black, 2, 'Nc6', FEN_AFTER_NF3)).toEqual({ ok: false, code: 'GAME_OVER' })
  })

  it('end the game when the validated move is checkmate or a draw', async () => {
    const mate = await opened('ada', 'bola')
    expect(await move(mate.matchId, mate.white, 2, 'Qh5#', FEN_AFTER_NF3, 'checkmate', 'w')).toMatchObject({ ok: true, finished: true })
    expect(await match(mate.matchId)).toEqual({ status: 'finished', result: 'win', end_reason: 'checkmate', winner: 'white' })
    const [record] = await db.rows(`select pgn from public.chess_games where match_id = $1`, [mate.matchId])
    expect(record).toEqual({ pgn: '1. e4 e5 2. Qh5#' })

    const stale = await opened('chidi', 'dede')
    expect(await move(stale.matchId, stale.white, 2, 'Kh1', FEN_AFTER_NF3, 'stalemate', null)).toMatchObject({ ok: true, finished: true })
    expect(await match(stale.matchId)).toEqual({ status: 'finished', result: 'draw', end_reason: 'stalemate', winner: null })
  })
})

describe('clock claims and the background sweep', () => {
  it('abort a game whose first move never came, with no winner', async () => {
    const { matchId, white } = await newGame('ada', 'bola')
    expect(await action(matchId, white, 'claim')).toEqual({ ok: true, clock: 'none' })
    await rewind(matchId, '31 seconds')
    expect(await move(matchId, white, 0, 'e4', FEN_AFTER_E4)).toEqual({ ok: false, code: 'ABORTED' })
    expect(await match(matchId)).toEqual({ status: 'aborted', result: 'aborted', end_reason: 'no_first_move', winner: null })
  })

  it('abort when Black never answers the first move', async () => {
    const { matchId, white, black } = await newGame('ada', 'bola')
    await move(matchId, white, 0, 'e4', FEN_AFTER_E4)
    await rewind(matchId, '31 seconds')
    expect(await action(matchId, black, 'claim')).toEqual({ ok: true, clock: 'aborted' })
    expect((await match(matchId)).status).toBe('aborted')
  })

  it('a claim only succeeds when the server’s own clock agrees', async () => {
    const { matchId, white, black } = await opened('ada', 'bola')
    // Black claims White has run out of time. White has not.
    expect(await action(matchId, black, 'claim')).toEqual({ ok: true, clock: 'none' })
    expect((await match(matchId)).status).toBe('active')
    await rewind(matchId, '3 minutes 1 second')
    expect(await action(matchId, black, 'claim')).toEqual({ ok: true, clock: 'timeout' })
    expect(await match(matchId)).toMatchObject({ result: 'win', end_reason: 'timeout', winner: 'black' })
    expect(await action(matchId, white, 'claim')).toEqual({ ok: true, clock: 'none' })
  })

  it('a timeout is a draw when the player with time left could never mate', async () => {
    const { matchId } = await opened('ada', 'bola')
    // White (to move) still has a rook; Black has a bare king. White then runs out of time.
    await db.pg.query(`update public.chess_games set fen = '8/8/4k3/8/8/3K4/8/R7 w - - 0 40' where match_id = $1`, [matchId])
    await rewind(matchId, '10 minutes')
    await db.pg.exec(`select private.sweep()`)
    expect(await match(matchId)).toEqual({ status: 'finished', result: 'draw', end_reason: 'timeout', winner: null })
  })

  it('the sweep ends abandoned games and clears dead queue entries, and leaves live ones alone', async () => {
    const abandoned = await opened('ada', 'bola')
    const live = await opened('chidi', 'dede')
    await rewind(abandoned.matchId, '1 hour')
    await join('outsider')
    await db.pg.query(`update public.match_queue set heartbeat_at = now() - interval '3 minutes'`)

    await db.pg.exec(`select private.sweep()`)
    expect(await match(abandoned.matchId)).toMatchObject({ status: 'finished', end_reason: 'timeout', winner: 'black' })
    expect((await match(live.matchId)).status).toBe('active')
    expect(await db.rows(`select 1 from public.match_queue`)).toEqual([])
  })
})

describe('resigning and draws', () => {
  it('resignation gives the opponent the win; before both have moved it just calls the game off', async () => {
    const game = await opened('ada', 'bola')
    expect(await action(game.matchId, game.black, 'resign')).toEqual({ ok: true })
    expect(await match(game.matchId)).toEqual({ status: 'finished', result: 'win', end_reason: 'resignation', winner: 'white' })
    expect(await action(game.matchId, game.white, 'resign')).toEqual({ ok: false, code: 'GAME_OVER' })

    const early = await newGame('chidi', 'dede')
    expect(await action(early.matchId, early.white, 'resign')).toEqual({ ok: true })
    expect(await match(early.matchId)).toMatchObject({ status: 'aborted', result: 'aborted', winner: null })
  })

  it('a draw needs an offer from one player and acceptance by the other', async () => {
    const { matchId, white, black } = await opened('ada', 'bola')
    // Nobody can accept a draw that was not offered, or accept their own offer.
    expect(await action(matchId, black, 'accept_draw')).toEqual({ ok: false, code: 'NO_OFFER' })
    expect(await action(matchId, white, 'offer_draw')).toEqual({ ok: true })
    expect(await action(matchId, white, 'accept_draw')).toEqual({ ok: false, code: 'NO_OFFER' })
    expect(await action(matchId, black, 'offer_draw')).toEqual({ ok: false, code: 'OFFER_PENDING' })
    expect(await action(matchId, 'outsider', 'accept_draw')).toEqual({ ok: false, code: 'NOT_A_PLAYER' })

    expect(await action(matchId, black, 'decline_draw')).toEqual({ ok: true })
    expect((await match(matchId)).status).toBe('active')

    // Offering and then moving withdraws the offer.
    expect(await action(matchId, white, 'offer_draw')).toEqual({ ok: true })
    await move(matchId, white, 2, 'Nf3', FEN_AFTER_NF3)
    expect(await action(matchId, black, 'accept_draw')).toEqual({ ok: false, code: 'NO_OFFER' })

    expect(await action(matchId, black, 'offer_draw')).toEqual({ ok: true })
    expect(await action(matchId, white, 'accept_draw')).toEqual({ ok: true })
    expect(await match(matchId)).toEqual({ status: 'finished', result: 'draw', end_reason: 'agreement', winner: null })
  })

  it('a result is recorded once and only once', async () => {
    const { matchId, white } = await opened('ada', 'bola')
    await action(matchId, white, 'resign')
    const [again] = await db.rows<{ r: boolean }>(`select private.finish_match($1, 'draw', null, 'agreement') as r`, [matchId])
    expect(again!.r).toBe(false)
    expect(await match(matchId)).toMatchObject({ result: 'win', end_reason: 'resignation' })
  })
})

describe('access', () => {
  it('clients cannot call any of these functions directly; they must go through the Edge Functions', async () => {
    const { matchId } = await newGame('ada', 'bola')
    const attempts = [
      `select public.join_match_queue('${users.ada}', 'chess', 0, '{"time_control":"3+2"}', 'blitz')`,
      `select public.leave_match_queue('${users.bola}')`,
      `select public.chess_apply_move('${matchId}', '${users.ada}', 0, 'e4', 'e2e4', '${FEN_AFTER_E4}', 'checkmate', 'w')`,
      `select public.chess_game_action('${matchId}', '${users.bola}', 'resign')`,
      `select public.chess_move_context('${matchId}', '${users.bola}')`,
      `select private.finish_match('${matchId}', 'win', '${users.ada}', 'checkmate')`,
      `select private.sweep()`,
      `update public.chess_games set fen = 'x'`,
      `update public.matches set status = 'finished'`,
      `delete from public.match_queue`,
    ]
    for (const role of ['authenticated', 'anon'] as const) {
      await db.as(role, role === 'authenticated' ? users.ada! : null, async () => {
        for (const sql of attempts) {
          await expect(db.pg.query(sql), `${role}: ${sql}`).rejects.toThrow(/permission denied|row-level security/)
        }
      })
    }
    await db.as('authenticated', users.ada!, async () => {
      const [row] = await db.rows<{ t: string }>(`select public.server_now() as t`)
      expect(row!.t).toBeTruthy()
    })
    expect((await match(matchId)).status).toBe('active')
  })
})
