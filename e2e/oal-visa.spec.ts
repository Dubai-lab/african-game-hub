// One Africa Life: the visa office, against the development project. A Liberian with money
// applies for a six-month stay in Ghana, and has the visa an hour (thirty game hours) later;
// office jobs in Accra are there to apply for online.
// (The rules: supabase/tests/oalVisa.test.ts and src/games/oal/oalBorder.test.ts.)
// Run with: npm run on-dev -- e2e -- e2e/oal-visa.spec.ts
import { expect, test } from '@playwright/test'
import { goTo } from './oalWorld.ts'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(180_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const APPEARANCE = {
  version: 1, sex: 'male', skin: 0.75,
  build: { weight: 0, muscle: 0.2, height: 0.1 },
  face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
  hair: 'lowcut', hairColour: 'black', eyes: 'darkbrown', outfit: 'shirt_jeans',
}
const setGameTime = (at: string) =>
  runSql(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from '${at}'::timestamp at time zone 'UTC')) / 29)`)

test('a six-month visa for Ghana, applied for and issued', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Kollie Flomo', 'male', 30, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await runSql(`select private.oal_money('${me!.id}', 'USD', 60000, 'adjustment')`)
  await setGameTime('2026-12-15 09:00')

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  await goTo(page, 'jobs', 'jobs', 'walk')
  await expect(page.getByTestId('oal-jobs-abroad').getByText('Osu Trading, Accra')).toBeVisible({ timeout: 20_000 })
  await goTo(page, 'visa', 'visa')
  const office = page.getByTestId('oal-visa')
  await expect(office).toBeVisible({ timeout: 20_000 })

  await office.getByLabel('Months').selectOption('6')
  await page.getByTestId('oal-apply-long-visit').click()
  await expect(page.getByText('Applied. The answer comes in about an hour.')).toBeVisible({ timeout: 20_000 })
  await expect(office.getByText(/Your visa application will be answered/)).toBeVisible()

  await setGameTime('2026-12-16 15:30')
  await page.reload()
  await expect(page.getByTestId('oal-visa-held')).toHaveText(/^Long-stay visa for Ghana, GV\d{7}, valid until June 16, 2027\.$/, { timeout: 20_000 })
  expect(errors).toEqual([])
})
