// Word Battle between two real browsers and accounts, through the hosted project: pairing, a
// rack each that the other cannot see, words judged by the server, and a win that pays out.
// The ending is reached by putting the stored game one word from the end and playing that
// word, so the server's rules and settlement are all exercised.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(180_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { context: BrowserContext; page: Page }

async function signedIn(browser: Browser, index: number): Promise<Seat> {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true })
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[index]!.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
  return { context, page }
}

const board = (page: Page) => page.getByTestId('words-board')
const rack = (page: Page) => page.getByTestId('words-rack').locator('[data-tile]')
const tilesHeld = (page: Page) => rack(page).evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-tile')!).sort())
/** Lays one tile of the rack on a square. */
async function lay(page: Page, letter: string, row: number, col: number) {
  await page.getByTestId('words-rack').locator(`[data-tile="${letter}"]`).first().click()
  await page.locator(`[data-square="${row}-${col}"]`).click()
  await expect(page.locator(`[data-square="${row}-${col}"]`)).toHaveAttribute('data-letter', letter)
}

test('two players are dealt racks only they can see, the server judges the words, and a win pays out', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  const errors: string[] = []
  for (const { page } of [one, two]) {
    page.on('pageerror', (error) => errors.push(error.message))
    // The other player's tiles must never reach this browser, in any answer from the server.
    page.on('response', async (response) => {
      if (response.url().includes('words_bags')) errors.push('the bag was asked for')
      if (!response.url().includes('words_racks')) return
      const rows = (await response.json().catch(() => [])) as unknown
      if (Array.isArray(rows) && rows.length > 1) errors.push('more than one rack was sent to a player')
    })
  }

  for (const { page } of [one, two]) {
    await page.getByTestId('game-words').click()
    await page.getByTestId('game-play').click()
    await expect(page).toHaveURL(/\/play\/words\/new$/)
    // Two players is the table chosen unless the player picks a bigger one.
    await expect(page.getByRole('button', { name: 'Game 2' })).toBeVisible()
    await page.getByTestId('play-stake-toggle').click()
    await page.getByText('100', { exact: true }).click()
  }
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/words\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(board(page)).toBeVisible()
  }
  expect(one.page.url()).toBe(two.page.url())
  const matchId = one.page.url().split('/').pop()!

  // Seven tiles each, shown only to their owner; the bag holds the rest.
  for (const { page } of [one, two]) {
    await expect(rack(page)).toHaveCount(7)
    await expect(board(page)).toHaveAttribute('data-bag', '86')
  }
  const seats = await runSql<{ seat: string; username: string }>(`select mp.seat, p.username from public.match_players mp join public.profiles p on p.id = mp.user_id where mp.match_id = '${matchId}'`)
  const firstIsOne = seats.find((row) => row.seat === '1')!.username === TEST_ACCOUNTS[0]!.username
  const [first, second] = firstIsOne ? [one.page, two.page] : [two.page, one.page]
  await expect(first.getByTestId('words-player-2')).toHaveAttribute('data-tiles', '7')
  await expect(first.getByTestId('words-status')).toContainText('Your turn')
  await expect(second.getByTestId('words-status')).toContainText('Waiting for ')
  // Out of turn, nothing can be asked for.
  await expect(second.getByTestId('words-pass')).toBeDisabled()
  await expect(second.getByTestId('words-play')).toBeDisabled()

  // A known position: the first player is one word from the end, and the bag is empty.
  await runSql(`
    update public.words_racks set tiles = '{c,a,t}' where match_id = '${matchId}' and seat = '1';
    update public.words_racks set tiles = '{q,z}' where match_id = '${matchId}' and seat = '2';
    update public.words_bags set tiles = '{}' where match_id = '${matchId}';
    update public.words_games
       set counts = '{"1": 3, "2": 2}', bag_count = 0, move_no = move_no + 1, deadline = now() + interval '90 seconds'
     where match_id = '${matchId}'`)
  await expect(board(first)).toHaveAttribute('data-bag', '0', { timeout: 20_000 })
  await expect.poll(() => tilesHeld(first), { timeout: 20_000 }).toEqual(['a', 'c', 't'])
  await expect.poll(() => tilesHeld(second), { timeout: 20_000 }).toEqual(['q', 'z'])

  // Tiles that do not cover the middle cannot be played at all, and the screen says why.
  await lay(first, 't', 0, 0)
  await expect(first.getByTestId('words-hint')).not.toBeEmpty()
  await expect(first.getByTestId('words-play')).toBeDisabled()
  await first.locator('[data-square="0-0"]').click()
  await expect(first.locator('[data-square="0-0"]')).toHaveAttribute('data-letter', '')

  // Letters that make no word: the server refuses, names the word, and nothing is recorded.
  await lay(first, 't', 7, 7)
  await lay(first, 'c', 7, 8)
  await first.getByTestId('words-play').click()
  await expect(first.getByText('TC is not in the word list.')).toBeVisible({ timeout: 20_000 })
  await expect(board(second)).toHaveAttribute('data-turn', '1')
  await first.getByRole('button', { name: 'Take back' }).click()
  await expect.poll(() => tilesHeld(first)).toEqual(['a', 'c', 't'])

  // A real word through the middle: what it would score is shown before it is played.
  await lay(first, 'c', 7, 6)
  await lay(first, 'a', 7, 7)
  await lay(first, 't', 7, 8)
  await expect(first.getByTestId('words-hint')).toHaveText('CAT: 10 points')
  await expect(first.getByTestId('words-play')).toHaveText('Play for 10')
  await first.getByTestId('words-play').click()

  // Their last tiles with the bag empty: the game is won, and the other rack is counted.
  await expect(first.getByRole('dialog', { name: 'You won' })).toBeVisible({ timeout: 30_000 })
  await expect(second.getByRole('dialog', { name: 'You lost' })).toBeVisible({ timeout: 30_000 })
  await expect(first.getByTestId('game-over-reason')).toContainText('Every tile was played.')
  await expect(first.getByTestId('words-final-1')).toHaveText('30')
  await expect(second.getByTestId('words-final-2')).toHaveText('-20')
  await expect(second.locator('[data-square="7-7"]')).toHaveAttribute('data-letter', 'a')
  // 100 each staked; the winner takes 200 less the 10% fee.
  await expect(first.getByTestId('game-over-tokens')).toContainText('+80')
  await expect(second.getByTestId('game-over-tokens')).toContainText('−100')

  const [match] = await runSql<{ status: string; end_reason: string; settled: boolean }>(`select status, end_reason, settled from public.matches where id = '${matchId}'`)
  expect(match).toMatchObject({ status: 'finished', end_reason: 'finished', settled: true })
  const [ledger] = await runSql<{ problems: number }>(`select (select count(*) from public.verify_ledger_integrity())::int as problems`)
  expect(ledger!.problems).toBe(0)
  expect(errors).toEqual([])
  await one.context.close()
  await two.context.close()
})

