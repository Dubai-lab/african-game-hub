// Two real browsers, two real accounts, playing each other through the hosted project.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const password = TEST_PASSWORD
const accounts = TEST_ACCOUNTS

// Two browsers and a real server: these are the slowest tests in the suite.
test.setTimeout(120_000)

test.beforeAll(ensureTestAccounts)
// Each test starts with both accounts out of any game, on 1,000 bonus tokens and default ratings.
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { context: BrowserContext; page: Page }

async function signedIn(browser: Browser, email: string): Promise<Seat> {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Find match' })).toBeVisible()
  return { context, page }
}

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)
const pieceOn = (page: Page, name: string) => square(page, name).locator('[data-piece]')
const moves = (page: Page) => page.getByRole('list', { name: 'Moves' }).getByRole('button')

async function tapMove(page: Page, from: string, to: string) {
  await square(page, from).click()
  await square(page, to).click()
}

/** Both players tap Find match; returns them as [white, black] once they are at the board. */
async function startGame(one: Seat, two: Seat): Promise<[Page, Page]> {
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()

  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/chess\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByTestId('chess-board')).toBeVisible()
  }
  expect(one.page.url()).toBe(two.page.url())

  // Each player sees their own colour at the bottom.
  const whiteAtBottom = async (page: Page) => {
    const a1 = (await square(page, 'a1').boundingBox())!
    const a8 = (await square(page, 'a8').boundingBox())!
    return a1.y > a8.y
  }
  const oneIsWhite = await whiteAtBottom(one.page)
  expect(await whiteAtBottom(two.page)).toBe(!oneIsWhite)
  return oneIsWhite ? [one.page, two.page] : [two.page, one.page]
}

