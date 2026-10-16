// Oware between two real browsers and two real accounts, through the hosted project.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(120_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { context: BrowserContext; page: Page }

async function signedIn(browser: Browser, email: string, stake?: string): Promise<Seat> {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-oware')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('game-oware').click()
  await page.getByTestId('game-play').click()
  await page.getByTestId('play-stake-toggle').click()
  if (stake) await page.getByRole('radio', { name: stake, exact: true }).check({ force: true })
  await expect(page.getByRole('button', { name: 'Find match' })).toBeVisible()
  return { context, page }
}

const pit = (page: Page, n: number) => page.locator(`[data-pit="${n}"]`)
const moves = (page: Page) => page.getByRole('list', { name: 'Moves' }).getByRole('button')

/** Both players tap Find match; returns them as [south, north] once they are at the board. */
async function startGame(one: Seat, two: Seat): Promise<[Page, Page]> {
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/oware\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByTestId('oware-board')).toBeVisible()
  }
  expect(one.page.url()).toBe(two.page.url())
  // Each player's own row is the near one.
  const oneIsSouth = (await one.page.getByTestId('oware-board').getAttribute('data-near')) === 's'
  expect(await two.page.getByTestId('oware-board').getAttribute('data-near')).toBe(oneIsSouth ? 'n' : 's')
  return oneIsSouth ? [one.page, two.page] : [two.page, one.page]
}

test('two players play Oware: moves cross, only the mover’s pits can be played, a refresh loses nothing, resigning ends it', async ({ browser }) => {
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email)
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email)
  const errors: string[] = []
  for (const { page } of [one, two]) page.on('pageerror', (error) => errors.push(error.message))

  const [south, north] = await startGame(one, two)
  await expect(south.getByTestId('player-n')).toContainText('1200')
  await expect(south.getByTestId('clock-s')).toHaveText('5:00')
  await expect(south.getByText(/Make your first move/)).toBeVisible()

  // South moves first: South's six pits are on offer to South, nothing to North.
  await expect(south.locator('[data-playable="true"]')).toHaveCount(6)
  await expect(north.locator('[data-playable="true"]')).toHaveCount(0)
  await expect(pit(north, 6)).toBeDisabled()

  // 1. c: four seeds from South's third pit, sown into the next four.
  await pit(south, 2).click()
  await expect(pit(south, 2)).toHaveAttribute('data-seeds', '0')
  await expect(pit(north, 6)).toHaveAttribute('data-seeds', '5', { timeout: 15_000 })
  await expect(north.locator('[data-playable="true"]')).toHaveCount(6)

  // 1... C, then 2. a. Both screens tell the same story.
  await pit(north, 8).click()
  await expect(pit(south, 0)).toHaveAttribute('data-seeds', '5', { timeout: 15_000 })
  await pit(south, 0).click()
  await expect(moves(north)).toHaveText(['c', 'C', 'a'], { timeout: 15_000 })
  await expect(moves(south)).toHaveText(['c', 'C', 'a'])

  // The clocks are running now, and only the mover's.
  await expect(south.getByTestId('clock-n')).toHaveAttribute('data-active', 'true')
  await expect(south.getByTestId('clock-s')).toHaveAttribute('data-active', 'false')

  // A refresh in the middle of the game brings the same game back.
  await north.reload()
  await expect(north.getByTestId('oware-board')).toBeVisible({ timeout: 20_000 })
  await expect(moves(north)).toHaveText(['c', 'C', 'a'])
  await expect(pit(north, 0)).toHaveAttribute('data-seeds', '0')

  // North plays on after the refresh, then South resigns.
  await pit(north, 6).click()
  await expect(moves(south)).toHaveText(['c', 'C', 'a', 'A'], { timeout: 15_000 })
  await south.getByTestId('game-menu').click()
  await south.getByRole('button', { name: 'Resign' }).click()
  await south.getByRole('dialog').getByRole('button', { name: 'Resign' }).click()
  await expect(south.getByRole('heading', { name: 'You lost' })).toBeVisible({ timeout: 15_000 })
  await expect(north.getByRole('heading', { name: 'You won' })).toBeVisible({ timeout: 15_000 })
  await expect(north.getByTestId('game-over-reason')).toHaveText('By resignation.')
  // A free game is rated: the winner's rating went up.
  await expect(north.getByTestId('game-over-rating')).toContainText('+', { timeout: 15_000 })

  expect(await runSql(`select * from public.verify_ledger_integrity()`)).toEqual([])
  expect(errors).toEqual([])
  await one.context.close()
  await two.context.close()
})

test('a staked game of Oware pays the winner the pot less the commission', async ({ browser }) => {
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email, '100')
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email, '100')
  const [south, north] = await startGame(one, two)

  await pit(south, 2).click()
  await expect(north.locator('[data-playable="true"]')).toHaveCount(6, { timeout: 15_000 })
  await pit(north, 8).click()
  await expect(moves(south)).toHaveText(['c', 'C'], { timeout: 15_000 })
  await south.getByTestId('game-menu').click()
  await south.getByRole('button', { name: 'Resign' }).click()
  await south.getByRole('dialog').getByRole('button', { name: 'Resign' }).click()

  await expect(north.getByTestId('game-over-tokens')).toHaveText(/\+80/, { timeout: 20_000 })
  await expect(south.getByTestId('game-over-tokens')).toHaveText(/−100/, { timeout: 20_000 })
  const wallets = await runSql<{ total: number }>(
    `select (w.bonus_balance + w.cash_balance)::int as total from public.wallets w join public.profiles p on p.id = w.user_id where p.username in ('e2e_player', 'e2e_player2') order by total`,
  )
  expect(wallets.map((w) => w.total)).toEqual([900, 1080])
  expect(await runSql(`select * from public.verify_ledger_integrity()`)).toEqual([])
  await one.context.close()
  await two.context.close()
})
