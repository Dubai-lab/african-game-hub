// "Play a friend" and tournaments, between real browsers and accounts on the hosted project.
// The games themselves are ended from outside (as the server would on a checkmate), so these
// tests are about the invitations, the pairing, the prize and the standings.
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
const idOf = (index: number) => `(select id from auth.users where email = '${TEST_ACCOUNTS[index]!.email}')`
const bonus = async (index: number) => (await runSql<{ b: number }>(`select bonus_balance::int as b from public.wallets where user_id = ${idOf(index)}`))[0]!.b
const MATCH_URL = /\/play\/chess\/match\/[0-9a-f-]{36}$/

test('play a friend: an invitation with a stake pops up for the friend, and accepting starts the game', async ({ browser }) => {
  await runSql(`insert into public.friendships (requester_id, addressee_id, status, responded_at) values (${idOf(0)}, ${idOf(1)}, 'accepted', now())`)
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)

  // From chess's home: the friend is listed with a Challenge button.
  await one.page.getByTestId('game-chess').click()
  await one.page.getByTestId('game-friends').getByRole('link', { name: 'Challenge' }).click()
  await expect(one.page).toHaveURL(/\/play\/chess\/friend\?to=e2e_player2$/)
  await expect(one.page.getByRole('radio', { name: 'e2e_player2' })).toBeChecked()
  await one.page.getByText('100', { exact: true }).click()
  await one.page.getByText('3 | 2', { exact: true }).click()
  await one.page.getByRole('button', { name: 'Send challenge' }).click()
  await expect(one.page.getByTestId('challenge-waiting')).toContainText('Waiting for e2e_player2')
  // Nothing is taken until the friend accepts.
  expect(await bonus(0)).toBe(1000)

  // The friend, wherever they are in the app, is shown the invitation with its terms.
  const invitation = two.page.getByRole('dialog', { name: 'E2E Player challenges you' })
  await expect(invitation).toBeVisible({ timeout: 20_000 })
  await expect(invitation).toContainText('Chess · Blitz · 3 | 2')
  await expect(invitation.getByTestId('challenge-stake')).toContainText('Stake: 100 tokens each')
  await invitation.getByRole('button', { name: 'Accept' }).click()

  for (const { page } of [one, two]) await expect(page).toHaveURL(MATCH_URL, { timeout: 20_000 })
  expect(one.page.url()).toBe(two.page.url())
  // Both stakes are now held, exactly as for a game found by matchmaking.
  expect(await bonus(0)).toBe(900)
  expect(await bonus(1)).toBe(900)
  await one.context.close()
  await two.context.close()
})

test('play a friend by link: anyone given the link can accept; a refresh keeps the invitation', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  await one.page.goto('/play/chess/friend')
  await expect(one.page.getByRole('radio', { name: 'Anyone with the link' })).toBeChecked()
  await one.page.getByRole('button', { name: 'Create link' }).click()
  const link = await one.page.getByTestId('share-link').inputValue()
  expect(link).toMatch(/\/challenge\/[0-9a-f-]{36}$/)
  await expect(one.page.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*challenge/)
  // Refreshing does not lose it.
  await one.page.reload()
  await expect(one.page.getByTestId('challenge-waiting')).toBeVisible({ timeout: 20_000 })
  // The maker opening their own link is told to share it instead.
  const own = await one.context.newPage()
  await own.goto(link)
  await expect(own.getByText('This is your own invitation.')).toBeVisible()
  await own.close()

  await two.page.goto(link)
  await expect(two.page.getByText('E2E Player challenges you')).toBeVisible()
  await expect(two.page.getByTestId('challenge-stake')).toHaveText('A free game. No tokens at stake.')
  await two.page.getByRole('button', { name: 'Accept' }).click()
  for (const { page } of [one, two]) await expect(page).toHaveURL(MATCH_URL, { timeout: 20_000 })

  // The link works once.
  const late = await signedIn(browser, 2)
  await late.page.goto(link)
  await expect(late.page.getByText('This invitation is no longer open.')).toBeVisible()
  for (const seat of [one, two, late]) await seat.context.close()
})

