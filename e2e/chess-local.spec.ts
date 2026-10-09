import { expect, type Page, test } from '@playwright/test'
import { TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const email = 'e2e-player@example.com'
const password = TEST_PASSWORD

async function openLocalGame(page: Page, query = '') {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/)
  if (query) {
    await page.goto(`/play/chess/local${query}`)
  } else {
    await page.getByTestId('game-chess').click()
    await page.getByTestId('game-play').click()
    await page.getByRole('link', { name: 'Play on this device' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Two players, one phone' })).toBeVisible()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.getByTestId('chess-board')).toBeVisible()
}

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)

/** Tap-to-move: tap the piece, then the destination. */
async function tapMove(page: Page, from: string, to: string) {
  await square(page, from).click()
  await square(page, to).click()
}

/** The layer of a square that carries move hints, check and last-move highlights. */
const hintLayer = (page: Page, name: string) => square(page, name).locator(':scope > div')

const pieceOn = (page: Page, name: string) => square(page, name).locator('[data-piece]')

test('a full game by tapping: hints, clocks, captures, checkmate, review and rematch', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openLocalGame(page)

  // Clocks wait for the first move.
  await expect(page.getByTestId('clock-w')).toHaveText('5:00')
  await expect(page.getByTestId('clock-w')).toHaveAttribute('data-active', 'false')

  // Selecting a piece shows where it may go; an illegal destination does nothing.
  await square(page, 'e2').click()
  await expect(hintLayer(page, 'e4')).toHaveCSS('background-image', /radial-gradient/)
  await expect(hintLayer(page, 'e5')).not.toHaveCSS('background-image', /radial-gradient/)
  await square(page, 'e5').click()
  await expect(pieceOn(page, 'e2')).toHaveCount(1)

  // It is White's turn: Black's pieces cannot be picked up.
  await square(page, 'e7').click()
  await expect(hintLayer(page, 'e5')).not.toHaveCSS('background-image', /radial-gradient/)

  await tapMove(page, 'e2', 'e4')
  await expect(pieceOn(page, 'e4')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'e4', exact: true })).toBeVisible()
  // White moved, so Black's clock is now the one running.
  await expect(page.getByTestId('clock-b')).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId('clock-w')).toHaveAttribute('data-active', 'false')

  await tapMove(page, 'f7', 'f5')
  // A capturable piece gets a ring, and capturing shows the taken pawn and the material lead.
  await square(page, 'e4').click()
  await expect(hintLayer(page, 'f5')).toHaveCSS('background-image', /radial-gradient/)
  await square(page, 'f5').click()
  await expect(page.getByRole('button', { name: 'exf5' })).toBeVisible()
  await expect(page.getByTestId('captured-w').locator('img')).toHaveCount(1)
  await expect(page.getByTestId('captured-w')).toContainText('+1')

  // Black walks into a quick mate: 1.e4 f5 2.exf5 g5 3.Qh5#
  await tapMove(page, 'g7', 'g5')
  await tapMove(page, 'd1', 'h5')

  await expect(page.getByRole('dialog', { name: 'White wins' })).toBeVisible()
  await expect(page.getByTestId('game-over-reason')).toHaveText('By checkmate.')
  // The mated king is highlighted.
  await expect(hintLayer(page, 'e8')).toHaveCSS('background-image', /radial-gradient/)
  // Both clocks have stopped.
  await expect(page.getByTestId('clock-w')).toHaveAttribute('data-active', 'false')
  await expect(page.getByTestId('clock-b')).toHaveAttribute('data-active', 'false')

  // Look back through the game: the board shows earlier positions and cannot be played on.
  // The result card offers the review; it opens on the first move.
  await page.getByRole('button', { name: 'Game Review' }).click()
  await expect(pieceOn(page, 'e4')).toHaveCount(1)
  await expect(pieceOn(page, 'f7')).toHaveCount(1)
  await page.getByRole('button', { name: 'e4', exact: true }).click()
  await expect(pieceOn(page, 'e4')).toHaveCount(1)
  await expect(pieceOn(page, 'd1')).toHaveCount(1)
  await page.getByRole('button', { name: 'Previous move' }).click()
  await expect(pieceOn(page, 'e2')).toHaveCount(1)
  await square(page, 'e2').click()
  await expect(hintLayer(page, 'e4')).not.toHaveCSS('background-image', /radial-gradient/)
  await page.getByRole('list', { name: 'Moves' }).getByRole('button').last().click()
  await expect(pieceOn(page, 'h5')).toHaveCount(1)

  // The engine has gone through the game: accuracy for both sides, every move graded, and the
  // losing move called what it is, with the move that should have been played.
  await expect(page.getByTestId('review-table')).toBeVisible({ timeout: 90_000 })
  expect(Number(await page.getByTestId('accuracy-w').textContent())).toBeGreaterThan(Number(await page.getByTestId('accuracy-b').textContent()))
  await page.getByRole('list', { name: 'Moves' }).getByRole('button', { name: /^g5/ }).click()
  await expect(page.getByTestId('review-note')).toContainText('2… g5 is a blunder. Best was')
  await expect(page.getByRole('list', { name: 'Moves' }).locator('[data-grade="blunder"]')).toHaveCount(1)
  await expect(page.getByTestId('review-eval')).toHaveText('M1')

  // Rematch: a fresh board and fresh clocks.
  await page.getByRole('button', { name: 'Rematch' }).click()
  await expect(pieceOn(page, 'e2')).toHaveCount(1)
  await expect(page.getByText('No moves yet')).toBeVisible()
  await expect(page.getByTestId('clock-w')).toHaveText('5:00')

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  expect(errors).toEqual([])
})

