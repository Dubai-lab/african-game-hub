// One Africa Life: travelling. Everything a player asks for on a journey: where am I now, buy a
// ticket, board, book a hotel, answer the immigration officer, leave the airport.
//
// The database does each step under the life's row lock and applies time's changes first
// (public.oal_travel_state and the others in 20261019100000_oal_travel.sql). The immigration
// officer's decision is made HERE, by the rules in ../_shared/oalBorder.ts, on facts the
// database gathers (passport, tickets, the booking for the reference given, the money really
// carried, what calling a host's number finds). The app sends only the traveller's answers; it
// can never send a decision.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'
import { type BorderFacts, checkAnswers, decide } from '../_shared/oalBorder.ts'

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('state') }),
  z.object({ action: z.literal('book_flight'), flight: z.string().regex(/^[A-Z]{2}[0-9]{3}$/), date: z.iso.date() }),
  z.object({ action: z.literal('board'), ticket_id: z.int().positive() }),
  z.object({ action: z.literal('book_hotel'), hotel: z.string().regex(/^[a-z0-9_]{2,40}$/), from: z.iso.date(), nights: z.int().min(1).max(30) }),
  z.object({ action: z.literal('immigration'), answers: z.optional(z.record(z.string(), z.unknown())) }),
  z.object({ action: z.literal('leave_airport') }),
])

type Outcome = { ok: boolean; code?: string } & Record<string, unknown>

async function call(fn: string, args: Record<string, unknown>): Promise<Outcome> {
  const result = await admin.rpc(fn, args)
  if (result.error) throw result.error
  return result.data as Outcome
}
const answer = (outcome: Outcome) => (outcome.ok ? json(outcome) : refuse(outcome.code ?? 'SERVER_ERROR'))

serve(body, async ({ userId, body }) => {
  switch (body.action) {
    case 'state':
      return answer(await call('oal_travel_state', { p_user_id: userId }))
    case 'book_flight':
      return answer(await call('oal_book_flight', { p_user_id: userId, p_flight: body.flight, p_on: body.date }))
    case 'board':
      return answer(await call('oal_board', { p_user_id: userId, p_ticket_id: body.ticket_id }))
    case 'book_hotel':
      return answer(await call('oal_book_hotel', { p_user_id: userId, p_hotel: body.hotel, p_from: body.from, p_nights: body.nights }))
    case 'leave_airport':
      return answer(await call('oal_leave_airport', { p_user_id: userId }))
    case 'immigration': {
      const answers = body.answers ? checkAnswers(body.answers) : null
      if (body.answers && !answers) return refuse('BAD_REQUEST')
      const reference = answers?.stay.kind === 'hotel' ? answers.stay.reference : null
      const phone = answers?.stay.kind === 'host' ? answers.stay.phone : null
      const gathered = await call('oal_border_facts', { p_user_id: userId, p_reference: reference, p_phone: phone })
      if (!gathered.ok) return refuse(gathered.code ?? 'SERVER_ERROR')
      const facts = gathered.facts as BorderFacts
      // A visitor must answer the officer's questions; a citizen is only welcomed home.
      if (facts.nationality !== facts.country && !answers) return refuse('ANSWERS_REQUIRED')
      const decision = decide(facts, answers)
      return answer(
        await call('oal_border_record', {
          p_user_id: userId,
          p_trip_id: gathered.trip_id,
          p_category: decision.category,
          p_decision: decision.decision,
          p_permitted_until: decision.permittedUntil,
          p_answers: answers,
          p_reasons: decision.reasons,
        }),
      )
    }
  }
})
