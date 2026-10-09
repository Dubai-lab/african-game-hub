import { describe, expect, it } from 'vitest'
import { type Applied, type ChessContext, type ChessDb, ChessGames, type Member } from './chess.ts'

// The game server's handling of a chess game, with a stand-in for the database that behaves the
// way public.chess_apply_move does: it accepts a move only on the position it holds.

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function fakeDb() {
  const game = { status: 'active', fen: START, sans: [] as string[] }
  const seats: Record<string, 'w' | 'b'> = { white: 'w', black: 'b' }
  const state = { applied: 0, refuseWith: null as string | null, fail: false, delay: 0 }
  const db: ChessDb = {
    context: async (_match, userId): Promise<ChessContext | null> => {
      const color = seats[userId]
      if (!color) return null
      return { status: game.status, color, fen: game.fen, ply: game.sans.length, turn: game.sans.length % 2 === 0 ? 'w' : 'b', sans: [...game.sans] }
    },
    applyMove: async (move): Promise<Applied> => {
      if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay))
      if (state.fail) throw new Error('database unreachable')
      if (state.refuseWith) return { ok: false, code: state.refuseWith }
      if (game.status !== 'active') return { ok: false, code: 'GAME_OVER' }
      if (move.expectedPly !== game.sans.length) return { ok: false, code: 'OUT_OF_SYNC' }
      game.sans.push(move.san)
      game.fen = move.fenAfter
      state.applied++
      if (move.endReason) game.status = 'finished'
      return { ok: true, ply: game.sans.length, white_time_ms: 300_000, black_time_ms: 300_000, last_move_at: '2026-10-09T12:00:00Z', finished: move.endReason !== null }
    },
  }
  return { db, game, state }
}

function player(userId: string) {
  const heard: Record<string, unknown>[] = []
  const member: Member = { userId, send: (message) => heard.push(message) }
  return { member, heard }
}

async function table() {
  const fake = fakeDb()
  const games = new ChessGames(fake.db)
  const white = player('white')
  const black = player('black')
  expect(await games.join(white.member, 'm1')).toEqual({ ok: true, ply: 0 })
  expect(await games.join(black.member, 'm1')).toEqual({ ok: true, ply: 0 })
  return { ...fake, games, white, black }
}

describe('joining', () => {
  it('lets the two players in and nobody else', async () => {
    const { games } = await table()
    expect(await games.join(player('stranger').member, 'm1')).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(games.live).toBe(1)
  })

  it('keeps nothing for a game once both players have gone', async () => {
    const { games, white, black } = await table()
    games.leave(white.member, 'm1')
    expect(games.live).toBe(1)
    games.leave(black.member, 'm1')
    expect(games.live).toBe(0)
  })

  it('tells a returning player how far the game has got, including moves made elsewhere', async () => {
    const { games, white, game } = await table()
    await games.move(white.member, 'm1', { uci: 'e2e4', ply: 0 })
    // Black replies through the Edge Function while disconnected from this server.
    game.sans.push('e5')
    game.fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    const again = player('black')
    expect(await games.join(again.member, 'm1')).toEqual({ ok: true, ply: 2 })
  })
})

