// One Africa Life: Monrovia as one town to walk (./src/games/oal/city/CityScene.tsx), against the
// development project. Out of the family's gate onto its road, along it; at the Sinkor junction
// where Tubman Boulevard (built by hand) meets the town made from the map.
// Run with: npm run on-dev -- e2e -- e2e/oal-city.spec.ts --headed (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(600_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
  await page.waitForTimeout(300)
}
const where = async (page: Page) => {
  const v = page.getByTestId('oal-street')
  return { x: Number(await v.getAttribute('data-x')), y: Number(await v.getAttribute('data-y')) }
}

test('out of the family gate, along the road; the Sinkor junction', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  const go = async (spot: object) => {
    // Off the town first (it keeps saving where the player stands while open).
    await page.goto('/lobby')
    await page.evaluate(([id, s]) => localStorage.setItem(`oal-spot:${id}`, s as string), [me!.id, JSON.stringify(spot)])
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await page.waitForTimeout(5000)
  }
  // Out of the family's gate.
  await go({ area: 'city', place: 'home' })
  const gate = await where(page)
  await shot(page, 'city1-gate')
  await expect(page.getByTestId('oal-place-open')).toHaveText('Go in at the gate')
  // Turned round (a drag), to see the road.
  const box = (await page.getByTestId('oal-street').boundingBox())!
  await page.mouse.move(box.width / 2, box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.width / 2 + 300, box.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  await shot(page, 'city2-road')
  await hold(page, 'ArrowUp', 6000)
  const after = await where(page)
  expect(Math.hypot(after.x - gate.x, after.y - gate.y)).toBeGreaterThan(2)
  await shot(page, 'city3-walked')
  // Where Tubman Boulevard is entered.
  await go({ area: 'sinkor', walking: true })
  await shot(page, 'city4-sinkor')
  await page.mouse.move(box.width / 2, box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.width / 2 + 600, box.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  await shot(page, 'city5-sinkor-back')
  expect(errors).toEqual([])
})
