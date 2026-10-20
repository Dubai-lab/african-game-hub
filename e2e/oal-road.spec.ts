// One Africa Life by road, against the development project. A life in Monrovia goes (walking)
// to the Red Light parking station, buys a seat in a shared car to Voinjama, waits for it to
// fill, rides up-country (seen on the road), and gets in to Voinjama's parking station.
// Run with: npm run on-dev -- e2e -- e2e/oal-road.spec.ts
import { expect, test } from '@playwright/test'
import { goTo } from './oalWorld.ts'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

// The road is drawn in 3D: slow in a test browser.
test.setTimeout(1_800_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
test.afterAll(resetTestAccounts)

const APPEARANCE = {
  version: 1, sex: 'female', skin: 0.8,
  build: { weight: 0.2, muscle: 0, height: 0 },
  face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 },
  hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt',
}
const setGameTime = (at: string) =>
  runSql(`update public.oal_settings set clock_epoch = to_timestamp((30 * extract(epoch from now()) - extract(epoch from '${at}'::timestamp at time zone 'UTC')) / 29)`)

test('Monrovia to Voinjama in a shared car from Red Light', async ({ page }) => {
  const account = TEST_ACCOUNTS[2]!
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await setGameTime('2026-12-07 09:00')
  await runSql(`update public.oal_lives set hunger = 100, energy = 100, health = 100, needs_at = public.oal_game_time() where user_id = '${me!.id}'`)
  // A seat is L$4,000; a new life has L$3,000.
  await runSql(`select private.oal_money('${me!.id}', 'LRD', 200000, 'adjustment')`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  await page.goto('/life')

  // To Paynesville, on foot.
  await goTo(page, 'station', 'station', 'walk')
  await expect(page.getByTestId('oal-station')).toContainText('Red Light parking station, Paynesville', { timeout: 20_000 })
  await page.getByTestId('oal-ride-mon_voi_car').click()
  await expect(page.getByText('You have a seat. On the way to Voinjama.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('oal-on-road')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('oal-on-road')).toContainText('Waiting for the car to fill', { timeout: 60_000 })

  // Under way, then in.
  await setGameTime('2026-12-07 14:00')
  await page.reload()
  await expect(page.getByTestId('oal-on-road')).toContainText(/On the road: \d+ of 410 km/, { timeout: 120_000 })
  await setGameTime('2026-12-07 19:30')
  await page.reload()
  await expect(page.getByTestId('oal-at-station')).toContainText('Parking station, Voinjama', { timeout: 60_000 })
  const [life] = await runSql<{ place: string; state: string }>(`select place, state from public.oal_lives where user_id = '${me!.id}'`)
  expect(life).toEqual({ place: 'Voinjama', state: 'settled' })
  expect(errors).toEqual([])
})
