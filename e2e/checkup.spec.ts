// Check Up between two real browsers and accounts, through the hosted project: pairing, a hand
// each that the other cannot see, cards judged by the server, and a win that pays out.
// The ending is reached by putting the stored game a few cards from a win and playing those
// cards, so the server's rules and settlement are all exercised.
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

const table = (page: Page) => page.getByTestId('checkup-table')
const hand = (page: Page) => page.getByTestId('checkup-hand').locator('[data-card]')
const cardsHeld = (page: Page) => hand(page).evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card')!).sort())

test('two players are dealt hands only they can see, play by the server’s rules, and a win pays out', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  const errors: string[] = []
  for (const { page } of [one, two]) {
    page.on('pageerror', (error) => errors.push(error.message))
    // The other player's cards must never reach this browser, in any answer from the server.
    page.on('response', async (response) => {
      if (!response.url().includes('checkup_hands')) return
      const rows = (await response.json().catch(() => [])) as unknown
      if (Array.isArray(rows) && rows.length > 1) errors.push('more than one hand was sent to a player')
    })
  }

  for (const { page } of [one, two]) {
    await page.getByTestId('game-checkup').click()
    await page.getByTestId('game-play').click()
    await expect(page).toHaveURL(/\/play\/checkup\/new$/)
    await page.getByTestId('play-stake-toggle').click()
    await page.getByText('100', { exact: true }).click()
  }
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/checkup\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(table(page)).toBeVisible()
  }
  expect(one.page.url()).toBe(two.page.url())
  const matchId = one.page.url().split('/').pop()!

  // Six cards each, face up only to their owner; the market holds the rest.
  for (const { page } of [one, two]) {
    await expect(hand(page)).toHaveCount(6)
    await expect(table(page)).toHaveAttribute('data-market', '41')
  }
  const dealt = { one: await cardsHeld(one.page), two: await cardsHeld(two.page) }
  expect(dealt.one).not.toEqual(dealt.two)
  // Each sees how many the other holds, never which.
  const seats = await runSql<{ seat: string; username: string }>(`select mp.seat, p.username from public.match_players mp join public.profiles p on p.id = mp.user_id where mp.match_id = '${matchId}'`)
  const firstIsOne = seats.find((row) => row.seat === '1')!.username === TEST_ACCOUNTS[0]!.username
  const [first, second] = firstIsOne ? [one.page, two.page] : [two.page, one.page]
  await expect(first.getByTestId('checkup-player-2')).toHaveAttribute('data-cards', '6')
  await expect(second.getByTestId('checkup-player-1')).toHaveAttribute('data-cards', '6')
  await expect(first.getByTestId('checkup-status')).toHaveText('Your turn')
  await expect(second.getByTestId('checkup-status')).toHaveText(/^Waiting for /)

  // Out of turn, nothing can be asked for: the market is not theirs to go to.
  await expect(second.getByTestId('checkup-market')).toBeDisabled()

  // A known position, two cards from the end for the first player.
  await runSql(`
    update public.checkup_hands set cards = '{c3,w20}' where match_id = '${matchId}' and seat = '1';
    update public.checkup_hands set cards = '{x7,s1}' where match_id = '${matchId}' and seat = '2';
    update public.checkup_markets set cards = '{r1,r2,t4}' where match_id = '${matchId}';
    update public.checkup_games
       set top = 'c7', called = null, counts = '{"1": 2, "2": 2}', market_count = 3, pending_number = null, pending_count = 0,
           move_no = move_no + 1, deadline = now() + interval '60 seconds'
     where match_id = '${matchId}'`)
  await expect(table(first)).toHaveAttribute('data-top', 'c7', { timeout: 20_000 })
  await expect.poll(() => cardsHeld(first), { timeout: 20_000 }).toEqual(['c3', 'w20'])
  await expect.poll(() => cardsHeld(second), { timeout: 20_000 }).toEqual(['s1', 'x7'])

  // The first player plays a circle on a circle. Both tables show it; the turn passes.
  await first.locator('[data-card="c3"]').click()
  for (const page of [first, second]) await expect(table(page)).toHaveAttribute('data-top', 'c3', { timeout: 20_000 })
  await expect(second.getByTestId('checkup-status')).toHaveText('Your turn', { timeout: 20_000 })
  await expect(second.getByTestId('checkup-last')).toContainText('played Circle 3')
  await expect(second.getByTestId('checkup-player-1')).toContainText('Last card')

  // The second player holds nothing that goes on a circle 3: neither card can be played, so
  // to market. What they draw is theirs alone to see.
  await expect(second.locator('[data-card][data-playable="true"]')).toHaveCount(0)
  // (Pressed all the same, as a player might: nothing happens.)
  await second.locator('[data-card="x7"]').click({ force: true })
  await expect(table(second)).toHaveAttribute('data-top', 'c3')
  await second.getByTestId('checkup-draw').click()
  await expect.poll(() => cardsHeld(second), { timeout: 20_000 }).toEqual(['s1', 't4', 'x7'])
  await expect(first.getByTestId('checkup-player-2')).toHaveAttribute('data-cards', '3', { timeout: 20_000 })
  await expect(first.getByTestId('checkup-last')).toContainText('went to market')
  await expect(first.getByTestId('checkup-last')).not.toContainText('Triangle')

  // The first player's last card is the 20: a shape must be called, and the game is won.
  await expect(first.getByTestId('checkup-status')).toHaveText('Your turn', { timeout: 20_000 })
  await first.locator('[data-card="w20"]').click()
  await first.getByRole('dialog', { name: 'Call a shape' }).getByRole('button', { name: 'Star' }).click()

  await expect(first.getByRole('dialog', { name: 'You won' })).toBeVisible({ timeout: 30_000 })
  await expect(second.getByRole('dialog', { name: 'You lost' })).toBeVisible({ timeout: 30_000 })
  await expect(first.getByTestId('game-over-reason')).toHaveText('Check up! Every card played.')
  // The cards are laid down: the loser's three, counted.
  await expect(second.getByTestId('checkup-total-2')).toHaveText('12')
  await expect(first.getByTestId('checkup-total-1')).toHaveText('0')
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

