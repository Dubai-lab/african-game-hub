import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life's body: food and rest falling with the hours (faster at work), sleep that
// restores them (half as well sleeping rough), health that falls while starving or exhausted
// (never below 10) and comes back at the clinic; meals at a cookshop, with family once a day, or
// cooked where there is a kitchen; no work too tired or unwell. And overstaying: a fine at the
// airport, and a refusal next time if it was long.

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
  const user = await db.createUser(`body${++n}@example.com`, { username: `body${n}`, country_code: country, age_confirmed: true })
  expect(await one(`select public.oal_start_life($1, 'Kollie Flomo', 'male', 30, $2, $3, $4) as r`, [user, country, town, JSON.stringify(defaultAppearance('male'))])).toEqual({ ok: true })
  return user
}
const setGameTime = (at: string) =>
  db.pg.query(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from $1::timestamp at time zone 'UTC')) / 29)`, [at])
const body = async (user: string) => (await one(`select public.oal_travel_state($1) as r`, [user])).body
const act = (user: string, action: string, hours: number | null = null) => one(`select public.oal_needs_action($1, $2, $3) as r`, [user, action, hours])
const give = (user: string, currency: string, cents: number) => db.rows(`select private.oal_money($1, $2, $3, 'adjustment')`, [user, currency, cents])

describe('the body', () => {
  it('a new life starts fed and rested; ten waking hours later it is hungrier and tired', async () => {
    await setGameTime('2027-01-04 08:00')
    const user = await live()
    expect(await body(user)).toMatchObject({ food: 80, rest: 80, health: 100 })
    await setGameTime('2027-01-04 18:00')
    expect(await body(user)).toMatchObject({ food: 40, rest: 20, health: 100 })
  })

  it('a day at work tires faster than a day awake', async () => {
    await setGameTime('2027-01-05 07:00')
    const user = await live()
    await one(`select public.oal_start_shift($1, 'waterside_trader', 6, 100000) as r`, [user])
    await setGameTime('2027-01-05 13:00')
    // Six hours at 9 an hour: 80 - 54.
    expect(await body(user)).toMatchObject({ rest: 26, food: 50 })
  })

  it('cannot start work too tired, nor unwell', async () => {
    await setGameTime('2027-01-06 06:00')
    const user = await live()
    await db.rows(`update public.oal_lives set energy = 10 where user_id = $1`, [user])
    expect(await one(`select public.oal_start_shift($1, 'waterside_trader', 6, 100000) as r`, [user])).toEqual({ ok: false, code: 'TOO_TIRED' })
    await db.rows(`update public.oal_lives set energy = 90, health = 25 where user_id = $1`, [user])
    expect(await one(`select public.oal_start_shift($1, 'waterside_trader', 6, 100000) as r`, [user])).toEqual({ ok: false, code: 'UNWELL' })
  })

  it('a night at the family\'s restores rest; a night rough restores half and costs health', async () => {
    await setGameTime('2027-01-07 22:00')
    const home = await live()
    await db.rows(`update public.oal_lives set energy = 10 where user_id = $1`, [home])
    expect(await act(home, 'sleep', 8)).toMatchObject({ ok: true, rough: false })
    expect(await act(home, 'eat_out')).toEqual({ ok: false, code: 'BUSY' })
    await setGameTime('2027-01-08 06:05')
    expect(await body(home)).toMatchObject({ rest: 100 })
    // In Accra, with no room, no family and no hotel: on a bench.
    const away = await live()
    await db.rows(`update public.oal_lives set place = 'Accra', country = 'GH', energy = 10 where user_id = $1`, [away])
    expect(await act(away, 'sleep', 8)).toMatchObject({ ok: true, rough: true })
    await setGameTime('2027-01-08 14:05')
    const b = await body(away)
    expect(b.rest).toBe(58)
    expect(b.health).toBeLessThan(100)
  })

  it('a long absence leaves a life weak, never below 10; the clinic makes it well', async () => {
    await setGameTime('2027-01-10 08:00')
    const user = await live()
    await setGameTime('2027-02-10 08:00')
    expect(await body(user)).toMatchObject({ food: 0, rest: 0, health: 10 })
    await give(user, 'LRD', 200000)
    expect(await act(user, 'clinic')).toMatchObject({ ok: true })
    await setGameTime('2027-02-10 11:05')
    expect((await body(user)).health).toBeGreaterThanOrEqual(85)
  })
})

describe('meals', () => {
  it('with family at home once a day; a cookshop plate anywhere; cooking only with a kitchen', async () => {
    await setGameTime('2027-01-12 12:00')
    const user = await live()
    await db.rows(`update public.oal_lives set hunger = 20 where user_id = $1`, [user])
    expect(await act(user, 'eat_family')).toEqual({ ok: true })
    expect(await act(user, 'eat_family')).toEqual({ ok: false, code: 'ALREADY_ATE_WITH_FAMILY' })
    expect((await body(user)).food).toBe(60)
    expect(await act(user, 'cook')).toEqual({ ok: true })
    expect(await act(user, 'eat_out')).toEqual({ ok: true })
    expect((await body(user)).food).toBe(100)
    // Abroad: no family, no kitchen.
    await db.rows(`update public.oal_lives set place = 'Accra', country = 'GH', hunger = 20 where user_id = $1`, [user])
    expect(await act(user, 'eat_family')).toEqual({ ok: false, code: 'NOT_AT_HOME' })
    expect(await act(user, 'cook')).toEqual({ ok: false, code: 'NO_KITCHEN' })
    await give(user, 'GHS', 10000)
    expect(await act(user, 'eat_out')).toEqual({ ok: true })
  })
})

describe('overstaying', () => {
  it('ten days past the date given: a US$100 fine at the airport before boarding, and remembered', async () => {
    await setGameTime('2027-03-01 06:00')
    const kollie = await live()
    await give(kollie, 'USD', 200000)
    const out = await one(`select public.oal_book_flight($1, 'CL301', '2027-03-01'::date) as r`, [kollie])
    await setGameTime('2027-03-01 08:00')
    await one(`select public.oal_board($1, $2) as r`, [kollie, out.ticket_id])
    await setGameTime('2027-03-01 12:00')
    const facts = (await one(`select public.oal_border_facts($1, null, null) as r`, [kollie])).facts
    await one(`select public.oal_border_record($1, $2, 'ecowas_visitor', 'admitted', '2027-03-08'::date, null, '{}') as r`, [kollie, (await one(`select public.oal_border_facts($1, null, null) as r`, [kollie])).trip_id])
    expect(facts.overstayedDays).toBe(0)
    await one(`select public.oal_leave_airport($1) as r`, [kollie])
    // Still in Accra on 18 March, ten days past the 8th.
    await setGameTime('2027-03-17 06:00')
    const home = await one(`select public.oal_book_flight($1, 'CL302', '2027-03-18'::date) as r`, [kollie])
    await setGameTime('2027-03-18 11:00')
    const before = Number((await db.rows<{ a: string }>(`select amount as a from public.oal_balances where user_id = $1 and currency = 'USD'`, [kollie]))[0]!.a)
    expect(await one(`select public.oal_board($1, $2) as r`, [kollie, home.ticket_id])).toMatchObject({ ok: true })
    const after = Number((await db.rows<{ a: string }>(`select amount as a from public.oal_balances where user_id = $1 and currency = 'USD'`, [kollie]))[0]!.a)
    expect(before - after).toBe(10000)
    expect(await db.rows(`select country, days from public.oal_overstays where user_id = $1`, [kollie])).toEqual([{ country: 'GH', days: 10 }])
  })

  it('a fine that cannot be paid: no boarding', async () => {
    await setGameTime('2027-04-01 06:00')
    const kollie = await live()
    await give(kollie, 'USD', 40000)
    const out = await one(`select public.oal_book_flight($1, 'CL301', '2027-04-01'::date) as r`, [kollie])
    await setGameTime('2027-04-01 08:00')
    await one(`select public.oal_board($1, $2) as r`, [kollie, out.ticket_id])
    await setGameTime('2027-04-01 12:00')
    await one(`select public.oal_border_record($1, $2, 'ecowas_visitor', 'admitted', '2027-04-03'::date, null, '{}') as r`, [kollie, (await one(`select public.oal_border_facts($1, null, null) as r`, [kollie])).trip_id])
    await one(`select public.oal_leave_airport($1) as r`, [kollie])
    await give(kollie, 'USD', 34500)
    const home = await one(`select public.oal_book_flight($1, 'KA715', '2027-05-01'::date) as r`, [kollie])
    await setGameTime('2027-05-01 04:00')
    // Twenty-eight days over: US$280, and nothing like it left.
    expect(await one(`select public.oal_board($1, $2) as r`, [kollie, home.ticket_id])).toMatchObject({ ok: false, code: 'OVERSTAY_FINE_UNPAID', days: 28 })
  })
})
