// One Africa Life: Furniture City on Tubman Boulevard (./src/games/oal/city/FurnitureCity.tsx):
// seen from its forecourt, walked into among its displays, its stairs climbed to the first floor.
// Run with: npm run on-dev -- e2e -- e2e/oal-store.spec.ts (SHOTS=<dir> for pictures)
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
// The store's frame on the map (as FurnitureCity.tsx has it).
const R = (-21 * Math.PI) / 180
const X = [Math.cos(R), Math.sin(R)]
const Y = [-Math.sin(R), Math.cos(R)]
const O = [1574 + Y[0]! * 18, -1570 + Y[1]! * 18]
const at = (lx: number, ly: number) => ({ x: O[0]! + X[0]! * lx + Y[0]! * ly, y: O[1]! + X[1]! * lx + Y[1]! * ly, f: R + Math.PI })

test('Furniture City: its front, its shop floor, up its stairs', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('[city]')) console.log('CONSOLE', m.text().slice(0, 600)) })
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
  const loaded = async () => {
    for (let i = 0; i < 24; i++) {
      const st = await page.evaluate(() => (window as unknown as { oalStore?: { loaded: boolean } }).oalStore)
      if (st?.loaded) return
      if (i % 2 === 0) console.log('WAIT', i * 5, JSON.stringify(st))
      await page.waitForTimeout(5000)
    }
    throw new Error('Furniture City never loaded')
  }
  const level = () => page.evaluate(() => (window as unknown as { oalStore?: { level: number; inside: boolean } }).oalStore)
  // From the forecourt.
  await go({ area: 'city', at: at(0, -12) })
  await loaded()
  await page.waitForTimeout(3000)
  await shot(page, 'store-1-front')
  // Inside, among the living rooms.
  await go({ area: 'city', at: at(-2, 3) })
  await loaded()
  await page.waitForTimeout(3000)
  await shot(page, 'store-2-shop')
  console.log('INSIDE', JSON.stringify(await level()))
  expect((await level())?.inside).toBe(true)
  // At the foot of the stairs, up them.
  await go({ area: 'city', at: at(10.4, 5.2) })
  await loaded()
  await page.waitForTimeout(2500)
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(16000)
  await page.keyboard.up('ArrowUp')
  await page.waitForTimeout(1000)
  console.log('LEVEL', JSON.stringify(await level()))
  await shot(page, 'store-3-upstairs')
  expect((await level())?.level).toBe(1)
  expect(errors).toEqual([])
})
