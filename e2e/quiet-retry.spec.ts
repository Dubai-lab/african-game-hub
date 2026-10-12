// A move goes over the open connection to the game server. When that connection lets a move
// down, the player must not be alarmed: the move is sent again by the other road, and the
// game goes on. Two real browsers, the development project, and the game server on this machine.
import { type Browser, expect, type Page, test } from '@playwright/test'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.skip(!process.env.VITE_GAME_SERVER_URL, 'no game server configured')
test.setTimeout(180_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

type Line = { silent: boolean; refuse: boolean; sent: number }

/** A signed-in player whose line to the game server can be made to fail in the ways real lines do. */
async function signedIn(browser: Browser, index: number) {
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US', hasTouch: true })
  const page = await context.newPage()
  const line: Line = { silent: false, refuse: false, sent: 0 }
  await page.routeWebSocket(/localhost:8787/, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((message) => {
      const text = String(message)
      if (!text.includes('"t":"move"')) return server.send(message)
      line.sent++
      // Gone quiet: a phone that changed network. The move goes nowhere and nothing comes back.
      if (line.silent) return
      // The server no longer knows the sign-in (it lasts an hour): it says so and hangs up.
      if (line.refuse) {
        ws.send(JSON.stringify({ t: 'ack', id: (JSON.parse(text) as { id: number }).id, ok: false, code: 'NOT_AUTHENTICATED' }))
        return ws.close({ code: 4401, reason: 'sign in again' })
      }
      server.send(message)
    })
  })
  const functionCalls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/functions/v1/ludo-action') && /"action":"(roll|move)"/.test(request.postData() ?? '')) functionCalls.push(request.postData() ?? '')
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[index]!.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
  return { page, line, functionCalls }
}
const turnNo = async (page: Page) => Number(await page.getByTestId('ludo-turn').getAttribute('data-turn-no'))
/** Anything red on the screen: a message that something went wrong. */
const alarms = (page: Page) => page.getByText(/could not reach the server|session has ended|went wrong/i)

test('Ludo: a connection that goes quiet, or a sign-in the server has forgotten, costs the player nothing', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  for (const { page } of [one, two]) {
    await page.getByText('Ludo', { exact: true }).click()
    await page.getByTestId('game-play').click()
    await expect(page).toHaveURL(/\/play\/ludo\/new$/)
  }
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/ludo\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByTestId('ludo-board')).toBeVisible()
  }
  // Time for both lines to the game server to open.
  await one.page.waitForTimeout(3000)

  /** Whoever may throw, throws; a piece that must be chosen is chosen. Returns who threw. */
  async function throwOnce() {
    for (let i = 0; i < 20; i++) {
      for (const seat of [one, two]) {
        const roll = seat.page.getByRole('button', { name: 'Roll' }).first()
        if ((await roll.count()) > 0 && (await roll.isEnabled())) {
          const before = await turnNo(seat.page)
          const [sent, called] = [seat.line.sent, seat.functionCalls.length]
          await roll.click()
          // (Up to the eight seconds the app waits for an answer, and then the other road.)
          await expect.poll(() => turnNo(seat.page), { timeout: 30_000 }).toBeGreaterThan(before)
          return { seat, byLine: seat.line.sent - sent, byFunction: seat.functionCalls.length - called }
        }
        await seat.page.locator('[data-testid^="piece-"][data-movable="true"]').first().click({ timeout: 400 }).catch(() => undefined)
      }
      await one.page.waitForTimeout(700)
    }
    throw new Error('nobody could throw')
  }

  // As it should be: the throw goes over the open connection, and only there.
  const normal = await throwOnce()
  expect(normal).toMatchObject({ byLine: 1, byFunction: 0 })

  // The line goes quiet. The throw still happens (by the other road), and nothing red is shown.
  for (const seat of [one, two]) seat.line.silent = true
  const quiet = await throwOnce()
  expect(quiet.byLine).toBe(1)
  expect(quiet.byFunction).toBe(1)
  for (const { page } of [one, two]) await expect(alarms(page)).toHaveCount(0)
  for (const seat of [one, two]) seat.line.silent = false

  // The server has forgotten the sign-in. Again the throw happens, and nothing red is shown.
  await one.page.waitForTimeout(2500)
  for (const seat of [one, two]) seat.line.refuse = true
  const refused = await throwOnce()
  expect(refused.byFunction).toBe(1)
  for (const { page } of [one, two]) await expect(alarms(page)).toHaveCount(0)
  for (const seat of [one, two]) seat.line.refuse = false

  // And the line comes back by itself: a later throw is over the connection again.
  await one.page.waitForTimeout(3500)
  let back = false
  for (let i = 0; i < 4 && !back; i++) {
    const again = await throwOnce()
    back = again.byLine === 1 && again.byFunction === 0
  }
  expect(back).toBe(true)
  for (const { page } of [one, two]) await expect(alarms(page)).toHaveCount(0)
})
