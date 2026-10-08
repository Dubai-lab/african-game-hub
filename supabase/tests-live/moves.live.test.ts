// Move validation against the deployed Edge Functions: illegal moves, moving out of turn,
// simultaneous and repeated requests, and moving after time has run out. Staked games are used
// where a wrong result would also move tokens. The ledger integrity check runs after every test.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  act,
  burst,
  call,
  integrityProblems,
  matchState,
  move,
  type Player,
  resetTestAccounts,
  runSql,
  signInPlayers,
  startGame,
  wallet,
} from './live.ts'

let ada: Player, bola: Player, outsider: Player

beforeAll(async () => {
  const players = await signInPlayers()
  ;[ada, bola, outsider] = players as [Player, Player, Player]
})

beforeEach(resetTestAccounts)

afterEach(async () => {
  expect(await integrityProblems()).toEqual([])
})

afterAll(resetTestAccounts)

/** Plays a list of moves in order, alternating sides, and insists each is accepted. */
async function play(game: { matchId: string; white: Player; black: Player }, moves: string[], fromPly = 0) {
  for (const [index, uci] of moves.entries()) {
    const ply = fromPly + index
    const reply = await move(ply % 2 === 0 ? game.white : game.black, game.matchId, uci, ply)
    expect(reply, `${uci} at ply ${ply}`).toMatchObject({ ok: true })
  }
}

const sans = async (matchId: string) => (await matchState(matchId)).sans

describe('illegal moves', () => {
  it('are refused, each for the right reason, and leave the game untouched', async () => {
    const game = await startGame(ada, bola, 0)
    const { matchId, white, black } = game

    const refused: [string, Player, string, number][] = [
      ['a pawn jumping three squares', white, 'e2e5', 0],
      ['a rook through its own pawn', white, 'a1a4', 0],
      ['a bishop through its own pawn', white, 'c1e3', 0],
      ['a knight moving like a bishop', white, 'b1d3', 0],
      ['capturing its own piece', white, 'd1d2', 0],
      ['the king walking two squares', white, 'e1e3', 0],
      ['castling through pieces', white, 'e1g1', 0],
      ['moving an empty square', white, 'e4e5', 0],
      ['moving the opponent’s piece', white, 'e7e5', 0],
      ['a promotion that is not one', white, 'e2e4q', 0],
    ]
    for (const [what, who, uci, ply] of refused) {
      expect(await move(who, matchId, uci, ply), what).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    }
    // Nothing was recorded and no clock was touched.
    expect(await matchState(matchId)).toMatchObject({ status: 'active', ply: 0, moves: 0 })

    // 1.e4 d5 2.Bb5+ : Black is in check and must deal with it.
    await play(game, ['e2e4', 'd7d5', 'f1b5'])
    expect(await move(black, matchId, 'a7a6', 3), 'ignoring a check').toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await move(black, matchId, 'e8d7', 3), 'the king stepping into the check').toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await move(black, matchId, 'c7c6', 3), 'blocking the check').toMatchObject({ ok: true, san: 'c6' })

    // 3.Bxc6+ : the b7 pawn may retake; the pinned knight on b8 may also retake, d7 may not move the bishop away... keep it simple.
    expect(await move(white, matchId, 'b5c6', 4)).toMatchObject({ ok: true, san: 'Bxc6+' })
    expect(await move(black, matchId, 'd8d7', 5), 'blocking with the queen is legal').toMatchObject({ ok: true })
    // The queen on d7 is now pinned to the king by the bishop: it cannot leave the diagonal.
    expect(await move(white, matchId, 'g1f3', 6)).toMatchObject({ ok: true })
    expect(await move(black, matchId, 'd7d6', 7), 'a pinned queen leaving the pin').toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await sans(matchId)).toEqual(['e4', 'd5', 'Bb5+', 'c6', 'Bxc6+', 'Qd7', 'Nf3'])
  })

  it('malformed requests never reach the game', async () => {
    const { matchId, white } = await startGame(ada, bola, 0)
    const bad: Record<string, unknown>[] = [
      { match_id: matchId, uci: 'e2e4; drop table matches', ply: 0 },
      { match_id: matchId, uci: 'e7e8k', ply: 0 },
      { match_id: matchId, uci: 'z9z9', ply: 0 },
      { match_id: matchId, uci: 'e2e4', ply: -1 },
      { match_id: matchId, uci: 'e2e4', ply: '0' },
      { match_id: matchId, uci: 'e2e4' },
      { match_id: 'not-a-match', uci: 'e2e4', ply: 0 },
      { uci: 'e2e4', ply: 0 },
      {},
    ]
    for (const body of bad) {
      const reply = await call(white, 'chess-make-move', body)
      expect(reply.ok, JSON.stringify(body)).toBe(false)
    }
    expect(await matchState(matchId)).toMatchObject({ status: 'active', ply: 0, moves: 0 })
  })
})

