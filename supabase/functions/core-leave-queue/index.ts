// Cancel a search. Harmless if the player was not waiting.
import { z } from 'npm:zod@4'
import { admin, json, serve } from '../_shared/http.ts'

serve(z.object({}), async ({ userId }) => {
  const { error } = await admin.rpc('leave_match_queue', { p_user_id: userId })
  if (error) throw error
  return json({ ok: true })
})
