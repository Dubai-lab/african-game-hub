// Chess through the game server: two real browsers, two real accounts, the development project,
// and the game server running on this machine. Run with: npm run on-dev -- e2e -- e2e/game-server.spec.ts
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

// Only where a game server is part of the setup (the development project's file names one).
test.skip(!process.env.VITE_GAME_SERVER_URL, 'no game server configured')

test.setTimeout(120_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { context: BrowserContext; page: Page; viaFunction: string[]; viaServer: string[] }

async function signedIn(browser: Browser, email: string, options: { stake?: string; cutOff?: boolean } = {}): Promise<Seat> {
  const { stake, cutOff } = options
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true })
  // This phone cannot reach the game server at all: every connection is dropped at once.
  if (cutOff) await context.routeWebSocket(/localhost:8787/, (ws) => ws.close())
  const page = await context.newPage()
  // A record of which road each move took.
  const viaFunction: string[] = []
  const viaServer: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/functions/v1/chess-make-move') && request.method() === 'POST') viaFunction.push(request.postData() ?? '')
  })
  page.on('websocket', (ws) => {
    if (!ws.url().includes('localhost')) return
    ws.on('framesent', (frame) => {
      if (String(frame.payload).includes('"t":"move"')) viaServer.push(String(frame.payload))
    })
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('game-chess').click()
  await page.getByTestId('game-play').click()
  await page.getByTestId('play-stake-toggle').click()
  if (stake) await page.getByRole('radio', { name: stake, exact: true }).check({ force: true })
  await expect(page.getByRole('button', { name: 'Find match' })).toBeVisible()
  return { context, page, viaFunction, viaServer }
}

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)
const pieceOn = (page: Page, name: string) => square(page, name).locator('[data-piece]')
const moves = (page: Page) => page.getByRole('list', { name: 'Moves' }).getByRole('button')
async function tapMove(page: Page, from: string, to: string) {
  await square(page, from).click()
  await square(page, to).click()
}

async function startGame(one: Seat, two: Seat): Promise<[Seat, Seat]> {
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/chess\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByTestId('chess-board')).toBeVisible()
  }
  const whiteAtBottom = async (page: Page) => (await square(page, 'a1').boundingBox())!.y > (await square(page, 'a8').boundingBox())!.y
  return (await whiteAtBottom(one.page)) ? [one, two] : [two, one]
}

/** Plays a move and reports how long the opponent's screen took to show it. */
async function timed(mover: Page, watcher: Page, from: string, to: string): Promise<number> {
  const started = Date.now()
  await tapMove(mover, from, to)
  await expect(pieceOn(watcher, to)).toHaveCount(1, { timeout: 15_000 })
  return Date.now() - started
}

test('a staked game played through the game server: every move takes the quick road, and the winner is paid', async ({ browser }) => {
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email, { stake: '100' })
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email, { stake: '100' })
  const errors: string[] = []
  for (const { page } of [one, two]) page.on('pageerror', (error) => errors.push(error.message))
  const [white, black] = await startGame(one, two)
  // Give both connections a moment to be admitted.
  await white.page.waitForTimeout(2500)

  // Fool's mate. Each move must reach the other screen.
  const times = [
    await timed(white.page, black.page, 'f2', 'f3'),
    await timed(black.page, white.page, 'e7', 'e5'),
    await timed(white.page, black.page, 'g2', 'g4'),
    await timed(black.page, white.page, 'd8', 'h4'),
  ]
  console.log(`opponent saw each move after (ms, includes the test's own tapping): ${times.join(', ')}`)

  await expect(black.page.getByRole('heading', { name: 'You won' })).toBeVisible({ timeout: 20_000 })
  await expect(white.page.getByRole('heading', { name: 'You lost' })).toBeVisible({ timeout: 20_000 })
  await expect(moves(white.page)).toHaveText(['f3', 'e5', 'g4', 'Qh4#'])
  await expect(moves(black.page)).toHaveText(['f3', 'e5', 'g4', 'Qh4#'])

  // All four moves went over the open connection, none through the Edge Function.
  expect(white.viaServer.length + black.viaServer.length).toBe(4)
  expect(white.viaFunction.length + black.viaFunction.length).toBe(0)

  // The database recorded the game and settled it once, exactly as it does for the other road.
  await expect(black.page.getByTestId('game-over-tokens')).toHaveText(/\+80/, { timeout: 20_000 })
  const [match] = await runSql<{ status: string; end_reason: string; settled: boolean; plies: number }>(
    `select m.status, m.end_reason, m.settled, (select count(*)::int from public.chess_moves mv where mv.match_id = m.id) as plies
       from public.matches m where m.id = '${white.page.url().split('/').pop()}'`,
  )
  expect(match).toEqual({ status: 'finished', end_reason: 'checkmate', settled: true, plies: 4 })
  expect(await runSql(`select * from public.verify_ledger_integrity()`)).toEqual([])
  expect(errors).toEqual([])
  await one.context.close()
  await two.context.close()
})

test('without the game server the same game is played through the Edge Functions, and the two roads mix safely', async ({ browser }) => {
  // One player's phone cannot reach the game server at all.
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email, { cutOff: true })
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email)
  const [white, black] = await startGame(one, two)
  await white.page.waitForTimeout(2500)

  await tapMove(white.page, 'e2', 'e4')
  await expect(pieceOn(black.page, 'e4')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(black.page, 'e7', 'e5')
  await expect(pieceOn(white.page, 'e5')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(white.page, 'g1', 'f3')
  await expect(pieceOn(black.page, 'f3')).toHaveCount(1, { timeout: 15_000 })
  await tapMove(black.page, 'b8', 'c6')
  await expect(pieceOn(white.page, 'c6')).toHaveCount(1, { timeout: 15_000 })

  await expect(moves(white.page)).toHaveText(['e4', 'e5', 'Nf3', 'Nc6'])
  await expect(moves(black.page)).toHaveText(['e4', 'e5', 'Nf3', 'Nc6'])
  // The cut-off player used the Edge Function for both moves; the other used the game server.
  expect(one.viaFunction.length).toBe(2)
  expect(one.viaServer.length).toBe(0)
  expect(two.viaServer.length).toBe(2)
  expect(two.viaFunction.length).toBe(0)

  // A refresh in the middle changes nothing.
  await two.page.reload()
  await expect(moves(two.page)).toHaveText(['e4', 'e5', 'Nf3', 'Nc6'], { timeout: 20_000 })
  await one.context.close()
  await two.context.close()
})
