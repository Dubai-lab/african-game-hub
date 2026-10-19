// One Africa Life: a day's work, against the development project. A life in Monrovia takes
// L$2,000 of stock to Waterside Market, comes home with the day's takings, changes some of it
// for US dollars, and applies for a commercial licence to ride a kekeh.
// (The rules and chances are tested on the database: supabase/tests/oalWork.test.ts.)
// Run with: npm run on-dev -- e2e -- e2e/oal-work.spec.ts
import { expect, test } from '@playwright/test'
import { goTo } from './oalWorld.ts'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(240_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const APPEARANCE = {
  version: 1, sex: 'female', skin: 0.8,
  build: { weight: 0.2, muscle: 0, height: 0 },
  face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
  hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt',
}
const setGameTime = (at: string) =>
  runSql(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from '${at}'::timestamp at time zone 'UTC')) / 29)`)

test('a day at Waterside Market, the money changer, and a licence applied for', async ({ page }) => {
  const account = TEST_ACCOUNTS[2]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await setGameTime('2026-12-03 07:00')
  // Moving the clock weeks ahead would leave her starving: she starts the day fed and rested.
  await runSql(`update public.oal_lives set hunger = 100, energy = 100, health = 100, needs_at = public.oal_game_time() where user_id = '${me!.id}'`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  await goTo(page, 'jobs', 'jobs')
  await expect(page.getByTestId('oal-work')).toBeVisible({ timeout: 20_000 })

  // L$2,000 of stock, eight hours at the market.
  await page.getByTestId('oal-stock').fill('2000')
  await page.getByTestId('oal-job-waterside_trader').getByLabel('Hours').selectOption('8')
  await page.getByTestId('oal-start-waterside_trader').click()
  await expect(page.getByTestId('oal-at-work')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Selling at Waterside Market')).toBeVisible()

  // Closing time.
  await setGameTime('2026-12-03 15:10')
  await page.reload()
  await expect(page.getByTestId('oal-last-shift')).toContainText(/of your stock sold/, { timeout: 20_000 })
  const [shift] = await runSql<{ earned: number; status: string }>(`select earned, status from public.oal_shifts where user_id = '${me!.id}'`)
  expect(shift!.status).toBe('done')
  expect(Number(shift!.earned)).toBeGreaterThanOrEqual(200000)

  // L$1,000 for dollars at the changer on Tubman Boulevard.
  await goTo(page, 'sinkor', 'changer')
  await page.getByTestId('oal-change-amount').fill('1000')
  await page.getByTestId('oal-buy-usd').click()
  await expect(page.getByText(/You received US\$5/)).toBeVisible({ timeout: 20_000 })

  // A commercial licence, to ride a kekeh: applied for and paid (the fee given first: how the
  // market went is chance).
  await runSql(`select private.oal_money('${me!.id}', 'LRD', 300000, 'adjustment')`)
  await page.reload()
  await goTo(page, 'jobs', 'jobs')
  await expect(page.getByTestId('oal-apply-licence')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('oal-apply-licence').click()
  await expect(page.getByText(/Your licence will be ready/)).toBeVisible({ timeout: 20_000 })
  expect(errors).toEqual([])
})
