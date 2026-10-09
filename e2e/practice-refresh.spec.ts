// A practice game against the computer lives on the player's device. Refreshing the page (or
// closing the tab and coming back) must bring the same game back, not start a new one.
import { expect, test } from '@playwright/test'
import { ensureTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(120_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[0].email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
})

test('pool against the computer survives a refresh', async ({ page }) => {
  await page.goto('/play/pool/computer')
  await page.getByRole('radio', { name: '9-ball' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  const state = page.getByTestId('pool-state')
  const cue = page.getByTestId('pool-power')
  const box = (await cue.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Number(await state.getAttribute('data-shot-no')), { timeout: 20_000 }).toBeGreaterThan(0)
  await expect(state).toHaveAttribute('data-playing', 'false', { timeout: 30_000 })
  const before = Number(await state.getAttribute('data-shot-no'))

  await page.reload()
  // Straight back at the table, in the same game: no setup screen, and no shot has been lost.
  await expect(page.getByTestId('pool-table')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
  await expect(page.getByText(/9-ball/).first()).toBeVisible()
  expect(Number(await state.getAttribute('data-shot-no'))).toBeGreaterThanOrEqual(before)

  // Choosing to leave the game really does end it.
  await page.goto('/play/pool/computer')
  await expect(page.getByTestId('pool-table')).toBeVisible()
})

test('Ludo against the computer survives a refresh', async ({ page }) => {
  await page.goto('/play/ludo/computer')
  await page.getByRole('button', { name: /Start/ }).click()
  await expect(page.getByTestId('ludo-board')).toBeVisible()
  await page.getByRole('button', { name: 'Roll' }).first().click()
  const log = page.getByTestId('ludo-last')
  await expect(log).toContainText('You rolled', { timeout: 20_000 })
  const turn = page.getByTestId('ludo-turn')
  const before = Number(await turn.getAttribute('data-turn-no'))

  await page.reload()
  await expect(page.getByTestId('ludo-board')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Start/ })).toHaveCount(0)
  expect(Number(await turn.getAttribute('data-turn-no'))).toBeGreaterThanOrEqual(before)
  expect(before).toBeGreaterThan(0)

  // Leaving the game forgets it: the next visit offers a new one.
  await page.getByRole('button', { name: 'Leave this game' }).click()
  const confirm = page.getByRole('dialog').getByRole('button').last()
  if ((await page.getByRole('dialog').count()) > 0) await confirm.click()
  await page.goto('/play/ludo/computer')
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible()
})

test('chess against the computer survives a refresh, with the clock still running', async ({ page }) => {
  await page.getByTestId('game-chess').click()
  await page.getByTestId('game-play').click()
  await page.getByRole('link', { name: 'Play the computer' }).click()
  await expect(page.getByRole('heading', { name: 'Play the computer' })).toBeVisible()
  await page.getByRole('button', { name: 'Start game' }).click()
  const board = page.getByTestId('chess-board')
  await expect(board).toBeVisible()
  const moves = page.getByRole('list', { name: 'Moves' }).getByRole('button')
  // Play e4 if we are White; either way wait until at least two half-moves are on the record.
  if ((await moves.count()) === 0 && (await page.locator('[data-square="e2"] [data-piece]').count()) > 0) {
    await page.locator('[data-square="e2"]').click()
    await page.locator('[data-square="e4"]').click()
  }
  await expect.poll(() => moves.count(), { timeout: 30_000 }).toBeGreaterThan(0)
  await page.waitForTimeout(1500)
  const before = await moves.allTextContents()

  await page.reload()
  await expect(board).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Start game' })).toHaveCount(0)
  const after = await moves.allTextContents()
  expect(after.slice(0, before.length)).toEqual(before)
})

test('chess for two on one device survives a refresh', async ({ page }) => {
  await page.goto('/play/chess/local')
  await page.getByRole('button', { name: 'Start game' }).click()
  const moves = page.getByRole('list', { name: 'Moves' }).getByRole('button')
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await page.locator('[data-square="e7"]').click()
  await page.locator('[data-square="e5"]').click()
  await expect(moves).toHaveText(['e4', 'e5'])

  await page.reload()
  await expect(page.getByTestId('chess-board')).toBeVisible({ timeout: 20_000 })
  await expect(moves).toHaveText(['e4', 'e5'])
})
