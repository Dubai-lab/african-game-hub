// One Africa Life: a business walked into in Monrovia, its inside in its own building (J.B. Chop
// Bar, Paynesville): seen through its door from the street, walked in (still the town: nothing
// loaded), its counter, walked out onto its street again.
// Run with: npm run on-dev -- e2e -- e2e/oal-walk-in.spec.ts --headed (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(1_500_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
test('a shop: in at its door, out of it again onto its street', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  // J.B. Chop Bar, Paynesville.
  const door = [10986.649, -1442.883]
  const face = [0.96504, -0.26211]
  await page.evaluate(([id, sp]) => {
    localStorage.setItem(`oal-spot:${id}`, sp as string)
    localStorage.setItem('oal-city-hour', '13')
  }, [me!.id, JSON.stringify({ area: 'city', at: { x: door[0]! - face[0]! * 1.5, y: door[1]! - face[1]! * 1.5, f: Math.atan2(face[0]!, -face[1]!) } })])
  await page.goto('/life')
  await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
  await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
  await page.waitForTimeout(8000)
  await shot(page, 'shop-1-before')
  // In through its door: still the town (nothing loaded, no other place), inside the shop.
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(3600)
  await page.keyboard.up('ArrowUp')
  await expect(page.getByTestId('oal-street')).toBeVisible()
  await page.waitForTimeout(1500)
  await shot(page, 'shop-2-inside')
  // Further in, to the counter.
  await page.keyboard.down('ArrowUp')
  for (let i = 0; i < 30 && !(await page.getByTestId('oal-place-open').isVisible()); i++) await page.waitForTimeout(200)
  await page.keyboard.up('ArrowUp')
  await shot(page, 'shop-3-counter')
  // Out again: turned round (half a turn of the camera), walked out of the door.
  await page.keyboard.down('ArrowDown')
  await page.waitForTimeout(5000)
  await page.keyboard.up('ArrowDown')
  await page.waitForTimeout(1000)
  await shot(page, 'shop-4-back-out')
})
