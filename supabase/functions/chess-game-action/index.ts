// Everything a player can do in a chess game besides moving: resign, offer / accept / decline a
// draw, and "claim" (ask the server to look at the clock). A claim never takes the app's word
// for anything; the server checks its own clock and ends the game only if time is really up.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['resign', 'offer_draw', 'accept_draw', 'decline_draw', 'claim']),
})

serve(body, async ({ userId, body }) => {
  const { data, error } = await admin.rpc('chess_game_action', {
    p_match_id: body.match_id,
    p_user_id: userId,
    p_action: body.action,
  })
  if (error) throw error
  const result = data as { ok: boolean; code?: string }
  if (!result.ok) return refuse(result.code ?? 'SERVER_ERROR')
  return json(result)
})
