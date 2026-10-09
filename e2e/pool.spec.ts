// Pool between two real browsers and accounts, through the hosted project. The break is played
// for real; the ending is reached by putting the stored table one shot from a win and playing
// that shot, so the server's physics, rules and settlement are all exercised.
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
    if (request.url().includes('/functions/v1/pool-action') && /"action":"(shoot)"/.test(request.postData() ?? '')) roads.edge++
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[index]!.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
  return { context, page }
}

const state = (page: Page) => page.getByTestId('pool-state')
const shotNo = async (page: Page) => Number(await state(page).getAttribute('data-shot-no'))
const cue = (page: Page) => page.getByTestId('pool-power')
/** Pulls the cue beside the table back by this much of its travel (0 to 1) and lets go. */
async function pullCue(page: Page, power: number) {
  const box = (await cue(page).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height * 0.25
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + box.height * 0.55 * power, { steps: 5 })
  await page.mouse.up()
}

test('two players are paired at 9-ball, the break is played on the server, and pocketing the 9 pays out', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  const errors: string[] = []
  for (const { page } of [one, two]) page.on('pageerror', (error) => errors.push(error.message))

  for (const { page } of [one, two]) {
    await page.getByText('Pool', { exact: true }).click()
    await page.getByTestId('game-play').click()
    // How to play and the stake each open from their own row.
    await page.getByTestId('play-options-toggle').click()
    await page.getByTestId('play-stake-toggle').click()
    await expect(page).toHaveURL(/\/play\/pool\/new$/)
    // 8-ball is offered first; this test plays 9-ball.
    await expect(page.getByRole('radio', { name: /^8-ball/ })).toBeChecked()
    await page.getByText('9-ball', { exact: true }).click()
    await expect(page.getByRole('radio', { name: /^9-ball/ })).toBeChecked()
    await page.getByText('100', { exact: true }).click()
  }
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) {
    await expect(page).toHaveURL(/\/play\/pool\/match\/[0-9a-f-]{36}$/, { timeout: 20_000 })
    await expect(page.getByTestId('pool-table')).toBeVisible()
  }
  expect(one.page.url()).toBe(two.page.url())
  const matchId = one.page.url().split('/').pop()!

  // Seat 1 breaks, with the cue ball in hand behind the line. Only that player has the controls.
  await expect(state(one.page)).toHaveAttribute('data-turn', '1')
  await expect(one.page.getByText(/^(Your break|Waiting for )/)).toBeVisible()
  const oneBreaks = (await cue(one.page).count()) > 0
  const [first, second] = oneBreaks ? [one.page, two.page] : [two.page, one.page]
  await expect(first.getByText('Your break: place the cue ball, then pull the cue')).toBeVisible()
  await expect(cue(second)).toHaveCount(0)
  await expect(second.getByText(/^Waiting for /)).toBeVisible()

  // The break, straight down the table at full power.
  await pullCue(first, 1)
  for (const page of [first, second]) {
    await expect.poll(() => shotNo(page), { timeout: 20_000 }).toBe(1)
    await expect(state(page)).toHaveAttribute('data-playing', 'false', { timeout: 30_000 })
  }
  // Both screens agree on whose shot it is now.
  expect(await state(first).getAttribute('data-turn')).toBe(await state(second).getAttribute('data-turn'))
  const [shots] = await runSql<{ n: number }>(`select count(*)::int as n from public.pool_shots where match_id = '${matchId}'`)
  expect(shots!.n).toBe(1)

  // One shot from the end: only the 9 is left, a short straight shot from a corner pocket.
  await runSql(`
    update public.pool_games
       set balls = '[{"n":0,"x":2250,"y":980,"in":false},{"n":9,"x":2440,"y":1170,"in":false},{"n":1,"x":0,"y":0,"in":true},{"n":2,"x":0,"y":0,"in":true},{"n":3,"x":0,"y":0,"in":true},{"n":4,"x":0,"y":0,"in":true},{"n":5,"x":0,"y":0,"in":true},{"n":6,"x":0,"y":0,"in":true},{"n":7,"x":0,"y":0,"in":true},{"n":8,"x":0,"y":0,"in":true}]',
           turn = '1', break_shot = false, ball_in_hand = false, fouls = '{"1":0,"2":0}', acted = '{"1":true,"2":true}',
           last_shot = null, shot_no = shot_no + 1, deadline = now() + interval '30 seconds'
     where match_id = '${matchId}'`)
  await expect(first.getByText('Your shot')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => shotNo(second), { timeout: 20_000 }).toBe(2)

  // The cue is already pointed at the 9, which sits straight in front of the corner. Medium power.
  await pullCue(first, 0.45)

  await expect(first.getByRole('dialog', { name: 'You won' })).toBeVisible({ timeout: 30_000 })
  await expect(second.getByRole('dialog', { name: 'You lost' })).toBeVisible({ timeout: 30_000 })
  for (const page of [first, second]) await expect(page.getByTestId('game-over-reason')).toHaveText('The 9 ball was pocketed.')
  // 200 in the pot, 10% to the house.
  await expect(first.getByTestId('game-over-tokens')).toContainText('+80')
  await expect(second.getByTestId('game-over-tokens')).toContainText('−100')
  // Pool players are known by their wins, not a rating number.
  await expect(first.getByTestId('game-over-wins')).toHaveText(/9-ball games won\s*1/)
  await expect(second.getByTestId('game-over-wins')).toHaveText(/9-ball games won\s*0/)
  await expect(first.getByTestId('pool-player-1')).toContainText('1 win')

  const [match] = await runSql<{ status: string; end_reason: string; settled: boolean }>(`select status, end_reason, settled from public.matches where id = '${matchId}'`)
  expect(match).toMatchObject({ status: 'finished', end_reason: 'nine_ball', settled: true })
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

