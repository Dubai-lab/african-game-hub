// One Africa Life: Monrovia's roads (./src/games/oal/city/cityGen.ts), against the development
// project: a signalled junction (Tubman Boulevard and 9th Street: its zebra crossings, stop
// lines, traffic lights, kerbs, the street-name sign), the Gabriel Johnson Tucker Bridge (its
// deck raised over the river, its parapets), a roundabout's island.
// Run with: npm run on-dev -- e2e -- e2e/oal-roads.spec.ts --headed (SHOTS=<dir> for pictures)
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
// Where to stand and which way to face (yaw: forward is (sin, -cos) on the map).
const SPOTS: [string, number, number, number][] = [
  ['junction', 549 + 14, -1173 - 14, Math.atan2(-1, -1)],
  ['bridge', -1282 - 0.179 * 120 + 0.984 * 9, 1513 + 0.984 * 120 + 0.179 * 9, Math.atan2(-0.179, -0.984)],
  ['roundabout', 6970 + 11.5, 1739, Math.atan2(-1, 0)],
]

test('a junction, a bridge, a roundabout', async ({ page }) => {
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
  for (const [name, x, y, f] of SPOTS) {
    await page.goto('/lobby')
    await page.evaluate(([id, s]) => localStorage.setItem(`oal-spot:${id}`, s as string), [me!.id, JSON.stringify({ area: 'city', at: { x, y, f } })])
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
    await page.waitForTimeout(5000)
    await shot(page, `road-${name}`)
  }
  expect(errors).toEqual([])
})
