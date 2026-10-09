import { describe, expect, it } from 'vitest'
import { START } from '../../supabase/functions/_shared/draughts.ts'
import { type DraughtsContext, type DraughtsDb, DraughtsGames } from './draughts.ts'
import type { Applied, Member } from './live.ts'

// Draughts on the game server, with a stand-in for the database that behaves the way
// public.draughts_apply_move does. (How moves are ordered, taken back and caught up with is the
// same code as chess and is tested there.)

function fakeDb() {
  const game = { status: 'active', board: START as string, paths: [] as number[][] }
  const seats: Record<string, 'w' | 'b'> = { white: 'w', black: 'b' }
  const recorded: Record<string, unknown>[] = []
  const db: DraughtsDb = {
    context: async (_match, userId): Promise<DraughtsContext | null> => {
      const color = seats[userId]
      if (!color) return null
      return { status: game.status, color, board: game.board, ply: game.paths.length, turn: game.paths.length % 2 === 0 ? 'w' : 'b', paths: game.paths.map((p) => [...p]) }
    },
    applyMove: async (move): Promise<Applied> => {
      if (move.expectedPly !== game.paths.length) return { ok: false, code: 'OUT_OF_SYNC' }
      game.paths.push(move.path)
      game.board = move.boardAfter
      recorded.push(move)
      return { ok: true, ply: game.paths.length, white_time_ms: 300_000, black_time_ms: 300_000, last_move_at: '2026-10-09T12:00:00Z', finished: move.endReason !== null }
    },
  }
  return { db, game, recorded }
}

function player(userId: string) {
  const heard: Record<string, unknown>[] = []
  const member: Member = { userId, send: (message) => heard.push(message) }
  return { member, heard }
}

async function table() {
  const fake = fakeDb()
  const games = new DraughtsGames(fake.db)
  const white = player('white')
  const black = player('black')
  expect(await games.join(white.member, 'm1')).toEqual({ ok: true, ply: 0 })
  expect(await games.join(black.member, 'm1')).toEqual({ ok: true, ply: 0 })
  return { ...fake, games, white, black }
}

describe('draughts on the game server', () => {
  it('passes a move to the opponent as the squares the piece visits, and records it in full', async () => {
    const { games, white, black, recorded } = await table()
    expect(await games.move(white.member, 'm1', 0, { path: [32, 28] })).toMatchObject({ ok: true, ply: 1, path: [32, 28] })
    expect(black.heard[0]).toEqual({ t: 'move', ply: 1, path: [32, 28] })
    expect(black.heard[1]).toMatchObject({ t: 'clock', ply: 1 })
    expect(recorded[0]).toMatchObject({ expectedPly: 0, notation: '32-28', path: [32, 28], captures: [], endReason: null, winner: null })
  })

  it('judges with the real rules: a capture is compulsory, and nothing else is accepted', async () => {
    const { games, white, black, recorded } = await table()
    await games.move(white.member, 'm1', 0, { path: [32, 28] })
    await games.move(black.member, 'm1', 1, { path: [19, 23] })
    // White must take the man on 23.
    expect(await games.move(white.member, 'm1', 2, { path: [31, 27] })).toEqual({ ok: false, code: 'ILLEGAL_MOVE' })
    expect(await games.move(white.member, 'm1', 2, { path: [28, 19] })).toMatchObject({ ok: true, ply: 3, path: [28, 19] })
    expect(recorded.at(-1)).toMatchObject({ notation: '28x19', captures: [23] })
    expect(black.heard.at(-2)).toEqual({ t: 'move', ply: 3, path: [28, 19] })
  })

  it('refuses a move out of turn', async () => {
    const { games, black } = await table()
    expect(await games.move(black.member, 'm1', 0, { path: [19, 23] })).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
  })

  it('will not play on a record that does not replay to the stored board', async () => {
    const fake = fakeDb()
    fake.game.paths = [[32, 28]]
    // The stored board says something the moves do not.
    fake.game.board = START
    const games = new DraughtsGames(fake.db)
    const black = player('black')
    await games.join(black.member, 'm1')
    expect(await games.move(black.member, 'm1', 1, { path: [19, 23] })).toEqual({ ok: false, code: 'CORRUPT_GAME' })
  })
})
