// One Africa Life: work and money. Apply (for a commercial licence, for an office job), go to work
// (a day at the market with stock bought, a day on a rented kekeh, a day at the office), change
// money. Each step is the database's, under the life's row lock and after time's changes (see
// 20261020100000_oal_work.sql): it checks the town, the hours, the licence, the money, and
// decides the day's takings by chance when the day is over. The app sends only the choice.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('apply'), kind: z.enum(['licence', 'job']), target: z.string().regex(/^[A-Za-z0-9_]{2,40}$/) }),
  z.object({
    action: z.literal('start_shift'),
    job: z.string().regex(/^[a-z0-9_]{2,40}$/),
    hours: z.optional(z.int().min(1).max(15)),
    /** A trader's stock, in hundredths of the market's currency. */
    stock: z.optional(z.int().min(1).max(100_000_000)),
  }),
  z.object({ action: z.literal('exchange'), from: z.enum(['LRD', 'USD', 'GHS']), amount: z.int().min(100).max(10_000_000_000) }),
])

serve(body, async ({ userId, body }) => {
  const [fn, args] =
    body.action === 'apply'
      ? ['oal_apply', { p_user_id: userId, p_kind: body.kind, p_target: body.target }]
      : body.action === 'start_shift'
        ? ['oal_start_shift', { p_user_id: userId, p_job: body.job, p_hours: body.hours ?? null, p_stock: body.stock ?? null }]
        : ['oal_exchange', { p_user_id: userId, p_from: body.from, p_amount: body.amount }]
  const result = await admin.rpc(fn, args)
  if (result.error) throw result.error
  const outcome = result.data as { ok: boolean; code?: string }
  return outcome.ok ? json(outcome) : refuse(outcome.code ?? 'SERVER_ERROR')
})
