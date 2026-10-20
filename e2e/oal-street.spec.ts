// One Africa Life: out in town, against the development project. A life in Monrovia goes out on
// Tubman Boulevard, walks from the junction to the money changer's kiosk, changes money there,
// and to Ma Hawa Cookshop and eats (scripts/oal/makeStreet.py); and goes to Waterside Market and
// walks to the trader's table, where the market's work is offered (scripts/oal/makeWaterside.py).
// Run with: npm run on-dev -- e2e -- e2e/oal-street.spec.ts
import { expect, type Page, test } from '@playwright/test'
import { walkIn } from './oalWorld.ts'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'
import street from '../src/games/oal/sinkorStreet.json' with { type: 'json' }
import waterside from '../src/games/oal/watersideMarket.json' with { type: 'json' }

// The test browser draws the street in software, under a frame a second on a busy machine: a
// long limit.
test.setTimeout(3_600_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const APPEARANCE = {
  version: 1, sex: 'female', skin: 0.8,
  build: { weight: 0.2, muscle: 0, height: 0 },
  face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
  hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt',
}

async function where(page: Page) {
  const view = page.getByTestId('oal-street')
  return { x: Number(await view.getAttribute('data-x')), y: Number(await view.getAttribute('data-y')) }
}

/** Walks toward a point with short presses (a test browser draws slowly), until `done`. */
async function walkTo(page: Page, x: number, y: number, done: () => Promise<boolean>, face: number[] = street.spawn.face) {
  for (let i = 0; i < 300; i++) {
    if (await done()) return
    const at = await where(page)
    const dx = x - at.x
    const dy = y - at.y
    // The arrows move relative to where the camera looks: forward (sin yaw, -cos yaw), right
    // (cos yaw, sin yaw), the camera still looking the way it started (no drag here).
    const yaw = Math.atan2(face[0]!, -face[1]!)
    const ahead = dx * Math.sin(yaw) - dy * Math.cos(yaw)
    const right = -(dx * Math.cos(yaw) + dy * Math.sin(yaw))
    const forward = Math.abs(ahead) >= Math.abs(right)
    const key = forward ? (ahead > 0 ? 'ArrowUp' : 'ArrowDown') : right > 0 ? 'ArrowRight' : 'ArrowLeft'
    await page.keyboard.down(key)
    await page.waitForTimeout(Math.min(700, Math.max(150, Math.max(Math.abs(dx), Math.abs(dy)) * 250)))
    await page.keyboard.up(key)
    await page.waitForTimeout(200)
    // Stopped by something (a palm, a bin): a step to the side, as a walker would, then on.
    const now = await where(page)
    if (Math.hypot(now.x - at.x, now.y - at.y) < 0.05) {
      const side = forward ? (i % 2 ? 'ArrowLeft' : 'ArrowRight') : i % 2 ? 'ArrowUp' : 'ArrowDown'
      await page.keyboard.down(side)
      await page.waitForTimeout(500)
      await page.keyboard.up(side)
      await page.waitForTimeout(200)
    }
  }
  throw new Error(`could not reach (${x}, ${y}): at ${JSON.stringify(await where(page))}`)
}

test('out on Tubman Boulevard: the money changer, then Ma Hawa Cookshop', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await runSql(`update public.oal_lives set hunger = 30 where user_id = '${me!.id}'`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  await walkIn(page, 'sinkor')
  const view = page.getByTestId('oal-street')
  await expect(view).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })

  const changer = street.places.changer
  await walkTo(page, changer.x, changer.y, () => page.getByTestId('oal-place-open').isVisible())
  await expect(view.getByText('Money changer', { exact: true }).first()).toBeVisible()
  await page.getByTestId('oal-place-open').click()
  await page.getByTestId('oal-change-amount').fill('500')
  await page.getByTestId('oal-buy-usd').click()
  await expect(page.getByText(/You received US\$\d/)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Done' }).click()

  const cookshop = street.places.cookshop
  await walkTo(page, cookshop.x, cookshop.y, async () => (await page.getByTestId('oal-place-open').isVisible()) && (await view.getByText('Ma Hawa Cookshop', { exact: true }).isVisible()))
  await page.getByTestId('oal-place-open').click()
  await page.getByTestId('oal-street-eat').click()
  await expect(page.getByText('You ate.')).toBeVisible({ timeout: 20_000 })
  // The plate was paid for (the walk itself takes game hours: how hungry she is now depends on them).
  const [meal] = await runSql<{ amount: number }>(`select amount from public.oal_money_entries where user_id = '${me!.id}' and kind = 'food'`)
  expect(Number(meal!.amount)).toBe(-25000)
  expect(errors).toEqual([])
})

test('Waterside Market: from Water Street to the trader\'s table', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  await walkIn(page, 'waterside', 'walk')
  const view = page.getByTestId('oal-street')
  await expect(view).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
  await expect(page.getByTestId('oal-street-chip')).toHaveText(/Waterside Market/)

  const stall = waterside.places.stall
  await walkTo(page, stall.x, stall.y, async () => (await page.getByTestId('oal-place-open').isVisible()) && (await view.getByText('Table 14, Waterside Market', { exact: true }).isVisible()), waterside.spawn.face)
  await page.getByTestId('oal-place-open').click()
  await expect(page.getByTestId('oal-job-waterside_trader')).toBeVisible({ timeout: 20_000 })
  expect(errors).toEqual([])
})