test('dragging a piece moves it, and an illegal drop puts it back', async ({ page }) => {
  await openLocalGame(page)
  const drag = async (from: string, to: string) => {
    const a = (await square(page, from).boundingBox())!
    const b = (await square(page, to).boundingBox())!
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  await drag('g1', 'f3')
  await expect(page.getByRole('button', { name: 'Nf3' })).toBeVisible()
  await expect(pieceOn(page, 'f3')).toHaveCount(1)

  // Black tries to move a rook through its own pawn.
  await drag('a8', 'a5')
  await expect(pieceOn(page, 'a8')).toHaveCount(1)
  await expect(pieceOn(page, 'a5')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Moves' }).getByRole('button')).toHaveCount(1)
})

test('resigning asks first, and a draw needs the other player to accept', async ({ page }) => {
  await openLocalGame(page)
  await tapMove(page, 'e2', 'e4')
  await tapMove(page, 'e7', 'e5')

  await page.getByRole('button', { name: 'Offer draw' }).click()
  await expect(page.getByRole('dialog', { name: 'White offers a draw' })).toBeVisible()
  await page.getByRole('button', { name: 'Decline' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Resign' }).click()
  await expect(page.getByRole('dialog', { name: 'White resigns?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep playing' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Resign' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Resign' }).click()
  await expect(page.getByRole('dialog', { name: 'Black wins' })).toBeVisible()
  await expect(page.getByTestId('game-over-reason')).toHaveText('By resignation.')

  await page.getByRole('dialog').getByRole('button', { name: 'New game' }).click()
  await expect(page.getByRole('heading', { name: 'Two players, one phone' })).toBeVisible()
})

test('a move the referee refuses is shown at once, then gently taken back', async ({ page }) => {
  await openLocalGame(page, '?referee=reject')
  await tapMove(page, 'e2', 'e4')
  // Optimistic: the move is on the board immediately.
  await expect(pieceOn(page, 'e4')).toHaveCount(1)
  // Then the referee says no: the pawn goes home and the player is told why.
  await expect(page.getByRole('status').filter({ hasText: 'That move was not accepted' })).toBeVisible()
  await expect(pieceOn(page, 'e2')).toHaveCount(1)
  await expect(pieceOn(page, 'e4')).toHaveCount(0)
  await expect(page.getByText('No moves yet')).toBeVisible()
  await expect(page.getByTestId('clock-w')).toHaveText('5:00')
})

test('board theme, piece set and sound choices are saved to the account', async ({ page }) => {
  await openLocalGame(page)
  // Resolves when the account copy has been written with the given board theme.
  const savedWith = (theme: string) =>
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/profile_private') &&
        (response.request().postData() ?? '').includes(theme) &&
        response.ok(),
      { timeout: 20_000 },
    )

  await page.getByRole('button', { name: 'Board settings' }).click()
  let saved = savedWith('rhosgfx')
  await page.getByRole('radio', { name: 'Green' }).click()
  await page.getByRole('radio', { name: 'Rounded pieces' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(square(page, 'a1')).toHaveCSS('background-color', 'rgb(111, 154, 82)')
  await expect(pieceOn(page, 'e1').locator('img')).toHaveAttribute('src', /rhosgfx|data:image/)

  // Saved to the account (after a short delay), so it survives a cleared browser.
  await saved
  await page.evaluate(() => localStorage.removeItem('agh.settings'))
  await page.reload()
  // (The game in progress is still on the board after the refresh; no need to start another.)
  await expect(square(page, 'a1')).toHaveCSS('background-color', 'rgb(111, 154, 82)')

  // Put the defaults back for the next run.
  await page.getByRole('button', { name: 'Board settings' }).click()
  saved = savedWith('chessnut')
  await page.getByRole('radio', { name: 'Blue' }).click()
  await page.getByRole('radio', { name: 'Classic pieces' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await saved
})

test('a pawn reaching the last rank asks which piece to promote to', async ({ page }) => {
  await openLocalGame(page)
  // 1.h4 g5 2.hxg5 h6 3.gxh6 Bg7 4.hxg7 Nf6, and the pawn on g7 can now take the rook on h8.
  for (const [from, to] of [
    ['h2', 'h4'], ['g7', 'g5'], ['h4', 'g5'], ['h7', 'h6'],
    ['g5', 'h6'], ['f8', 'g7'], ['h6', 'g7'], ['g8', 'f6'],
  ] as const) {
    await tapMove(page, from, to)
  }

  await tapMove(page, 'g7', 'h8')
  const picker = page.getByRole('dialog', { name: 'Promote the pawn to' })
  await expect(picker).toBeVisible()
  // Nothing has been played yet: tapping outside the picker cancels, and the pawn stays put.
  await page.getByTestId('chess-board').click({ position: { x: 5, y: 5 } })
  await expect(picker).toHaveCount(0)
  await expect(pieceOn(page, 'g7')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Moves' }).getByRole('button')).toHaveCount(8)

  await tapMove(page, 'g7', 'h8')
  await picker.getByRole('button', { name: 'Knight' }).click()
  await expect(page.getByRole('button', { name: 'gxh8=N' })).toBeVisible()
  await expect(pieceOn(page, 'h8')).toHaveAttribute('data-piece', 'wN')
  // A bishop, a rook and two pawns taken by White; the promotion counts toward the lead as well.
  await expect(page.getByTestId('captured-w').locator('img')).toHaveCount(4)
})
