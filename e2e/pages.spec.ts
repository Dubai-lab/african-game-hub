// Profile, leaderboards and settings, on top of one real finished game.
import { expect, type Page, test } from '@playwright/test'
import { resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'
import { move, signInPlayers, startGame } from '../supabase/tests-live/live.ts'

test.setTimeout(120_000)

// Who won the game set up below: decided by the random colours, so the tests read it from here.
let firstPlayerWon = false

test.beforeAll(async () => {
  await resetTestAccounts()
  // One staked blitz game between the first two test accounts, played through the real
  // functions and ending in mate: 1.f3 e5 2.g4 Qh4#. Black wins.
  const [one, two] = await signInPlayers()
  const game = await startGame(one!, two!, 100)
  for (const [index, uci] of ['f2f3', 'e7e5', 'g2g4', 'd8h4'].entries()) {
    const reply = await move(index % 2 === 0 ? game.white : game.black, game.matchId, uci, index)
    if (!reply.ok) throw new Error(`setup move ${uci} refused: ${reply.code}`)
  }
  firstPlayerWon = game.black === one
})

test.afterAll(resetTestAccounts)

async function logIn(page: Page, index = 0) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[index]!.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
}

test('profile shows ratings per pace and the match history, and a past game can be replayed', async ({ page }) => {
  await logIn(page)
  await page.getByRole('link', { name: 'Profile' }).click()

  await expect(page.getByText('@e2e_player')).toBeVisible()
  await expect(page.getByText(/Rwanda/)).toBeVisible()
  // The profile is about the person: no per-game ratings here (those are on each game's home).
  await expect(page.getByText('Chess ratings')).toHaveCount(0)
  await expect(page.getByTestId('rating-blitz')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Game history' })).toBeVisible()
  // It can be shared: a link to the public profile, to copy or send on WhatsApp.
  await expect(page.getByRole('heading', { name: 'Share profile' })).toBeVisible()
  await expect(page.getByTestId('share-link')).toHaveValue(/\/players\/e2e_player$/)
  await expect(page.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\//)
  // Chess's home is where the ratings are: blitz moved with the game, bullet and rapid did not.
  await page.goto('/play/chess')
  await expect(page.getByTestId('stat-blitz')).toContainText(firstPlayerWon ? '1220' : '1180')
  await expect(page.getByTestId('stat-blitz')).toContainText(firstPlayerWon ? '1 W · 0 L · 0 D' : '0 W · 1 L · 0 D')
  await expect(page.getByTestId('stat-bullet')).toContainText('No games yet')
  await page.getByRole('link', { name: 'Profile' }).click()

  // Newest first. (The test accounts keep their older staked games, so there are more below.)
  const games = page.getByTestId('match-history').getByRole('listitem')
  await expect(games.first()).toContainText(firstPlayerWon ? 'Won' : 'Lost')
  await expect(games.first()).toContainText('e2e_player2')
  await expect(games.first()).toContainText('Chess · Blitz')
  await expect(games.first()).toContainText(firstPlayerWon ? '+20' : '-20')
  await expect(games.first()).toContainText(firstPlayerWon ? '+80 tokens' : '-100 tokens')

  // Tap the game: it opens for replay with every move.
  await games.first().getByRole('link').click()
  await expect(page).toHaveURL(/\/play\/chess\/match\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('dialog', { name: firstPlayerWon ? 'You won' : 'You lost' })).toBeVisible()
  await page.getByRole('button', { name: 'Game Review' }).click()
  // (Once the review has run, a doubtful move carries its mark, as in "g4??".)
  await expect(page.getByRole('list', { name: 'Moves' }).getByRole('button')).toHaveText([/^f3/, /^e5/, /^g4/, /^Qh4#/])
  await page.getByRole('list', { name: 'Moves' }).getByRole('button', { name: /^f3/ }).click()
  await expect(page.locator('[data-square="f3"] [data-piece]')).toHaveCount(1)
  await expect(page.locator('[data-square="e7"] [data-piece]')).toHaveCount(1)

  // The display name can be changed; the username cannot.
  await page.getByRole('link', { name: 'Lobby' }).click()
  await page.getByRole('link', { name: 'Profile' }).click()
  await page.getByRole('button', { name: 'Edit profile' }).click()
  await page.getByLabel('Display name').fill('Amina of Kigali')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Amina of Kigali')
  await expect(page.getByText('@e2e_player')).toBeVisible()
  await page.getByRole('button', { name: 'Edit profile' }).click()
  await page.getByLabel('Display name').fill('E2E Player')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Player')
})

test('leaderboards rank players per pace, for all of Africa and per country', async ({ page }) => {
  await logIn(page)
  await page.getByRole('link', { name: 'Ranks' }).click()
  await expect(page.getByRole('heading', { name: 'Leaderboards' })).toBeVisible()

  // Blitz, all of Africa: both players, the winner first.
  // The game and the pace are chosen from dropdowns, like the country.
  await expect(page.getByLabel('Game')).toHaveValue('chess')
  await expect(page.getByLabel('Ranking')).toHaveValue('blitz')
  await expect(page.getByRole('radio')).toHaveCount(0)
  const rows = page.getByTestId('leaderboard-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('1220')
  await expect(rows.nth(0)).toContainText(firstPlayerWon ? 'E2E Player' : 'e2e_player2')
  await expect(rows.nth(1)).toContainText('1180')
  await expect(page.getByText('2 ranked players')).toBeVisible()

  // One country at a time.
  await page.getByRole('button', { name: 'My country' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('E2E Player')
  await expect(page.getByText('1 ranked player')).toBeVisible()
  await page.getByLabel('Region').selectOption('NG')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('e2e_player2')
  await page.getByLabel('Region').selectOption('KE')
  await expect(page.getByText('Nobody is ranked here yet.')).toBeVisible()

  // Other paces have their own tables.
  await page.getByLabel('Region').selectOption('')
  await page.getByLabel('Ranking').selectOption('rapid')
  // Real players may be ranked at this pace; the two test players, who only played blitz, are not.
  await expect(rows.filter({ hasText: 'e2e_player' })).toHaveCount(0)

  // A name leads to that player's profile: public figures only.
  await page.getByLabel('Ranking').selectOption('blitz')
  // Another game has its own table (and, for pool, its own two rankings).
  await page.getByLabel('Game').selectOption('pool')
  await expect(page.getByLabel('Ranking')).toHaveValue('eight_ball')
  await page.getByLabel('Game').selectOption('chess')
  await page.getByLabel('Ranking').selectOption('blitz')
  await page.getByRole('link', { name: /e2e_player2/ }).click()
  await expect(page).toHaveURL(/\/players\/e2e_player2$/)
  await expect(page.getByText('@e2e_player2')).toBeVisible()
  await expect(page.getByText(/Nigeria/)).toBeVisible()
  await expect(page.getByTestId('match-history').getByRole('listitem').first()).toContainText(firstPlayerWon ? 'Lost' : 'Won')
  await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0)
  // Another player's token results are not shown.
  await expect(page.getByTestId('match-history')).not.toContainText('tokens')

  await page.goto('/players/nobody_by_this_name')
  await expect(page.getByText('There is no player with that name.')).toBeVisible()
})

test('settings: language, data saver, board choices and logging out', async ({ page }) => {
  await logIn(page)
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByText(TEST_ACCOUNTS[0].email)).toBeVisible()

  // Language applies everywhere at once.
  await page.getByLabel('Language').selectOption('fr')
  await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Portefeuille' })).toBeVisible()
  await page.getByLabel('Langue').selectOption('en')

  // The Settings page is for the system only: nothing about any game is on it.
  await expect(page.getByRole('radio', { name: 'Brown wood' })).toHaveCount(0)
  await expect(page.getByText('Game settings')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('link', { name: /Chess|Ludo|Pool/ })).toHaveCount(0)
  // A game's settings are reached from that game's own home.
  await page.goto('/play/chess')
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/play\/chess\/settings$/)
  // Board colours chosen there are used by the board,
  // even when the page is reloaded the very next moment.
  await page.getByRole('radio', { name: 'Brown wood' }).click()
  await page.goto('/play/chess/local')
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.locator('[data-square="a1"]')).toHaveCSS('background-color', 'rgb(168, 115, 74)')

  // Data saver: the home page keeps its still picture and never downloads the 3D scene.
  await page.goto('/play/chess/settings')
  await page.getByRole('region', { name: 'Chess settings' }).getByRole('radio', { name: 'Blue' }).click()
  await page.goto('/settings')
  await page.getByRole('checkbox', { name: /Data saver/ }).check()
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await page.goto('/')
  await page.waitForTimeout(3500)
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(requested.filter((url) => /HeroScene/i.test(url))).toEqual([])

  await page.goto('/settings')
  await page.getByRole('checkbox', { name: /Data saver/ }).uncheck()
  await page.waitForTimeout(2000) // let the choice reach the account before leaving

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/profile')
  await expect(page).toHaveURL(/\/login$/)
})
