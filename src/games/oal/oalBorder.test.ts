import { describe, expect, it } from 'vitest'
import { type Answers, type BorderFacts, checkAnswers, decide } from '../../../supabase/functions/_shared/oalBorder'

// The immigration officer's rules: citizens always come home; an ECOWAS visitor comes for up to
// 90 days with a passport, a ticket out, somewhere real to stay and money enough, and anything
// they say that the game can check is checked.

const facts = (over: Partial<BorderFacts> = {}): BorderFacts => ({
  country: 'GH',
  nationality: 'LR',
  arrival: '2026-11-02',
  passport: { number: 'R1234567', expires: '2031-10-18' },
  ticketOut: '2026-11-12',
  booking: { reference: 'HB-7KQ2P9', from: '2026-11-02', nights: 10 },
  fundsUsd: 300,
  ...over,
})
const answers = (over: Partial<Answers> = {}): Answers => ({
  purpose: 'visit_family',
  days: 10,
  stay: { kind: 'hotel', reference: 'HB-7KQ2P9' },
  occupation: 'trader',
  returnTicket: true,
  fundsUsd: 300,
  ...over,
})

describe('the immigration officer', () => {
  it('lets a visitor with everything in order in, for the days they asked for', () => {
    expect(decide(facts(), answers())).toEqual({ decision: 'admitted', category: 'ecowas_visitor', permittedUntil: '2026-11-12', reasons: [] })
  })

  it('always lets a citizen home, even with no answers and no papers', () => {
    expect(decide(facts({ nationality: 'GH', passport: null, ticketOut: null }), null)).toMatchObject({ decision: 'admitted', category: 'citizen' })
  })

  it('refuses more than 90 days, or work and study, without a visa', () => {
    expect(decide(facts({ ticketOut: '2027-02-10' }), answers({ days: 100 })).reasons).toContain('STAY_TOO_LONG')
    expect(decide(facts(), answers({ purpose: 'work' })).reasons).toEqual(['PURPOSE_NEEDS_VISA'])
    expect(decide(facts(), answers({ purpose: 'study' })).reasons).toEqual(['PURPOSE_NEEDS_VISA'])
  })

  it('wants a ticket out, catches a claimed one that does not exist, and one that does not match the stay', () => {
    expect(decide(facts(), answers({ returnTicket: false })).reasons).toEqual(['NO_TICKET_OUT'])
    expect(decide(facts({ ticketOut: null }), answers()).reasons).toEqual(['FALSE_TICKET'])
    expect(decide(facts({ ticketOut: '2026-12-20' }), answers()).reasons).toEqual(['TICKET_DOES_NOT_MATCH'])
    // A few days either way is how real trips are.
    expect(decide(facts({ ticketOut: '2026-11-14' }), answers()).decision).toBe('admitted')
  })

  it('checks the hotel booking: it must exist, be theirs, and start when they arrive', () => {
    expect(decide(facts({ booking: null }), answers()).reasons).toEqual(['FALSE_BOOKING'])
    expect(decide(facts(), answers({ stay: { kind: 'hotel', reference: 'HB-AAAAAA' } })).reasons).toEqual(['FALSE_BOOKING'])
    expect(decide(facts({ booking: { reference: 'HB-7KQ2P9', from: '2026-11-20', nights: 3 } }), answers()).reasons).toEqual(['BOOKING_DOES_NOT_MATCH'])
  })

  it('cannot check a host yet (phones come later), so does not accept one', () => {
    expect(decide(facts(), answers({ stay: { kind: 'host', phone: '+233 24 123 4567' } })).reasons).toEqual(['HOST_NOT_AVAILABLE'])
  })

  it('catches a lie about money, and wants enough for the days not paid for', () => {
    expect(decide(facts({ fundsUsd: 40 }), answers({ fundsUsd: 500 })).reasons).toEqual(['FALSE_FUNDS'])
    // Ten nights paid, five more days at $25 a day: $125 needed, $100 carried.
    expect(decide(facts({ fundsUsd: 100, ticketOut: '2026-11-17' }), answers({ days: 15, fundsUsd: 100 })).reasons).toEqual(['NOT_ENOUGH_MONEY'])
  })

  it('refuses without a passport, or with one that ends before the stay does', () => {
    expect(decide(facts({ passport: null }), answers()).reasons).toEqual(['NO_PASSPORT'])
    expect(decide(facts({ passport: { number: 'R1', expires: '2026-11-05' } }), answers()).reasons).toEqual(['PASSPORT_EXPIRED'])
  })
})

describe('the answers', () => {
  it('accepts only what the questions allow', () => {
    expect(checkAnswers(answers({ stay: { kind: 'hotel', reference: ' hb-7kq2p9 ' } }))).toMatchObject({ stay: { reference: 'HB-7KQ2P9' } })
    expect(checkAnswers({ ...answers(), purpose: 'smuggling' })).toBeNull()
    expect(checkAnswers({ ...answers(), days: 0 })).toBeNull()
    expect(checkAnswers({ ...answers(), days: 2.5 })).toBeNull()
    expect(checkAnswers({ ...answers(), stay: { kind: 'hotel', reference: "x'; drop" } })).toBeNull()
    expect(checkAnswers(null)).toBeNull()
  })
})
