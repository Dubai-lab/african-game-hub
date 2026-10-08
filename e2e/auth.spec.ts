import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

process.loadEnvFile('.env.local')

const url = process.env.VITE_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

test('landing shows instantly and leads to signup, with validation and French', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your move.')

  await page.getByRole('link', { name: 'Play chess free' }).click()
  await expect(page).toHaveURL(/\/signup$/)

  // The country list comes from the live database.
  const country = page.getByLabel('Country')
  await expect(country.locator('option')).toHaveCount(55)
  await expect(country.locator('option[value="RW"]')).toHaveText(/Rwanda/)

  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Use 3 to 20 characters.')).toBeVisible()
  await expect(page.getByText('Select your country.')).toBeVisible()
  await expect(page.getByText('Enter a valid email address.')).toBeVisible()
  await expect(page.getByText('You must be 18 or older to play.')).toBeVisible()

  await page.getByLabel('Language').selectOption('fr')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Créez votre compte')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
})

test('signup refuses a username that is already taken, without creating an account', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('Username').fill('E2E_Player')
  await page.getByLabel('Country').selectOption('RW')
  await page.getByLabel('Email').fill('someone-new@example.com')
  await page.getByLabel('Password').fill('long-enough-password')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('This username is taken. Try another one.')).toBeVisible()
  await expect(page).toHaveURL(/\/signup$/)
})

test('a signed-out visitor is sent from a protected page to login', async ({ page }) => {
  await page.goto('/lobby')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

test('wrong password shows a toast and stays on login', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('nobody-here@example.com')
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('alert')).toHaveText(/Wrong email or password/)
  await expect(page).toHaveURL(/\/login$/)
})

test.describe('with a confirmed account', () => {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  // One fixed test account, reused on every run: accounts own ledger rows, so they are never deleted.
  const email = 'e2e-player@example.com'
  const password = TEST_PASSWORD

  test.beforeAll(async () => {
    // Created already confirmed through the admin API, so no email is sent.
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: 'e2e_player', age_confirmed: true },
    })
    if (error && error.code !== 'email_exists') throw error
  })

  test('login returns to the page asked for, survives refresh, and logout works', async ({ page }) => {
    await page.goto('/lobby')
    await expect(page).toHaveURL(/\/login$/)

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page).toHaveURL(/\/lobby$/)
    await expect(page.getByTestId('balance-bonus')).toBeVisible()

    // Refresh: the session is restored and the login page never appears.
    let sawLogin = false
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url().includes('/login')) sawLogin = true
    })
    await page.reload()
    await expect(page.getByTestId('balance-bonus')).toBeVisible()
    expect(sawLogin).toBe(false)

    // A signed-in player opening /login is sent straight on.
    await page.goto('/login')
    await expect(page).toHaveURL(/\/lobby$/)

    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/lobby')
    await expect(page).toHaveURL(/\/login$/)
  })
})