describe('turn order', () => {
  it('nobody moves out of turn, twice in a row, or in a game they are not in', async () => {
    const game = await startGame(ada, bola, 100)
    const { matchId, white, black } = game
    expect(await move(black, matchId, 'e7e5', 0)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await move(outsider, matchId, 'e2e4', 0)).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(await act(outsider, matchId, 'resign')).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(await act(outsider, matchId, 'claim')).toEqual({ ok: false, code: 'NOT_A_PLAYER' })

    await play(game, ['e2e4'])
    expect(await move(white, matchId, 'd2d4', 1)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    // White pretending the position is still the starting one (a replayed request).
    expect(await move(white, matchId, 'd2d4', 0)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    // Black with a stale or invented view of the game.
    expect(await move(black, matchId, 'e7e5', 0)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect(await move(black, matchId, 'e7e5', 5)).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect(await move(black, matchId, 'e7e5', 1)).toMatchObject({ ok: true })

    expect(await sans(matchId)).toEqual(['e4', 'e5'])
    // The outsider's attempts cost nobody anything.
    expect(await wallet(outsider)).toEqual({ bonus: 1000, cash: 0 })
    expect((await matchState(matchId)).held).toBe(200)
  })

  it('the same move sent 10 times at once is played once', async () => {
    const { matchId, white } = await startGame(ada, bola, 0)
    const replies = await burst(10, () => move(white, matchId, 'e2e4', 0))
    expect(replies.filter((r) => r.ok === true)).toHaveLength(1)
    expect(replies.filter((r) => !r.ok).every((r) => ['NOT_YOUR_TURN', 'OUT_OF_SYNC'].includes(r.code!))).toBe(true)
    expect(await matchState(matchId)).toMatchObject({ ply: 1, moves: 1 })
    expect(await sans(matchId)).toEqual(['e4'])
  })

  it('two different moves by the same player at the same instant: only one happens', async () => {
    const { matchId, white } = await startGame(ada, bola, 0)
    const replies = await Promise.all([
      ...Array.from({ length: 4 }, () => move(white, matchId, 'e2e4', 0)),
      ...Array.from({ length: 4 }, () => move(white, matchId, 'd2d4', 0)),
      ...Array.from({ length: 4 }, () => move(white, matchId, 'g1f3', 0)),
    ])
    expect(replies.filter((r) => r.ok === true)).toHaveLength(1)
    const played = await sans(matchId)
    expect(played).toHaveLength(1)
    expect(['e4', 'd4', 'Nf3']).toContain(played[0])
    expect((await matchState(matchId)).ply).toBe(1)
  })

  it('both players moving at the same instant: the game stays in strict alternation', async () => {
    const game = await startGame(ada, bola, 0)
    const { matchId, white, black } = game
    // Each side fires its next three moves at once, with the ply it expects for each.
    await Promise.all([
      move(white, matchId, 'e2e4', 0), move(black, matchId, 'e7e5', 1),
      move(white, matchId, 'g1f3', 2), move(black, matchId, 'b8c6', 3),
      move(white, matchId, 'f1c4', 4), move(black, matchId, 'g8f6', 5),
    ])
    const played = await sans(matchId)
    // However the requests interleaved, what was recorded is a legal prefix of that line.
    expect(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'].slice(0, played.length)).toEqual(played)
    expect(played.length).toBeGreaterThanOrEqual(1)
    const state = await matchState(matchId)
    expect(state.ply).toBe(played.length)
    expect(state.moves).toBe(played.length)
  })
})

describe('the clock', () => {
  it('a move sent after the player’s time ran out is refused, and the opponent is paid', async () => {
    const game = await startGame(ada, bola, 250)
    const { matchId, white, black } = game
    await play(game, ['e2e4', 'e7e5'])
    // White's 3 minutes pass on the server.
    await runSql(`update public.chess_games set last_move_at = now() - interval '3 minutes 5 seconds' where match_id = '${matchId}'`)

    // A whole burst of "I moved in time" requests.
    const replies = await burst(8, () => move(white, matchId, 'g1f3', 2))
    expect(replies.every((r) => r.ok === false)).toBe(true)
    expect(replies.some((r) => r.code === 'TIME_OUT')).toBe(true)
    expect(replies.every((r) => ['TIME_OUT', 'GAME_OVER'].includes(r.code!))).toBe(true)

    const state = await matchState(matchId)
    expect(state).toMatchObject({ status: 'finished', result: 'win', end_reason: 'timeout', winner_id: black.id, settled: true })
    expect([state.moves, state.payouts, state.revenue_rows, state.rake]).toEqual([2, 1, 1, 50])
    // Pot 500, rake 50: the player who still had time ends on 1,200; the one who ran out, 750.
    expect(await wallet(black)).toEqual({ bonus: 1200, cash: 0 })
    expect(await wallet(white)).toEqual({ bonus: 750, cash: 0 })

    // And nothing can be played afterwards, by either side.
    expect(await move(white, matchId, 'g1f3', 2)).toEqual({ ok: false, code: 'GAME_OVER' })
    expect(await move(black, matchId, 'b8c6', 2)).toEqual({ ok: false, code: 'GAME_OVER' })
    expect(await act(white, matchId, 'offer_draw')).toEqual({ ok: false, code: 'GAME_OVER' })
  })

  it('a player cannot win on time by claiming early, and time spent is really charged', async () => {
    const game = await startGame(ada, bola, 100)
    const { matchId, white, black } = game
    await play(game, ['e2e4', 'e7e5'])
    const claims = await burst(6, () => act(black, matchId, 'claim'))
    expect(claims.every((r) => r.clock === 'none')).toBe(true)
    expect((await matchState(matchId)).status).toBe('active')

    // Ninety seconds pass for White, who then moves: the server charges them, plus the increment.
    await runSql(`update public.chess_games set last_move_at = now() - interval '90 seconds' where match_id = '${matchId}'`)
    expect(await move(white, matchId, 'g1f3', 2)).toMatchObject({ ok: true })
    const clock = await matchState(matchId)
    expect(clock.blackMs).toBe(180_000)
    expect(clock.whiteMs).toBeGreaterThan(90_000)
    expect(clock.whiteMs).toBeLessThanOrEqual(92_000)
  })

  it('the first-move window is enforced by the server: too late means no game and no loss', async () => {
    const { matchId, white } = await startGame(ada, bola, 500)
    await runSql(`update public.chess_games set last_move_at = now() - interval '35 seconds' where match_id = '${matchId}'`)
    const replies = await burst(6, () => move(white, matchId, 'e2e4', 0))
    expect(replies.every((r) => r.ok === false)).toBe(true)
    expect(replies.some((r) => r.code === 'ABORTED')).toBe(true)

    const state = await matchState(matchId)
    expect([state.status, state.moves, state.refunds, state.payouts, state.revenue_rows]).toEqual(['aborted', 0, 2, 0, 0])
    expect(await wallet(ada)).toEqual({ bonus: 1000, cash: 0 })
    expect(await wallet(bola)).toEqual({ bonus: 1000, cash: 0 })
  })
})

describe('a full staked game', () => {
  it('played to checkmate through the functions pays the right player the right amount', async () => {
    const game = await startGame(ada, bola, 1000)
    const { matchId, white, black } = game
    expect(await wallet(white)).toEqual({ bonus: 0, cash: 0 })
    // Scholar's mate: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
    await play(game, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6'])
    const mate = await move(white, matchId, 'h5f7', 6)
    expect(mate).toMatchObject({ ok: true, san: 'Qxf7#', finished: true })

    const state = await matchState(matchId)
    expect(state).toMatchObject({ status: 'finished', result: 'win', end_reason: 'checkmate', winner_id: white.id, settled: true })
    // Pot 2,000, rake 200, payout 1,800.
    expect(await wallet(white)).toEqual({ bonus: 1800, cash: 0 })
    expect(await wallet(black)).toEqual({ bonus: 0, cash: 0 })
    expect(state.rake).toBe(200)
    // The loser has nothing left to stake.
    expect((await call(black, 'core-join-queue', { game_type: 'chess', stake: 50, options: { time_control: '3+2' } })).code).toBe(
      'INSUFFICIENT_BALANCE',
    )
  })
})
