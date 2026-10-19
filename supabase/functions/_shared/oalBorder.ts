// One Africa Life: crossing a border at an airport. What the immigration officer (a bot, never a
// person) asks, and how they decide, the way it is done in real life:
//
//   * A citizen coming home is always let in (no country may refuse its own citizens). The
//     officer looks at the passport and says welcome home.
//   * Liberia and Ghana are both in ECOWAS: a citizen of one may visit the other for up to 90
//     days without a visa. Staying longer, or working, needs a visa applied for before
//     travelling (20261022100000_oal_visas.sql): a long-stay visa allows a stay to its end; a
//     work visa allows work, and someone coming to work is not asked for a ticket home or money.
//     Studying needs a student visa (not in the game yet).
//   * The officer asks why you have come, how long you will stay, where you will stay, what you
//     do for a living, whether you have a ticket home, and how much money you carry. Every
//     answer that can be checked is checked against what the game knows: the passport, the
//     tickets bought, the hotel booking (by its reference), the host (by calling the number
//     given: registered in this country to someone there now), the money actually carried. A
//     false answer is a refusal, as it would be at a real border.
//
// The server decides (supabase/functions/oal-travel); the app only offers the questions. No
// library: read by the Edge Functions (Deno) and by the app.

export const ECOWAS_VISIT_DAYS = 90

export const PURPOSES = ['visit_family', 'tourism', 'business', 'conference', 'work', 'study'] as const
export type Purpose = (typeof PURPOSES)[number]

export const OCCUPATIONS = ['trader', 'driver', 'teacher', 'nurse', 'office_worker', 'farmer', 'student', 'self_employed', 'unemployed'] as const
export type Occupation = (typeof OCCUPATIONS)[number]

/** Where the traveller says they will stay: a hotel (by its booking reference), or with someone. */
export type Stay = { kind: 'hotel'; reference: string } | { kind: 'host'; phone: string }

export type Answers = {
  purpose: Purpose
  /** How many days they say they will stay. */
  days: number
  stay: Stay
  occupation: Occupation
  /** Whether they say they have a ticket out of the country. */
  returnTicket: boolean
  /** How much money they say they carry, in whole US dollars (all currencies together). */
  fundsUsd: number
}

/** What the game knows about the traveller, gathered by the database (private.oal_border_facts). */
export type BorderFacts = {
  /** The country they are entering, and the one whose passport they hold. */
  country: 'LR' | 'GH'
  nationality: 'LR' | 'GH'
  /** The game's date of arrival, YYYY-MM-DD. */
  arrival: string
  passport: { number: string; expires: string } | null
  /** Their earliest ticket out of this country, on or after arrival (YYYY-MM-DD), if any. */
  ticketOut: string | null
  /** The hotel booking with the reference they gave, if it is theirs, in this country. */
  booking: { reference: string; from: string; nights: number } | null
  /**
   * What calling the host's number found: null when no SIM in this country has that number;
   * else whether it is the traveller's own, whether its owner is in the country now (not
   * travelling), and whether they have a phone to answer it on.
   */
  host?: { self: boolean; here: boolean; phone: boolean } | null
  /** The visa held for this country and valid on arrival, if any (a work visa first). */
  visa?: { kind: 'long_visit' | 'work'; until: string; number: string } | null
  /** Days the traveller overstayed in this country in the year before arriving. */
  overstayedDays?: number
  /** What they really carry, in whole US dollars at the game's rates. */
  fundsUsd: number
}

export type Reason =
  | 'NO_PASSPORT'
  | 'PASSPORT_EXPIRED'
  | 'STAY_TOO_LONG'
  | 'BEYOND_VISA'
  | 'PREVIOUS_OVERSTAY'
  | 'PURPOSE_NEEDS_VISA'
  | 'NO_TICKET_OUT'
  | 'FALSE_TICKET'
  | 'TICKET_DOES_NOT_MATCH'
  | 'FALSE_BOOKING'
  | 'BOOKING_DOES_NOT_MATCH'
  | 'HOST_UNKNOWN'
  | 'HOST_IS_YOU'
  | 'HOST_NOT_REACHED'
  | 'FALSE_FUNDS'
  | 'NOT_ENOUGH_MONEY'

export type Decision =
  | { decision: 'admitted'; category: 'citizen'; permittedUntil: null; reasons: [] }
  | { decision: 'admitted'; category: 'ecowas_visitor'; permittedUntil: string; reasons: [] }
  | { decision: 'refused'; category: 'ecowas_visitor'; permittedUntil: null; reasons: Reason[] }

/** Money a visitor must show for each day not already paid for, in US dollars. */
export const DAILY_FUNDS_USD = 25
/** Staying with someone costs less: what a visitor must show a day then. */
export const DAILY_FUNDS_HOSTED_USD = 10

