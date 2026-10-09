// Accessibility: every main page is checked with axe-core against WCAG 2 level A and AA
// (colour contrast, labels on buttons and form fields, alt text, headings, keyboard reach).
// A second test fills in the sign-up form with the keyboard alone.
import { createRequire } from 'node:module'
import { expect, type Page, test } from '@playwright/test'
import { ensureTestAccounts, TEST_ACCOUNTS, TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js')
type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[]; failureSummary?: string }[] }

async function problems(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath })
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: unknown[] }> } }).axe
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return result.violations
  })
  return (violations as Violation[]).flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} @ ${n.target.join(' ')}`))
}

test.beforeAll(ensureTestAccounts)

const PUBLIC = ['/', '/login', '/signup', '/terms', '/privacy', '/cookies', '/refunds', '/responsible-gaming']
const SIGNED_IN = ['/lobby', '/play/chess', '/play/chess/new', '/play/chess/friend', '/play/chess/tournaments', '/play/chess/settings', '/play/ludo', '/play/ludo/new', '/play/pool', '/play/pool/new', '/play/draughts', '/play/draughts/new', '/play/draughts/settings', '/play/draughts/computer', '/wallet', '/leaderboards', '/friends', '/profile', '/settings', '/play/pool/computer', '/play/chess/computer', '/play/ludo/computer']

for (const width of [393, 1366]) {
  test(`public pages have no accessibility faults (${width}px wide)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 851 }, locale: 'en-US', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const found: Record<string, string[]> = {}
    for (const path of PUBLIC) {
      await page.goto(path)
      await expect(page.locator('h1').first()).toBeVisible()
      const list = await problems(page)
      if (list.length > 0) found[path] = list
    }
    expect(found).toEqual({})
    await context.close()
  })

  test(`pages for signed-in players have no accessibility faults (${width}px wide)`, async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ viewport: { width, height: 851 }, locale: 'en-US', reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_ACCOUNTS[0].email)
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByTestId('game-chess')).toBeVisible({ timeout: 20_000 })
    const found: Record<string, string[]> = {}
    for (const path of SIGNED_IN) {
      await page.goto(path)
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(700)
      const list = await problems(page)
      if (list.length > 0) found[path] = list
    }
    expect(found).toEqual({})
    await context.close()
  })
}

test('the sign-up form can be filled in and sent with the keyboard alone, and says what is wrong', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Tab reaches every field in order; each has a visible label that names it.
  await page.getByLabel('Email').focus()
  await page.keyboard.type('not-an-email')
  const reached: string[] = []
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return ''
      const label = (el as HTMLInputElement).labels?.[0]?.textContent ?? el.getAttribute('aria-label') ?? el.textContent ?? ''
      return `${el.tagName.toLowerCase()}:${label.trim().slice(0, 40)}`
    })
    reached.push(name)
    if (name.startsWith('button:Create')) break
  }
  expect(reached.some((name) => name.startsWith('input:Password'))).toBe(true)
  expect(reached.some((name) => name.includes('18 years old'))).toBe(true)
  expect(reached.at(-1)).toMatch(/^button:Create/)
  // Enter on the button sends the form; the mistakes are announced next to their fields.
  await page.keyboard.press('Enter')
  await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible()
  // The terms and privacy policy are linked from the form itself.
  await expect(page.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms')
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy')
})
