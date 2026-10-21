// One Africa Life: the game's own places standing in Monrovia as part of the town (no place of
// their own apart from it): the family's house in its compound, the Ministry of Health (its gate,
// its guards, its hall's door), the visa office, the job centre, the parking station, the phone
// shop on Tubman Boulevard; in at the house's door and out of it again, into the visa office and
// out of it again, back in the town each time.
// Run with: npm run on-dev -- e2e -- e2e/oal-places.spec.ts --headed (SHOTS=<dir> for pictures)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(1_500_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
const PLACES = (process.env.DOORS_ONLY ? [] : ['home', 'health-gate', 'health', 'visa', 'jobs', 'station', 'phone'])

test('the places in the town, in and out', async ({ page }) => {
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
  const at = async (place: string) => {
    await page.goto('/lobby')
    await page.evaluate(([id, s]) => {
      localStorage.setItem(`oal-spot:${id}`, s as string)
      localStorage.setItem('oal-city-hour', '13')
    }, [me!.id, JSON.stringify({ area: 'city', place })])
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
    await page.waitForTimeout(5000)
  }
  // Each place seen from before it: out of its door a few steps (which way it faces), then from
  // 20 m out, looking back at it.
  const pos = async () => {
    const v = page.getByTestId('oal-street')
    return [Number(await v.getAttribute('data-x')), Number(await v.getAttribute('data-y'))] as const
  }
  for (const place of PLACES.filter((p) => !process.env.ONLY || p === process.env.ONLY)) {
    await at(place)
    await shot(page, `place-${place}-out`)
    const [x0, y0] = await pos()
    await page.keyboard.down('ArrowUp')
    await page.waitForTimeout(1500)
    await page.keyboard.up('ArrowUp')
    const [x1, y1] = await pos()
    const n = Math.hypot(x1 - x0, y1 - y0) || 1
    const [ux, uy] = [(x1 - x0) / n, (y1 - y0) / n]
    await page.goto('/lobby')
    await page.evaluate(([id, sp]) => localStorage.setItem(`oal-spot:${id}`, sp as string), [me!.id, JSON.stringify({ area: 'city', at: { x: x0 + ux * 20, y: y0 + uy * 20, f: Math.atan2(-ux, uy) } })])
    await page.goto('/life')
    await expect(page.getByTestId('oal-street')).toHaveAttribute('data-x', /\d/, { timeout: 120_000 })
    await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
    await page.waitForTimeout(5000)
    await shot(page, `place-${place}-in`)
  }
  // In at the house's door, out of it again: in the yard, in the town.
  for (const place of ['home', 'visa'].filter((p) => !process.env.ONLY || p === process.env.ONLY)) {
    await at(place)
    // Back to the door (out of it, one is a few steps on) and in at it: no button, walked in.
    const street = page.getByTestId('oal-street')
    // Up to the porch; along the front to the door (one way, else the other).
    await page.keyboard.down('ArrowDown')
    await page.waitForTimeout(place === 'home' ? 6000 : 3000)
    for (const side of ['ArrowRight', 'ArrowLeft']) {
      if (!(await street.isVisible())) break
      await page.keyboard.down(side)
      for (let i = 0; i < 25 && (await street.isVisible()); i++) await page.waitForTimeout(200)
      await page.keyboard.up(side)
    }
    await expect(street).toBeHidden({ timeout: 30_000 })
    await page.keyboard.up('ArrowDown')
    await expect(page.getByTestId('oal-street')).toBeHidden({ timeout: 60_000 })
    await page.waitForTimeout(6000)
    await shot(page, `door-${place}-inside`)
    await page.keyboard.down('ArrowDown')
    await expect(page.getByTestId('oal-street')).toBeVisible({ timeout: 30_000 })
    await page.keyboard.up('ArrowDown')
    await expect(page.getByTestId('oal-loading')).toHaveCount(0)
    await page.waitForTimeout(4000)
    await shot(page, `door-${place}-back-out`)
  }
  expect(errors).toEqual([])
})