/** The game's dates, as YYYY-MM-DD, moved by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** The answers, cleaned up, or null when they are not answers the officer's questions allow. */
export function checkAnswers(input: unknown): Answers | null {
  if (typeof input !== 'object' || input === null) return null
  const a = input as Record<string, unknown>
  const stay = a.stay as Record<string, unknown> | undefined
  if (!PURPOSES.includes(a.purpose as Purpose) || !OCCUPATIONS.includes(a.occupation as Occupation)) return null
  if (!Number.isInteger(a.days) || (a.days as number) < 1 || (a.days as number) > 3650) return null
  if (!Number.isInteger(a.fundsUsd) || (a.fundsUsd as number) < 0 || (a.fundsUsd as number) > 10_000_000) return null
  if (typeof a.returnTicket !== 'boolean' || typeof stay !== 'object' || stay === null) return null
  let cleanStay: Stay
  if (stay.kind === 'hotel' && typeof stay.reference === 'string' && /^[A-Z0-9-]{4,20}$/.test(stay.reference.trim().toUpperCase())) {
    cleanStay = { kind: 'hotel', reference: stay.reference.trim().toUpperCase() }
  } else if (stay.kind === 'host' && typeof stay.phone === 'string' && /^\+?[0-9 ]{6,20}$/.test(stay.phone.trim())) {
    cleanStay = { kind: 'host', phone: stay.phone.trim() }
  } else {
    return null
  }
  return { purpose: a.purpose as Purpose, days: a.days as number, stay: cleanStay, occupation: a.occupation as Occupation, returnTicket: a.returnTicket, fundsUsd: a.fundsUsd as number }
}

/** The officer's decision on what the traveller answered and what the game knows. */
export function decide(facts: BorderFacts, answers: Answers | null): Decision {
  if (facts.nationality === facts.country) return { decision: 'admitted', category: 'citizen', permittedUntil: null, reasons: [] }
  const reasons: Reason[] = []
  const refuse = (): Decision => ({ decision: 'refused', category: 'ecowas_visitor', permittedUntil: null, reasons })
  if (!facts.passport) {
    reasons.push('NO_PASSPORT')
    return refuse()
  }
  if (!answers) return refuse()
  // Someone who overstayed more than a month here within the year is not let in again.
  if ((facts.overstayedDays ?? 0) > 30) reasons.push('PREVIOUS_OVERSTAY')
  const leaving = addDays(facts.arrival, answers.days)
  if (facts.passport.expires < leaving) reasons.push('PASSPORT_EXPIRED')

  // What the ECOWAS visit allows, or the visa held: a long stay up to its end; work with a work
  // visa. (Study needs a student visa: not in the game yet.)
  const visa = facts.visa ?? null
  const working = visa?.kind === 'work'
  if (answers.purpose === 'study' || (answers.purpose === 'work' && !working)) reasons.push('PURPOSE_NEEDS_VISA')
  if (visa) {
    if (leaving > visa.until) reasons.push('BEYOND_VISA')
  } else if (answers.days > ECOWAS_VISIT_DAYS) reasons.push('STAY_TOO_LONG')

  // The ticket home: claimed, and real; its date agreeing with the stay they describe. Someone
  // coming to work on a work visa has come to live: no ticket home is asked for.
  if (working) {
    // (nothing asked)
  } else if (!answers.returnTicket) reasons.push('NO_TICKET_OUT')
  else if (!facts.ticketOut) reasons.push('FALSE_TICKET')
  else if (Math.abs(daysBetween(leaving, facts.ticketOut)) > 3) reasons.push('TICKET_DOES_NOT_MATCH')

  // Where they will stay: a booking that exists, theirs, here, starting when they arrive.
  let paidDays = 0
  let daily = DAILY_FUNDS_USD
  if (answers.stay.kind === 'host') {
    // The officer calls the host: a number registered here, not the traveller's own, its owner
    // here now and with a phone to answer.
    if (!facts.host) reasons.push('HOST_UNKNOWN')
    else if (facts.host.self) reasons.push('HOST_IS_YOU')
    else if (!facts.host.here || !facts.host.phone) reasons.push('HOST_NOT_REACHED')
    else daily = DAILY_FUNDS_HOSTED_USD
  } else if (!facts.booking || facts.booking.reference !== answers.stay.reference) {
    reasons.push('FALSE_BOOKING')
  } else if (Math.abs(daysBetween(facts.arrival, facts.booking.from)) > 1) {
    reasons.push('BOOKING_DOES_NOT_MATCH')
  } else {
    paidDays = Math.min(answers.days, facts.booking.nights)
  }

  // The money: what they say they carry must be what they carry (a little either way is
  // forgiven), and enough for the days not already paid for.
  if (answers.fundsUsd > facts.fundsUsd * 1.1 + 10) reasons.push('FALSE_FUNDS')
  else if (!working && facts.fundsUsd < (answers.days - paidDays) * daily) reasons.push('NOT_ENOUGH_MONEY')

  if (reasons.length) return refuse()
  return { decision: 'admitted', category: 'ecowas_visitor', permittedUntil: leaving, reasons: [] }
}
