// Draughts on the game server. The rules are the one file the Edge Function and the app also
// use (supabase/functions/_shared/draughts.ts); the record is kept by
// public.draughts_apply_move. See live.ts for how a move is handled.
import { applyMove, type DraughtsState, replay } from '../../supabase/functions/_shared/draughts.ts'
import { type Applied, type Color, type GameKind, LiveGames, type Stored } from './live.ts'

export type DraughtsContext = Stored & { board: string; turn: Color; paths: number[][] }

/** The few things the game server asks of the database for draughts. */
export type DraughtsDb = {
  context: (matchId: string, userId: string) => Promise<DraughtsContext | null>
  /** Records a move already judged legal. The database re-checks turn, position and clock. */
  applyMove: (move: {
    matchId: string
    userId: string
    expectedPly: number
    notation: string
    path: number[]
    captures: number[]
    boardAfter: string
    endReason: string | null
    winner: Color | null
  }) => Promise<Applied>
}

export type DraughtsRequest = { path: number[] }

/** The move a player's message asks for: the squares the piece visits. Null when it is not one. */
export function draughtsRequest(message: Record<string, unknown>): DraughtsRequest | null {
  const path = message.path
  if (!Array.isArray(path) || path.length < 2 || path.length > 24) return null
  return path.every((square) => Number.isInteger(square) && square >= 1 && square <= 50) ? { path: path as number[] } : null
}

const kind = (db: DraughtsDb): GameKind<DraughtsContext, DraughtsState, DraughtsRequest> => ({
  context: db.context,
  // The whole game is played through from the first move: the draw rules depend on its
  // history, and a record that does not replay to the stored board is not played on.
  open: (stored) => {
    const game = replay(stored.paths)
    return game && !game.result && game.state.board === stored.board && game.state.turn === stored.turn ? game.state : stored.status === 'active' ? null : (game?.state ?? null)
  },
  judge: (state, request) => {
    const played = applyMove(state, request.path)
    if (!played) return { ok: false, code: 'ILLEGAL_MOVE' }
    return {
      ok: true,
      state: played.state,
      told: { path: played.move.path },
      record: (matchId, userId, expectedPly) =>
        db.applyMove({
          matchId,
          userId,
          expectedPly,
          notation: played.move.notation,
          path: played.move.path,
          captures: played.move.captures,
          boardAfter: played.state.board,
          endReason: played.result?.reason ?? null,
          winner: played.result?.winner ?? null,
        }),
    }
  },
})

export class DraughtsGames extends LiveGames<DraughtsContext, DraughtsState, DraughtsRequest> {
  constructor(db: DraughtsDb) {
    super('draughts', kind(db))
  }
}
