// The same app on a computer screen. Everything else in the suite runs at phone size; this
// file makes sure a wide window gets a layout made for it instead of a phone column in the middle.
import { expect, test } from '@playwright/test'
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.use({ viewport: { width: 1600, height: 900 }, isMobile: false, hasTouch: false })

test('on a computer the pages use the width and the board fills the window height', async ({ page }) => {
  await page.goto('/login')
  // Sign-in: the form sits beside a brand panel.
  await expect(page.getByText('Your move.')).toBeVisible()
  await page.getByLabel('Email').fill(TEST_ACCOUNTS[0].email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Find match' })).toBeVisible()

  // Navigation is a sidebar on the left, not a bar at the bottom.
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toHaveCount(1)
  const navBox = (await nav.boundingBox())!
  expect(navBox.x).toBeLessThan(50)
  expect(navBox.height).toBeGreaterThan(200)

  // Lobby: wallet and match setup side by side, and Find match needs no scrolling.
  const wallet = (await page.getByTestId('balance-bonus').boundingBox())!
  const find = (await page.getByRole('button', { name: 'Find match' }).boundingBox())!
  expect(find.x).toBeGreaterThan(wallet.x + 300)
  expect(find.y + find.height).toBeLessThanOrEqual(900)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

  // Against the computer: a big board with both clocks, and the moves in a panel beside it.
  await page.getByRole('link', { name: 'Play the computer' }).click()
  await page.getByRole('checkbox', { name: /Play with a clock/ }).check()
  await page.getByRole('button', { name: 'Start game' }).click()
  const board = page.getByTestId('chess-board')
  await expect(board).toBeVisible()
  await expect(page.getByRole('timer')).toHaveCount(2)

  const boardBox = (await board.boundingBox())!
  // The board takes most of the window's height (900px), not a phone-sized square.
  expect(boardBox.width).toBeGreaterThan(650)
  expect(Math.abs(boardBox.width - boardBox.height)).toBeLessThan(2)
  const movesBox = (await page.getByRole('list', { name: 'Moves' }).boundingBox())!
  expect(movesBox.x).toBeGreaterThan(boardBox.x + boardBox.width)
  // Everything fits: the page does not scroll in either direction.
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

  // The board follows the window when it is resized.
  await page.setViewportSize({ width: 1280, height: 650 })
  await expect.poll(async () => (await board.boundingBox())!.width).toBeLessThan(520)
  expect((await board.boundingBox())!.width).toBeGreaterThan(400)
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)

  // Arrow keys step through the game.
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByRole('list', { name: 'Moves' }).getByRole('button')).toHaveCount(2, { timeout: 30_000 })
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('[data-square="e2"] [data-piece]')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-square="e4"] [data-piece]')).toHaveCount(1)
})
