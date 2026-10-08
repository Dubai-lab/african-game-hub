// Rematch after a finished game: offer one, accept or decline the opponent's, or take an offer
// back. Game-agnostic. One atomic database function does the work (see *_rematch.sql); an
// accepted offer starts the new match with both stakes in escrow, exactly like matchmaking.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['offer', 'accept', 'decline', 'cancel']),
})

serve(body, async ({ userId, body }) => {
  const result = await admin.rpc('rematch', { p_user_id: userId, p_match_id: body.match_id, p_action: body.action })
  if (result.error) throw result.error

  const outcome = result.data as { status: string; match_id?: string; code?: string }
  if (outcome.status === 'error') return refuse(outcome.code ?? 'SERVER_ERROR')
  return json({ ok: true, status: outcome.status, match_id: outcome.match_id ?? null })
})
