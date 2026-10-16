// Everything an Oware player can ask for: play a pit, resign, offer or answer a draw, or point
// out that a clock has run out.
//
// A move is judged HERE, on the server, by playing the stored game through with the rules in
// ../_shared/oware.ts. The app sends only the pit it wants to play. It cannot send a result,
// and a request made on an out-of-date position is refused. Order of checks:
//   1. who is asking (session token)
//   2. the game is on, they are in it, and it is their turn
//   3. the pit may be played in the stored game (feeding an empty row included)
//   4. recorded by the database under a row lock, which re-checks turn and position, counts the
//      seeds again and applies the server's clock (see public.oware_apply_move)
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'
import { applyMove, replay, type Side } from '../_shared/oware.ts'

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['move', 'resign', 'offer_draw', 'accept_draw', 'decline_draw', 'claim']),
  /** The pit to play, 0-11. */
  pit: z.optional(z.int().min(0).max(11)),
  /** How many moves the app believes have been played. A stale view is refused, not guessed at. */
  ply: z.optional(z.int().min(0).max(5000)),
})

type Context = { status: string; side: Side; pits: number[]; store_south: number; store_north: number; ply: number; turn: Side; moves: number[] }

serve(body, async ({ userId, body }) => {
  if (body.action !== 'move') {
    const done = await admin.rpc('oware_game_action', { p_match_id: body.match_id, p_user_id: userId, p_action: body.action })
    if (done.error) throw done.error
    const outcome = done.data as { ok: boolean; code?: string }
    return outcome.ok ? json(outcome) : refuse(outcome.code ?? 'SERVER_ERROR')
  }
  if (body.pit === undefined || body.ply === undefined) return refuse('BAD_REQUEST')

  const context = await admin.rpc('oware_move_context', { p_match_id: body.match_id, p_user_id: userId })
  if (context.error) throw context.error
  const game = context.data as Context | null

  if (!game) return refuse('NOT_A_PLAYER')
  if (game.status !== 'active') return refuse('GAME_OVER')
  // Cheap early answers; the database function checks both again under a lock.
  if (game.turn !== game.side) return refuse('NOT_YOUR_TURN')
  if (game.ply !== body.ply) return refuse('OUT_OF_SYNC')

  // The whole game is played through from the first move: the ending rules depend on its history.
  const stored = replay(game.moves)
  if (
    !stored ||
    stored.result ||
    stored.state.turn !== game.turn ||
    stored.state.pits.join(',') !== game.pits.join(',') ||
    stored.state.stores.s !== game.store_south ||
    stored.state.stores.n !== game.store_north
  ) {
    console.error('[oware] stored game does not replay', body.match_id)
    return refuse('CORRUPT_GAME')
  }
  const played = applyMove(stored.state, body.pit)
  if (!played) return refuse('ILLEGAL_MOVE')

  const applied = await admin.rpc('oware_apply_move', {
    p_match_id: body.match_id,
    p_user_id: userId,
    p_expected_ply: game.ply,
    p_pit: played.move.pit,
    p_notation: played.move.notation,
    p_taken: played.move.taken,
    p_pits_after: played.state.pits,
    p_store_south: played.state.stores.s,
    p_store_north: played.state.stores.n,
    p_end_reason: played.result?.reason ?? null,
    p_winner: played.result?.winner ?? null,
  })
  if (applied.error) throw applied.error

  const result = applied.data as { ok: boolean; code?: string }
  if (!result.ok) return refuse(result.code ?? 'SERVER_ERROR')
  return json(result)
})