test('a tournament: created with a prize, joined from its link, players paired, and the prize shared at the end', async ({ browser }) => {
  const host = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  const three = await signedIn(browser, 2)

  // The host creates it from the chess tournaments page.
  await host.page.getByTestId('game-chess').click()
  await host.page.getByTestId('game-play').click()
  await host.page.getByRole('link', { name: 'Tournaments' }).click()
  await host.page.getByRole('tab', { name: 'Create' }).click()
  await host.page.getByLabel('Name').fill('Friday Blitz')
  await host.page.getByText('3 | 2', { exact: true }).click()
  await host.page.getByRole('radio', { name: '30 min' }).click()
  await host.page.getByRole('radio', { name: 'Tokens from my wallet' }).click()
  // More than the wallet holds is refused before anything is sent.
  await host.page.getByLabel('Prize in tokens').fill('5000')
  await expect(host.page.getByText('You do not have that many tokens.')).toBeVisible()
  await expect(host.page.getByRole('button', { name: 'Create tournament' })).toBeDisabled()
  await host.page.getByLabel('Prize in tokens').fill('300')
  await host.page.getByRole('button', { name: 'Create tournament' }).click()
  await expect(host.page).toHaveURL(/\/tournaments\/[0-9a-f-]{36}$/, { timeout: 20_000 })
  const link = host.page.url()
  const tournamentId = link.split('/').pop()!
  await expect(host.page.getByRole('heading', { name: 'Friday Blitz' })).toBeVisible()
  await expect(host.page.getByTestId('tournament-prize')).toHaveText('Prize 300')
  await expect(host.page.getByTestId('share-link')).toHaveValue(link)
  // The prize has left the host's wallet and is held.
  expect(await bonus(0)).toBe(700)

  // It is listed for everyone, and the two players join from the link.
  await three.page.goto('/play/chess/tournaments')
  await expect(three.page.getByTestId('tournament-list')).toContainText('Friday Blitz')
  await expect(three.page.getByTestId('tournament-list')).toContainText('Prize 300')
  for (const { page } of [two, three]) {
    await page.goto(link)
    await page.getByRole('button', { name: 'Join' }).click()
    // By time, nobody is paired until they ask for a game.
    await expect(page.getByText('Ready when you are.')).toBeVisible()
  }
  await two.page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(two.page.getByText('Looking for your next opponent…')).toBeVisible()
  await expect(two.page.getByRole('button', { name: 'Stop looking' })).toBeVisible()
  await three.page.getByRole('button', { name: 'Play', exact: true }).click()
  // Both asking: they are paired with each other and taken to the board.
  for (const { page } of [two, three]) await expect(page).toHaveURL(MATCH_URL, { timeout: 30_000 })
  expect(two.page.url()).toBe(three.page.url())
  const matchId = two.page.url().split('/').pop()!
  const matchId0 = () => matchId
  const [match] = await runSql<{ stake: number; tournament_id: string }>(`select stake_amount::int as stake, tournament_id from public.matches where id = '${matchId}'`)
  expect(match).toEqual({ stake: 0, tournament_id: tournamentId })

  // The host is not playing. Under Games they see the game in progress, and can watch it.
  await host.page.getByTestId('tournament-games-tab').click()
  await expect(host.page.getByTestId('tournament-games-tab')).toHaveText('Games (1)', { timeout: 20_000 })
  const playing = host.page.getByTestId('tournament-games').getByRole('listitem')
  await expect(playing).toHaveCount(1)
  await expect(playing).toContainText('e2e_player2')
  await expect(playing).toContainText('e2e_player3')
  await playing.getByRole('link').click()
  await expect(host.page).toHaveURL(two.page.url())
  await expect(host.page.getByTestId('chess-board')).toBeVisible({ timeout: 20_000 })
  // Watching only: no resign or draw buttons for someone who is not playing.
  await expect(host.page.getByRole('button', { name: 'Resign' })).toHaveCount(0)
  // A move played by a player is seen by the watcher as it happens.
  const mover = (await runSql<{ white: boolean }>(`select (select user_id from public.match_players where match_id = '${matchId0()}' and seat = 'white') = ${idOf(1)} as white`))[0]!.white ? two.page : three.page
  await mover.locator('[data-square="e2"]').click()
  await mover.locator('[data-square="e4"]').click()
  await expect(host.page.getByRole('list', { name: 'Moves' }).getByRole('button')).toHaveText(['e4'], { timeout: 20_000 })
  // And there is a way back to the tournament.
  await host.page.getByTestId('watching-back').click()
  await expect(host.page).toHaveURL(link)

  // Chat: a player writes, and the host (its creator) reads it and answers.
  await host.page.getByRole('tab', { name: 'Chat' }).click()
  await host.page.getByLabel('Say something to the tournament').fill('Good luck to you both')
  await host.page.getByRole('button', { name: 'Send' }).click()
  await expect(host.page.getByTestId('tournament-chat')).toContainText('Good luck to you both')

  // The game ends with player two the winner, and the tournament's time runs out.
  await runSql(`select private.finish_match('${matchId}', 'win', ${idOf(1)}, 'resignation')`)
  await runSql(`update public.tournaments set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second' where id = '${tournamentId}';
                select private.tournaments_tick()`)
  // From the board, the way on is back to the tournament.
  for (const { page } of [two, three]) {
    await page.getByRole('dialog').getByRole('link', { name: 'Back to the tournament' }).click()
    await expect(page).toHaveURL(link)
    await expect(page.getByTestId('tournament-info')).toHaveAttribute('data-status', 'finished', { timeout: 20_000 })
  }
  // Two players finished a game: the winner takes 70% (first and third share), the other 30%.
  const rows = two.page.getByTestId('tournament-standings').getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('e2e_player2')
  await expect(rows.nth(0)).toContainText('+210')
  await expect(rows.nth(1)).toContainText('+90')
  await expect(two.page.getByText('You won 210 tokens.')).toBeVisible()
  // The players can read what was said in the chat.
  await two.page.getByRole('tab', { name: 'Chat' }).click()
  await expect(two.page.getByTestId('tournament-chat')).toContainText('Good luck to you both')
  await two.page.getByRole('tab', { name: 'Standings' }).click()
  await expect(three.page.getByText('You won 90 tokens.')).toBeVisible()
  expect(await bonus(1)).toBe(1210)
  expect(await bonus(2)).toBe(1090)
  expect(await bonus(0)).toBe(700)
  // The wallet history says where the tokens came from, and the books balance.
  await two.page.goto('/wallet')
  await expect(two.page.getByTestId('ledger').getByRole('listitem').first()).toContainText('Tournament prize won')
  const [books] = await runSql<{ problems: number }>(`select count(*)::int as problems from public.verify_ledger_integrity()`)
  expect(books!.problems).toBe(0)
  for (const seat of [host, two, three]) await seat.context.close()
})

