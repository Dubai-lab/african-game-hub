// One Africa Life: the body, against the development project. A hungry, tired life in Monrovia
// eats with family (free, once a day), buys a cookshop plate, sleeps eight hours at the family's
// house, and wakes rested. (The rules: supabase/tests/oalNeeds.test.ts.)
// Run with: npm run on-dev -- e2e -- e2e/oal-body.spec.ts
import { expect, test } from '@playwright/test'
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

test('hungry and tired: a meal with family, a cookshop plate, a night\'s sleep', async ({ page }) => {
  const account = TEST_ACCOUNTS[2]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Kollie Flomo', 'male', 30, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await setGameTime('2027-01-20 21:00')
  await runSql(`update public.oal_lives set hunger = 10, energy = 12, health = 90, needs_at = public.oal_game_time() where user_id = '${me!.id}'`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  await expect(page.getByTestId('oal-body')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('You are too tired to work: sleep first.')).toBeVisible()

  await page.getByTestId('oal-eat-family').click()
  await expect(page.getByTestId('oal-eat-family')).toHaveText('You ate with family today', { timeout: 20_000 })
  await page.getByTestId('oal-eat-out').click()
  await expect.poll(async () => Number(await page.getByTestId('oal-food').getAttribute('data-value')), { timeout: 20_000 }).toBeGreaterThanOrEqual(90)

  await page.getByLabel('Hours of sleep').selectOption('8')
  await page.getByTestId('oal-sleep').click()
  await expect(page.getByTestId('oal-resting')).toContainText('Asleep until', { timeout: 20_000 })
  await setGameTime('2027-01-21 05:10')
  await page.reload()
  await expect(page.getByTestId('oal-body')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => Number(await page.getByTestId('oal-rest').getAttribute('data-value')), { timeout: 20_000 }).toBeGreaterThanOrEqual(99)
  expect(errors).toEqual([])
})
