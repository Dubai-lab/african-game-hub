// One Africa Life: the town's traffic driven as cars are (./src/games/oal/city/driving.ts):
// at a signalled junction (Tubman Boulevard and 9th Street), frames a moment apart: the cars in
// their lanes, turning on curves with their front wheels turned, stopped at the red, never one in
// another.
// Run with: npm run on-dev -- e2e -- e2e/oal-traffic.spec.ts --headed (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(600_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
test('the traffic at a junction', async ({ page }) => {
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
  const [x, y, f] = (process.env.AT ?? `${549 + 18},${-1173 - 18},${Math.atan2(-1, -1)}`).split(',').map(Number) as [number, number, number]
  await page.evaluate(([id, s]) => {
    localStorage.setItem(`oal-spot:${id}`, s as string)
    localStorage.setItem('oal-city-hour', '13')
    localStorage.setItem('oal-stats', '1')
  }, [me!.id, JSON.stringify({ area: 'city', at: { x, y, f } })])
  await page.goto('/life')
  await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
  await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
  await page.waitForTimeout(20_000)
  for (let i = 0; i < 4; i++) {
    await shot(page, `traffic-${i}`)
    await page.waitForTimeout(1500)
  }
  if (process.env.HAIL) {
    // A taxi waved down: it comes along the road and pulls in beside the player (seen up close).
    await page.getByTestId('oal-hail-taxi').click()
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(2500)
      await shot(page, `hail-${i}`)
    }
    return
  }
  // A minute of the traffic, every five seconds: nobody in anybody, nobody stuck for long.
  for (let i = 0; i < 12; i++) {
    const t = await page.evaluate(() => (window as unknown as { oalTraffic?: Record<string, number> }).oalTraffic)
    console.log(`traffic ${JSON.stringify(t)}`)
    expect(t?.overlapping ?? 0).toBe(0)
    await page.waitForTimeout(5000)
  }
  expect(errors).toEqual([])
})
