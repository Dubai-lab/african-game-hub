import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life's foundation: a life started once, with what a new life starts with; the
// game's money kept as entries that add up and are never changed; the clock; and nothing of it
// writable from the app.

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

const player = async () => db.createUser(`oal${++n}@example.com`, { username: `oal${n}`, country_code: 'LR', age_confirmed: true })
const start = async (user: string, age = 24, country = 'LR', town = 'Monrovia', appearance: Json = defaultAppearance('male')) =>
  (await db.rows<{ r: Json }>(`select public.oal_start_life($1, 'Kollie Flomo', $2, $3, $4, $5, $6) as r`, [user, appearance.sex, age, country, town, JSON.stringify(appearance)]))[0]!.r

describe('starting a life', () => {
  it('records the character once, born on the game calendar, with a little money', async () => {
    const user = await player()
    expect(await start(user)).toEqual({ ok: true })
    const [life] = await db.rows<Json>(`select game_name, sex, home_town, extract(year from age(public.oal_game_time()::date, born_on))::int as age from public.oal_lives where user_id = $1`, [user])
    expect(life).toMatchObject({ game_name: 'Kollie Flomo', sex: 'male', home_town: 'Monrovia', age: 24 })
    const money = await db.rows<{ currency: string; amount: number }>(`select currency, amount::int as amount from public.oal_balances where user_id = $1 order by currency`, [user])
    expect(money).toEqual([
      { currency: 'LRD', amount: 300000 },
      { currency: 'USD', amount: 2000 },
    ])
    expect(await start(user)).toEqual({ ok: false, code: 'ALREADY_LIVING' })
  })

  it('a Ghanaian life starts with cedis', async () => {
    const user = await player()
    expect(await start(user, 30, 'GH', 'Kumasi', defaultAppearance('female'))).toEqual({ ok: true })
    const money = await db.rows<{ currency: string }>(`select currency from public.oal_balances where user_id = $1 order by currency`, [user])
    expect(money.map((m) => m.currency)).toEqual(['GHS', 'USD'])
  })

  it('refuses a child, a town that is not in the country, and a character of the other sex', async () => {
    const user = await player()
    expect(await start(user, 16)).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect(await start(user, 24, 'LR', 'Accra')).toMatchObject({ ok: false, code: 'BAD_REQUEST' })
    expect((await db.rows<{ r: Json }>(`select public.oal_start_life($1, 'X Y', 'female', 24, 'LR', 'Monrovia', $2) as r`, [user, JSON.stringify(defaultAppearance('male'))]))[0]!.r).toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('the money', () => {
  it('entries are never changed or removed', async () => {
    const user = await player()
    await start(user)
    await expect(db.pg.query(`update public.oal_money_entries set amount = 999999 where user_id = $1`, [user])).rejects.toThrow(/FINAL/)
    await expect(db.pg.query(`delete from public.oal_money_entries where user_id = $1`, [user])).rejects.toThrow(/FINAL/)
  })
})

describe('the clock', () => {
  it('runs thirty times faster: a real day is thirty game days', async () => {
    const [row] = await db.rows<{ days: number }>(`select extract(epoch from public.oal_game_time('2026-10-19 00:00:00+00') - public.oal_game_time('2026-10-18 00:00:00+00')) / 86400 as days`)
    expect(Number(row!.days)).toBe(30)
  })
})

describe('nobody writes it from the app', () => {
  it('a player reads their own life and money, nobody else\'s, and changes nothing', async () => {
    const me = await player()
    const other = await player()
    await start(me)
    await start(other)
    const mine = await db.as('authenticated', me, () => db.rows(`select user_id from public.oal_lives`))
    expect(mine).toEqual([{ user_id: me }])
    await expect(db.as('authenticated', me, () => db.rows(`update public.oal_balances set amount = 99999999 where user_id = $1`, [me]))).rejects.toThrow()
    await expect(db.as('authenticated', me, () => db.rows(`insert into public.oal_money_entries (user_id, currency, amount, kind, balance_after, game_at) values ($1, 'USD', 100, 'gift', 100, now())`, [me]))).rejects.toThrow()
    await expect(db.as('authenticated', me, () => db.rows(`select public.oal_start_life($1, 'A B', 'male', 20, 'LR', 'Monrovia', '{}')`, [me]))).rejects.toThrow()
  })
})
