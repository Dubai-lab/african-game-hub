import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { type Answers, type BorderFacts, decide } from '../functions/_shared/oalBorder'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life: a phone, a SIM registered as the law asks (a Ghanaian with the Ghana Card, a
// foreigner or a Liberian with a passport), airtime, a room rented with the landlord's advance,
// and a host at the border found by calling their number.

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
const live = async (country = 'LR', town = 'Monrovia') => {
  const user = await db.createUser(`home${++n}@example.com`, { username: `home${n}`, country_code: country, age_confirmed: true })
  expect(await one(`select public.oal_start_life($1, 'Ama Mensah', 'female', 30, $2, $3, $4) as r`, [user, country, town, JSON.stringify(defaultAppearance('female'))])).toEqual({ ok: true })
  return user
}
const act = (user: string, action: string, target: string, amount: number | null = null) => one(`select public.oal_home_action($1, $2, $3, $4) as r`, [user, action, target, amount])
const give = (user: string, currency: string, cents: number) => db.rows(`select private.oal_money($1, $2, $3, 'adjustment')`, [user, currency, cents])
const setGameTime = (at: string) =>
  db.pg.query(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from $1::timestamp at time zone 'UTC')) / 29)`, [at])

describe('papers', () => {
  it('a Ghanaian life holds a Ghana Card; a Liberian one does not', async () => {
    const ama = await live('GH', 'Accra')
    const kollie = await live('LR', 'Monrovia')
    const cards = await db.rows<{ user_id: string; number: string }>(`select user_id, number from public.oal_id_cards where user_id in ($1, $2)`, [ama, kollie])
    expect(cards.map((c) => c.user_id)).toEqual([ama])
    expect(cards[0]!.number).toMatch(/^GHA-\d{9}-\d$/)
  })
})

describe('a phone and a SIM', () => {
  it('a SIM does nothing until registered: in Ghana, a Ghanaian with the Ghana Card, numbers in the network\'s prefixes', async () => {
    const ama = await live('GH', 'Accra')
    await give(ama, 'GHS', 50000)
    expect(await act(ama, 'buy_phone', 'gh_basic')).toEqual({ ok: true, kind: 'basic', handset: 'gh_basic' })
    expect(await act(ama, 'buy_sim', 'gh_sika')).toEqual({ ok: true })
    expect(await act(ama, 'buy_sim', 'gh_sika')).toEqual({ ok: false, code: 'ALREADY_HAVE_SIM' })
    expect(await act(ama, 'top_up', 'gh_sika', 1000)).toEqual({ ok: false, code: 'NOT_REGISTERED' })
    const reg = await act(ama, 'register_sim', 'gh_sika')
    expect(reg).toMatchObject({ ok: true, document: 'ghana_card' })
    expect(reg.number).toMatch(/^\+233(24|54|55|59)\d{7}$/)
    expect(await act(ama, 'register_sim', 'gh_sika')).toEqual({ ok: false, code: 'ALREADY_REGISTERED' })
    expect(await act(ama, 'top_up', 'gh_sika', 1000)).toEqual({ ok: true, airtime: 1000 })
    // Networks are bought where they are: no Liberian SIM in Accra.
    expect(await act(ama, 'buy_sim', 'lr_citrus')).toEqual({ ok: false, code: 'WRONG_COUNTRY' })
  })

  it('a Liberian registers with the passport, in Liberia and as a foreigner in Ghana', async () => {
    const kollie = await live('LR', 'Monrovia')
    await act(kollie, 'buy_sim', 'lr_citrus')
    expect(await act(kollie, 'register_sim', 'lr_citrus')).toMatchObject({ ok: true, document: 'passport', number: expect.stringMatching(/^\+231(77|78)\d{7}$/) })
    await db.rows(`update public.oal_lives set place = 'Accra', country = 'GH' where user_id = $1`, [kollie])
    await give(kollie, 'GHS', 1000)
    await act(kollie, 'buy_sim', 'gh_volta')
    expect(await act(kollie, 'register_sim', 'gh_volta')).toMatchObject({ ok: true, document: 'passport', number: expect.stringMatching(/^\+233(20|50)\d{7}$/) })
  })
})

describe('a room', () => {
  it('the landlord wants the advance: six months in Monrovia, in US dollars', async () => {
    await setGameTime('2026-12-01 10:00')
    const kollie = await live('LR', 'Monrovia')
    // $25 a month in Paynesville, six months: $150, far more than a new life has.
    expect(await act(kollie, 'rent', 'paynesville_single')).toEqual({ ok: false, code: 'NOT_ENOUGH_MONEY' })
    await give(kollie, 'USD', 20000)
    expect(await act(kollie, 'rent', 'paynesville_single')).toEqual({ ok: true, until: '2027-06-01' })
    expect(await act(kollie, 'rent', 'sinkor_single')).toEqual({ ok: false, code: 'ALREADY_RENTING' })
    expect(await act(kollie, 'rent', 'nima_single')).toEqual({ ok: false, code: 'WRONG_TOWN' })
    // Renewing adds the next six months on.
    await give(kollie, 'USD', 20000)
    expect(await act(kollie, 'rent', 'paynesville_single')).toEqual({ ok: true, until: '2027-12-01' })
  })
})

describe('a host at the border', () => {
  it('a Liberian staying with a Ghanaian friend in Accra: the officer calls the friend\'s registered number', async () => {
    await setGameTime('2026-12-10 06:00')
    const ama = await live('GH', 'Accra')
    await give(ama, 'GHS', 50000)
    await act(ama, 'buy_phone', 'gh_basic')
    await act(ama, 'buy_sim', 'gh_sika')
    const amaNumber: string = (await act(ama, 'register_sim', 'gh_sika')).number
    const kollie = await live('LR', 'Monrovia')
    await give(kollie, 'USD', 100000)
    const out = await one(`select public.oal_book_flight($1, 'CL301', '2026-12-10'::date) as r`, [kollie])
    await one(`select public.oal_book_flight($1, 'CL302', '2026-12-17'::date) as r`, [kollie])
    await setGameTime('2026-12-10 08:00')
    await one(`select public.oal_board($1, $2) as r`, [kollie, out.ticket_id])
    await setGameTime('2026-12-10 12:00')
    const ask = async (phone: string) => {
      const gathered = await one(`select public.oal_border_facts($1, null, $2) as r`, [kollie, phone])
      const answers: Answers = { purpose: 'visit_family', days: 7, stay: { kind: 'host', phone }, occupation: 'trader', returnTicket: true, fundsUsd: gathered.facts.fundsUsd }
      return { facts: gathered.facts as BorderFacts, decision: decide(gathered.facts, answers), trip: gathered.trip_id }
    }
    // A number nobody has; then the friend's, written the local way (0 and nine digits).
    expect((await ask('+233249999999')).decision.reasons).toEqual(['HOST_UNKNOWN'])
    const local = '0' + amaNumber.slice(4)
    const { facts, decision, trip } = await ask(local)
    expect(facts.host).toEqual({ self: false, here: true, phone: true })
    expect(decision).toMatchObject({ decision: 'admitted' })
    expect(await one(`select public.oal_border_record($1, $2, $3, $4, $5::date, null, $6) as r`, [kollie, trip, decision.category, decision.decision, decision.permittedUntil, decision.reasons])).toMatchObject({ ok: true, decision: 'admitted' })
  })
})

describe('nobody does it from the app', () => {
  it('a player reads their own SIMs and leases, and cannot buy or register from the app', async () => {
    const user = await live('GH', 'Kumasi')
    await expect(db.as('authenticated', user, () => db.rows(`select public.oal_home_action($1, 'buy_phone', 'gh_basic', null)`, [user]))).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', user, () => db.rows(`insert into public.oal_sims (user_id, network, bought_on) values ($1, 'gh_sika', '2026-12-01')`, [user]))).rejects.toThrow()
    const networks = await db.as('authenticated', user, () => db.rows(`select id from public.oal_networks`))
    expect(networks.length).toBe(5)
  })
})
