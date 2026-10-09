import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

process.loadEnvFile('.env.local')

test('landing page shows every section from live data, with honest copy', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your move.')
  await expect(page.getByText('Start with 1,000 free tokens.')).toBeVisible()
  await expect(page.getByRole('img', { name: /chess board in the middle of a game/ })).toBeAttached()

  // Games registry: chess, ludo, draughts and pool live, one coming soon.
  await expect(page.getByRole('heading', { name: 'Chess', level: 3 })).toBeVisible()
  await expect(page.getByText('Live now')).toHaveCount(4)
  await expect(page.getByText('Coming soon')).toHaveCount(1)
  await expect(page.getByText('Play free, or stake 50 to 1,000 tokens').first()).toBeVisible()

  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Fair play' })).toBeVisible()
  await expect(page.getByText('Players from 54 countries can sign up today.')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: /Rwanda$/ })).toBeVisible()

  // Real money is off everywhere, and the page must say so rather than imply otherwise.
  await expect(page.getByText(/cashing out for real money is not available yet/)).toBeVisible()
  // Live numbers: a figure appears only once it passes its threshold (5 countries, 100 matches
  // today), and the section disappears when none do. Check the page against the real figures.
  const stats = await createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!).rpc('landing_stats').single()
  const figures = stats.data as { matches_today: number; countries_represented: number; players_online: number | null }
  const showCountries = figures.countries_represented >= 5
  const showMatches = figures.matches_today >= 100
  await expect(page.getByText('On the hub today')).toHaveCount(showCountries || showMatches ? 1 : 0)
  await expect(page.getByText('countries represented')).toHaveCount(showCountries ? 1 : 0)
  await expect(page.getByText('matches played today')).toHaveCount(showMatches ? 1 : 0)
  // Players online cannot be counted yet, so it is never shown.
  await expect(page.getByText('players online')).toHaveCount(0)

  // No sideways scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

  await page.getByRole('link', { name: 'Responsible gaming' }).click()
  await expect(page).toHaveURL(/\/responsible-gaming$/)
  await expect(page.getByText('Draft. This text has not yet been reviewed by a lawyer.')).toBeVisible()

  expect(errors).toEqual([])
})

test('with reduced motion the 3D scene is never loaded and the still picture stays', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await page.goto('/')
  await page.waitForTimeout(3500)
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.getByRole('img', { name: /chess board in the middle of a game/ })).toBeVisible()
  expect(requested.filter((url) => /HeroScene|three/i.test(url))).toEqual([])
  await context.close()
})
