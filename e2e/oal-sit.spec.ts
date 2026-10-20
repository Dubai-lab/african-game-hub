// One Africa Life: sitting down, against the development project. In Starline Mobile's customer
// care (scripts/oal/makeHome.py), by a free waiting chair: sat down (the standing-to-sitting
// movement, then seated), stood up again.
// Run with: npm run on-dev -- e2e -- e2e/oal-sit.spec.ts --headed (SHOTS=<dir> for pictures)
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

test('sitting down on a waiting chair, and standing up', async ({ page }) => {
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
  // Straight into the office.
  await page.evaluate((id) => localStorage.setItem(`oal-spot:${id}`, JSON.stringify({ area: 'sinkor', place: 'starline' })), me!.id)
  await page.goto('/life')
  await expect(page.getByTestId('oal-home-view')).toHaveAttribute('data-kind', 'starline', { timeout: 120_000 })
  await page.waitForTimeout(3000)
  // To the free chair at the end of the front row (x -1.8, y -1.6): in front of it.
  await hold(page, 'ArrowUp', 1500)
  await hold(page, 'ArrowLeft', 1500)
  await page.getByTestId('oal-sit-down').click({ timeout: 10_000 })
  await page.waitForTimeout(1000)
  await shot(page, 'sit1-down')
  await page.waitForTimeout(2500)
  await shot(page, 'sit2-seated')
  // Seated: the stick does not move her.
  await hold(page, 'ArrowUp', 800)
  await expect(page.getByTestId('oal-stand-up')).toBeVisible()
  await page.getByTestId('oal-stand-up').click()
  await page.waitForTimeout(1000)
  await shot(page, 'sit3-up')
  await page.waitForTimeout(2500)
  await expect(page.getByTestId('oal-sit-down')).toBeVisible()
  await shot(page, 'sit4-standing')
  expect(errors).toEqual([])
})
