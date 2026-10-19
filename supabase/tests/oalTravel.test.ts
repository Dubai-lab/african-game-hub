import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { type Answers, type BorderFacts, decide } from '../functions/_shared/oalBorder'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life's journeys: a passport from the start; tickets bought with the life's own
// money; boarding only from the airport's town and only in the boarding window; the flight
// taking its time; the immigration officer's decision recorded once, with an admitted visitor
// going on into the town and a refused one held and flown home at the airline's cost. The game's
// clock is moved here by moving its start (oal_settings.clock_epoch), as only a test may.

let db: TestDb
let n = 0
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  db = await createTestDb()
}, 120_000)
afterEach(async () => {
  expect(await db.rows(`select * from public.oal_money_problems()`)).toEqual([])
  expect(await db.integrityProblems()).toEqual([])
})
afterAll(async () => {
  await db.close()
})

const one = async (sql: string, params: unknown[] = []) => (await db.rows<{ r: Json }>(sql, params))[0]!.r
const player = async () => db.createUser(`trav${++n}@example.com`, { username: `trav${n}`, country_code: 'LR', age_confirmed: true })
const live = async (country = 'LR', town = 'Monrovia') => {
  const user = await player()
  expect(await one(`select public.oal_start_life($1, 'Musu Kollie', 'female', 28, $2, $3, $4) as r`, [user, country, town, JSON.stringify(defaultAppearance('female'))])).toEqual({ ok: true })
  return user
}
/** Sets the game's clock to a game moment (UTC), by moving the moment it started. */
const setGameTime = async (at: string) => {
  await db.pg.query(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from $1::timestamp at time zone 'UTC')) / 29)`, [at])
}
const giveUsd = async (user: string, dollars: number) => {
  const admin = await player()
  expect(await one(`select public.admin_oal_adjust($1, $2, 'USD', $3, 'testing a journey') as r`, [admin, user, dollars * 100])).toMatchObject({ ok: true })
}
const state = (user: string) => one(`select public.oal_travel_state($1) as r`, [user])
const book = (user: string, flight: string, date: string) => one(`select public.oal_book_flight($1, $2, $3::date) as r`, [user, flight, date])
const board = (user: string, ticket: number) => one(`select public.oal_board($1, $2) as r`, [user, ticket])
const hotel = (user: string, id: string, from: string, nights: number) => one(`select public.oal_book_hotel($1, $2, $3::date, $4) as r`, [user, id, from, nights])
/** What the oal-travel Edge Function does at the immigration desk. */
const immigration = async (user: string, answers: Answers | null) => {
  const gathered = await one(`select public.oal_border_facts($1, $2, $3) as r`, [user, answers?.stay.kind === 'hotel' ? answers.stay.reference : null, answers?.stay.kind === 'host' ? answers.stay.phone : null])
  if (!gathered.ok) return gathered
  const decision = decide(gathered.facts as BorderFacts, answers)
  return one(`select public.oal_border_record($1, $2, $3, $4, $5::date, $6, $7) as r`, [
    user, gathered.trip_id, decision.category, decision.decision, decision.permittedUntil, answers ? JSON.stringify(answers) : null, decision.reasons,
  ])
}
const visit = (reference: string, over: Partial<Answers> = {}): Answers => ({
  purpose: 'visit_family', days: 7, stay: { kind: 'hotel', reference }, occupation: 'trader', returnTicket: true, fundsUsd: 0, ...over,
})

describe('papers and money', () => {
  it('a life starts at home with its passport: Liberian, five years', async () => {
    const user = await live()
    const [passport] = await db.rows<Json>(`select number, (expires_on - issued_on) as days from public.oal_passports where user_id = $1`, [user])
    expect(passport!.number).toMatch(/^R[0-9]{7}$/)
    expect(Number(passport!.days)).toBeGreaterThanOrEqual(365 * 5)
    expect(await state(user)).toMatchObject({ ok: true, state: 'settled', place: 'Monrovia', country: 'LR', trip: null })
  })

  it('a ticket costs what the airline asks, out of the life\'s own dollars; twenty dollars buys none', async () => {
    await setGameTime('2026-11-01 06:00')
    const user = await live()
    expect(await book(user, 'CL301', '2026-11-02')).toEqual({ ok: false, code: 'NOT_ENOUGH_MONEY' })
    await giveUsd(user, 2000)
    expect(await book(user, 'CL301', '2026-11-02')).toMatchObject({ ok: true })
    expect(await book(user, 'CL301', '2026-11-02')).toEqual({ ok: false, code: 'ALREADY_BOOKED' })
    const [usd] = await db.rows<{ amount: number }>(`select amount::int as amount from public.oal_balances where user_id = $1 and currency = 'USD'`, [user])
    expect(usd!.amount).toBe(2000 + 200000 - 38500)
    // Less than an hour before take-off, or more than 90 days ahead: no.
    await setGameTime('2026-11-02 09:00')
    expect(await book(user, 'KA714', '2026-11-02')).toMatchObject({ ok: true })
    expect(await book(user, 'CL301', '2026-11-03')).toMatchObject({ ok: true })
    await setGameTime('2026-11-02 17:00')
    expect(await book(user, 'KA714', '2026-11-03')).toMatchObject({ ok: true })
    expect(await book(user, 'CL301', '2027-03-01')).toEqual({ ok: false, code: 'TOO_FAR_AHEAD' })
  })
})

describe('a journey', () => {
  it('Monrovia to Accra: board in the window, fly, land, cleared as a visitor, into Accra', async () => {
    await setGameTime('2026-11-01 06:00')
    const user = await live()
    await giveUsd(user, 2000)
    const out = await book(user, 'CL301', '2026-11-02')
    expect(await book(user, 'CL302', '2026-11-09')).toMatchObject({ ok: true })
    const stay = await hotel(user, 'osu_garden', '2026-11-02', 7)
    expect(stay.reference).toMatch(/^HB-[A-Z0-9]{6}$/)

    // Boarding opens three hours before 09:40 and closes thirty minutes before.
    await setGameTime('2026-11-02 06:00')
    expect(await board(user, out.ticket_id)).toEqual({ ok: false, code: 'BOARDING_NOT_OPEN' })
    await setGameTime('2026-11-02 08:00')
    expect(await board(user, out.ticket_id)).toMatchObject({ ok: true })
    expect(await state(user)).toMatchObject({ state: 'in_flight', trip: { from: 'ROB', to: 'ACC', flight: 'CL301' } })
    // Nobody leaves the plane mid-air, nor before it lands at 11:45.
    expect(await one(`select public.oal_border_facts($1, null, null) as r`, [user])).toEqual({ ok: false, code: 'NOT_AT_ARRIVALS' })
    await setGameTime('2026-11-02 11:50')
    expect(await state(user)).toMatchObject({ state: 'arrivals', place: 'ACC', country: 'GH' })

    const facts = (await one(`select public.oal_border_facts($1, $2, null) as r`, [user, stay.reference])).facts
    expect(facts).toMatchObject({ country: 'GH', nationality: 'LR', arrival: '2026-11-02', ticketOut: '2026-11-09', booking: { reference: stay.reference, nights: 7 } })
    expect(await immigration(user, visit(stay.reference, { fundsUsd: facts.fundsUsd }))).toMatchObject({ ok: true, decision: 'admitted', permitted_until: '2026-11-09' })
    // Once: the decision cannot be asked for again.
    expect(await immigration(user, visit(stay.reference))).toEqual({ ok: false, code: 'NOT_AT_ARRIVALS' })
    expect(await one(`select public.oal_leave_airport($1) as r`, [user])).toEqual({ ok: true, place: 'Accra' })
    expect(await state(user)).toMatchObject({ state: 'settled', place: 'Accra', country: 'GH', trip: null })
  })

  it('refused at Kotoka (no ticket home): held, flown back on the next flight, welcomed home at Roberts', async () => {
    await setGameTime('2026-11-05 06:00')
    const user = await live()
    await giveUsd(user, 1000)
    const out = await book(user, 'CL301', '2026-11-05')
    const stay = await hotel(user, 'osu_garden', '2026-11-05', 5)
    await setGameTime('2026-11-05 08:00')
    await board(user, out.ticket_id)
    await setGameTime('2026-11-05 12:00')
    const refused = await immigration(user, visit(stay.reference, { days: 5, returnTicket: false }))
    expect(refused).toMatchObject({ ok: true, decision: 'refused', reasons: ['NO_TICKET_OUT'], flight_back: 'CL302', departs_at: '2026-11-05T13:05:00' })
    expect(await state(user)).toMatchObject({ state: 'held', place: 'ACC', trip: { kind: 'removal', from: 'ACC', to: 'ROB' } })
    expect(await one(`select public.oal_leave_airport($1) as r`, [user])).toEqual({ ok: false, code: 'NOT_CLEARED' })
    // Nothing was charged for the flight back.
    const [entries] = await db.rows<{ k: number }>(`select count(*)::int as k from public.oal_money_entries where user_id = $1 and kind = 'flight_ticket'`, [user])
    expect(entries!.k).toBe(1)
    await setGameTime('2026-11-05 13:30')
    expect(await state(user)).toMatchObject({ state: 'in_flight' })
    await setGameTime('2026-11-05 15:20')
    expect(await state(user)).toMatchObject({ state: 'arrivals', place: 'ROB', country: 'LR' })
    expect(await immigration(user, null)).toMatchObject({ ok: true, decision: 'admitted' })
    const [entry] = await db.rows<Json>(`select category, decision from public.oal_border_entries where user_id = $1 order by id desc limit 1`, [user])
    expect(entry).toEqual({ category: 'citizen', decision: 'admitted' })
    expect(await one(`select public.oal_leave_airport($1) as r`, [user])).toEqual({ ok: true, place: 'Monrovia' })
  })

  it('boarding is from the airport\'s town only, and a ticket not used in time is lost', async () => {
    await setGameTime('2026-11-07 06:00')
    const far = await live('LR', 'Voinjama')
    await giveUsd(far, 1000)
    const ticket = await book(far, 'CL301', '2026-11-07')
    await setGameTime('2026-11-07 08:00')
    expect(await board(far, ticket.ticket_id)).toEqual({ ok: false, code: 'NOT_AT_AIRPORT_TOWN' })
    await setGameTime('2026-11-07 09:20')
    expect(await board(far, ticket.ticket_id)).toEqual({ ok: false, code: 'TOO_LATE' })
    const [t] = await db.rows<{ status: string }>(`select status from public.oal_tickets where id = $1`, [ticket.ticket_id])
    expect(t!.status).toBe('missed')
  })
})

describe('nobody does it from the app', () => {
  it('a player reads their own papers and tickets, writes nothing, and cannot call the steps', async () => {
    await setGameTime('2026-11-08 06:00')
    const me = await live()
    const other = await live()
    await giveUsd(other, 1000)
    await book(other, 'CL301', '2026-11-09')
    const tickets = await db.as('authenticated', me, () => db.rows(`select id from public.oal_tickets`))
    expect(tickets).toEqual([])
    const flights = await db.as('authenticated', me, () => db.rows(`select code from public.oal_flights`))
    expect(flights.length).toBe(4)
    await expect(db.as('authenticated', me, () => db.rows(`update public.oal_lives set state = 'cleared' where user_id = $1 returning user_id`, [me]))).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', me, () => db.rows(`insert into public.oal_passports values ($1, 'GH', 'G0000001', '2026-01-01', '2036-01-01')`, [me]))).rejects.toThrow()
    await expect(db.as('authenticated', me, () => db.rows(`select public.oal_board($1, 1)`, [me]))).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', me, () => db.rows(`select public.admin_oal_adjust($1, $1, 'USD', 100000, 'free money')`, [me]))).rejects.toThrow(/permission denied/)
  })

  it('an admin\'s correction needs a reason and is audited', async () => {
    const user = await live()
    const admin = await player()
    expect(await one(`select public.admin_oal_adjust($1, $2, 'USD', 500, 'x') as r`, [admin, user])).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    expect(await one(`select public.admin_oal_adjust($1, $2, 'USD', 500, 'testing travel') as r`, [admin, user])).toMatchObject({ ok: true })
    const [audit] = await db.rows<Json>(`select action, details ->> 'currency' as currency from private.admin_audit_log where target_user_id = $1`, [user])
    expect(audit).toEqual({ action: 'oal_adjust', currency: 'USD' })
  })
})
