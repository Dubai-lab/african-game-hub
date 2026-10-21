// One Africa Life: a driver at the wheel (./src/games/oal/city/wheelHands.ts): seated in the
// family's car, the legs in the footwell, both hands on the wheel (turning with it), seen from the
// seat, from the side and from the front.
// Run with: npm run on-dev -- e2e -- e2e/oal-seat.spec.ts (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(1_200_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
test('at the wheel: seated in the car, hands on the wheel', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  const go = async (spot: object) => {
    await page.goto('/lobby')
    await page.evaluate(([id, s]) => {
      localStorage.setItem(`oal-spot:${id}`, s as string)
      localStorage.setItem('oal-city-hour', '13')
    }, [me!.id, JSON.stringify(spot)])
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
  }
  await go({ area: 'city', place: 'home' })
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { oalOwnCar?: { d: unknown } }).oalOwnCar?.d)), { timeout: 60_000 }).toBe(true)
  const car = await page.evaluate(() => {
    const d = (window as unknown as { oalOwnCar: { d: { x: number; y: number; yaw: number } } }).oalOwnCar.d
    return { x: d.x, y: d.y, yaw: d.yaw }
  })
  const c = Math.cos(car.yaw)
  const sn = Math.sin(car.yaw)
  await go({ area: 'city', at: { x: car.x + c * 0.5 - sn * 2.0, y: car.y + sn * 0.5 + c * 2.0, f: Math.atan2(-sn, -c) } })
  await page.getByTestId('oal-car-in').click()
  await expect(page.getByTestId('oal-car-out')).toBeVisible({ timeout: 40_000 })
  await page.waitForTimeout(2000)
  const camera = (v: number[] | null) => page.evaluate((v) => ((window as unknown as { oalCarCamera?: number[] | null }).oalCarCamera = v), v)
  // From the driver's seat: the hands on the wheel.
  await page.getByTestId('oal-car-view').click()
  await page.waitForTimeout(1500)
  await shot(page, 'seat-1-inside')
  // The wheel turned: the hands with it.
  await page.getByTestId('oal-drive-gear-D').click()
  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(1200)
  await shot(page, 'seat-4-turning')
  await page.keyboard.up('ArrowLeft')
  await camera(null)
  expect(errors).toEqual([])
})
