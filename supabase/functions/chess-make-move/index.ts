// A chess move. The app sends only what it wants to play; this function decides whether it
// happens. Order of checks:
//   1. who is asking (session token)
//   2. the game is on, they are in it, and it is their turn
//   3. the move is legal in the stored position (chess.js)
//   4. recorded by the database under a row lock, which re-checks turn and position and applies
//      the server's clock (see public.chess_apply_move)
import { z } from 'npm:zod@4'
import { judgeMove } from '../_shared/chessRules.ts'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  match_id: z.uuid(),
  uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
  /** How many moves the app believes have been played. A stale view is refused, not guessed at. */
  ply: z.number().int().min(0).max(2000),
})

type Context = { status: string; color: 'w' | 'b'; fen: string; ply: number; turn: 'w' | 'b'; sans: string[] }

serve(body, async ({ userId, body }) => {
  const context = await admin.rpc('chess_move_context', { p_match_id: body.match_id, p_user_id: userId })
  if (context.error) throw context.error
  const game = context.data as Context | null

  if (!game) return refuse('NOT_A_PLAYER')
  if (game.status !== 'active') return refuse('GAME_OVER')
  if (game.turn !== game.color) return refuse('NOT_YOUR_TURN')
  if (game.ply !== body.ply) return refuse('OUT_OF_SYNC')

  const verdict = judgeMove(game.sans, game.fen, body.uci)
  if (!verdict.ok) {
    if (verdict.code === 'CORRUPT_GAME') console.error('[chess] stored game does not replay', body.match_id)
    return refuse(verdict.code)
  }

  const applied = await admin.rpc('chess_apply_move', {
    p_match_id: body.match_id,
    p_user_id: userId,
    p_expected_ply: game.ply,
    p_san: verdict.san,
    p_uci: verdict.uci,
    p_fen_after: verdict.fenAfter,
    p_end_reason: verdict.endReason,
    p_winner: verdict.winner,
  })
  if (applied.error) throw applied.error

  const result = applied.data as { ok: boolean; code?: string }
  if (!result.ok) return refuse(result.code ?? 'SERVER_ERROR')
  return json({ ...result, san: verdict.san })
})
