// One Africa Life: journeys, against the development project. A Liberian life buys its tickets
// and a hotel, boards in the boarding window, flies, walks through Kotoka's arrivals hall in 3D to
// an officer, answers, and walks out into Accra. Another, in Accra, flies home and walks through
// Roberts International's hall to a booth, is welcomed home, and out through the opened gate.
// (Two tests: a browser without a graphics card draws these halls slowly.)
// The game's clock is moved by moving its start (development project only; the reset puts it
// back). The officer's rules themselves are tested in src/games/oal/oalBorder.test.ts.
// Run with: npm run on-dev -- e2e -- e2e/oal-travel.spec.ts
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

// The halls are drawn in software by the test browser: slow on a busy machine.
test.setTimeout(3_600_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const DAY = '2026-12-01'
const WEEK_LATER = '2026-12-08'
const APPEARANCE = {
  version: 1, sex: 'male', skin: 0.75,
  build: { weight: 0, muscle: 0.2, height: 0.1 },
  face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
  hair: 'lowcut', hairColour: 'black', eyes: 'darkbrown', outfit: 'shirt_jeans',
}

/** Sets the game's clock to a game moment (GMT). */
const setGameTime = (at: string) =>
  runSql(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from '${at}'::timestamp at time zone 'UTC')) / 29)`)

/** Where the traveller stands in the hall (u, v), as the page reports it. */
async function position(page: Page) {
  const hall = page.getByTestId('oal-hall')
  return { u: Number(await hall.getAttribute('data-u')), v: Number(await hall.getAttribute('data-v')) }
}

/**
 * Walks the traveller to a point with short presses of the arrow keys, looking again after each
 * (frames can be slow in a test browser, so a long press would overshoot). Up is toward the
 * landside (v falling), right is along the hall (u rising). Stops early when `done` says so.
 */
async function walkTo(page: Page, u: number, v: number, done?: () => Promise<boolean>) {
  for (let i = 0; i < 400; i++) {
    if (done && (await done())) return
    const at = await position(page)
    const du = u - at.u
    const dv = v - at.v
    // Within a metre is there (each press can carry the traveller that far in a slow test browser).
    if (Math.abs(du) < 1.0 && Math.abs(dv) < 1.0) {
      if (!done) return
    }
    const alongU = Math.abs(dv) < 1.0 || (Math.abs(du) >= 1.0 && Math.abs(du) >= Math.abs(dv))
    const key = alongU ? (du > 0 ? 'ArrowRight' : 'ArrowLeft') : dv < 0 ? 'ArrowUp' : 'ArrowDown'
    const metres = Math.max(0.2, Math.abs(alongU ? du : dv))
    await page.keyboard.down(key)
    await page.waitForTimeout(Math.min(800, metres * 300))
    await page.keyboard.up(key)
    await page.waitForTimeout(250)
  }
  const at = await position(page)
  throw new Error(`could not walk to (${u}, ${v}): stopped at (${at.u}, ${at.v})`)
}

/** A Liberian life for the test account, given what a journey costs (as an admin would). */
async function liberian(index: number) {
  const account = TEST_ACCOUNTS[index]!
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Kollie Flomo', 'male', 30, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  // Twenty dollars buys no ticket.
  await runSql(`select private.oal_money('${me!.id}', 'USD', 300000, 'adjustment')`)
  return { account, id: me!.id }
}

async function logIn(page: Page, account: { email: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')
  await expect(page.getByTestId('oal-travel')).toBeVisible({ timeout: 20_000 })
}

const crossingsOf = (id: string) =>
  runSql<{ country: string; category: string; decision: string }>(`select country, category, decision from public.oal_border_entries where user_id = '${id}' order by id`)

test('Monrovia to Accra: tickets and a hotel, the flight, the officer in Kotoka\'s hall, out into Accra', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const { account, id } = await liberian(0)
  await setGameTime(`${DAY} 06:00`)
  await logIn(page, account)
  const travel = page.getByTestId('oal-travel')
  await expect(page.getByText('You are in Monrovia, Liberia.')).toBeVisible()
  await expect(travel.getByText(/^Liberia/)).toBeVisible()

  // The flight out today, the flight home in a week, a hotel in Osu for the week.
  await page.getByTestId('oal-book-CL301').click()
  await expect(page.getByText('Ticket bought.')).toBeVisible()
  await travel.locator('button[aria-pressed]').nth(7).click()
  await page.getByTestId('oal-book-CL302').click()
  await expect(page.getByTestId(/^oal-board-/)).toHaveCount(2)
  await page.getByLabel('Nights').selectOption('7')
  await page.getByTestId('oal-hotel-osu_garden').click()
  await expect(page.getByText(/Your reference is HB-/)).toBeVisible()

  // Boarding opens at 06:40 for the 09:40.
  await setGameTime(`${DAY} 08:00`)
  await page.reload()
  await page.getByTestId(/^oal-board-/).first().click()
  await expect(page.getByTestId('oal-in-flight')).toBeVisible({ timeout: 20_000 })

  // Landed at Kotoka: the officer's questions.
  await setGameTime(`${DAY} 11:50`)
  await page.reload()
  await expect(page.getByTestId('oal-arrivals')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('oal-enter-hall').click()
  const kotoka = page.getByTestId('oal-hall')
  await expect(kotoka).toHaveAttribute('data-v', /\d/, { timeout: 90_000 })
  // Out of the corridor, through the gap in the queue lines, to booth 6 (ECOWAS nationals).
  await walkTo(page, 37.6, 18.4)
  await walkTo(page, 36.0, 18.2, () => page.getByTestId('oal-speak').isVisible())
  await page.getByTestId('oal-speak').click()
  await page.getByTestId('oal-hand-passport').click()
  await page.getByRole('button', { name: 'Visiting family' }).click()
  await page.getByTestId('oal-days').fill('7')
  await page.getByRole('button', { name: 'Answer' }).click()
  await page.getByRole('button', { name: /Show your booking/ }).click()
  await page.getByRole('button', { name: 'At a hotel' }).click()
  await page.getByRole('button', { name: 'Trader' }).click()
  await page.getByRole('button', { name: 'Yes' }).click()
  await page.getByTestId('oal-funds').fill('1700')
  await page.getByTestId('oal-submit').click()
  await expect(page.getByText(/Welcome to Ghana\. You may stay until/)).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('oal-desk-done').click()
  // Through booth 6's gate, round the middle belt, out of the doors.
  await walkTo(page, 37.6, 14.0)
  await walkTo(page, 25.5, 14.0)
  await walkTo(page, 25.5, 2.4)
  await walkTo(page, 33.0, 1.0, async () => !(await kotoka.isVisible()))
  await expect(page.getByText('You are in Accra, Ghana.')).toBeVisible({ timeout: 20_000 })

  expect(await crossingsOf(id)).toEqual([{ country: 'GH', category: 'ecowas_visitor', decision: 'admitted' }])
  expect(errors).toEqual([])
})

test('Accra to Monrovia: home through Roberts International\'s hall, welcomed as a citizen', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const { account, id } = await liberian(1)
  // A Liberian visiting Accra (on the development project only, put there directly).
  await runSql(`update public.oal_lives set place = 'Accra', country = 'GH' where user_id = '${id}'`)
  await setGameTime(`${WEEK_LATER} 06:00`)
  await logIn(page, account)
  await expect(page.getByText('You are in Accra, Ghana.')).toBeVisible()
  await page.getByTestId('oal-book-CL302').click()
  await expect(page.getByText('Ticket bought.')).toBeVisible()

  // Boarding the 13:05, landing at Roberts at 15:10.
  await setGameTime(`${WEEK_LATER} 11:00`)
  await page.reload()
  await page.getByTestId(/^oal-board-/).first().click()
  await expect(page.getByTestId('oal-in-flight')).toBeVisible({ timeout: 20_000 })
  await setGameTime(`${WEEK_LATER} 15:20`)
  await page.reload()
  await page.getByTestId('oal-enter-hall').click()
  const hall = page.getByTestId('oal-hall')
  await expect(hall).toHaveAttribute('data-v', /\d/, { timeout: 90_000 })

  // Walk to booth 5 (an officer is there), through the gap in the queue lines.
  await walkTo(page, 50.5, 25.6)
  await walkTo(page, 52.6, 25.6, () => page.getByTestId('oal-speak').isVisible())
  await page.getByTestId('oal-speak').click()
  await page.getByTestId('oal-hand-passport').click()
  await expect(page.getByText('Welcome home.')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('oal-desk-done').click()

  // Through the gate the officer opened, and out of the landside doors.
  await walkTo(page, 54.05, 22.0)
  await walkTo(page, 54.05, 1.0, async () => !(await hall.isVisible()))
  await expect(page.getByText('You are in Monrovia, Liberia.')).toBeVisible({ timeout: 20_000 })

  expect(await crossingsOf(id)).toEqual([{ country: 'LR', category: 'citizen', decision: 'admitted' }])
  expect(errors).toEqual([])
})
