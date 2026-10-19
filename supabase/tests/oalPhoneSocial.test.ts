import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life: texts between registered numbers, paid from airtime; mobile money on a
// registered SIM (cash in, cash out, send to a number in the same country, the network's fee);
// and the hub's safety rules: blocked pairs, banned accounts, a rate limit.

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
const give = (user: string, currency: string, cents: number) => db.rows(`select private.oal_money($1, $2, $3, 'adjustment')`, [user, currency, cents])
const money = async (user: string, currency: string) => Number((await db.rows<{ a: string }>(`select amount as a from public.oal_balances where user_id = $1 and currency = $2`, [user, currency]))[0]?.a ?? 0)
const home = (user: string, action: string, target: string, amount: number | null = null) => one(`select public.oal_home_action($1, $2, $3, $4) as r`, [user, action, target, amount])
const phone = (user: string, action: string, number: string | null, body: string | null, amount: number | null) => one(`select public.oal_phone_action($1, $2, $3, $4, $5) as r`, [user, action, number, body, amount])

/** A Liberian in Monrovia with a phone, a registered Citrus SIM and some airtime. */
async function withPhone(country = 'LR', town = 'Monrovia') {
  const user = await db.createUser(`soc${++n}@example.com`, { username: `soc${n}`, country_code: country, age_confirmed: true })
  await one(`select public.oal_start_life($1, 'Kollie Flomo', 'male', 30, $2, $3, $4) as r`, [user, country, town, JSON.stringify(defaultAppearance('male'))])
  const local = country === 'LR' ? 'LRD' : 'GHS'
  await give(user, local, 1000000)
  await home(user, 'buy_phone', country === 'LR' ? 'lr_basic' : 'gh_basic')
  const net = country === 'LR' ? 'lr_citrus' : 'gh_sika'
  await home(user, 'buy_sim', net)
  const number: string = (await home(user, 'register_sim', net)).number
  await home(user, 'top_up', net, 10000)
  return { user, number }
}

describe('texts', () => {
  it('a text to a registered number costs L$5 of airtime; written the local way too', async () => {
    const a = await withPhone()
    const b = await withPhone()
    expect(await phone(a.user, 'text', '0' + b.number.slice(4), 'Kollie, it is Musu. Call me.', null)).toEqual({ ok: true, airtime: 10000 - 500 })
    const inbox = await db.as('authenticated', b.user, () => db.rows<{ body: string; from_number: string }>(`select body, from_number from public.oal_texts`))
    expect(inbox).toEqual([{ body: 'Kollie, it is Musu. Call me.', from_number: a.number }])
    // Read by nobody else.
    const c = await withPhone()
    expect(await db.as('authenticated', c.user, () => db.rows(`select id from public.oal_texts`))).toEqual([])
  })

  it('no number, no phone, no airtime, too long: not sent and not charged', async () => {
    const a = await withPhone()
    expect(await phone(a.user, 'text', '+231770000000', 'Hello', null)).toEqual({ ok: false, code: 'NUMBER_NOT_FOUND' })
    expect(await phone(a.user, 'text', a.number, 'Me', null)).toEqual({ ok: false, code: 'OWN_NUMBER' })
    const b = await withPhone()
    expect(await phone(a.user, 'text', b.number, 'x'.repeat(161), null)).toEqual({ ok: false, code: 'BAD_TEXT' })
    await db.rows(`update public.oal_sims set airtime = 100 where user_id = $1`, [a.user])
    expect(await phone(a.user, 'text', b.number, 'Hello', null)).toEqual({ ok: false, code: 'NO_AIRTIME' })
  })

  it('the hub\'s rules hold: blocked, banned, and twenty a minute', async () => {
    const a = await withPhone()
    const b = await withPhone()
    await db.rows(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [b.user, a.user])
    expect(await phone(a.user, 'text', b.number, 'Hello', null)).toEqual({ ok: false, code: 'NOT_DELIVERED' })
    expect(await phone(a.user, 'send', b.number, null, 10000)).toEqual({ ok: false, code: 'NOT_DELIVERED' })
    const c = await withPhone()
    for (let i = 0; i < 18; i++) expect(await phone(c.user, 'text', a.number, `Message ${i}`, null)).toMatchObject({ ok: true })
    await db.rows(`update public.oal_sims set airtime = 100000 where user_id = $1`, [c.user])
    await phone(c.user, 'text', a.number, 'One more', null)
    await phone(c.user, 'text', a.number, 'And one', null)
    expect(await phone(c.user, 'text', a.number, 'Too many', null)).toEqual({ ok: false, code: 'SLOW_DOWN' })
    await db.rows(`update public.profile_private set is_banned = true where user_id = $1`, [c.user])
    expect(await phone(c.user, 'text', b.number, 'Hi', null)).toEqual({ ok: false, code: 'BANNED' })
  })
})

describe('mobile money', () => {
  it('cash in at an agent, send to a friend\'s number (1%, at least L$5), cash out', async () => {
    const a = await withPhone()
    const b = await withPhone()
    const cash = await money(a.user, 'LRD')
    expect(await phone(a.user, 'cash_in', null, null, 300000)).toEqual({ ok: true })
    expect(await money(a.user, 'LRD')).toBe(cash - 300000)
    expect(await money(a.user, 'LRM')).toBe(300000)
    expect(await phone(a.user, 'send', '0' + b.number.slice(4), null, 100000)).toEqual({ ok: true, fee: 1000, to: b.number })
    expect(await money(a.user, 'LRM')).toBe(300000 - 101000)
    expect(await money(b.user, 'LRM')).toBe(100000)
    // A small amount still pays the least fee.
    expect(await phone(b.user, 'cash_out', null, null, 10000)).toEqual({ ok: true, fee: 500 })
    expect(await money(b.user, 'LRM')).toBe(100000 - 10500)
    expect(await phone(b.user, 'cash_out', null, null, 1000000)).toEqual({ ok: false, code: 'NOT_ENOUGH_MONEY' })
  })

  it('money goes to numbers in the same country only', async () => {
    const a = await withPhone('LR', 'Monrovia')
    const ama = await withPhone('GH', 'Accra')
    await phone(a.user, 'cash_in', null, null, 100000)
    expect(await phone(a.user, 'send', ama.number, null, 10000)).toEqual({ ok: false, code: 'WRONG_COUNTRY' })
    // A text abroad is fine, at ten times the price.
    expect(await phone(a.user, 'text', ama.number, 'Akwaaba!', null)).toEqual({ ok: true, airtime: 10000 - 5000 })
  })
})
