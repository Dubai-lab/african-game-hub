// One Africa Life: Monrovia's landmarks (./src/games/oal/city/landmarks.ts) seen from before
// each (the Capitol, the Executive Mansion, the Ducor Hotel, Providence Baptist Church, the
// maternity hospital at JFK), the town's walls in their styles by day and at night, and what is
// round the buildings: Red Light and the General Market, a street's compounds and trees, a beach.
// Run with: npm run on-dev -- e2e -- e2e/oal-landmarks.spec.ts --headed (SHOTS=<dir> for pictures)
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
import { LANDMARKS } from '../src/games/oal/city/landmarks.ts'

// Before each landmark, some way out from its front, facing it (forward is (sin f, -cos f)).
const AWAY: Record<string, number> = { capitol: 85, mansion: 62, ducor: 55, providence: 34, jfk: 34 }
const SPOTS: [string, number, number, number, number][] = LANDMARKS.map((l) => [l.name, l.x + Math.sin(l.yaw) * AWAY[l.name]!, l.y - Math.cos(l.yaw) * AWAY[l.name]!, l.yaw + Math.PI, 13])
SPOTS.push(['walls-day', 1679.5, -1781, -0.356, 13], ['walls-night', 1679.5, -1781, -0.356, 21])
SPOTS.push(['site-visa', -2253.4, 1387.3, 1.19, 13], ['site-jobs', -1302.3, 923.5, -0.337, 13])
SPOTS.push(['around-redlight', 10984.1, -1362.1, -2.967, 13], ['around-general', -1462.4, 411.5, 1.075, 13], ['around-street', 1679.5, -1781, 2.786, 13], ['around-beach', -198, -1320, 2.2, 13])

test('the landmarks, the walls', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 300)))
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL(/\/lobby$/, { timeout: 20_000 })
  for (const [name, x, y, f, hour] of SPOTS.filter(([n]) => !process.env.ONLY || n.startsWith(process.env.ONLY))) {
    await page.goto('/lobby')
    await page.evaluate(([id, s, h]) => {
      localStorage.setItem(`oal-spot:${id}`, s as string)
      localStorage.setItem('oal-city-hour', h as string)
    }, [me!.id, JSON.stringify({ area: 'city', at: { x, y, f } }), String(hour)])
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
    await page.waitForTimeout(7000)
    await shot(page, `landmark-${name}`)
  }
  expect(errors).toEqual([])
})
