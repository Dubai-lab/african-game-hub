import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life by road: from Monrovia's parking station to Voinjama by shared car (leaving
// within the hour, six to three) or the morning bus (boarding from an hour and a half before),
// the fare paid in cash; arrived after the hours of the road, in Voinjama, hungrier and tired;
// nothing else done while riding. And rides across town: a kekeh's fare, or walking for free.

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
const live = async () => {
  const user = await db.createUser(`road${++n}@example.com`, { username: `road${n}`, country_code: 'LR', age_confirmed: true })
  expect(await one(`select public.oal_start_life($1, 'Kollie Flomo', 'male', 30, 'LR', 'Monrovia', $2) as r`, [user, JSON.stringify(defaultAppearance('male'))])).toEqual({ ok: true })
  return user
}
const setGameTime = (at: string) =>
  db.pg.query(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from $1::timestamp at time zone 'UTC')) / 29)`, [at])
const road = (user: string, action: string, target: string) => one(`select public.oal_road_action($1, $2, $3) as r`, [user, action, target])
const give = (user: string, cents: number) => db.rows(`select private.oal_money($1, 'LRD', $2, 'adjustment')`, [user, cents])
const lrd = async (user: string) => Number((await db.rows<{ amount: string }>(`select amount from public.oal_balances where user_id = $1 and currency = 'LRD'`, [user]))[0]?.amount ?? 0)
const where = async (user: string) => (await db.rows<{ state: string; place: string }>(`select state, place from public.oal_lives where user_id = $1`, [user]))[0]!
const travel = async (user: string) => one(`select public.oal_travel_state($1) as r`, [user])

describe('up-country by road', () => {
  it('a shared car to Voinjama: paid at the station, an hour to fill, nine on the road, arrived', async () => {
    await setGameTime('2027-02-01 10:00')
    const user = await live()
    await give(user, 200000)
    const before = await lrd(user)
    expect(await road(user, 'ride', 'mon_voi_car')).toEqual({ ok: true, trip: expect.any(Number), departs: '2027-02-01 11:00', arrives: '2027-02-01 20:00' })
    expect(await lrd(user)).toBe(before - 400000)
    expect(await where(user)).toEqual({ state: 'on_road', place: 'Monrovia' })
    // Riding, nothing else.
    expect(await road(user, 'ride', 'mon_voi_bus')).toEqual({ ok: false, code: 'BUSY' })
    await setGameTime('2027-02-01 19:59')
    expect((await where(user)).state).toBe('on_road')
    await setGameTime('2027-02-01 20:30')
    await travel(user)
    expect(await where(user)).toEqual({ state: 'settled', place: 'Voinjama' })
    // Ten hours awake: hungrier and tired.
    expect((await travel(user)).body).toMatchObject({ food: expect.any(Number) })
    expect((await travel(user)).body.food).toBeLessThan(80)
  })

  it('no shared cars leave at night; the bus boards from an hour and a half before its seven o\'clock', async () => {
    await setGameTime('2027-02-02 16:30')
    const user = await live()
    await give(user, 200000)
    expect(await road(user, 'ride', 'mon_voi_car')).toEqual({ ok: false, code: 'NO_CARS_NOW' })
    await setGameTime('2027-02-03 05:00')
    expect(await road(user, 'ride', 'mon_voi_bus')).toEqual({ ok: false, code: 'BUS_NOT_BOARDING', departs: '2027-02-03 07:00' })
    await setGameTime('2027-02-03 06:00')
    expect(await road(user, 'ride', 'mon_voi_bus')).toEqual({ ok: true, trip: expect.any(Number), departs: '2027-02-03 07:00', arrives: '2027-02-03 19:00' })
  })

  it('a new life\'s L$3,000 does not pay a car\'s L$4,000; nor does a route from elsewhere go from here', async () => {
    await setGameTime('2027-02-04 09:00')
    const user = await live()
    expect(await road(user, 'ride', 'mon_voi_car')).toEqual({ ok: false, code: 'NOT_ENOUGH_MONEY' })
    expect(await road(user, 'ride', 'voi_mon_car')).toEqual({ ok: false, code: 'NOT_HERE' })
    expect(await where(user)).toEqual({ state: 'settled', place: 'Monrovia' })
    expect(await db.rows(`select * from public.oal_road_trips where user_id = $1`, [user])).toEqual([])
  })
})

describe('across town', () => {
  it('a kekeh costs L$100; walking costs nothing; a taxi out to the airport L$3,000', async () => {
    await setGameTime('2027-02-05 09:00')
    const user = await live()
    const before = await lrd(user)
    expect(await road(user, 'town', 'kekeh')).toEqual({ ok: true, fare: 10000 })
    expect(await road(user, 'town', 'walk')).toEqual({ ok: true, fare: 0 })
    expect(await lrd(user)).toBe(before - 10000)
    expect(await road(user, 'town', 'helicopter')).toEqual({ ok: false, code: 'BAD_REQUEST' })
    // Out to Roberts International by taxi: L$3,000, all a new life has left.
    expect(await road(user, 'town', 'airport')).toEqual({ ok: false, code: 'NOT_ENOUGH_MONEY' })
    await give(user, 10000)
    expect(await road(user, 'town', 'airport')).toEqual({ ok: true, fare: 300000 })
  })
})
