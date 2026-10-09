// Ludo between two real browsers and accounts, through the hosted project. The dice are the
// server's, so the opening turns are played as they fall; the ending is reached by putting the
// stored game one move from a win (exactly the state a roll would leave) and playing that move.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(180_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { context: BrowserContext; page: Page }

const roads = { server: 0, edge: 0 }
test.beforeEach(() => {
  roads.server = 0
  roads.edge = 0
})

async function signedIn(browser: Browser, index: number): Promise<Seat> {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true })
  const page = await context.newPage()
  // Which road each request to play takes: the game server's open connection, or the Edge Function.
  page.on('websocket', (ws) => {
    if (ws.url().includes('localhost')) ws.on('framesent', (frame) => String(frame.payload).includes('"t":"move"') && roads.server++)
  })
  page.on('request', (request) => {
    if (request.url().includes('/functions/v1/ludo-action') && /"action":"(roll|move)"/.test(request.postData() ?? '')) roads.edge++
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[index]!.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
  return { context, page }
}

const turn = (page: Page) => page.getByTestId('ludo-turn')
const turnNo = async (page: Page) => Number(await turn(page).getAttribute('data-turn-no'))
const progress = (page: Page) =>
  page.locator('[data-testid^="piece-"]').evaluateAll((pieces) => pieces.map((p) => `${p.getAttribute('data-testid')}=${p.getAttribute('data-progress')}`).sort().join(' '))

test('two players are paired, take turns with the server’s dice, and a win pays out', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  const errors: string[] = []
  for (const { page } of [one, two]) page.on('pageerror', (error) => errors.push(error.message))

  // Both choose Ludo, the quick game, for 100 tokens.
  for (const { page } of [one, two]) {
    await page.getByText('Ludo', { exact: true }).click()
    // Ludo's home shows games won, not a rating number.
    await expect(page.getByTestId('stat-default')).toContainText('Games won')
    await page.getByTestId('game-play').click()
    // How to play and the stake each open from their own row.
    await page.getByTestId('play-options-toggle').click()
    await page.getByTestId('play-stake-toggle').click()
    await expect(page).toHaveURL(/\/play\/ludo\/new$/)
    // The usual game is offered first: both sides, two dice, lay. This test plays the short
    // one-house game.
    await expect(page.getByRole('radio', { name: /Both sides/ })).toBeChecked()
    await expect(page.getByRole('radio', { name: '2 dice' })).toBeChecked()
    await expect(page.getByRole('radio', { name: /^Lay/ })).toBeChecked()
    await page.getByText('One side', { exact: true }).click()
    await page.getByText('Quick', { exact: true }).click()
    await expect(page.getByRole('radio', { name: /Quick/ })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Find match' })).toBeEnabled()
    await page.getByText('100', { exact: true }).click()
  }
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/ludo\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByTestId('ludo-board')).toBeVisible()
  }
  expect(one.page.url()).toBe(two.page.url())
  const matchId = one.page.url().split('/').pop()!

  // Red moves first. Exactly one of the two is offered the die.
  await expect(turn(one.page)).toHaveAttribute('data-turn', 'red')
  const oneIsRed = (await one.page.getByRole('button', { name: 'Roll' }).count()) > 0
  const [red, yellow] = oneIsRed ? [one.page, two.page] : [two.page, one.page]
  await expect(red.getByText('Your turn: touch the dice')).toBeVisible()
  await expect(yellow.getByRole('button', { name: 'Roll' })).toHaveCount(0)
  await expect(yellow.getByText(/^Waiting for /)).toBeVisible()
  // Every piece starts in its yard, and the stake has left both wallets.
  expect(await progress(red)).toBe('piece-red-0=-1 piece-red-1=-1 piece-yellow-0=-1 piece-yellow-1=-1')

  // A few turns as the dice fall. After each, both screens show the same game.
  for (let i = 0; i < 6; i++) {
    const before = await turnNo(red)
    const mover = (await turn(red).getAttribute('data-turn')) === 'red' ? red : yellow
    await mover.getByRole('button', { name: 'Roll' }).first().click()
    await expect.poll(() => turnNo(mover), { timeout: 20_000 }).toBeGreaterThan(before)
    // Where there is a real choice (which piece, which die first), take the first one offered,
    // until the throw is played out.
    const seat = mover === red ? 'red' : 'yellow'
    for (let plays = 0; plays < 3; plays++) {
      if ((await turn(mover).getAttribute('data-phase')) !== 'move' || (await turn(mover).getAttribute('data-turn')) !== seat) break
      const now = await turnNo(mover)
      await mover.locator('[data-movable="true"]').first().click()
      await expect.poll(() => turnNo(mover), { timeout: 20_000 }).toBeGreaterThan(now)
    }
    const other = mover === red ? yellow : red
    await expect.poll(() => turnNo(other), { timeout: 20_000 }).toBe(await turnNo(mover))
    // (Pieces walk square by square, so the two screens are compared until both have arrived.)
    await expect.poll(async () => (await progress(other)) === (await progress(mover)), { timeout: 15_000 }).toBe(true)
    // Two dice lie in the middle of the board, and they show the same on both screens.
    await expect(mover.getByTestId('ludo-die')).toHaveCount(2)
    for (const index of [0, 1]) {
      await expect(other.getByTestId('ludo-die').nth(index)).toHaveAttribute('data-value', (await mover.getByTestId('ludo-die').nth(index).getAttribute('data-value'))!)
    }
  }
  const log = await runSql<{ rolls: number; faces: number }>(
    `select count(*)::int as rolls, count(*) filter (where die between 1 and 6)::int as faces from public.ludo_moves where match_id = '${matchId}'`,
  )
  expect(log[0]!.rolls).toBeGreaterThanOrEqual(6)
  expect(log[0]!.faces).toBe(log[0]!.rolls)

  // One move from the end: red has a piece home and has just thrown the 2 the other needs.
  await runSql(`
    update public.ludo_games
       set positions = '{"red": [56, 54], "yellow": [3, 20]}', turn = 'red', phase = 'move', die = 2, dice = '[2]', rolled = '[2]', extra = false,
           acted = '{"red": true, "yellow": true}', turn_no = turn_no + 1, deadline = now() + interval '20 seconds'
     where match_id = '${matchId}'`)
  await expect(red.getByText('You rolled 2: tap a piece')).toBeVisible({ timeout: 20_000 })
  // The piece that is home has left the board (the card keeps count); the other can use the 2.
  await expect(red.getByTestId('piece-red-0')).toHaveCount(0)
  await expect(red.getByTestId('ludo-home-red')).toHaveText('1 of 2 home')
  await red.waitForTimeout(700)
  await red.getByTestId('piece-red-1').click()

  await expect(red.getByRole('dialog', { name: 'You won' })).toBeVisible({ timeout: 20_000 })
  await expect(yellow.getByRole('dialog', { name: 'You lost' })).toBeVisible({ timeout: 20_000 })
  await expect(red.getByTestId('game-over-reason')).toHaveText('Every piece is home.')
  await expect(red.getByTestId('game-over-tokens')).toContainText('+80')
  await expect(yellow.getByTestId('game-over-tokens')).toContainText('−100')
  await expect(red.getByTestId('game-over-rating')).toHaveText(/1220\s*\+20/)
  // The same choices as after any game: someone new, or the same opponent again.
  await expect(red.getByRole('dialog').getByRole('button', { name: 'New game' })).toBeVisible()
  await expect(red.getByRole('dialog').getByRole('button', { name: 'Rematch' })).toBeVisible()

  // Paid once, books balanced, and the profile lists the game.
  const books = await runSql<{ problems: number; settled: boolean }>(
    `select (select count(*) from public.verify_ledger_integrity())::int as problems, (select settled from public.matches where id = '${matchId}') as settled`,
  )
  expect(books[0]).toEqual({ problems: 0, settled: true })
  await red.goto('/lobby')
  await expect(red.getByTestId('balance-bonus')).toHaveText('1,080')
  await red.goto('/profile')
  await expect(red.getByTestId('match-history').getByRole('listitem').first()).toContainText('Ludo')

  expect(errors).toEqual([])
  if (process.env.VITE_GAME_SERVER_URL) {
    // With a game server in the setup, play went over its open connection. (The very first
    // request can be made before that connection is up, and then rightly takes the Edge Function.)
    expect(roads.server).toBeGreaterThan(0)
    expect(roads.edge).toBeLessThanOrEqual(1)
  }
  await one.context.close()
  await two.context.close()
})

