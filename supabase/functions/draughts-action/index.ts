// Everything a draughts player can ask for: play a move, resign, offer or answer a draw, or
// point out that a clock has run out.
//
// A move is judged HERE, on the server, by playing the stored game through with the rules in
// ../_shared/draughts.ts. The app sends only the squares its piece is to visit. It cannot send
// a result, and a request made on an out-of-date position is refused. Order of checks:
//   1. who is asking (session token)
//   2. the game is on, they are in it, and it is their turn
//   3. the move is legal in the stored game (compulsory and longest capture included)
//   4. recorded by the database under a row lock, which re-checks turn and position and applies
//      the server's clock (see public.draughts_apply_move)
import { z } from 'npm:zod@4'
import { applyMove, replay } from '../_shared/draughts.ts'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['move', 'resign', 'offer_draw', 'accept_draw', 'decline_draw', 'claim']),
  /** The squares the piece stands on, first to last. */
  path: z.optional(z.array(z.int().min(1).max(50)).min(2).max(24)),
  /** How many moves the app believes have been played. A stale view is refused, not guessed at. */
  ply: z.optional(z.int().min(0).max(2000)),
})

type Context = { status: string; color: 'w' | 'b'; board: string; ply: number; turn: 'w' | 'b'; paths: number[][] }

serve(body, async ({ userId, body }) => {
  if (body.action !== 'move') {
    const done = await admin.rpc('draughts_game_action', { p_match_id: body.match_id, p_user_id: userId, p_action: body.action })
    if (done.error) throw done.error
    const outcome = done.data as { ok: boolean; code?: string }
    return outcome.ok ? json(outcome) : refuse(outcome.code ?? 'SERVER_ERROR')
  }
  if (!body.path || body.ply === undefined) return refuse('BAD_REQUEST')

  const context = await admin.rpc('draughts_move_context', { p_match_id: body.match_id, p_user_id: userId })
  if (context.error) throw context.error
  const game = context.data as Context | null

  if (!game) return refuse('NOT_A_PLAYER')
  if (game.status !== 'active') return refuse('GAME_OVER')
  // Cheap early answers; the database function checks both again under a lock.
  if (game.turn !== game.color) return refuse('NOT_YOUR_TURN')
  if (game.ply !== body.ply) return refuse('OUT_OF_SYNC')

  // The whole game is played through from the first move: the draw rules depend on its history.
  const stored = replay(game.paths)
  if (!stored || stored.result || stored.state.board !== game.board || stored.state.turn !== game.turn) {
    console.error('[draughts] stored game does not replay', body.match_id)
    return refuse('CORRUPT_GAME')
  }
  const played = applyMove(stored.state, body.path)
  if (!played) return refuse('ILLEGAL_MOVE')

  const applied = await admin.rpc('draughts_apply_move', {
    p_match_id: body.match_id,
    p_user_id: userId,
    p_expected_ply: game.ply,
    p_notation: played.move.notation,
    p_path: played.move.path,
    p_captures: played.move.captures,
    p_board_after: played.state.board,
    p_end_reason: played.result?.reason ?? null,
    p_winner: played.result?.winner ?? null,
  })
  if (applied.error) throw applied.error

  const result = applied.data as { ok: boolean; code?: string }
  if (!result.ok) return refuse(result.code ?? 'SERVER_ERROR')
  return json(result)
})