test('a tournament set for later can be cancelled by its creator, and the prize comes back', async ({ browser }) => {
  const host = await signedIn(browser, 0)
  await host.page.goto('/play/chess/tournaments')
  await host.page.getByRole('tab', { name: 'Create' }).click()
  await host.page.getByLabel('Name').fill('Later on')
  await host.page.getByRole('radio', { name: 'In 1 hour' }).click()
  await host.page.getByRole('radio', { name: 'Tokens from my wallet' }).click()
  await host.page.getByLabel('Prize in tokens').fill('400')
  await host.page.getByRole('button', { name: 'Create tournament' }).click()
  await expect(host.page.getByRole('heading', { name: 'Later on' })).toBeVisible({ timeout: 20_000 })
  await expect(host.page.getByRole('timer')).toContainText('Starts in')
  expect(await bonus(0)).toBe(600)
  await host.page.getByRole('button', { name: 'Cancel tournament' }).click()
  await expect(host.page.getByTestId('tournament-info')).toHaveAttribute('data-status', 'cancelled', { timeout: 20_000 })
  expect(await bonus(0)).toBe(1000)
  await host.context.close()
})

test('a tournament by rounds: the system pairs the players, the next round waits for the game to end, and entry closes at round 1', async ({ browser }) => {
  const host = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  const three = await signedIn(browser, 2)

  await host.page.goto('/play/chess/tournaments')
  await host.page.getByRole('tab', { name: 'Create' }).click()
  await host.page.getByLabel('Name').fill('Three rounds')
  await host.page.getByRole('radio', { name: 'By rounds' }).click()
  await host.page.getByRole('radio', { name: '3 rounds' }).click()
  await host.page.getByRole('radio', { name: 'In 15 minutes' }).click()
  await host.page.getByRole('button', { name: 'Create tournament' }).click()
  await expect(host.page.getByRole('heading', { name: 'Three rounds' })).toBeVisible({ timeout: 20_000 })
  const link = host.page.url()
  const tournamentId = link.split('/').pop()!
  await expect(host.page.getByTestId('tournament-info')).toContainText('3 rounds')

  // Two players join before the start and wait on the page.
  for (const { page } of [two, three]) {
    await page.goto(link)
    await page.getByRole('button', { name: 'Join' }).click()
    await expect(page.getByText('You are in. It has not started yet')).toBeVisible()
  }
  // The start time comes. Nobody presses anything: the system pairs them and opens the board.
  await runSql(`update public.tournaments set starts_at = now() - interval '1 second' where id = '${tournamentId}'; select private.tournaments_tick()`)
  for (const { page } of [two, three]) await expect(page).toHaveURL(MATCH_URL, { timeout: 40_000 })
  const first = two.page.url()
  expect(three.page.url()).toBe(first)
  // Entry is closed now: the host, who did not join, can only watch.
  await expect(host.page.getByTestId('tournament-info')).toHaveAttribute('data-round', '1', { timeout: 20_000 })
  await expect(host.page.getByRole('timer')).toHaveText('Round 1 of 3')
  await expect(host.page.getByRole('button', { name: 'Join' })).toHaveCount(0)
  await expect(host.page.getByText('Entry closed when round 1 began')).toBeVisible()
  await host.page.getByTestId('tournament-games-tab').click()
  await expect(host.page.getByTestId('tournament-pairings')).toContainText('Playing')

  // Round 1 ends. Still on the board, both are taken straight into their round 2 game.
  await runSql(`select private.finish_match('${first.split('/').pop()}', 'win', ${idOf(1)}, 'resignation')`)
  for (const { page } of [two, three]) await expect(page).not.toHaveURL(first, { timeout: 40_000 })
  for (const { page } of [two, three]) await expect(page).toHaveURL(MATCH_URL)
  const second = two.page.url()
  expect(three.page.url()).toBe(second)
  await expect(host.page.getByTestId('tournament-info')).toHaveAttribute('data-round', '2', { timeout: 20_000 })

  // Rounds 2 and 3 are played out; then it is over and the standings are final.
  await runSql(`select private.finish_match('${second.split('/').pop()}', 'draw', null, 'agreement')`)
  for (const { page } of [two, three]) await expect(page).not.toHaveURL(second, { timeout: 40_000 })
  const third = two.page.url()
  await runSql(`select private.finish_match('${third.split('/').pop()}', 'win', ${idOf(1)}, 'resignation')`)
  await expect(host.page.getByTestId('tournament-info')).toHaveAttribute('data-status', 'finished', { timeout: 40_000 })
  await host.page.getByRole('tab', { name: 'Standings' }).click()
  const rows = host.page.getByTestId('tournament-standings').getByRole('listitem')
  await expect(rows).toHaveCount(2)
  // Player two: two wins and a draw, 5 points. Player three: a draw, 1 point.
  await expect(rows.nth(0)).toContainText('e2e_player2')
  await expect(rows.nth(0)).toContainText('2 W · 1 D · 0 L')
  await expect(rows.nth(1)).toContainText('0 W · 1 D · 2 L')
  for (const seat of [host, two, three]) await seat.context.close()
})