test('three players, free: the first home wins, and the other two play on for second place', async ({ browser }) => {
  const seatsIn = [await signedIn(browser, 0), await signedIn(browser, 1), await signedIn(browser, 2)]
  for (const { page } of seatsIn) {
    await page.getByText('Ludo', { exact: true }).click()
    // Ludo's home shows games won, not a rating number.
    await expect(page.getByTestId('stat-default')).toContainText('Games won')
    await page.getByTestId('game-play').click()
    // How to play and the stake each open from their own row.
    await page.getByTestId('play-options-toggle').click()
    await page.getByTestId('play-stake-toggle').click()
    await page.getByText('3 players', { exact: true }).click()
    await page.getByText('Quick', { exact: true }).click()
    await expect(page.getByRole('radio', { name: '3 players' })).toBeChecked()
  }
  // The table needs all three before a game starts.
  await seatsIn[0]!.page.getByRole('button', { name: 'Find match' }).click()
  await expect(seatsIn[0]!.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await seatsIn[1]!.page.getByRole('button', { name: 'Find match' }).click()
  await expect(seatsIn[1]!.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await expect(seatsIn[0]!.page).toHaveURL(/\/play\/ludo\/new$/)
  await seatsIn[2]!.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of seatsIn) {
    await expect(page).toHaveURL(/\/play\/ludo\/match\/[0-9a-f-]{36}$/, { timeout: 25_000 })
    await expect(page.getByTestId('ludo-board')).toBeVisible()
    // Three colours are in the game; each player sees the two others above the board.
    await expect(page.locator('[data-testid^="ludo-player-"]')).toHaveCount(3)
  }
  const matchId = seatsIn[0]!.page.url().split('/').pop()!
  const seated = await runSql<{ username: string; seat: string }>(
    `select p.username, mp.seat from public.match_players mp join public.profiles p on p.id = mp.user_id where mp.match_id = '${matchId}'`,
  )
  const pageOf = (seat: string) => seatsIn[TEST_ACCOUNTS.findIndex((a) => a.username === seated.find((s) => s.seat === seat)!.username)]!.page
  const [red, green, yellow] = [pageOf('red'), pageOf('green'), pageOf('yellow')]
  await expect(red.getByText('Your turn: touch the dice')).toBeVisible()

  // Red is one move from home.
  await runSql(`
    update public.ludo_games
       set positions = '{"red": [56, 54], "green": [10, 12], "yellow": [56, 30]}', turn = 'red', phase = 'move', die = 2, dice = '[2]', rolled = '[2]', extra = false,
           acted = '{"red": true, "green": true, "yellow": true}', turn_no = turn_no + 1, deadline = now() + interval '20 seconds'
     where match_id = '${matchId}'`)
  // (Wait until the throw is on screen, as a player would, before tapping the piece.)
  await expect(red.getByText('You rolled 2: tap a piece')).toBeVisible({ timeout: 20_000 })
  // (The test has just lifted this piece across the board by hand; let it land before tapping it.)
  await red.waitForTimeout(700)
  await red.getByTestId('piece-red-1').click()

  // The match is decided: red has won, and the result says so on every screen.
  await expect(red.getByRole('dialog', { name: 'You won' })).toBeVisible({ timeout: 20_000 })
  for (const page of [green, yellow]) {
    const result = page.getByRole('dialog', { name: /won$/ })
    await expect(result).toBeVisible({ timeout: 20_000 })
    await expect(result.getByText('The game has its winner. You can keep playing for the next place.')).toBeVisible()
    await result.getByRole('button', { name: 'Keep playing' }).click()
  }
  // A table of three offers a new game, not a rematch.
  await expect(red.getByRole('dialog').getByRole('button', { name: 'New game' })).toBeVisible()
  await expect(red.getByRole('dialog').getByRole('button', { name: 'Rematch' })).toHaveCount(0)
  await expect(green.getByTestId('ludo-home-red')).toHaveText('1st: winner')

  // The table is still open and it is green's turn; green plays.
  await expect(green.getByText('Your turn: touch the dice')).toBeVisible({ timeout: 20_000 })
  const before = await turnNo(green)
  await green.getByRole('button', { name: 'Roll' }).first().click()
  await expect.poll(() => turnNo(green), { timeout: 20_000 }).toBeGreaterThan(before)

  // Yellow comes home second; green, the last one left, is third, and the table closes.
  await runSql(`
    update public.ludo_games
       set positions = '{"red": [56, 56], "green": [10, 12], "yellow": [56, 54]}', turn = 'yellow', phase = 'move', die = 2, dice = '[2]', rolled = '[2]', extra = false,
           turn_no = turn_no + 1, deadline = now() + interval '20 seconds'
     where match_id = '${matchId}'`)
  await expect(yellow.getByText('You rolled 2: tap a piece')).toBeVisible({ timeout: 20_000 })
  await yellow.waitForTimeout(700)
  await yellow.getByTestId('piece-yellow-1').click()
  for (const page of [red, green, yellow]) {
    await expect(page.getByTestId('ludo-home-yellow')).toHaveText('2nd place', { timeout: 20_000 })
    await expect(page.getByTestId('ludo-home-green')).toHaveText('3rd place')
  }
  await expect(green.getByRole('status').filter({ hasText: 'Game over' })).toBeVisible()

  // The winner of the match is still red, and it was rated once.
  const result = await runSql<{ winner: string; status: string; rated: number; problems: number }>(
    `select (select p.username from public.profiles p where p.id = m.winner_id) as winner, m.status,
            (select count(*) from public.match_players mp where mp.match_id = m.id and mp.rating_after is not null)::int as rated,
            (select count(*) from public.verify_ledger_integrity())::int as problems
       from public.matches m where m.id = '${matchId}'`,
  )
  expect(result[0]).toEqual({ winner: seated.find((s) => s.seat === 'red')!.username, status: 'finished', rated: 3, problems: 0 })

  for (const { context } of seatsIn) await context.close()
})

test('against the computer: three computer players take their turns and the game comes back round', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[0].email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })

  // The practice link belongs to the game that is selected.
  await page.getByText('Ludo', { exact: true }).click()
    await page.getByTestId('game-play').click()
    // How to play and the stake each open from their own row.
    await page.getByTestId('play-options-toggle').click()
    await page.getByTestId('play-stake-toggle').click()
  await expect(page.getByRole('link', { name: 'Play on this device' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Play the computer' }).click()
  await expect(page.getByRole('heading', { name: 'Ludo against the computer' })).toBeVisible()
  await page.getByText('3 computers', { exact: true }).click()
  await page.getByText('Quick', { exact: true }).click()
  await page.getByRole('button', { name: 'Start game' }).click()

  await expect(page.locator('[data-testid^="ludo-player-"]')).toHaveCount(4)
  await expect(page.locator('[data-testid^="piece-"]')).toHaveCount(8)
  await expect(page.getByText('Your turn: touch the dice')).toBeVisible()
  await page.getByRole('button', { name: 'Roll' }).first().click()
  await expect.poll(() => turnNo(page)).toBeGreaterThan(0)

  // Whatever was thrown, the turn goes round the computers and returns to the player.
  const seen = new Set<string>()
  await expect
    .poll(
      async () => {
        const who = (await turn(page).getAttribute('data-turn'))!
        seen.add(who)
        if (who === 'red' && (await turn(page).getAttribute('data-phase')) === 'move') await page.locator('[data-movable="true"]').first().click()
        else if (who === 'red' && seen.size < 4 && (await page.getByRole('button', { name: 'Roll' }).count())) await page.getByRole('button', { name: 'Roll' }).first().click()
        return seen.size === 4 && who === 'red'
      },
      { timeout: 90_000, intervals: [400] },
    )
    .toBe(true)
  expect([...seen].sort()).toEqual(['blue', 'green', 'red', 'yellow'])
  await expect(page.getByTestId('ludo-last')).not.toHaveText(' ')

  // Two dice lie in the middle of the board, because that is the usual game.
  await expect(page.getByTestId('ludo-die')).toHaveCount(2)

  // Leaving goes back to the setup, which remembers the choice.
  await page.getByRole('button', { name: 'Leave this game' }).click()
  await expect(page.getByRole('radio', { name: '3 computers' })).toBeChecked()
  await expect(page.getByRole('radio', { name: '2 dice' })).toBeChecked()

  // Ludo has its own settings: one die instead of two, and the board seen from above.
  await page.goto('/play/ludo/settings')
  const ludo = page.getByRole('region', { name: 'Ludo settings' })
  await expect(ludo.getByRole('radio', { name: '2 dice' })).toBeChecked()
  await ludo.getByRole('radio', { name: '1 die' }).click()
  await ludo.getByRole('checkbox', { name: /3D board/ }).uncheck()
  // The lobby and the practice game both follow it.
  await page.goto('/play/ludo/new')
  await page.getByTestId('play-options-toggle').click()
  await expect(page.getByRole('radio', { name: '1 die' })).toBeChecked()
  await page.getByRole('link', { name: 'Play the computer' }).click()
  await expect(page.getByRole('radio', { name: '1 die' })).toBeChecked()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.getByTestId('ludo-die')).toHaveCount(1)
  await page.getByRole('button', { name: 'Roll' }).first().click()
  await expect.poll(() => turnNo(page)).toBeGreaterThan(0)

  // Back to two dice, from the lobby this time; the setting follows.
  await page.goto('/play/ludo/new')
  await page.getByTestId('play-options-toggle').click()
  await page.getByText('2 dice', { exact: true }).click()
  await page.goto('/play/ludo/settings')
  await expect(page.getByRole('region', { name: 'Ludo settings' }).getByRole('radio', { name: '2 dice' })).toBeChecked()
  expect(errors).toEqual([])
})
