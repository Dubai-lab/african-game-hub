// One Africa Life: home and body. A phone, its SIM (registered with the document the law asks
// for: the database checks which), airtime, a room (public.oal_home_action); eating, sleeping,
// the clinic (public.oal_needs_action); texts and mobile money (public.oal_phone_action); the
// government offices' counters: the birth certificate (public.oal_office_action); things from
// Furniture City, bought, put in the house, moved, kept aside, sold (public.oal_thing_action). Each
// step is the database's, under the life's row lock, after time's changes.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'
import { ITEM_IDS, type ItemId } from '../_shared/oalItems.ts'

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['buy_phone', 'buy_sim', 'register_sim', 'top_up', 'rent']),
    target: z.string().regex(/^[a-z0-9_]{2,40}$/),
    /** Airtime to buy, in hundredths of the local money. */
    amount: z.optional(z.int().min(100).max(100_000_000)),
  }),
  z.object({ action: z.enum(['eat_out', 'eat_family', 'cook', 'clinic']) }),
  z.object({ action: z.literal('sleep'), hours: z.int().min(1).max(10) }),
  // The phone in use: texts and mobile money (public.oal_phone_action).
  z.object({ action: z.literal('text'), number: z.string().max(20), body: z.string().min(1).max(160) }),
  z.object({ action: z.literal('send_money'), number: z.string().max(20), amount: z.int().min(100).max(10_000_000_000) }),
  z.object({ action: z.enum(['cash_in', 'cash_out']), amount: z.int().min(100).max(10_000_000_000) }),
  z.object({ action: z.literal('read_texts') }),
  z.object({ action: z.literal('birth_apply'), father: z.string().min(2).max(60), mother: z.string().min(2).max(60), witness: z.string().min(2).max(60), relation: z.string().min(2).max(30) }),
  z.object({ action: z.enum(['birth_pay', 'birth_lodge', 'birth_collect']) }),
  // The new phone at home: out of its box, on charge (public.oal_phone_box_action).
  z.object({ action: z.enum(['unbox', 'charge']) }),
  // Things for the house (public.oal_thing_action).
  z.object({ action: z.literal('buy_thing'), item: z.enum(ITEM_IDS as [ItemId, ...ItemId[]]) }),
  z.object({ action: z.enum(['sell_thing', 'store_thing']), id: z.int().min(1) }),
  // The delivery carried in at the house (public.oal_thing_action: 'receive').
  z.object({ action: z.literal('receive_things') }),
  z.object({ action: z.literal('sell_piece'), piece: z.enum(['living', 'bedroom']) }),
  z.object({ action: z.literal('place_thing'), id: z.int().min(1), x: z.number().min(-40).max(40), y: z.number().min(-40).max(40), rot: z.number().min(-7).max(7) }),
])

const PHONE: Record<string, string> = { text: 'text', send_money: 'send', cash_in: 'cash_in', cash_out: 'cash_out', read_texts: 'read' }

const THING: Record<string, string> = { buy_thing: 'buy', sell_thing: 'sell', place_thing: 'place', store_thing: 'store', receive_things: 'receive' }

serve(body, async ({ userId, body }) => {
  const thing = THING[body.action]
  const result = body.action === 'sell_piece'
    ? await admin.rpc('oal_piece_sell', { p_user_id: userId, p_piece: body.piece })
    : thing
    ? await admin.rpc('oal_thing_action', { p_user_id: userId, p_action: thing, p_data: { ...body, action: undefined } })
    : body.action === 'unbox' || body.action === 'charge'
    ? await admin.rpc('oal_phone_box_action', { p_user_id: userId, p_action: body.action })
    : body.action.startsWith('birth_')
    ? await admin.rpc('oal_office_action', { p_user_id: userId, p_action: body.action, p_data: body.action === 'birth_apply' ? { father: body.father, mother: body.mother, witness: body.witness, relation: body.relation } : {} })
    : PHONE[body.action]
    ? await admin.rpc('oal_phone_action', {
        p_user_id: userId,
        p_action: PHONE[body.action],
        p_number: 'number' in body ? body.number : null,
        p_body: 'body' in body ? body.body : null,
        p_amount: 'amount' in body ? body.amount : null,
      })
    : 'target' in body
      ? await admin.rpc('oal_home_action', { p_user_id: userId, p_action: body.action, p_target: body.target, p_amount: body.amount ?? null })
      : await admin.rpc('oal_needs_action', { p_user_id: userId, p_action: body.action, p_hours: 'hours' in body ? body.hours : null })
  if (result.error) throw result.error
  const outcome = result.data as { ok: boolean; code?: string }
  return outcome.ok ? json(outcome) : refuse(outcome.code ?? 'SERVER_ERROR')
})