test('two players are paired and play a game to checkmate, each seeing the other’s moves', async ({ browser }) => {
  const one = await signedIn(browser, accounts[0]!.email)
  const two = await signedIn(browser, accounts[1]!.email)
  const errors: string[] = []
  for (const { page } of [one, two]) page.on('pageerror', (error) => errors.push(error.message))

  const [white, black] = await startGame(one, two)

  // Opponent's name, flag-bearing card and rating are shown; clocks have not started.
  await expect(white.getByTestId('player-b')).toContainText('1200')
  await expect(white.getByTestId('clock-w')).toHaveText('5:00')
  await expect(white.getByText(/Make your first move/)).toBeVisible()
  await expect(black.getByText(/first move\. Seconds left/)).toBeVisible()

  // Black cannot move first: tapping a move now only queues it (a premove), and tapping an
  // empty square cancels it. Nobody can move the other side's pieces.
  await tapMove(black, 'e7', 'e5')
  await expect(pieceOn(black, 'e7')).toHaveCount(1)
  await expect(black.getByTestId('chess-board')).toHaveAttribute('data-premove', 'e7e5')
  await square(black, 'a4').click()
  await expect(black.getByTestId('chess-board')).not.toHaveAttribute('data-premove', /./)
  await square(white, 'e7').click()
  await expect(square(white, 'e5').locator(':scope > div')).not.toHaveCSS('background-image', /radial-gradient/)

  // 1.f3: on White's screen at once, on Black's a moment later.
  await tapMove(white, 'f2', 'f3')
  await expect(pieceOn(white, 'f3')).toHaveCount(1)
  await expect(pieceOn(black, 'f3')).toHaveCount(1, { timeout: 15_000 })
  await expect(moves(black)).toHaveCount(1)

  await tapMove(black, 'e7', 'e5')
  await expect(pieceOn(white, 'e5')).toHaveCount(1, { timeout: 15_000 })
  // Both have moved: White's clock is now running on both screens.
  await expect(white.getByTestId('clock-w')).toHaveAttribute('data-active', 'true')
  await expect(black.getByTestId('clock-w')).toHaveAttribute('data-active', 'true')

  await tapMove(white, 'g2', 'g4')
  await expect(pieceOn(black, 'g4')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(black, 'd8', 'h4')

  await expect(black.getByRole('dialog', { name: 'You won' })).toBeVisible({ timeout: 15_000 })
  await expect(white.getByRole('dialog', { name: 'You lost' })).toBeVisible({ timeout: 15_000 })
  await expect(white.getByTestId('game-over-reason')).toHaveText('By checkmate.')
  await expect(moves(white)).toHaveText(['f3', 'e5', 'g4', 'Qh4#'])
  await expect(moves(black)).toHaveText(['f3', 'e5', 'g4', 'Qh4#'])

  // The result card: the new rating and how far it moved, then (once the engine has been
  // through the game) how the player did.
  await expect(black.getByTestId('game-over-rating')).toHaveText(/1220\s*\+20/)
  await expect(white.getByTestId('game-over-rating')).toHaveText(/1180\s*−20/)
  await expect(black.getByTestId('review-tiles')).toBeVisible({ timeout: 90_000 })
  await expect(black.getByText('Your accuracy')).toBeVisible()

  // Rematch: the loser asks, the winner is told and accepts, and both are at a new board with
  // the colours the other way round. Neither went back to the lobby.
  const firstGame = white.url()
  await white.getByRole('dialog').getByRole('button', { name: 'Rematch' }).click()
  await expect(white.getByRole('dialog').getByText(/Rematch offered\. Waiting for/)).toBeVisible()
  await expect(black.getByRole('dialog').getByText(/wants a rematch\./)).toBeVisible({ timeout: 20_000 })
  await black.getByRole('dialog').getByRole('button', { name: 'Accept' }).click()
  for (const page of [white, black]) {
    await expect(page).not.toHaveURL(firstGame, { timeout: 20_000 })
    await expect(page).toHaveURL(/\/play\/chess\/match\/[0-9a-f-]{36}$/)
    await expect(page.getByText('No moves yet')).toBeVisible()
  }
  expect(white.url()).toBe(black.url())
  // "white" played White last time; now Black's pieces are at the bottom of their screen.
  const a1 = (await square(white, 'a1').boundingBox())!
  const a8 = (await square(white, 'a8').boundingBox())!
  expect(a1.y).toBeLessThan(a8.y)

  // This one is called off before it starts. From the result, a declined rematch and a search
  // for someone new, again without leaving the screen.
  await black.getByRole('button', { name: 'Abort' }).click()
  await black.getByRole('dialog').getByRole('button', { name: 'Abort', exact: true }).click()
  await expect(white.getByRole('dialog', { name: 'Game aborted' })).toBeVisible({ timeout: 20_000 })
  await expect(black.getByRole('dialog', { name: 'Game aborted' })).toBeVisible()
  await black.getByRole('dialog').getByRole('button', { name: 'Rematch' }).click()
  await expect(white.getByRole('dialog').getByText(/wants a rematch\./)).toBeVisible({ timeout: 20_000 })
  await white.getByRole('dialog').getByRole('button', { name: 'Decline' }).click()
  await expect(black.getByRole('dialog').getByText(/declined the rematch\./)).toBeVisible({ timeout: 20_000 })
  await expect(black.getByRole('dialog').getByRole('button', { name: 'Rematch' })).toBeDisabled()

  await white.getByRole('dialog').getByRole('button', { name: /^New / }).click()
  await expect(white.getByRole('dialog').getByText('Looking for an opponent…')).toBeVisible()
  await white.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(white.getByRole('dialog').getByRole('button', { name: /^New / })).toBeVisible()

  // The lobby no longer offers a game to return to.
  await white.goto('/lobby')
  await expect(white.getByRole('button', { name: 'Find match' })).toBeVisible()
  await expect(white.getByText('You have a game in progress.')).toHaveCount(0)

  expect(errors).toEqual([])
  await one.context.close()
  await two.context.close()
})

test('a game survives a refresh, a dropped connection and leaving the screen; draws need both players', async ({ browser }) => {
  const one = await signedIn(browser, accounts[0]!.email)
  const two = await signedIn(browser, accounts[1]!.email)
  const [white, black] = await startGame(one, two)
  const whiteSeat = white === one.page ? one : two
  const blackSeat = black === one.page ? one : two

  await tapMove(white, 'e2', 'e4')
  await expect(pieceOn(black, 'e4')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(black, 'e7', 'e5')
  await expect(pieceOn(white, 'e5')).toHaveCount(1, { timeout: 15_000 })

  // Refresh mid-game: the whole game is loaded again from the database.
  await white.reload()
  await expect(moves(white)).toHaveText(['e4', 'e5'], { timeout: 15_000 })
  await expect(pieceOn(white, 'e4')).toHaveCount(1)
  await expect(white.getByTestId('clock-w')).toHaveAttribute('data-active', 'true')

  // Black loses their connection. White moves meanwhile.
  await blackSeat.context.setOffline(true)
  await expect(black.getByText('Reconnecting…')).toBeVisible({ timeout: 15_000 })
  await tapMove(white, 'g1', 'f3')
  await expect(moves(white)).toHaveCount(3, { timeout: 15_000 })
  // Back online: Black catches up without touching anything.
  await blackSeat.context.setOffline(false)
  await expect(moves(black)).toHaveText(['e4', 'e5', 'Nf3'], { timeout: 30_000 })
  await expect(pieceOn(black, 'f3')).toHaveCount(1)

  // White wanders off to the lobby and is offered the way back.
  await white.getByRole('link', { name: 'Lobby' }).click()
  await expect(white.getByText('You have a game in progress.')).toBeVisible()
  await white.getByRole('link', { name: 'Return to game' }).click()
  await expect(moves(white)).toHaveCount(3)

  // Black replies, then White offers a draw. Only Black is asked.
  await tapMove(black, 'b8', 'c6')
  await expect(moves(white)).toHaveCount(4, { timeout: 15_000 })
  await white.getByRole('button', { name: 'Offer draw' }).click()
  await expect(black.getByRole('dialog', { name: /offers a draw/ })).toBeVisible({ timeout: 15_000 })
  await expect(white.getByRole('dialog')).toHaveCount(0)
  await expect(white.getByText('Draw offered. Waiting for an answer.')).toBeVisible()
  await black.getByRole('button', { name: 'Decline' }).click()
  await expect(white.getByRole('button', { name: 'Offer draw' })).toBeEnabled({ timeout: 15_000 })

  // Black offers in turn and White accepts.
  await black.getByRole('button', { name: 'Offer draw' }).click()
  await white.getByRole('button', { name: 'Accept draw' }).click({ timeout: 15_000 })
  for (const page of [white, black]) {
    await expect(page.getByRole('dialog', { name: 'Draw' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('game-over-reason')).toHaveText('Both players agreed to a draw.')
  }

  await whiteSeat.context.close()
  await blackSeat.context.close()
})

test('searching can be cancelled, and a game abandoned before it starts is called off', async ({ browser }) => {
  const one = await signedIn(browser, accounts[0]!.email)
  const two = await signedIn(browser, accounts[1]!.email)

  // Cancel: the lone searcher goes back to the pickers and is no longer waiting on the server.
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await one.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(one.page.getByRole('button', { name: 'Find match' })).toBeVisible()
  await expect
    .poll(async () => (await runSql<{ n: number }>(`select count(*)::int as n from public.match_queue`))[0]!.n)
    .toBe(0)

  const [white, black] = await startGame(one, two)
  await white.getByRole('button', { name: 'Abort' }).click()
  await white.getByRole('dialog', { name: 'Abort this game?' }).getByRole('button', { name: 'Abort' }).click()
  for (const page of [white, black]) {
    await expect(page.getByRole('dialog', { name: 'Game aborted' })).toBeVisible({ timeout: 15_000 })
  }

  await one.context.close()
  await two.context.close()
})

test('a staked game: both stakes are held, the winner is paid, and both wallets show it', async ({ browser }) => {
  const one = await signedIn(browser, accounts[0]!.email)
  const two = await signedIn(browser, accounts[1]!.email)

  // Both choose to play for 100 tokens. The lobby quotes the payout before anything is staked.
  for (const { page } of [one, two]) {
    await expect(page.getByTestId('balance-bonus')).toHaveText('1,000')
    await page.getByText('100', { exact: true }).click()
    await expect(page.getByText(/The winner gets 180 \(10% fee\)/)).toBeVisible()
  }
  const [white, black] = await startGame(one, two)
  await expect(white.getByText('Chess · 5 · 100 tokens')).toBeVisible()

  // 1.f3 e5 2.g4 Qh4#
  await tapMove(white, 'f2', 'f3')
  await expect(pieceOn(black, 'f3')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(black, 'e7', 'e5')
  await expect(pieceOn(white, 'e5')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(white, 'g2', 'g4')
  await expect(pieceOn(black, 'g4')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(black, 'd8', 'h4')

  // The result screen shows tokens and rating for each side.
  const won = black.getByRole('dialog', { name: 'You won' })
  const lost = white.getByRole('dialog', { name: 'You lost' })
  await expect(won).toBeVisible({ timeout: 15_000 })
  await expect(won).toContainText('+80')
  await expect(won).toContainText('+20')
  await expect(lost).toBeVisible({ timeout: 15_000 })
  await expect(lost).toContainText('−100')
  await expect(lost).toContainText('−20')

  // Wallets: 1,080 for the winner, 900 for the loser, and the history says why.
  await black.goto('/lobby')
  await expect(black.getByTestId('balance-bonus')).toHaveText('1,080')
  await black.getByRole('link', { name: 'Wallet' }).click()
  await expect(black.getByRole('heading', { name: 'Wallet', level: 1 })).toBeVisible()
  const history = black.getByTestId('ledger').getByRole('listitem')
  await expect(history.nth(0)).toContainText('Winnings')
  await expect(history.nth(0)).toContainText('+180')
  await expect(history.nth(0)).toContainText('Balance 1,080')
  await expect(history.nth(1)).toContainText('Stake')
  await expect(history.nth(1)).toContainText('-100')
  await expect(black.getByRole('button', { name: /Deposit/ })).toBeDisabled()
  await expect(black.getByRole('button', { name: /Withdraw/ })).toBeDisabled()

  await white.goto('/lobby')
  await expect(white.getByTestId('balance-bonus')).toHaveText('900')
  // The loser can no longer afford the top stake, and the lobby says so.
  await expect(white.getByRole('radio', { name: /1,000/ })).toBeDisabled()
  // Rating shown in the lobby reflects the loss.
  await expect(white.getByText('Blitz rating 1180')).toBeVisible()

  const problems = await runSql(`select * from public.verify_ledger_integrity()`)
  expect(problems).toEqual([])

  await one.context.close()
  await two.context.close()
})
