// A forgotten password: asking for the link, and choosing a new password from it.
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { requireDevelopmentProject, requireEnv } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

// The last of the test accounts, so a changed password never gets in the way of the game tests.
const account = TEST_ACCOUNTS[5]!
const NEW_PASSWORD = 'a-brand-new-password-42'

test.beforeAll(ensureTestAccounts)
// Put the usual password back, whatever happened.
test.afterAll(ensureTestAccounts)

test('the log-in page leads to "forgot your password", which answers the same for any email', async ({ page }) => {
  // The email itself is not sent in this test: the request is answered here.
  const asked: string[] = []
  await page.route('**/auth/v1/recover**', async (route) => {
    asked.push(route.request().postData() ?? '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/login')
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()

  await page.getByRole('button', { name: 'Send me the link' }).click()
  await expect(page.getByText('Enter a valid email address.')).toBeVisible()
  expect(asked).toHaveLength(0)

  await page.getByLabel('Email').fill('Someone.Unknown@Example.com')
  await page.getByRole('button', { name: 'Send me the link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  // The same words whether or not the address has an account.
  await expect(page.getByText('If someone.unknown@example.com has an account, a link to choose a new password is on its way.')).toBeVisible()
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('someone.unknown@example.com')
  // The link in the email is to come back to this site's own page.
  expect(decodeURIComponent(page.url())).not.toContain('token')
})

test('the link from the email lets the player choose a new password, which then works and the old one does not', async ({ page, browser }) => {
  requireDevelopmentProject('make a password-reset link')
  const admin = createClient(requireEnv('VITE_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const origin = new URL(page.url() === 'about:blank' ? (test.info().project.use.baseURL ?? 'http://localhost:5173') : page.url()).origin
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: account.email, options: { redirectTo: `${origin}/auth/reset` } })
  expect(error).toBeNull()

  // Opening the link, as from the email.
  await page.goto(data.properties!.action_link)
  await expect(page).toHaveURL(/\/auth\/reset/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible({ timeout: 20_000 })

  // Too short, then two that differ: neither is sent.
  await page.getByLabel('New password', { exact: true }).fill('short')
  await page.getByLabel('New password again').fill('short')
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('New password again').fill(`${NEW_PASSWORD}x`)
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByText('The two passwords are not the same.')).toBeVisible()

  await page.getByLabel('New password again').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByText('Your password has been changed.')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 15_000 })

  // On another device: the old password is refused, the new one lets the player in.
  const other = await browser.newContext({ locale: 'en-US' })
  const fresh = await other.newPage()
  await fresh.goto('/login')
  await fresh.getByLabel('Email').fill(account.email)
  await fresh.getByLabel('Password').fill(TEST_PASSWORD)
  await fresh.getByRole('button', { name: 'Log in' }).click()
  await expect(fresh.getByText('Wrong email or password.')).toBeVisible({ timeout: 15_000 })
  await fresh.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD)
  await fresh.getByRole('button', { name: 'Log in' }).click()
  await expect(fresh).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await other.close()
})

test('the new-password page is not open to someone who did not come by a link', async ({ page, browser }) => {
  // Signed out: told the link is no good, and offered a new one.
  await page.goto('/auth/reset')
  await expect(page.getByText('This link has been used already or is too old. Ask for a new one.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'Send me a new link' })).toBeVisible()

  // Signed in, but not from a link: sent to the lobby, with no way to change the password here.
  const context = await browser.newContext({ locale: 'en-US' })
  const signedIn = await context.newPage()
  await signedIn.goto('/login')
  await signedIn.getByLabel('Email').fill(TEST_ACCOUNTS[4]!.email)
  await signedIn.getByLabel('Password').fill(TEST_PASSWORD)
  await signedIn.getByRole('button', { name: 'Log in' }).click()
  await expect(signedIn).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await signedIn.goto('/auth/reset')
  await expect(signedIn).toHaveURL(/\/lobby$/, { timeout: 15_000 })
  await expect(signedIn.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0)
  await context.close()
})
