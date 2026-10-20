// One Africa Life: making a character and starting a life, against the development project.
// (That a second life is refused is tested on the database: supabase/tests/oal.test.ts.)
// Run with: npm run on-dev -- e2e -- e2e/oal.spec.ts
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(120_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const slide = (page: Page, label: string, value: number) =>
  page.getByLabel(label).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)

test('a player makes their character and starts a life in Voinjama', async ({ page }) => {
  const account = TEST_ACCOUNTS[2]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })

  await page.goto('/life')
  await expect(page.getByTestId('oal-creator')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Woman' }).click()
  await slide(page, 'Weight', 0.6)
  await page.getByRole('tab', { name: 'Face' }).click()
  await slide(page, 'Lips', 0.4)
  await page.getByRole('tab', { name: 'Hair' }).click()
  await page.getByRole('button', { name: 'Braids' }).click()
  await page.getByRole('tab', { name: 'You' }).click()
  await page.getByLabel('Your name in the game').fill('Musu Kollie')
  await page.getByRole('button', { name: 'Voinjama, Liberia' }).click()
  await page.getByTestId('oal-start').click()

  // In the game: at home, the clock, the body, the money over the world; who she is in the menu.
  await expect(page.getByTestId('oal-home-view')).toHaveAttribute('data-kind', 'house', { timeout: 30_000 })
  await expect(page.getByTestId('oal-hud-money')).toContainText('L$ 3,000')
  await page.getByTestId('oal-menu').click()
  await expect(page.getByText('Musu Kollie', { exact: true })).toBeVisible()
  await expect(page.getByTestId('oal-who')).toContainText('from Voinjama, Liberia')

  const [life] = await runSql<{ sex: string; home_town: string; hair: string; weight: number }>(
    `select l.sex, l.home_town, l.appearance ->> 'hair' as hair, (l.appearance -> 'build' ->> 'weight')::float as weight
       from public.oal_lives l join auth.users u on u.id = l.user_id where u.email = '${account.email}'`,
  )
  expect(life).toMatchObject({ sex: 'female', home_town: 'Voinjama', hair: 'braids', weight: 0.6 })
  expect(errors).toEqual([])
})
