// Chess rules on the server. Every question of legality is answered by chess.js; nothing about
// how pieces move is written by hand.
import { Chess } from 'npm:chess.js@1.4.0'

export type Verdict =
  | { ok: false; code: 'CORRUPT_GAME' | 'ILLEGAL_MOVE' }
  | {
      ok: true
      san: string
      uci: string
      fenAfter: string
      /** Set when this move ends the game. */
      endReason: 'checkmate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty_moves' | null
      /** 'w' or 'b' when the move wins the game, otherwise null. */
      winner: 'w' | 'b' | null
    }

/**
 * Replays the stored game and tries the requested move in the resulting position.
 * Replaying (rather than loading the stored FEN) gives chess.js the full history, which is what
 * makes threefold repetition detectable, and doubles as an integrity check on the stored state.
 */
export function judgeMove(sans: string[], storedFen: string, uci: string): Verdict {
  const chess = new Chess()
  try {
    for (const san of sans) chess.move(san)
  } catch {
    return { ok: false, code: 'CORRUPT_GAME' }
  }
  if (chess.fen() !== storedFen) return { ok: false, code: 'CORRUPT_GAME' }

  let move
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return { ok: false, code: 'ILLEGAL_MOVE' }
  }
  // A promotion letter on a move that is not a promotion is refused rather than ignored.
  if ((uci[4] ?? undefined) !== move.promotion) return { ok: false, code: 'ILLEGAL_MOVE' }

  let endReason: Extract<Verdict, { ok: true }>['endReason'] = null
  let winner: 'w' | 'b' | null = null
  if (chess.isCheckmate()) {
    endReason = 'checkmate'
    winner = move.color
  } else if (chess.isStalemate()) endReason = 'stalemate'
  else if (chess.isInsufficientMaterial()) endReason = 'insufficient'
  else if (chess.isThreefoldRepetition()) endReason = 'repetition'
  else if (chess.isDrawByFiftyMoves()) endReason = 'fifty_moves'

  return {
    ok: true,
    san: move.san,
    uci: move.from + move.to + (move.promotion ?? ''),
    fenAfter: chess.fen(),
    endReason,
    winner,
  }
}
