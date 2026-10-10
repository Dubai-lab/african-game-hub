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
  await expect(page.getByText(/Free to play in Rwanda for now\. These are free-play tokens: they have no cash value/)).toBeVisible()
  // No price is put on play tokens anywhere.
  await expect(page.getByText(/worth about/)).toHaveCount(0)

  // The lobby is the list of games and nothing else: chess, ludo, draughts and pool are live and lead
  // to their own pages; one game is coming soon and leads nowhere. No stakes or options here.
  for (const name of ['Chess', 'Ludo', 'Draughts', 'Pool']) await expect(page.getByRole('link', { name: new RegExp(`${name}.*Live now`) })).toBeVisible()
  await expect(page.getByText('Coming soon')).toHaveCount(1)
  await expect(page.getByRole('link', { name: /Penalty/ })).toHaveCount(0)
  await expect(page.getByTestId('game-penalty')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: 'Find match' })).toHaveCount(0)
  await expect(page.getByText('Stake')).toHaveCount(0)

  // Chess has its own home: its name on top, a way back to the games, the player's stats (one
  // rating for each pace), friends, past games, and one big Play button. No match setup yet.
  await page.getByTestId('game-chess').click()
  await expect(page).toHaveURL(/\/play\/chess$/)
  await expect(page.getByRole('heading', { name: 'Chess', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /All games/ })).toHaveAttribute('href', '/lobby')
  for (const pool of ['bullet', 'blitz', 'rapid']) await expect(page.getByTestId(`stat-${pool}`)).toContainText('1200')
  for (const heading of ['Stats', 'Friends', 'Game history']) await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  // Nothing else on this screen: tournaments, friends' games and the computer are behind Play.
  await expect(page.getByRole('link', { name: 'Tournaments' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Play the computer' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Find match' })).toHaveCount(0)
  // (Chess's own settings are one small link at the top.)
  await expect(page.getByRole('main').getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', '/play/chess/settings')

  // Play opens one column of choices: the time control and the stake (each opening from its
  // own row), Find match, then Tournaments, Play a friend and the computer.
  await page.getByTestId('game-play').click()
  await expect(page).toHaveURL(/\/play\/chess\/new$/)
  await expect(page.getByTestId('play-options-value')).toHaveText('Blitz · 5 min')
  await expect(page.getByTestId('play-stake-value')).toHaveText('Free')
  await expect(page.getByRole('radio')).toHaveCount(0)
  const order = await page.getByRole('main').locator('button:visible, a:visible').allTextContents()
  expect(order.map((text) => text.trim()).filter((text) => ['Find match', 'Tournaments', 'Play a friend', 'Play the computer', 'Play on this device'].includes(text))).toEqual([
    'Find match',
    'Tournaments',
    'Play a friend',
    'Play the computer',
    'Play on this device',
  ])
  await expect(page.getByRole('link', { name: 'Tournaments' })).toHaveAttribute('href', '/play/chess/tournaments')
  await expect(page.getByRole('link', { name: 'Play a friend' })).toHaveAttribute('href', '/play/chess/friend')
  await expect(page.getByRole('link', { name: 'Play the computer' })).toBeVisible()
  // The wallet is in view here, where the stake is chosen.
  await expect(page.getByTestId('balance-bonus')).toHaveText('1,000')

  // Stake: free by default; a staked level quotes the real payout (pot of 200 less the 10% fee).
  await page.getByTestId('play-stake-toggle').click()
  await expect(page.getByRole('radio', { name: 'Free' })).toBeChecked()
  await expect(page.getByText('A free game. No tokens at stake.')).toBeVisible()
  await page.getByText('100', { exact: true }).click()
  await expect(page.getByRole('radio', { name: '100', exact: true })).toBeChecked()
  await expect(page.getByText(/You stake 100 tokens\. The winner gets 180 \(10% fee\)/)).toBeVisible()
  await expect(page.getByTestId('play-stake-value')).toHaveText('100 tokens')

  // Time control: comes from the chess module, 5 minutes by default.
  await page.getByTestId('play-options-toggle').click()
  await expect(page.getByRole('radio', { name: '5 minutes each', exact: true })).toBeChecked()
  await page.getByText('3 | 2', { exact: true }).click()
  await expect(page.getByRole('radio', { name: '3 minutes each, plus 2 seconds per move' })).toBeChecked()

  // Choices survive a refresh (and so do the session and the page the player was on).
  await page.reload()
  await expect(page).toHaveURL(/\/play\/chess\/new$/)
  await expect(page.getByTestId('play-stake-value')).toHaveText('100 tokens')
  await expect(page.getByTestId('play-options-value')).toHaveText('Blitz · 3 | 2')

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
  await page.getByRole('link', { name: 'Play', exact: true }).click()
  await expect(page).toHaveURL(/\/lobby$/)

  // A game that does not exist, or is not open yet, has no setup page.
  await page.goto('/play/penalty')
  await expect(page.getByText('This game is not open yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Find match' })).toHaveCount(0)

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test('the lobby works in French', async ({ page }) => {
  await logIn(page)
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Language').selectOption('fr')
  await page.getByRole('link', { name: 'Jouer' }).click()
  await expect(page.getByRole('heading', { name: 'Jeux' })).toBeVisible()
  await page.getByRole('link', { name: /Échecs/ }).click()
  await expect(page.getByRole('heading', { name: 'Échecs', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Statistiques' })).toBeVisible()
  await page.getByTestId('game-play').click()
  await expect(page.getByRole('button', { name: 'Trouver une partie' })).toBeVisible()
  await page.getByTestId('play-options-toggle').click()
  await expect(page.getByText('Cadence')).toBeVisible()
  await page.getByRole('link', { name: 'Réglages' }).click()
  await page.getByLabel('Langue').selectOption('en')
})
