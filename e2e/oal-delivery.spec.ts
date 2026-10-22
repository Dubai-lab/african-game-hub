// One Africa Life: Furniture City delivers (./src/games/oal/city/Delivery.tsx): a sofa bought is on
// the store's truck; it drives from Tubman Boulevard to the family's house, pulls in by the gate,
// its men carry the carton in; the sofa is then home (the server's arrives_at cleared).
// Run with: npm run on-dev -- e2e -- e2e/oal-delivery.spec.ts --headed (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(1_200_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'male', skin: 0.7, build: { weight: 0.1, muscle: 0.2, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'lowcut', hairColour: 'black', eyes: 'darkbrown', outfit: 'tee_jeans' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
type D = { phase: string; left: number; carried: number; x: number; y: number; hurry: number }
const phase = (page: Page) => page.evaluate(() => (window as unknown as { oalDelivery?: D }).oalDelivery?.phase ?? 'none')

test('a delivery: the truck brings the sofa, its men carry it in', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Joseph Flomo', 'male', 28, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  // A sofa bought two minutes ago, on its way.
  await runSql(`insert into public.oal_things (user_id, item, paid, bought_at, arrives_at) values ('${me!.id}', 'sofa', 52000, now() - interval '2 minutes', now() + interval '6 minutes')`)
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.evaluate(([id]) => {
    localStorage.setItem(`oal-spot:${id}`, JSON.stringify({ area: 'city', place: 'home' }))
    localStorage.setItem('oal-city-hour', '13')
  }, [me!.id])
  await page.goto('/life')
  await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
  await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
  // On the verge before the house.
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { oalHome?: { toMap?: unknown } }).oalHome?.toMap)), { timeout: 60_000 }).toBe(true)
  const spot = await page.evaluate(() => {
    const h = (window as unknown as { oalHome: { toMap: (u: number, v: number) => [number, number]; yaw: number } }).oalHome
    // In the yard, by the house, looking down the path to the gate (the men come in through it).
    const [x, y] = h.toMap(-2.2, -10.5)
    const [ax, ay] = h.toMap(0, -14)
    return { x, y, f: Math.atan2(ax - x, -(ay - y)) }
  })
  await page.goto('/lobby')
  await page.evaluate(([id, s]) => localStorage.setItem(`oal-spot:${id}`, s as string), [me!.id, JSON.stringify({ area: 'city', at: spot })])
  await page.goto('/life')
  await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
  await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('driving')
  await page.evaluate(() => ((window as unknown as { oalDelivery: D }).oalDelivery.hurry = 3))
  // On its way: the sofa is not yet to be put anywhere.
  await shot(page, 'delivery-0-on-its-way')
  let last = ''
  await expect
    .poll(
      async () => {
        const d = await page.evaluate(() => (window as unknown as { oalDelivery: D }).oalDelivery)
        const s = `${d.phase} ${Math.round(d.x)},${Math.round(d.y)}`
        if (s !== last) console.log('TRUCK', s)
        last = s
        return d.phase
      },
      { timeout: 600_000, intervals: [3000] },
    )
    .toMatch(/parked|unloading/)
  await page.evaluate(() => ((window as unknown as { oalDelivery: D }).oalDelivery.hurry = 1))
  await page.waitForTimeout(2500)
  await shot(page, 'delivery-1-parked')
  await expect.poll(() => page.evaluate(() => (window as unknown as { oalDelivery: D }).oalDelivery.left), { timeout: 30_000 }).toBe(0)
  await page.waitForTimeout(3000)
  await shot(page, 'delivery-2-carrying')
  await page.waitForTimeout(5000)
  await shot(page, 'delivery-3-carrying')
  for (let i = 0; i < 14; i++) {
    console.log('MEN', JSON.stringify(await page.evaluate(() => { const d = (window as unknown as { oalDelivery: D & { men: unknown; told: string } }).oalDelivery; return { phase: d.phase, left: d.left, carried: d.carried, men: d.men, told: d.told } })))
    await page.waitForTimeout(4000)
    await shot(page, `delivery-m${i}`)
  }
  await expect.poll(async () => (await runSql<{ arrives_at: string | null }>(`select arrives_at from public.oal_things where user_id = '${me!.id}'`))[0]?.arrives_at, { timeout: 120_000 }).toBeNull()
  await expect.poll(() => phase(page), { timeout: 30_000 }).toBe('leaving')
  await page.waitForTimeout(3000)
  await shot(page, 'delivery-4-leaving')
  expect(errors).toEqual([])
})
