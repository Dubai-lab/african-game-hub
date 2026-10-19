import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life's work: a trader's day at the market (stock bought with their own money, most
// of it sold at a markup), a kekeh rider's licence and day (the balance and fuel paid, fares
// earned), an office job applied for and paid at the month's end; the money changer; and work
// keeping a life from boarding a flight. The game's clock is moved by moving its start.

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
  const user = await db.createUser(`work${++n}@example.com`, { username: `work${n}`, country_code: 'LR', age_confirmed: true })
  expect(await one(`select public.oal_start_life($1, 'Kollie Flomo', 'male', 28, $2, $3, $4) as r`, [user, country, town, JSON.stringify(defaultAppearance('male'))])).toEqual({ ok: true })
  return user
}
// Days pass between these steps with nobody eating or sleeping; before each day's work the life
// is made fed and rested, as a player would.
const rested = (user: string) => db.rows(`update public.oal_lives set hunger = 100, energy = 100, health = 100, needs_at = public.oal_game_time() where user_id = $1`, [user])
const setGameTime = (at: string) =>
  db.pg.query(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from $1::timestamp at time zone 'UTC')) / 29)`, [at])
const money = async (user: string, currency: string) => Number((await db.rows<{ a: string }>(`select amount as a from public.oal_balances where user_id = $1 and currency = $2`, [user, currency]))[0]?.a ?? 0)
const give = (user: string, currency: string, cents: number) => db.rows(`select private.oal_money($1, $2, $3, 'adjustment')`, [user, currency, cents])
const start = (user: string, job: string, hours: number | null, stock: number | null) => one(`select public.oal_start_shift($1, $2, $3, $4) as r`, [user, job, hours, stock])
const state = (user: string) => one(`select public.oal_travel_state($1) as r`, [user])

describe('a market trader', () => {
  it('buys stock, pays the dues, and at closing has sold most of it at a markup', async () => {
    await setGameTime('2026-11-10 07:00')
    const user = await live()
    // L$3,000 to start: L$2,000 of stock and L$100 of dues.
    await rested(user)
    expect(await start(user, 'waterside_trader', 8, 200000)).toMatchObject({ ok: true })
    expect(await money(user, 'LRD')).toBe(300000 - 200000 - 10000)
    expect(await state(user)).toMatchObject({ state: 'working' })
    // A working life cannot go to work again, nor change money.
    await rested(user)
    expect(await start(user, 'waterside_trader', 8, 100000)).toEqual({ ok: false, code: 'BUSY' })
    await setGameTime('2026-11-10 15:10')
    expect(await state(user)).toMatchObject({ state: 'settled' })
    const [shift] = await db.rows<Json>(`select status, earned::int as earned, outcome from public.oal_shifts where user_id = $1`, [user])
    expect(shift!.status).toBe('done')
    // At least 70% sold at 25% or more, the rest at 90%: never a loss on the stock.
    expect(shift!.earned).toBeGreaterThanOrEqual(200000)
    expect(shift!.earned).toBeLessThanOrEqual(310000)
    expect(await money(user, 'LRD')).toBe(90000 + shift!.earned)
  })

  it('cannot trade outside market hours, in another town, or with stock it cannot afford', async () => {
    await setGameTime('2026-11-11 19:00')
    const user = await live()
    await rested(user)
    expect(await start(user, 'waterside_trader', 4, 100000)).toEqual({ ok: false, code: 'CLOSED' })
    await setGameTime('2026-11-12 07:00')
    await rested(user)
    expect(await start(user, 'makola_trader', 4, 6000)).toEqual({ ok: false, code: 'WRONG_TOWN' })
    await rested(user)
    expect(await start(user, 'waterside_trader', 4, 900000)).toEqual({ ok: false, code: 'NOT_ENOUGH_MONEY' })
    await rested(user)
    expect(await start(user, 'waterside_trader', 4, 50000)).toEqual({ ok: false, code: 'BAD_STOCK' })
  })

  it('a day ends at closing time however many hours were asked for', async () => {
    await setGameTime('2026-11-13 14:00')
    const user = await live()
    const shift = await start(user, 'waterside_trader', 10, 100000)
    expect(shift.ends_at).toBe('2026-11-13T18:00:00')
  })
})

describe('a kekeh rider', () => {
  it('needs a licence: paid for, ready in two days', async () => {
    await setGameTime('2026-11-14 07:00')
    const user = await live()
    await rested(user)
    expect(await start(user, 'monrovia_kekeh', 8, null)).toEqual({ ok: false, code: 'NO_LICENCE' })
    expect(await one(`select public.oal_apply($1, 'licence', 'LR') as r`, [user])).toMatchObject({ ok: true })
    expect(await one(`select public.oal_apply($1, 'licence', 'LR') as r`, [user])).toEqual({ ok: false, code: 'ALREADY_APPLIED' })
    expect(await money(user, 'LRD')).toBe(300000 - 250000)
    await setGameTime('2026-11-15 07:00')
    await state(user)
    expect(await db.rows(`select 1 from public.oal_licences where user_id = $1`, [user])).toEqual([])
    await setGameTime('2026-11-16 07:10')
    await state(user)
    const [licence] = await db.rows<Json>(`select number, (expires_on - issued_on) as days from public.oal_licences where user_id = $1`, [user])
    expect(licence!.number).toMatch(/^CL-\d{6}$/)
    expect(Number(licence!.days)).toBeGreaterThanOrEqual(365)
  })

  it('pays the day\'s balance and fuel, and earns fares through the hours', async () => {
    await setGameTime('2026-11-20 06:00')
    const user = await live()
    await give(user, 'LRD', 1000000)
    await one(`select public.oal_apply($1, 'licence', 'LR') as r`, [user])
    await setGameTime('2026-11-22 06:30')
    const before = await money(user, 'LRD')
    await rested(user)
    expect(await start(user, 'monrovia_kekeh', 12, null)).toMatchObject({ ok: true })
    expect(await money(user, 'LRD')).toBe(before - 250000 - 70000)
    await setGameTime('2026-11-22 18:40')
    await state(user)
    const [shift] = await db.rows<Json>(`select earned::int as earned, (outcome ->> 'passengers')::int as passengers from public.oal_shifts where user_id = $1`, [user])
    // Five to eleven passengers an hour for twelve hours, at L$50.
    expect(shift!.passengers).toBeGreaterThanOrEqual(60)
    expect(shift!.passengers).toBeLessThanOrEqual(132)
    expect(shift!.earned).toBe(shift!.passengers * 5000)
  })
})

describe('an office job', () => {
  it('is applied for, answered the next day, worked on weekdays from 08:30 at the latest, and paid at the month\'s end', async () => {
    await setGameTime('2026-11-02 09:00')
    const user = await live()
    let employed = false
    // Six in ten are taken on: keep applying (a week after each refusal) until hired.
    for (let week = 0; week < 20 && !employed; week++) {
      const day = new Date(Date.UTC(2026, 10, 2 + week * 8)).toISOString().slice(0, 10)
      await setGameTime(`${day} 09:00`)
      await state(user)
      await one(`select public.oal_apply($1, 'job', 'sinkor_clerk') as r`, [user])
      const next = new Date(Date.UTC(2026, 10, 3 + week * 8)).toISOString().slice(0, 10)
      await setGameTime(`${next} 09:30`)
      await state(user)
      employed = (await db.rows(`select 1 from public.oal_employments where user_id = $1`, [user])).length > 0
    }
    expect(employed).toBe(true)
    // A weekday in January 2027 (Monday the 25th): in by 08:30, out at 17:00.
    await setGameTime('2027-01-25 08:45')
    await rested(user)
    expect(await start(user, 'sinkor_clerk', null, null)).toEqual({ ok: false, code: 'TOO_LATE_FOR_WORK' })
    await setGameTime('2027-01-26 08:00')
    await rested(user)
    expect(await start(user, 'sinkor_clerk', null, null)).toMatchObject({ ok: true, ends_at: '2027-01-26T17:00:00' })
    await setGameTime('2027-01-26 17:05')
    await state(user)
    const usd = await money(user, 'USD')
    const [owed] = await db.rows<{ owed: number }>(`select owed::int as owed from public.oal_employments where user_id = $1`, [user])
    expect(owed!.owed).toBe(Math.floor(18000 / 22))
    // Saturday: no work.
    await setGameTime('2027-01-30 08:00')
    await rested(user)
    expect(await start(user, 'sinkor_clerk', null, null)).toEqual({ ok: false, code: 'WEEKEND' })
    // Pay day comes with the new month.
    await setGameTime('2027-02-01 09:00')
    await state(user)
    expect(await money(user, 'USD')).toBe(usd + Math.floor(18000 / 22))
  })
})

describe('the money changer, and work and travel', () => {
  it('changes local money for dollars and back, at a little less than the rate each way', async () => {
    await setGameTime('2026-11-25 10:00')
    const user = await live()
    expect(await one(`select public.oal_exchange($1, 'LRD', 190000) as r`, [user])).toEqual({ ok: true, currency: 'USD', received: Math.floor(190000 / (190 * 1.03)) })
    expect(await one(`select public.oal_exchange($1, 'USD', 1000) as r`, [user])).toEqual({ ok: true, currency: 'LRD', received: Math.floor(1000 * 190 * 0.97) })
    // Cedis are not changed in Liberia.
    expect(await one(`select public.oal_exchange($1, 'GHS', 1000) as r`, [user])).toEqual({ ok: false, code: 'BAD_REQUEST' })
  })

  it('a life at work cannot board its flight', async () => {
    await setGameTime('2026-11-26 06:00')
    const user = await live()
    await give(user, 'USD', 100000)
    const ticket = await one(`select public.oal_book_flight($1, 'CL301', '2026-11-26'::date) as r`, [user])
    await rested(user)
    expect(await start(user, 'waterside_trader', 6, 100000)).toMatchObject({ ok: true })
    await setGameTime('2026-11-26 08:00')
    expect(await one(`select public.oal_board($1, $2) as r`, [user, ticket.ticket_id])).toEqual({ ok: false, code: 'NOT_AT_AIRPORT_TOWN' })
  })

  it('nobody works from the app', async () => {
    const user = await live()
    await rested(user)
    await expect(db.as('authenticated', user, () => db.rows(`select public.oal_start_shift($1, 'waterside_trader', 4, 100000)`, [user]))).rejects.toThrow(/permission denied/)
    await expect(db.as('authenticated', user, () => db.rows(`update public.oal_employments set owed = 9999999`))).rejects.toThrow(/permission denied/)
    const jobs = await db.as('authenticated', user, () => db.rows(`select id from public.oal_jobs`))
    expect(jobs.length).toBe(9)
  })
})