test('8-ball: the 8 is a called shot, and going down in the called pocket wins', async ({ browser }) => {
  const one = await signedIn(browser, 0)
  const two = await signedIn(browser, 1)
  for (const { page } of [one, two]) {
    await page.getByText('Pool', { exact: true }).click()
    await page.getByTestId('game-play').click()
    // How to play and the stake each open from their own row.
    await page.getByTestId('play-options-toggle').click()
    await page.getByTestId('play-stake-toggle').click()
    await expect(page.getByRole('radio', { name: /^8-ball/ })).toBeChecked()
    await page.getByText('100', { exact: true }).click()
  }
  await one.page.getByRole('button', { name: 'Find match' }).click()
  await expect(one.page.getByRole('heading', { name: 'Looking for an opponent…' })).toBeVisible()
  await two.page.getByRole('button', { name: 'Find match' }).click()
  for (const { page } of [one, two]) await expect(page.getByTestId('pool-table')).toBeVisible({ timeout: 20_000 })
  const matchId = one.page.url().split('/').pop()!
  await expect(one.page.getByText(/^(Your break|Waiting for )/)).toBeVisible()
  const oneBreaks = (await cue(one.page).count()) > 0
  const [first, second] = oneBreaks ? [one.page, two.page] : [two.page, one.page]

  // Seat 1 has the solids and has cleared them: only the 8 is left for them, in front of a corner pocket.
  await runSql(`
    update public.pool_games
       set balls = '[{"n":0,"x":2250,"y":980,"in":false},{"n":8,"x":2440,"y":1170,"in":false},{"n":12,"x":600,"y":300,"in":false},{"n":1,"x":0,"y":0,"in":true},{"n":2,"x":0,"y":0,"in":true},{"n":3,"x":0,"y":0,"in":true},{"n":4,"x":0,"y":0,"in":true},{"n":5,"x":0,"y":0,"in":true},{"n":6,"x":0,"y":0,"in":true},{"n":7,"x":0,"y":0,"in":true}]',
           turn = '1', solids_seat = '1', break_shot = false, ball_in_hand = false, acted = '{"1":true,"2":true}',
           last_shot = null, shot_no = shot_no + 1, deadline = now() + interval '30 seconds'
     where match_id = '${matchId}'`)
  await expect(first.getByText('Call the 8: touch the pocket you will put it in')).toBeVisible({ timeout: 20_000 })
  await expect(cue(first)).toHaveAttribute('aria-disabled', 'true')
  // The cards say what each player has left.
  await expect(first.getByTestId('pool-player-1')).toContainText('Solids')
  await expect(first.getByTestId('pool-player-2')).toContainText('Stripes')

  // Touch the pocket behind the 8. (On a phone the table stands upright: that pocket is top right.)
  const box = (await first.getByTestId('pool-table').boundingBox())!
  await first.getByTestId('pool-table').click({ position: { x: box.width * 0.904, y: box.height * 0.053 } })
  await expect(state(first)).toHaveAttribute('data-called', '5')
  await expect(first.getByText('Your shot')).toBeVisible()

  // The opponent's screen is watched while the balls roll: the cards must go on showing the
  // shooter at the table until they stop. (The roll is short, so it is recorded in the page.)
  await second.evaluate(() => {
    const table = document.querySelector<HTMLElement>('[data-testid="pool-state"]')!
    const seen = { rolled: false, early: false }
    ;(window as unknown as { poolSeen: typeof seen }).poolSeen = seen
    new MutationObserver(() => {
      if (table.dataset.playing !== 'true') return
      seen.rolled = true
      if (document.querySelector<HTMLElement>('[data-testid="pool-player-1"]')?.dataset.toShoot !== 'true') seen.early = true
    }).observe(document.body, { subtree: true, attributes: true })
  })
  await pullCue(first, 0.45)

  await expect(first.getByRole('dialog', { name: 'You won' })).toBeVisible({ timeout: 30_000 })
  await expect(second.getByRole('dialog', { name: 'You lost' })).toBeVisible({ timeout: 30_000 })
  await expect(first.getByTestId('game-over-reason')).toHaveText('The 8 ball was pocketed.')
  expect(await second.evaluate(() => (window as unknown as { poolSeen: unknown }).poolSeen)).toEqual({ rolled: true, early: false })
  const [shot] = await runSql<{ pocket: number }>(`select (shot ->> 'pocket')::int as pocket from public.pool_shots where match_id = '${matchId}' order by shot_no desc limit 1`)
  expect(shot!.pocket).toBe(5)
  await one.context.close()
  await two.context.close()
})

