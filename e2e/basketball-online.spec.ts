// Street basketball online: two real browsers, two real accounts, the development project, and
// the game server running on this machine, which runs the match.
// Run with: npm run on-dev -- e2e -- e2e/basketball-online.spec.ts
import { type Browser, expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.skip(!process.env.VITE_GAME_SERVER_URL, 'no game server configured')

test.setTimeout(300_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Seat = { page: Page; states: number[][][]; sent: string[] }

async function signedIn(browser: Browser, email: string): Promise<Seat> {
  // A phone held sideways, as the game is played.
  const context = await browser.newContext({ viewport: { width: 851, height: 393 }, locale: 'en-US', hasTouch: true })
  const page = await context.newPage()
  const states: number[][][] = []
  const sent: string[] = []
  page.on('websocket', (ws) => {
    if (!ws.url().includes('localhost')) return
    ws.on('framereceived', (frame) => {
      const text = String(frame.payload)
      if (text.startsWith('{"t":"state"')) states.push((JSON.parse(text) as { s: { p: number[][] } }).s.p)
    })
    ws.on('framesent', (frame) => {
      if (String(frame.payload).includes('"t":"in"')) sent.push(String(frame.payload))
    })
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-basketball')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('game-basketball').click()
  await page.getByTestId('game-play').click()
  await expect(page).toHaveURL(/\/play\/basketball\/new$/)
  return { page, states, sent }
}

test('two players are matched, play on the game server, and one who leaves loses', async ({ browser }) => {
  const one = await signedIn(browser, TEST_ACCOUNTS[0]!.email)
  const two = await signedIn(browser, TEST_ACCOUNTS[1]!.email)
  const errors: string[] = []
  for (const { page } of [one, two]) page.on('pageerror', (error) => errors.push(error.message))

  await one.page.getByRole('button', { name: 'Find match' }).click()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/basketball\/match\/[0-9a-f-]{36}$/, { timeout: 60_000 })
    await expect(page.getByTestId('basketball-online')).toHaveAttribute('data-stage', 'playing', { timeout: 60_000 })
  }
  expect(one.page.url()).toBe(two.page.url())
  const matchId = one.page.url().split('/').pop()!

  // Both are sent the court, many times a second.
  await expect.poll(() => one.states.length, { timeout: 15_000 }).toBeGreaterThan(30)
  await expect.poll(() => two.states.length, { timeout: 15_000 }).toBeGreaterThan(30)

  // Player one holds the stick: the server moves them, and player two sees it.
  const [game] = await runSql<{ seat: string; username: string }>(
    `select mp.seat, p.username from public.match_players mp join public.profiles p on p.id = mp.user_id where mp.match_id = '${matchId}' and p.username = '${TEST_ACCOUNTS[0]!.username}'`,
  )
  const id = game!.seat === 'a1' ? 0 : 1
  await one.page.waitForTimeout(1500)
  const before = two.states.at(-1)![id]!
  await one.page.keyboard.down('d')
  await one.page.waitForTimeout(1500)
  await one.page.keyboard.up('d')
  await one.page.waitForTimeout(500)
  const after = two.states.at(-1)![id]!
  expect(Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!)).toBeGreaterThan(1)
  expect(one.sent.length).toBeGreaterThan(3)
  // Buttons only: nothing in what a phone sends says where anyone is or what the score is.
  for (const message of one.sent) expect(Object.keys(JSON.parse(message) as object).sort()).toEqual(['i', 't'])

  // Player one leaves. After the time allowed, player two wins.
  await one.page.close()
  await expect(two.page.getByTestId('game-over')).toBeVisible({ timeout: 60_000 })
  await expect(two.page.getByTestId('game-over')).toHaveAttribute('data-tone', 'win')
  await expect
    .poll(async () => (await runSql<{ status: string; end_reason: string; settled: boolean }>(`select status, end_reason, settled from public.matches where id = '${matchId}'`))[0], { timeout: 20_000 })
    .toMatchObject({ status: 'finished', end_reason: 'abandoned', settled: true })
  expect(errors).toEqual([])
})
