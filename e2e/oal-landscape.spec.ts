// One Africa Life sideways (the phone held landscape): each screen's controls where a thumb is,
// nothing over another: on foot in the street, by the car, driving (from behind, from the seat),
// the map, the phone, in the house arranging it.
// Run with: npm run on-dev -- e2e -- e2e/oal-landscape.spec.ts --headed (SHOTS=<dir> for pictures)
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
/** No two of the screen's controls over each other, each wholly on the screen. */
async function clear(page: Page, what: string) {
  const boxes = await page.evaluate(() => {
    const out: { id: string; x: number; y: number; w: number; h: number }[] = []
    for (const el of document.querySelectorAll('[data-testid="oal-street"] button, [data-testid="oal-hud"] button, [data-testid="oal-drive"] [data-testid]')) {
      const r = el.getBoundingClientRect()
      const st = getComputedStyle(el)
      if (!r.width || !r.height || st.visibility === 'hidden' || st.display === 'none') continue
      // (A control inside another counts as that one.)
      if (el.parentElement?.closest('[data-testid="oal-drive"] [data-testid]') && el.closest('[data-testid="oal-drive"]')) continue
      out.push({ id: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20) ?? '?', x: r.x, y: r.y, w: r.width, h: r.height })
    }
    return out
  })
  const vw = page.viewportSize()!.width
  const vh = page.viewportSize()!.height
  const problems: string[] = []
  for (const b of boxes) if (b.x < -1 || b.y < -1 || b.x + b.w > vw + 1 || b.y + b.h > vh + 1) problems.push(`${b.id} off screen`)
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      if (a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2) problems.push(`${a.id} over ${b.id}`)
    }
  console.log('LAYOUT', what, JSON.stringify(problems))
  return problems
}

test('sideways: every screen laid out for the thumbs', async ({ page }) => {
  const account = TEST_ACCOUNTS[1]!
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 300)))
  page.on('dialog', (d) => void d.dismiss())
  const [me] = await runSql<{ id: string }>(`select id from auth.users where email = '${account.email}'`)
  await runSql(`select public.oal_start_life('${me!.id}', 'Musu Kollie', 'female', 26, 'LR', 'Monrovia', '${JSON.stringify(APPEARANCE)}'::jsonb)`)
  await runSql(`insert into public.oal_things (user_id, item, paid) values ('${me!.id}', 'sofa', 52000)`)
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
  const all: string[] = []
  // On foot at the house's gate.
  await go({ area: 'city', place: 'home' })
  await page.waitForTimeout(2500)
  await shot(page, 'land-1-street')
  all.push(...(await clear(page, 'street')))
  // The map, the phone.
  await page.getByTestId('oal-map').click()
  await page.waitForTimeout(1500)
  await shot(page, 'land-2-map')
  await page.keyboard.press('Escape')
  await page.goto('/life')
  await expect(page.getByTestId('oal-loading')).toBeHidden({ timeout: 120_000 })
  await page.getByTestId('oal-phone-button').click()
  await page.waitForTimeout(1000)
  await shot(page, 'land-3-phone')
  await page.keyboard.press('Escape')
  // By the car, in it, driving.
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { oalOwnCar?: { d: unknown } }).oalOwnCar?.d)), { timeout: 60_000 }).toBe(true)
  const car = await page.evaluate(() => {
    const d = (window as unknown as { oalOwnCar: { d: { x: number; y: number; yaw: number } } }).oalOwnCar.d
    return { x: d.x, y: d.y, yaw: d.yaw }
  })
  const c = Math.cos(car.yaw)
  const sn = Math.sin(car.yaw)
  await go({ area: 'city', at: { x: car.x + c * 0.5 - sn * 2.0, y: car.y + sn * 0.5 + c * 2.0, f: Math.atan2(-sn, -c) } })
  await page.waitForTimeout(2500)
  await shot(page, 'land-4-by-car')
  all.push(...(await clear(page, 'by car')))
  await page.getByTestId('oal-car-in').click()
  await expect(page.getByTestId('oal-drive')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(1500)
  await shot(page, 'land-5-driving')
  all.push(...(await clear(page, 'driving')))
  await page.getByTestId('oal-car-view').click()
  await page.waitForTimeout(1500)
  await shot(page, 'land-6-inside-view')
  all.push(...(await clear(page, 'inside view')))
  await page.getByTestId('oal-car-view').click()
  await page.getByTestId('oal-car-out').click()
  // In the house, arranging it.
  await page.waitForTimeout(1500)
  const spot = await page.evaluate(() => {
    const h = (window as unknown as { oalHome: { toMap: (u: number, v: number) => [number, number]; yaw: number } }).oalHome
    const [x, y] = h.toMap(-3.2, -4.3)
    return { x, y, f: h.yaw + Math.PI }
  })
  await go({ area: 'city', at: spot })
  await expect.poll(() => page.evaluate(() => (window as unknown as { oalHome?: { inside: boolean } }).oalHome?.inside), { timeout: 30_000 }).toBe(true)
  await page.waitForTimeout(2000)
  await shot(page, 'land-7-house')
  all.push(...(await clear(page, 'house')))
  await page.getByTestId('oal-arrange').click()
  await page.getByTestId('oal-thing-sofa').click()
  await page.getByTestId('oal-thing-here').click()
  await page.waitForTimeout(1000)
  await shot(page, 'land-8-arranging')
  expect(all).toEqual([])
  expect(errors).toEqual([])
})