test('practice against the computer, with the cloth chosen in Settings', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 0)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // Pool keeps its settings on its own page.
  await page.goto('/play/pool/settings')
  const section = page.getByRole('region', { name: 'Pool settings' })
  await expect(section.getByRole('radio', { name: 'Green' })).toBeChecked()
  await section.getByRole('radio', { name: 'Blue' }).click()
  await expect(section.getByRole('radio', { name: 'Blue' })).toBeChecked()
  await section.getByRole('radio', { name: 'Short' }).click()
  await expect(section.getByRole('radio', { name: 'Short' })).toBeChecked()

  // From the lobby, Practice leads to the computer.
  await page.goto('/lobby')
  await page.getByText('Pool', { exact: true }).click()
    await page.getByTestId('game-play').click()
    // How to play and the stake each open from their own row.
    await page.getByTestId('play-options-toggle').click()
    await page.getByTestId('play-stake-toggle').click()
  await page.getByRole('link', { name: 'Play pool against the computer' }).click()
  await expect(page.getByRole('heading', { name: 'Pool against the computer' })).toBeVisible()
  await page.getByRole('radio', { name: '9-ball' }).click()
  await page.getByRole('radio', { name: 'Hard' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('pool-table')).toBeVisible()
  await expect(page.getByText('Your break: place the cue ball, then pull the cue')).toBeVisible()

  // Play until the computer has had a turn at the table and played it.
  let computerPlayed = false
  for (let i = 0; i < 8 && !computerPlayed; i++) {
    const before = await shotNo(page)
    await pullCue(page, i === 0 ? 1 : 0.3)
    await expect.poll(() => shotNo(page), { timeout: 20_000 }).toBeGreaterThan(before)
    await expect(state(page)).toHaveAttribute('data-playing', 'false', { timeout: 30_000 })
    if ((await page.getByRole('dialog').count()) > 0) break
    if ((await state(page).getAttribute('data-turn')) === '2') {
      const mine = await shotNo(page)
      await expect.poll(() => shotNo(page), { timeout: 30_000 }).toBeGreaterThan(mine)
      computerPlayed = true
    }
  }
  expect(computerPlayed).toBe(true)
  expect(errors).toEqual([])
  await context.close()
})
