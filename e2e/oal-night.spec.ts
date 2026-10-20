// One Africa Life: Monrovia by night and at dusk (./src/games/oal/city/CityScene.tsx: the sky,
// the street lamps lit, the windows, the traffic lights), against the development project.
// Run with: npm run on-dev -- e2e -- e2e/oal-night.spec.ts --headed (SHOTS=<dir> for pictures)
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

test('Tubman Boulevard at night and at dusk', async ({ page }) => {
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
  for (const [hour, name] of [
    ['20.5', 'night'],
    ['18.6', 'dusk'],
  ] as const) {
    await page.goto('/lobby')
    await page.evaluate(
      ([id, h]) => {
        localStorage.setItem(`oal-spot:${id}`, JSON.stringify({ area: 'city', at: { x: 1094, y: -1370.6, f: 1.19 } }))
        localStorage.setItem('oal-city-hour', h!)
      },
      [me!.id, hour],
    )
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await page.waitForTimeout(7000)
    await shot(page, `${name}1`)
  }
  await page.evaluate(() => localStorage.removeItem('oal-city-hour'))
  expect(errors).toEqual([])
})
