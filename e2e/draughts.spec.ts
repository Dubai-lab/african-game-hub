// Draughts between two real browsers and two real accounts, through the hosted project.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(120_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { context: BrowserContext; page: Page }

async function signedIn(browser: Browser, email: string, stake?: string): Promise<Seat> {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-draughts')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('game-draughts').click()
  await page.getByTestId('game-play').click()
  await page.getByTestId('play-stake-toggle').click()
  if (stake) await page.getByRole('radio', { name: stake, exact: true }).check({ force: true })
  await expect(page.getByRole('button', { name: 'Find match' })).toBeVisible()
  return { context, page }
}

const sq = (page: Page, n: number) => page.getByTestId(`sq-${n}`)
const moves = (page: Page) => page.getByRole('list', { name: 'Moves' }).getByRole('button')
async function play(page: Page, ...path: number[]) {
  for (const n of path) await sq(page, n).click()
}

/** Both players tap Find match; returns them as [white, black] once they are at the board. */
async function startGame(one: Seat, two: Seat): Promise<[Page, Page]> {
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/draughts\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByTestId('draughts-board')).toBeVisible()
  }
  expect(one.page.url()).toBe(two.page.url())
  // Each player has their own pieces at the bottom: square 50 is in White's back row.
  const whiteAtBottom = async (page: Page) => (await sq(page, 50).boundingBox())!.y > (await sq(page, 1).boundingBox())!.y
  const oneIsWhite = await whiteAtBottom(one.page)
  expect(await whiteAtBottom(two.page)).toBe(!oneIsWhite)
  return oneIsWhite ? [one.page, two.page] : [two.page, one.page]
}

test('two players play draughts: moves cross, capturing is compulsory, a refresh loses nothing, resigning ends it', async ({ browser }) => {
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email)
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email)
  const errors: string[] = []
  for (const { page } of [one, two]) page.on('pageerror', (error) => errors.push(error.message))

  const [white, black] = await startGame(one, two)
  await expect(white.getByTestId('player-b')).toContainText('1200')
  await expect(white.getByTestId('clock-w')).toHaveText('5:00')
  await expect(white.getByText(/Make your first move/)).toBeVisible()

  // Black cannot move first, and nobody can move the other side's men.
  await play(black, 19, 23)
  await expect(sq(black, 19)).toHaveAttribute('data-piece', 'b')
  await sq(white, 19).click()
  await expect(white.locator('[data-target="true"]')).toHaveCount(0)

  // 1. 32-28: on White's screen at once, on Black's a moment later.
  await sq(white, 32).click()
  await expect(white.locator('[data-target="true"]')).toHaveCount(2)
  await sq(white, 28).click()
  await expect(sq(white, 28)).toHaveAttribute('data-piece', 'w')
  await expect(sq(black, 28)).toHaveAttribute('data-piece', 'w', { timeout: 15_000 })

  // 1... 19-23 offers a man, and White has to take it: no other piece can be picked up.
  await play(black, 19, 23)
  await expect(sq(white, 23)).toHaveAttribute('data-piece', 'b', { timeout: 15_000 })
  await expect(white.getByTestId('draughts-board')).toHaveAttribute('data-must-capture', 'true')
  await expect(white.getByText(/You must capture/)).toBeVisible()
  await sq(white, 31).click()
  await expect(white.locator('[data-target="true"]')).toHaveCount(0)
  await play(white, 28, 19)
  await expect(sq(white, 23)).toHaveAttribute('data-piece', '.')
  await expect(sq(black, 19)).toHaveAttribute('data-piece', 'w', { timeout: 15_000 })
  await expect(sq(black, 23)).toHaveAttribute('data-piece', '.')

  // Black takes back. Both screens tell the same story.
  await play(black, 14, 23)
  await expect(moves(white)).toHaveText(['32-28', '19-23', '28x19', '14x23'], { timeout: 15_000 })
  await expect(moves(black)).toHaveText(['32-28', '19-23', '28x19', '14x23'])
  await expect(white.getByTestId('taken-w')).toContainText('1 piece taken')

  // The clocks are running now, and only the mover's.
  await expect(white.getByTestId('clock-w')).toHaveAttribute('data-active', 'true')
  await expect(white.getByTestId('clock-b')).toHaveAttribute('data-active', 'false')

  // A refresh in the middle of the game brings the same game back.
  await white.reload()
  await expect(white.getByTestId('draughts-board')).toBeVisible({ timeout: 20_000 })
  await expect(moves(white)).toHaveText(['32-28', '19-23', '28x19', '14x23'])
  await expect(sq(white, 23)).toHaveAttribute('data-piece', 'b')

  // White plays on after the refresh, then Black resigns.
  await play(white, 33, 28)
  await expect(sq(black, 28)).toHaveAttribute('data-piece', 'w', { timeout: 15_000 })
  await black.getByRole('button', { name: 'Resign' }).click()
  await black.getByRole('dialog').getByRole('button', { name: 'Resign' }).click()
  await expect(black.getByRole('heading', { name: 'You lost' })).toBeVisible({ timeout: 15_000 })
  await expect(white.getByRole('heading', { name: 'You won' })).toBeVisible({ timeout: 15_000 })
  await expect(white.getByTestId('game-over-reason')).toHaveText('By resignation.')
  // A free game is rated: the winner's rating went up.
  await expect(white.getByTestId('game-over-rating')).toContainText('+', { timeout: 15_000 })

  expect(await runSql(`select * from public.verify_ledger_integrity()`)).toEqual([])
  expect(errors).toEqual([])
  await one.context.close()
  await two.context.close()
})

