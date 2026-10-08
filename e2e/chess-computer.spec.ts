import { expect, type Page, test } from '@playwright/test'
import { TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const email = 'e2e-player@example.com'
const password = TEST_PASSWORD

async function openComputerSetup(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/)
  await page.getByRole('link', { name: 'Play the computer' }).click()
  await expect(page.getByRole('heading', { name: 'Play the computer' })).toBeVisible()
}

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)
const moves = (page: Page) => page.getByRole('list', { name: 'Moves' }).getByRole('button')

test('the engine is real Stockfish and finds a forced mate', async ({ page }) => {
  await page.goto('/')
  // Straight to the worker, exactly as the app talks to it: text in, text out.
  const best = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker('/engine/stockfish.wasm.js')
        const timer = setTimeout(() => reject(new Error('engine did not answer')), 25_000)
        let name = ''
        worker.onmessage = (event) => {
          const line = String(event.data)
          if (line.startsWith('id name')) name = line.slice(8)
          if (line.startsWith('bestmove')) {
            clearTimeout(timer)
            worker.terminate()
            resolve(`${name} | ${line.split(' ')[1]}`)
          }
        }
        worker.postMessage('uci')
        // White mates in one with the rook: Ra8#.
        worker.postMessage('position fen 6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1')
        worker.postMessage('go depth 6')
      }),
  )
  expect(best).toMatch(/^Stockfish.* \| a1a8$/)
})

test('playing White: the computer answers, and a move can be taken back', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openComputerSetup(page)

  await page.getByText('Master', { exact: true }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.getByTestId('chess-board')).toBeVisible()
  // A clock by default, as in a real game: five minutes each, not yet running.
  await expect(page.getByRole('timer')).toHaveCount(2)
  await expect(page.getByTestId('clock-w')).toHaveText('5:00')
  await expect(page.getByTestId('clock-b')).toHaveText('5:00')
  await expect(page.getByTestId('player-w')).toContainText('E2E Player')
  await expect(page.getByTestId('player-b')).toContainText('Computer')

  await square(page, 'e2').click()
  await square(page, 'e4').click()
  await expect(moves(page)).toHaveCount(1)
  // The computer replies by itself with a legal move for Black.
  await expect(moves(page)).toHaveCount(2, { timeout: 30_000 })
  await expect(page.getByTestId('chess-board')).toHaveAttribute('data-turn', 'w')
  // Both sides have moved: the player's clock is the one running, and the computer spent some time.
  await expect(page.getByTestId('clock-w')).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId('clock-b')).not.toHaveText('5:00')

  // The player cannot move the computer's pieces.
  await square(page, 'g8').click()
  await expect(square(page, 'f6').locator(':scope > div')).not.toHaveCSS('background-image', /radial-gradient/)

  // Take back: both the reply and the player's own move are undone.
  await page.getByRole('button', { name: 'Take back' }).click()
  await expect(page.getByText('No moves yet')).toBeVisible()
  await expect(square(page, 'e2').locator('[data-piece]')).toHaveCount(1)

  // Resigning is worded from the player's side and ends the game as a loss.
  await square(page, 'd2').click()
  await square(page, 'd4').click()
  await expect(moves(page)).toHaveCount(2, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Resign' }).click()
  await expect(page.getByRole('dialog', { name: 'Resign this game?' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Resign' }).click()
  await expect(page.getByRole('dialog', { name: 'You lost' })).toBeVisible()

  expect(errors).toEqual([])
})

test('playing Black: the computer opens and the board faces the player', async ({ page }) => {
  await openComputerSetup(page)
  await page.getByText('Beginner', { exact: true }).click()
  await page.getByText('Black', { exact: true }).click()
  // Relaxed practice: the clock can be switched off.
  await page.getByRole('checkbox', { name: /Play with a clock/ }).uncheck()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.getByRole('timer')).toHaveCount(0)

  // White (the computer) moves first without being asked.
  await expect(moves(page)).toHaveCount(1, { timeout: 30_000 })
  // Black's pieces are at the bottom of the screen.
  const h8 = (await square(page, 'h8').boundingBox())!
  const a1 = (await square(page, 'a1').boundingBox())!
  expect(h8.y).toBeGreaterThan(a1.y)
  expect(h8.x).toBeLessThan(a1.x)

  await square(page, 'e7').click()
  await square(page, 'e5').click()
  await expect(moves(page)).toHaveCount(3, { timeout: 30_000 })

  // The chosen level and colour are remembered for next time.
  await page.getByRole('link', { name: 'Lobby' }).click()
  await page.getByRole('link', { name: 'Play the computer' }).click()
  await expect(page.getByRole('radio', { name: /Beginner/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Black' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Play with a clock/ })).not.toBeChecked()
  // Put the default back for the next run.
  await page.getByRole('checkbox', { name: /Play with a clock/ }).check()
  await page.getByText('White', { exact: true }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await expect(page.getByRole('timer')).toHaveCount(2)
})
