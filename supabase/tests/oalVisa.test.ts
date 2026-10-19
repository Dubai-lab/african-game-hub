import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life's visa office: a long stay applied for with the fee and money shown, a work
// visa only with a job there, the answer in thirty game hours, no visa for one's own country,
// the visa among what the border officer sees, and work abroad only with a work visa.

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
  const user = await db.createUser(`visa${++n}@example.com`, { username: `visa${n}`, country_code: country, age_confirmed: true })
  expect(await one(`select public.oal_start_life($1, 'Kollie Flomo', 'male', 30, $2, $3, $4) as r`, [user, country, town, JSON.stringify(defaultAppearance('male'))])).toEqual({ ok: true })
  return user
}
const apply = (user: string, kind: string, target: string) => one(`select public.oal_apply($1, $2, $3) as r`, [user, kind, target])
const give = (user: string, currency: string, cents: number) => db.rows(`select private.oal_money($1, $2, $3, 'adjustment')`, [user, currency, cents])
const usd = async (user: string) => Number((await db.rows<{ a: string }>(`select amount as a from public.oal_balances where user_id = $1 and currency = 'USD'`, [user]))[0]?.a ?? 0)
// Days pass between these steps with nobody eating or sleeping; before each day's work the life
// is made fed and rested, as a player would.
const rested = (user: string) => db.rows(`update public.oal_lives set hunger = 100, energy = 100, health = 100, needs_at = public.oal_game_time() where user_id = $1`, [user])
const setGameTime = (at: string) =>
  db.pg.query(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from $1::timestamp at time zone 'UTC')) / 29)`, [at])
const settle = (user: string) => one(`select public.oal_travel_state($1) as r`, [user])

describe('a long-stay visa', () => {
  it('is paid for, wants money shown, and is issued thirty game hours later', async () => {
    await setGameTime('2026-12-01 09:00')
    const kollie = await live()
    expect(await apply(kollie, 'visa', 'GH:long_visit:6')).toEqual({ ok: false, code: 'NOT_ENOUGH_FUNDS_SHOWN' })
    await give(kollie, 'USD', 50000)
    expect(await apply(kollie, 'visa', 'GH:long_visit:6')).toMatchObject({ ok: true })
    expect(await apply(kollie, 'visa', 'GH:long_visit:6')).toEqual({ ok: false, code: 'ALREADY_APPLIED' })
    expect(await usd(kollie)).toBe(2000 + 50000 - 10000)
    await setGameTime('2026-12-02 14:00')
    await settle(kollie)
    expect(await db.rows(`select 1 from public.oal_visas where user_id = $1`, [kollie])).toEqual([])
    await setGameTime('2026-12-02 15:10')
    await settle(kollie)
    const [visa] = await db.rows<Json>(`select country, kind, number, issued_on::text as issued, valid_until::text as until from public.oal_visas where user_id = $1`, [kollie])
    expect(visa).toMatchObject({ country: 'GH', kind: 'long_visit', issued: '2026-12-02', until: '2027-06-02' })
    expect(visa!.number).toMatch(/^GV\d{7}$/)
  })

  it('a citizen needs no visa for home, and only 4 to 12 months are asked for', async () => {
    const kollie = await live()
    await give(kollie, 'USD', 100000)
    expect(await apply(kollie, 'visa', 'LR:long_visit:6')).toEqual({ ok: false, code: 'CITIZEN_NO_VISA' })
    expect(await apply(kollie, 'visa', 'GH:long_visit:2')).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await apply(kollie, 'visa', 'GH:student:6')).toEqual({ ok: false, code: 'BAD_REQUEST' })
  })
})

describe('a work visa, and work abroad', () => {
  it('needs a job there first (applied for from home); then the holder may work there, and no one else may', async () => {
    await setGameTime('2026-12-05 09:00')
    const kollie = await live()
    await give(kollie, 'USD', 100000)
    expect(await apply(kollie, 'visa', 'GH:work')).toEqual({ ok: false, code: 'NO_JOB_OFFER' })
    // An office job in Accra, applied for from Monrovia (six in ten are taken on).
    let hired = false
    for (let week = 0; week < 20 && !hired; week++) {
      const day = new Date(Date.UTC(2026, 11, 5 + week * 8)).toISOString().slice(0, 10)
      await setGameTime(`${day} 09:00`)
      await settle(kollie)
      await apply(kollie, 'job', 'osu_assistant')
      const next = new Date(Date.UTC(2026, 11, 6 + week * 8)).toISOString().slice(0, 10)
      await setGameTime(`${next} 09:30`)
      await settle(kollie)
      hired = (await db.rows(`select 1 from public.oal_employments where user_id = $1`, [kollie])).length > 0
    }
    expect(hired).toBe(true)

    // In Accra without a work visa: no work, not even at the market.
    await db.rows(`update public.oal_lives set place = 'Accra', country = 'GH' where user_id = $1`, [kollie])
    await setGameTime('2027-06-01 08:00')
    await give(kollie, 'GHS', 50000)
    await rested(kollie)
    expect(await one(`select public.oal_start_shift($1, 'makola_trader', 4, 10000) as r`, [kollie])).toEqual({ ok: false, code: 'NO_WORK_PERMIT' })
    // Applied for at the Immigration Service in Accra, then work.
    expect(await apply(kollie, 'visa', 'GH:work')).toMatchObject({ ok: true })
    await setGameTime('2027-06-02 15:00')
    await settle(kollie)
    const [visa] = await db.rows<Json>(`select kind, valid_until::text as until from public.oal_visas where user_id = $1`, [kollie])
    expect(visa).toEqual({ kind: 'work', until: '2028-06-02' })
    await setGameTime('2027-06-03 08:00')
    await rested(kollie)
    expect(await one(`select public.oal_start_shift($1, 'makola_trader', 4, 10000) as r`, [kollie])).toMatchObject({ ok: true })
  })

  it('a Ghanaian at home works without any visa', async () => {
    await setGameTime('2026-12-09 08:00')
    const ama = await live('GH', 'Accra')
    await rested(ama)
    expect(await one(`select public.oal_start_shift($1, 'makola_trader', 4, 10000) as r`, [ama])).toMatchObject({ ok: true })
  })
})

describe('at the border', () => {
  it('the officer sees the visa held for the country, valid on arrival', async () => {
    await setGameTime('2026-12-12 06:00')
    const kollie = await live()
    await give(kollie, 'USD', 200000)
    await apply(kollie, 'visa', 'GH:long_visit:6')
    await setGameTime('2026-12-14 06:00')
    await settle(kollie)
    const out = await one(`select public.oal_book_flight($1, 'CL301', '2026-12-14'::date) as r`, [kollie])
    await setGameTime('2026-12-14 08:00')
    await one(`select public.oal_board($1, $2) as r`, [kollie, out.ticket_id])
    await setGameTime('2026-12-14 12:00')
    const facts = (await one(`select public.oal_border_facts($1, null, null) as r`, [kollie])).facts
    expect(facts.visa).toMatchObject({ kind: 'long_visit', until: '2027-06-13' })
  })
})