test('a staked game of draughts pays the winner the pot less the commission', async ({ browser }) => {
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email, '100')
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email, '100')
  const [white, black] = await startGame(one, two)

  await play(white, 32, 28)
  await expect(sq(black, 28)).toHaveAttribute('data-piece', 'w', { timeout: 15_000 })
  await play(black, 19, 23)
  await expect(sq(white, 23)).toHaveAttribute('data-piece', 'b', { timeout: 15_000 })
  await white.getByRole('button', { name: 'Resign' }).click()
  await white.getByRole('dialog').getByRole('button', { name: 'Resign' }).click()

  await expect(black.getByTestId('game-over-tokens')).toHaveText(/\+80/, { timeout: 20_000 })
  await expect(white.getByTestId('game-over-tokens')).toHaveText(/−100/, { timeout: 20_000 })
  const wallets = await runSql<{ total: number }>(
    `select (w.bonus_balance + w.cash_balance)::int as total from public.wallets w join public.profiles p on p.id = w.user_id where p.username in ('e2e_player', 'e2e_player2') order by total`,
  )
  expect(wallets.map((w) => w.total)).toEqual([900, 1080])
  expect(await runSql(`select * from public.verify_ledger_integrity()`)).toEqual([])
  await one.context.close()
  await two.context.close()
})

test('the Back button does not walk a player out of a live game without asking', async ({ browser }) => {
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email)
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email)
  const [white, black] = await startGame(one, two)
  const match = white.url()
  await play(white, 32, 28)
  await expect(sq(black, 28)).toHaveAttribute('data-piece', 'w', { timeout: 15_000 })
  await play(black, 19, 23)
  await expect(sq(white, 23)).toHaveAttribute('data-piece', 'b', { timeout: 15_000 })

  // Back: the game stays on screen and the player is asked.
  await white.goBack()
  const question = white.getByRole('alertdialog', { name: 'Leave this game?' })
  await expect(question).toBeVisible()
  expect(white.url()).toBe(match)
  await expect(white.getByTestId('draughts-board')).toBeVisible()

  // Stay: back to the game, which is exactly as it was. And Back asks again next time.
  await question.getByRole('button', { name: 'Stay' }).click()
  await expect(question).toHaveCount(0)
  await expect(moves(white)).toHaveText(['32-28', '19-23'])
  await white.goBack()
  await expect(question).toBeVisible()

  // Leave: now the player really goes, and the game goes on without them.
  await question.getByRole('button', { name: 'Leave' }).click()
  await expect(white).not.toHaveURL(match)
  await expect(black.getByTestId('draughts-board')).toBeVisible()

  // Once a game is over there is nothing to ask: Back simply leaves.
  await black.getByRole('button', { name: 'Resign' }).click()
  await black.getByRole('dialog').getByRole('button', { name: 'Resign' }).click()
  await expect(black.getByRole('heading', { name: 'You lost' })).toBeVisible({ timeout: 15_000 })
  await black.goBack()
  await expect(black.getByRole('alertdialog')).toHaveCount(0)
  await expect(black).not.toHaveURL(match, { timeout: 10_000 })

  await one.context.close()
  await two.context.close()
})
