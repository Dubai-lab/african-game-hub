// One Africa Life: a ride in Monrovia (./src/games/oal/city/), against the development project.
// On Tubman Boulevard: a taxi waved down, pulls in; the driver told the Ministry of Health and
// paid; driven there by the roads (faster); out by the Ministry's gate.
// Run with: npm run on-dev -- e2e -- e2e/oal-ride.spec.ts --headed (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(900_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}

test('a taxi waved down on Tubman Boulevard, to the Ministry of Health', async ({ page }) => {
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
  await page.evaluate((id) => localStorage.setItem(`oal-spot:${id}`, JSON.stringify({ area: 'city', at: { x: 1094, y: -1370.6, f: 1.19 } })), me!.id)
  await page.goto('/life')
  await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
  await page.waitForTimeout(4000)
  await page.getByTestId('oal-hail-taxi').click({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  await shot(page, 'ride1-waving')
  await expect(page.getByTestId('oal-ride-where')).toBeVisible({ timeout: 60_000 })
  await shot(page, 'ride2-pulled-in')
  await page.getByTestId('oal-ride-to-health').click()
  await expect(page.getByTestId('oal-riding')).toBeVisible({ timeout: 20_000 })
  const [paid] = await runSql<{ amount: number }>(`select amount from public.oal_money_entries where user_id = '${me!.id}' and kind = 'transport'`)
  expect(Number(paid!.amount)).toBe(-15000)
  await page.waitForTimeout(3000)
  await shot(page, 'ride3-riding')
  await page.getByTestId('oal-ride-fast').click()
  await page.waitForTimeout(8000)
  await shot(page, 'ride4-on-the-way')
  await expect(page.getByTestId('oal-ride-out')).toBeVisible({ timeout: 400_000 })
  await shot(page, 'ride5-arrived')
  await page.getByTestId('oal-ride-out').click()
  await page.waitForTimeout(2500)
  await shot(page, 'ride6-out')
  // Out by the Ministry: a short walk from its gate.
  const v = page.getByTestId('oal-street')
  const x = Number(await v.getAttribute('data-x'))
  const y = Number(await v.getAttribute('data-y'))
  expect(Math.hypot(x - 3430, y + 2783)).toBeLessThan(150)
  expect(errors).toEqual([])
})