test('practice against the computer: it plays real words on the phone, and the game survives a refresh', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 2)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/play/words/computer')
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(board(page)).toBeVisible()
  await expect(rack(page)).toHaveCount(7)
  await expect(page.getByTestId('words-status')).toContainText('Your turn')
  // Once the word list is on the phone the player may act. They pass; the computer opens.
  await expect(page.getByTestId('words-pass')).toBeEnabled({ timeout: 60_000 })
  await page.getByTestId('words-pass').click()
  await expect(page.getByTestId('words-status')).toContainText('Your turn', { timeout: 30_000 })
  await expect(board(page)).toHaveAttribute('data-move-no', '2')
  // Either it laid a word through the middle, or (seven tiles that make nothing) it swapped.
  const down = await page.locator('[data-square]:not([data-letter=""])').count()
  if (down > 0) {
    expect(down).toBeGreaterThanOrEqual(2)
    await expect(page.locator('[data-square="7-7"]')).not.toHaveAttribute('data-letter', '')
    await expect(page.getByTestId('words-hint')).toContainText('Computer played')
    await expect(page.getByTestId('words-player-2')).not.toHaveAttribute('data-score', '0')
  }
  const mine = await tilesHeld(page)

  // A refresh loses nothing: the same board, the same tiles.
  await page.reload()
  await expect(board(page)).toHaveAttribute('data-move-no', '2')
  await expect.poll(() => tilesHeld(page)).toEqual(mine)
  expect(await page.locator('[data-square]:not([data-letter=""])').count()).toBe(down)

  expect(errors).toEqual([])
  await context.close()
})
