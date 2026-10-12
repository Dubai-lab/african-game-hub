// A player who joined before gender was asked for is asked once, the next time they open the
// app, and never again.
import { expect, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const account = TEST_ACCOUNTS[5]
const theirs = `(select id from auth.users where email = '${account.email}')`

test.beforeAll(ensureTestAccounts)
test.afterAll(async () => {
  await runSql(`update public.profiles set gender = '${account.gender}' where id = ${theirs}`)
})

test('an account with no gender is asked once after logging in, and the answer is kept', async ({ page }) => {
  await runSql(`update public.profiles set gender = null where id = ${theirs}`)
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()

  const prompt = page.getByRole('dialog', { name: 'One quick question' })
  await expect(prompt).toBeVisible({ timeout: 20_000 })
  // It cannot be put aside, and nothing is saved until a choice is made.
  await expect(prompt.getByRole('button', { name: 'Save' })).toBeDisabled()
  await prompt.getByText('Female', { exact: true }).click()
  await prompt.getByRole('button', { name: 'Save' }).click()
  await expect(prompt).toHaveCount(0, { timeout: 20_000 })
  expect(await runSql(`select gender from public.profiles where id = ${theirs}`)).toEqual([{ gender: 'female' }])

  // Never again: not after a reload, and the lobby is there to use.
  await page.reload()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('gender-prompt')).toHaveCount(0)
})