describe('moving', () => {
  it('passes a legal move to the opponent at once, records it, then sends the clocks', async () => {
    const { games, white, black, game, state } = await table()
    state.delay = 30
    const pending = games.move(white.member, 'm1', { uci: 'e2e4', ply: 0 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    // The opponent already has the move; the database has not answered yet.
    expect(black.heard).toEqual([{ t: 'move', ply: 1, san: 'e4' }])
    expect(game.sans).toEqual([])

    expect(await pending).toMatchObject({ ok: true, ply: 1, san: 'e4', finished: false })
    expect(game.sans).toEqual(['e4'])
    expect(black.heard[1]).toEqual({ t: 'clock', ply: 1, white_time_ms: 300_000, black_time_ms: 300_000, last_move_at: '2026-10-09T12:00:00Z' })
    // The mover is told by the answer to their own request, not by a broadcast.
    expect(white.heard).toEqual([])
  })

  it('refuses a move out of turn, an illegal move, and a move on an old position, and tells nobody else', async () => {
    const { games, white, black, state } = await table()
    expect(await games.move(black.member, 'm1', { uci: 'e7e5', ply: 0 })).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    expect(await games.move(white.member, 'm1', { uci: 'e2e5', ply: 0 })).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await games.move(white.member, 'm1', { uci: 'e2e4', ply: 3 })).toEqual({ ok: false, code: 'OUT_OF_SYNC' })
    expect(await games.move(player('stranger').member, 'm1', { uci: 'e2e4', ply: 0 })).toEqual({ ok: false, code: 'NOT_A_PLAYER' })
    expect(black.heard).toEqual([])
    expect(white.heard).toEqual([])
    expect(state.applied).toBe(0)
  })

  it('handles moves strictly in order: a reply sent before the first move is confirmed waits its turn', async () => {
    const { games, white, black, game, state } = await table()
    state.delay = 20
    const first = games.move(white.member, 'm1', { uci: 'e2e4', ply: 0 })
    const reply = games.move(black.member, 'm1', { uci: 'e7e5', ply: 1 })
    expect(await first).toMatchObject({ ok: true, ply: 1 })
    expect(await reply).toMatchObject({ ok: true, ply: 2, san: 'e5' })
    expect(game.sans).toEqual(['e4', 'e5'])
  })

  it('takes a move back from both players when the database refuses it', async () => {
    const { games, white, black, game, state } = await table()
    state.refuseWith = 'TIME_OUT'
    expect(await games.move(white.member, 'm1', { uci: 'e2e4', ply: 0 })).toEqual({ ok: false, code: 'TIME_OUT' })
    expect(black.heard).toEqual([{ t: 'move', ply: 1, san: 'e4' }, { t: 'revert', ply: 1 }])
    expect(game.sans).toEqual([])
    // The game goes on from where the database has it.
    state.refuseWith = null
    expect(await games.move(white.member, 'm1', { uci: 'd2d4', ply: 0 })).toMatchObject({ ok: true, san: 'd4' })
  })

  it('takes a move back when the database cannot be reached', async () => {
    const { games, white, black, state } = await table()
    state.fail = true
    expect(await games.move(white.member, 'm1', { uci: 'e2e4', ply: 0 })).toEqual({ ok: false, code: 'SERVER_ERROR' })
    expect(black.heard.at(-1)).toEqual({ t: 'revert', ply: 1 })
  })

  it('catches up with a move made through the Edge Function before judging the next one', async () => {
    const { games, white, black, game } = await table()
    game.sans.push('e4')
    game.fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    // Black's app has seen e4 (through the database's own live messages) and replies here.
    expect(await games.move(black.member, 'm1', { uci: 'e7e5', ply: 1 })).toMatchObject({ ok: true, ply: 2, san: 'e5' })
    expect(white.heard[0]).toEqual({ t: 'move', ply: 2, san: 'e5' })
  })

  it('reports checkmate to the database as the end of the game, and accepts nothing after it', async () => {
    const { games, white, black, game } = await table()
    const moves: [typeof white, string][] = [[white, 'f2f3'], [black, 'e7e5'], [white, 'g2g4'], [black, 'd8h4']]
    let last
    for (const [who, uci] of moves) last = await games.move(who.member, 'm1', { uci, ply: game.sans.length })
    expect(last).toMatchObject({ ok: true, san: 'Qh4#', finished: true })
    expect(game.status).toBe('finished')
    expect(await games.move(white.member, 'm1', { uci: 'a2a3', ply: 4 })).toEqual({ ok: false, code: 'GAME_OVER' })
  })

  it('learns from the database that a game ended another way (resignation, time)', async () => {
    const { games, white, game } = await table()
    game.status = 'finished'
    expect(await games.move(white.member, 'm1', { uci: 'e2e4', ply: 0 })).toEqual({ ok: false, code: 'GAME_OVER' })
  })
})
