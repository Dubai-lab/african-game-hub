// One Africa Life: the insides of the town's places (scripts/oal/makeInteriors.py), one of each
// kind, opened as a business of the town (against the development project): each drawn, without
// errors. Run with: npm run on-dev -- e2e -- e2e/oal-interiors.spec.ts --headed (SHOTS=<dir>)
import { expect, type Page, test } from '@playwright/test'
import { runSql } from '../scripts/lib/managementApi.ts'
import { ensureTestAccounts, resetTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

test.setTimeout(900_000)
test.beforeAll(ensureTestAccounts)
test.beforeEach(resetTestAccounts)
const APPEARANCE = { version: 1, sex: 'female', skin: 0.8, build: { weight: 0.2, muscle: 0, height: 0 }, face: { noseWidth: 0, noseLength: 0, lips: 0, mouthWidth: 0, jaw: 0, chin: 0, cheekbones: 0, eyes: 0 }, hair: 'braids', hairColour: 'black', eyes: 'darkbrown', outfit: 'blouse_skirt' }
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
}
const KINDS: [string, string][] = [
  ['provisions', 'Morris Provision Shop'],
  ['food', 'Mama Fatu Cookshop'],
  ['fun', 'New Generation Entertainment Center'],
  ['salon', 'El-Shaddai Braiding Center'],
  ['pharmacy', 'God Is Able Medicine Store'],
  ['health', 'Sinkor Health Center'],
  ['bank', 'Ecobank'],
  ['government', 'Ministry of Commerce'],
  ['school', 'Sinkor Public School'],
  ['church', 'Red Light Gospel Church'],
  ['mosque', 'Benson Street Mosque'],
  ['hotel', 'Grand Royal Hotel'],
  ['market', 'Red Light Market'],
  ['materials', "God's Grace Building Materials"],
  ['boutique', 'Weah Fashion House'],
]

test('one of each kind of place, inside', async ({ page }) => {
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
  for (const [cat, name] of KINDS) {
    await page.goto('/lobby')
    const spot = { area: 'biz', biz: { cat, name, door: [1094, -1370], face: [0, 1] } }
    await page.evaluate(([id, s]) => localStorage.setItem(`oal-spot:${id}`, s as string), [me!.id, JSON.stringify(spot)])
    await page.goto('/life')
    await page.waitForTimeout(8000)
    if (!(await page.getByTestId('oal-home-view').isVisible())) {
      await shot(page, `inside-fail-${cat}`)
      console.log('ERRORS', JSON.stringify(errors), (await page.locator('body').innerText()).slice(0, 400))
    }
    await expect(page.getByTestId('oal-home-view')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
    await page.waitForTimeout(2500)
    // Two steps in, and a look.
    await page.keyboard.down('ArrowUp')
    await page.waitForTimeout(1500)
    await page.keyboard.up('ArrowUp')
    await page.waitForTimeout(800)
    await shot(page, `inside-${cat}`)
  }
  expect(errors).toEqual([])
})
