// One Africa Life: a home arranged (./src/games/oal/HomeDesign.tsx): a thing bought at Furniture
// City put in the family's house in front of the player, moved a step and turned, put there; the
// house's own living room furniture sold.
// Run with: npm run on-dev -- e2e -- e2e/oal-home-things.spec.ts --headed (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(1_200_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
test('a home arranged: a sofa put in the house, the old living room furniture sold', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => void d.accept())
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  // A blue sofa she bought (kept aside, at the house).
  await runSql(`insert into public.oal_things (user_id, item, paid) values ('${me!.id}', 'sofa', 52000)`)
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
  // In the living room, facing its middle (the house's own metres: x across, y from the front).
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { oalHome?: { toMap?: unknown } }).oalHome?.toMap)), { timeout: 60_000 }).toBe(true)
  const spot = await page.evaluate(() => {
    const h = (window as unknown as { oalHome: { toMap: (u: number, v: number) => [number, number]; yaw: number } }).oalHome
    const [x, y] = h.toMap(-3.2, -4.3)
    // (Facing up the house, +y: on the map the house's +y turned by its yaw; f with (sin f, -cos f).)
    return { x, y, f: h.yaw + Math.PI }
  })
  await page.goto('/lobby')
  await page.evaluate(([id, s]) => localStorage.setItem(`oal-spot:${id}`, s as string), [me!.id, JSON.stringify({ area: 'city', at: spot })])
  await page.goto('/life')
  await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
  await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
  await page.waitForTimeout(4000)
  console.log('HOME', JSON.stringify(spot), JSON.stringify(await page.evaluate(() => { const h = (window as unknown as { oalHome: { inside: boolean; at: number[]; facing: number } }).oalHome; return { inside: h.inside, at: h.at, facing: h.facing } })))
  await shot(page, 'home-0-spawn')
  await expect.poll(() => page.evaluate(() => (window as unknown as { oalHome?: { inside: boolean } }).oalHome?.inside), { timeout: 30_000 }).toBe(true)
  await page.waitForTimeout(2500)
  await shot(page, 'home-1-inside')
  await page.getByTestId('oal-arrange').click()
  // The house's own living room furniture sold first (to make room): gone, its money in.
  await page.getByTestId('oal-sell-piece-living').click()
  await expect.poll(async () => (await runSql(`select piece from public.oal_pieces_sold where user_id = '${me!.id}'`)).length, { timeout: 20_000 }).toBe(1)
  await page.waitForTimeout(1500)
  await shot(page, 'home-1-sold')
  // The blue sofa put in front of her, turned round, put there.
  await page.getByTestId('oal-thing-sofa').click()
  await page.getByTestId('oal-thing-here').click()
  await page.waitForTimeout(800)
  await shot(page, 'home-2-put')
  await page.getByTestId('oal-move-turn').click()
  await page.getByTestId('oal-move-turn').click()
  await page.getByTestId('oal-move-done').click()
  await expect.poll(async () => (await runSql<{ placed: boolean }>(`select placed from public.oal_things where user_id = '${me!.id}'`))[0]?.placed, { timeout: 20_000 }).toBe(true)
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Done' }).first().click()
  await page.waitForTimeout(1500)
  await shot(page, 'home-3-placed')
  const [usd] = await runSql<{ amount: string }>(`select amount from public.oal_balances where user_id = '${me!.id}' and currency = 'USD'`)
  expect(Number(usd!.amount)).toBe(2000 + 12000)
  expect(await runSql(`select * from public.oal_money_problems()`)).toEqual([])
  expect(errors).toEqual([])
})
