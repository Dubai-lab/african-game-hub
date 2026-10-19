// One Africa Life: a phone, its SIM, airtime, a room. Buy a phone at the shop; buy a SIM from a
// network and register it with the document the law asks for (the database checks which: in
// Ghana the Ghana Card for a Ghanaian, otherwise the passport); top up; rent a room with the
// landlord's advance. Each step is public.oal_home_action, under the life's row lock.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  action: z.enum(['buy_phone', 'buy_sim', 'register_sim', 'top_up', 'rent']),
  target: z.string().regex(/^[a-z0-9_]{2,40}$/),
  /** Airtime to buy, in hundredths of the local money. */
  amount: z.optional(z.int().min(100).max(100_000_000)),
})

serve(body, async ({ userId, body }) => {
  const result = await admin.rpc('oal_home_action', { p_user_id: userId, p_action: body.action, p_target: body.target, p_amount: body.amount ?? null })
  if (result.error) throw result.error
  const outcome = result.data as { ok: boolean; code?: string }
  return outcome.ok ? json(outcome) : refuse(outcome.code ?? 'SERVER_ERROR')
})
