import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { defaultAppearance } from '../functions/_shared/oal'
import { createTestDb, type TestDb } from './testDb'

// One Africa Life: the birth certificate at the Ministry of Health, step by step (the form at
// Window 1, the fee at the cashier, the receipt lodged, a text when ready, collected), and a new
// phone that works only once unboxed and charged at home.

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
  const user = await db.createUser(`doc${++n}@example.com`, { username: `doc${n}`, country_code: country, age_confirmed: true })
  expect(await one(`select public.oal_start_life($1, 'Musu Kollie', 'female', 26, $2, $3, $4) as r`, [user, country, town, JSON.stringify(defaultAppearance('female'))])).toEqual({ ok: true })
  return user
}
const office = (user: string, action: string, data: Json = {}) => one(`select public.oal_office_action($1, $2, $3) as r`, [user, action, JSON.stringify(data)])
const home = (user: string, action: string, target: string) => one(`select public.oal_home_action($1, $2, $3, null) as r`, [user, action, target])
const box = (user: string, action: string) => one(`select public.oal_phone_box_action($1, $2) as r`, [user, action])
const give = (user: string, currency: string, cents: number) => db.rows(`select private.oal_money($1, $2, $3, 'adjustment')`, [user, currency, cents])
const lrd = async (user: string) => Number((await db.rows<{ a: string }>(`select amount as a from public.oal_balances where user_id = $1 and currency = 'LRD'`, [user]))[0]?.a ?? 0)
const FORM = { father: 'Joseph Kollie', mother: 'Mary Kollie', witness: 'Old Ma Kebbeh', relation: 'grandmother' }

describe('the birth certificate', () => {
  it('form, cashier, receipt lodged, ready the next day with a text, collected', async () => {
    const musu = await live()
    await give(musu, 'LRD', 500000)
    // Nothing to pay or lodge before the form; a form needs its witness.
    expect(await office(musu, 'birth_pay')).toEqual({ ok: false, code: 'NOT_APPLIED' })
    expect(await office(musu, 'birth_apply', { ...FORM, witness: '' })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await office(musu, 'birth_apply', FORM)).toEqual({ ok: true, fee: 150000 })
    expect(await office(musu, 'birth_apply', FORM)).toEqual({ ok: false, code: 'ALREADY_APPLIED' })
    // Not lodged before it is paid.
    expect(await office(musu, 'birth_lodge')).toEqual({ ok: false, code: 'NOT_PAID' })
    const before = await lrd(musu)
    const paid = await office(musu, 'birth_pay')
    expect(paid.ok).toBe(true)
    expect(paid.receipt).toMatch(/^R\d{8}$/)
    expect(await lrd(musu)).toBe(before - 150000)
    expect(await office(musu, 'birth_pay')).toEqual({ ok: false, code: 'ALREADY_PAID' })
    expect(await office(musu, 'birth_collect')).toEqual({ ok: false, code: 'NOT_READY' })
    expect((await office(musu, 'birth_lodge')).ok).toBe(true)
    expect(await office(musu, 'birth_collect')).toEqual({ ok: false, code: 'NOT_READY' })
    // A registered SIM to be texted on.
    await home(musu, 'buy_sim', 'lr_starline')
    expect((await home(musu, 'register_sim', 'lr_starline')).ok).toBe(true)
    // A day later: ready, the text sent, collected once.
    await db.rows(`update public.oal_birth_certificates set applied_at = applied_at - interval '2 days', ready_at = ready_at - interval '2 days' where user_id = $1`, [musu])
    await db.rows(`select private.oal_office_notices()`)
    const texts = await db.rows<{ from_number: string; body: string }>(`select from_number, body from public.oal_texts where to_user = $1 order by id`, [musu])
    expect(texts.map((x) => x.from_number)).toEqual(['STARLINE', 'MOH LIBERIA'])
    expect(texts[1]!.body).toContain(paid.receipt)
    const got = await office(musu, 'birth_collect')
    expect(got.ok).toBe(true)
    expect(got.number).toMatch(/^MOH\/VS\/\d{4}\/\d{6}$/)
    expect(await office(musu, 'birth_collect')).toEqual({ ok: false, code: 'ALREADY_COLLECTED' })
  })

  it('a Ghanaian is not registered at the Liberian ministry', async () => {
    const ama = await live('GH', 'Accra')
    expect(await office(ama, 'birth_apply', FORM)).toEqual({ ok: false, code: 'NOT_HERE' })
  })
})

describe('a new phone', () => {
  it('comes boxed and flat; unboxed and charged at home, then it works', async () => {
    const musu = await live()
    await give(musu, 'LRD', 5000000)
    expect((await home(musu, 'buy_phone', 'lr_smart')).ok).toBe(true)
    expect(await db.rows(`select unboxed, charge from public.oal_phones where user_id = $1`, [musu])).toEqual([{ unboxed: false, charge: 'flat' }])
    expect(await box(musu, 'charge')).toEqual({ ok: false, code: 'STILL_BOXED' })
    expect(await box(musu, 'unbox')).toEqual({ ok: true })
    expect(await box(musu, 'unbox')).toEqual({ ok: false, code: 'ALREADY_UNBOXED' })
    expect((await box(musu, 'charge')).ok).toBe(true)
    expect(await box(musu, 'charge')).toEqual({ ok: false, code: 'ALREADY_CHARGED' })
    expect((await db.rows<{ r: boolean }>(`select private.oal_phone_ready($1) as r`, [musu]))[0]!.r).toBe(false)
    await db.rows(`update public.oal_phones set charged_at = charged_at - interval '2 hours' where user_id = $1`, [musu])
    expect((await db.rows<{ r: boolean }>(`select private.oal_phone_ready($1) as r`, [musu]))[0]!.r).toBe(true)
  })

  it('is unboxed only at home', async () => {
    const musu = await live()
    await give(musu, 'LRD', 5000000)
    await home(musu, 'buy_phone', 'lr_basic')
    await db.rows(`update public.oal_lives set place = 'Voinjama' where user_id = $1`, [musu])
    expect(await box(musu, 'unbox')).toEqual({ ok: false, code: 'NOT_AT_HOME' })
  })
})
