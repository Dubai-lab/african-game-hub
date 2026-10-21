// One Africa Life: Monrovia's checks before the city is called done (./src/games/oal/city/):
// what drawing it costs in its busiest places with the processor slowed four times (as a budget
// phone's), and the map: its filters (landmarks among them), its search, the GPS to a place.
// Run with: npm run on-dev -- e2e -- e2e/oal-citycheck.spec.ts --headed (SHOTS=<dir> for pictures)
import { writeFileSync } from 'node:fs'
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
// Busy places: a street of Sinkor, downtown at Broad Street, Red Light.
const SPOTS: [string, number, number, number][] = [
  ['sinkor', 1679.5, -1781, -0.356],
  ['downtown', -1540, 1420, 2.0],
  ['redlight', 10984.1, -1362.1, -2.967],
]

test('the city: its cost, its map', async ({ page }) => {
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
  const cdp = await page.context().newCDPSession(page)
  for (const [name, x, y, f] of SPOTS.filter(([n]) => !process.env.ONLY || n.startsWith(process.env.ONLY))) {
    await page.goto('/lobby')
    await page.evaluate(([id, s]) => {
      localStorage.setItem(`oal-spot:${id}`, s as string)
      localStorage.setItem('oal-stats', '1')
      localStorage.setItem('oal-city-hour', '13')
    }, [me!.id, JSON.stringify({ area: 'city', at: { x, y, f } })])
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
    await page.waitForTimeout(12_000)
    const free = await page.evaluate(() => (window as unknown as { oalCityStats?: { frame: number } }).oalCityStats?.frame)
    if (process.env.PROFILE) {
      await page.waitForTimeout(Number(process.env.PROFILE_WAIT ?? 0))
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.start')
      await page.waitForTimeout(4000)
      const { profile } = await cdp.send('Profiler.stop')
      writeFileSync(`${process.env.PROFILE}/${name}.cpuprofile`, JSON.stringify(profile))
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.waitForTimeout(6000)
    const stats = { ...(await page.evaluate(() => (window as unknown as { oalCityStats?: Record<string, number> }).oalCityStats)), unthrottled: free }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    console.log(`city ${name}: ${JSON.stringify(stats)}`)
    await shot(page, `check-${name}`)
  }
  // The map: the landmarks' filter, a search, the GPS set to what was found.
  await page.getByTestId('oal-map').click()
  await page.getByTestId('oal-map-filter-landmark').click()
  await page.waitForTimeout(1500)
  await shot(page, 'check-map-landmarks')
  await page.getByTestId('oal-map-search').fill('Capitol')
  await page.getByTestId('oal-map-found').first().click()
  await expect(page.getByTestId('oal-map-place-card')).toContainText('Capitol Building')
  await shot(page, 'check-map-found')
  await page.getByTestId('oal-map-gps').click()
  await expect(page.getByTestId('oal-gps')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2000)
  await shot(page, 'check-gps')
  expect(errors).toEqual([])
})
