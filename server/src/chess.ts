// Chess on the game server. The rules are chess.js, through the same file the Edge Function
// uses; the record is kept by public.chess_apply_move. See live.ts for how a move is handled.
import { judgeMove } from '../../supabase/functions/_shared/chessRules.ts'
import { type Applied, type Color, type GameKind, LiveGames, type Member, type Stored } from './live.ts'

export type { Applied, Color, Member }

export type ChessContext = Omit<Stored, 'seat'> & { color: Color; fen: string; turn: Color; sans: string[] }

/** The few things the game server asks of the database for chess. */
export type ChessDb = {
  /** The stored game as one player sees it; null when they are not in the match. */
  context: (matchId: string, userId: string) => Promise<ChessContext | null>
  /** Records a move already judged legal. The database re-checks turn, position and clock. */
  applyMove: (move: {
    matchId: string
    userId: string
    expectedPly: number
    san: string
    uci: string
    fenAfter: string
    endReason: string | null
    winner: Color | null
  }) => Promise<Applied>
}

type Position = { sans: string[]; fen: string }
export type ChessRequest = { uci: string }

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/
/** The move a player's message asks for; null when it is not a chess move at all. */
export function chessRequest(message: Record<string, unknown>): ChessRequest | null {
  return typeof message.uci === 'string' && UCI.test(message.uci) ? { uci: message.uci } : null
}

type Seated = ChessContext & Stored

const kind = (db: ChessDb): GameKind<Seated, Position, ChessRequest> => ({
  context: async (matchId, userId) => {
    const stored = await db.context(matchId, userId)
    return stored && { ...stored, seat: stored.color }
  },
  open: (stored) => ({ sans: stored.sans, fen: stored.fen }),
  // White plays the first move and every other one after it.
  turn: (_position, ply) => (ply % 2 === 0 ? 'w' : 'b'),
  judge: (position, request) => {
    const verdict = judgeMove(position.sans, position.fen, request.uci)
    if (!verdict.ok) return verdict
    return {
      ok: true,
      state: { sans: [...position.sans, verdict.san], fen: verdict.fenAfter },
      told: { san: verdict.san },
      record: (matchId, userId, expectedPly) =>
        db.applyMove({ matchId, userId, expectedPly, san: verdict.san, uci: verdict.uci, fenAfter: verdict.fenAfter, endReason: verdict.endReason, winner: verdict.winner }),
    }
  },
})

export class ChessGames extends LiveGames<Seated, Position, ChessRequest> {
  constructor(db: ChessDb) {
    super('chess', kind(db))
  }
}