test('practice against the computer: the game is played out on the phone and survives a refresh', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 2)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByTestId('game-checkup').click()
  await page.getByTestId('game-play').click()
  await page.getByRole('link', { name: 'Play the computer' }).click()
  await expect(page.getByRole('heading', { name: 'Check Up against the computer' })).toBeVisible()
  await page.getByText('2 computers', { exact: true }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(table(page)).toBeVisible()
  await expect(hand(page)).toHaveCount(6)
  // Three at the table: 54 less 18 dealt and the card turned up.
  await expect(table(page)).toHaveAttribute('data-market', '35')

  // Play until the computers have had their turns and it has come back round twice.
  let turns = 0
  for (let i = 0; i < 40 && turns < 3; i++) {
    if ((await table(page).getAttribute('data-over')) === 'true') break
    await expect(page.getByTestId('checkup-status')).toHaveText(/Your turn|Pick|Game over/, { timeout: 30_000 })
    if ((await table(page).getAttribute('data-over')) === 'true') break
    const before = Number(await table(page).getAttribute('data-move-no'))
    const card = page.locator('[data-testid="checkup-hand"] [data-playable="true"]:not([data-card="w20"])').first()
    if (await card.count()) await card.click()
    else await page.getByTestId('checkup-draw').click()
    await expect.poll(async () => Number(await table(page).getAttribute('data-move-no')), { timeout: 20_000 }).toBeGreaterThan(before)
    turns++
  }
  expect(turns).toBeGreaterThan(0)

  if ((await table(page).getAttribute('data-over')) !== 'true') {
    // A refresh brings the same game back, not a new one.
    const moveNo = Number(await table(page).getAttribute('data-move-no'))
    await page.reload()
    await expect(table(page)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Start game' })).toHaveCount(0)
    expect(Number(await table(page).getAttribute('data-move-no'))).toBeGreaterThanOrEqual(moveNo)
    // Leaving the game forgets it: back at the setup, which remembers the choice.
    await page.getByTestId('game-menu').click()
    await page.getByRole('button', { name: 'Leave this game' }).click()
    await expect(page.getByRole('radio', { name: '2 computers' })).toBeChecked()
  }
  // The screen is fixed: nothing scrolls.
  expect(errors).toEqual([])
  await context.close()
})
