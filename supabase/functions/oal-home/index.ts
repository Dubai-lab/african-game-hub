// One Africa Life: home and body. A phone, its SIM (registered with the document the law asks
// for: the database checks which), airtime, a room (public.oal_home_action); and eating,
// sleeping, the clinic (public.oal_needs_action). Each step is the database's, under the life's
// row lock, after time's changes.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['buy_phone', 'buy_sim', 'register_sim', 'top_up', 'rent']),
    target: z.string().regex(/^[a-z0-9_]{2,40}$/),
    /** Airtime to buy, in hundredths of the local money. */
    amount: z.optional(z.int().min(100).max(100_000_000)),
  }),
  z.object({ action: z.enum(['eat_out', 'eat_family', 'cook', 'clinic']) }),
  z.object({ action: z.literal('sleep'), hours: z.int().min(1).max(10) }),
])

serve(body, async ({ userId, body }) => {
  const result =
    'target' in body
      ? await admin.rpc('oal_home_action', { p_user_id: userId, p_action: body.action, p_target: body.target, p_amount: body.amount ?? null })
      : await admin.rpc('oal_needs_action', { p_user_id: userId, p_action: body.action, p_hours: 'hours' in body ? body.hours : null })
  if (result.error) throw result.error
  const outcome = result.data as { ok: boolean; code?: string }
  return outcome.ok ? json(outcome) : refuse(outcome.code ?? 'SERVER_ERROR')
})
