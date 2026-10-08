// Everything a Ludo player can ask for: roll the die, move a piece, resign, or point out that
// the turn clock has run out. The rules, and the die itself, live in the database
// (see *_ludo.sql), so this only identifies the player and passes the request on.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['roll', 'move', 'resign', 'claim']),
  piece: z.optional(z.int().min(0).max(3)),
  // Which of the dice lying on the board to play on that piece.
  die: z.optional(z.int().min(1).max(6)),
  // Which of the player's colours the piece belongs to (they may hold two), and whether to
  // move it by both dice at once.
  color: z.optional(z.enum(['red', 'green', 'yellow', 'blue'])),
  full: z.optional(z.boolean()),
  // The last state of the game the app has seen; a request made on an old picture is refused.
  turn_no: z.optional(z.int().min(0)),
})

serve(body, async ({ userId, body }) => {
  const result = await admin.rpc('ludo_action', {
    p_match_id: body.match_id,
    p_user_id: userId,
    p_action: body.action,
    p_piece: body.piece ?? null,
    p_turn_no: body.turn_no ?? null,
    p_die: body.die ?? null,
    p_color: body.color ?? null,
    p_full: body.full ?? false,
  })
  if (result.error) throw result.error
  const outcome = result.data as { ok: boolean; code?: string }
  return outcome.ok ? json({ ok: true }) : refuse(outcome.code ?? 'SERVER_ERROR')
})
