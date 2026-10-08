import { expect, type Page, test } from '@playwright/test'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

// The fixed test account: confirmed, from Rwanda, reset to the 1,000 signup bonus before these tests.
const email = TEST_ACCOUNTS[0].email
const password = TEST_PASSWORD

test.beforeAll(async () => {
  await ensureTestAccounts()
  await resetTestAccounts()
})

async function logIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/)
}

test('lobby shows the wallet, the games registry, and remembers the player’s choices', async ({ page }) => {
  await logIn(page)

  // Wallet: bonus and cash shown separately, straight from the database.
  await expect(page.getByTestId('balance-bonus')).toHaveText('1,000')
  await expect(page.getByTestId('balance-cash')).toHaveText('0')
  // Real money is off in Rwanda and the lobby says so, with the local reference value.
  await expect(page.getByText(/In Rwanda, tokens are for play only for now/)).toBeVisible()
  await expect(page.getByText(/1,000 tokens are worth about RWF\s?739/)).toBeVisible()

  // Games registry: chess, ludo and pool are live (chess selected), two games are coming soon and cannot be chosen.
  await expect(page.getByRole('radio', { name: /Chess/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: /Ludo/ })).toHaveCount(1)
  await expect(page.getByRole('radio', { name: /Pool/ })).toHaveCount(1)
  await expect(page.getByText('Coming soon')).toHaveCount(2)
  await expect(page.getByRole('radio', { name: /Draughts/ })).toHaveCount(0)

  // Stake: free by default; a staked level quotes the real payout (pot of 200 less the 10% fee).
  await expect(page.getByRole('radio', { name: 'Free' })).toBeChecked()
  await expect(page.getByText('A free game. No tokens at stake.')).toBeVisible()
  await page.getByText('100', { exact: true }).click()
  await expect(page.getByRole('radio', { name: '100', exact: true })).toBeChecked()
  await expect(page.getByText(/You stake 100 tokens\. The winner gets 180 \(10% fee\)/)).toBeVisible()

  // Time control: comes from the chess module, 5 minutes by default.
  await expect(page.getByRole('radio', { name: '5 minutes each', exact: true })).toBeChecked()
  await page.getByText('3 | 2', { exact: true }).click()
  await expect(page.getByRole('radio', { name: '3 minutes each, plus 2 seconds per move' })).toBeChecked()

  // Choices survive a refresh (and so does the session).
  await page.reload()
  await expect(page.getByRole('radio', { name: '100', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: '3 minutes each, plus 2 seconds per move' })).toBeChecked()

  // Find match starts a real search; with nobody else looking it waits, and Cancel stops it.
  await page.getByRole('button', { name: 'Find match' }).click()
  await expect(page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await expect(page.getByText('Chess · 100 tokens')).toBeVisible()
  // Waiting costs nothing: the stake is only taken when a match is made.
  await expect(page.getByTestId('balance-bonus')).toHaveText('1,000')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Find match' })).toBeVisible()

  // The wallet page lists the ledger itself.
  await page.getByRole('link', { name: 'Wallet' }).click()
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible()
  await expect(page.getByTestId('ledger').getByRole('listitem').last()).toBeVisible()
  await page.getByRole('link', { name: 'Play' }).click()

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test('the lobby works in French', async ({ page }) => {
  await logIn(page)
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Language').selectOption('fr')
  await page.getByRole('link', { name: 'Jouer' }).click()
  await expect(page.getByRole('button', { name: 'Trouver une partie' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Échecs/ })).toBeChecked()
  await expect(page.getByText('Cadence')).toBeVisible()
  await page.getByRole('link', { name: 'Réglages' }).click()
  await page.getByLabel('Langue').selectOption('en')
})
