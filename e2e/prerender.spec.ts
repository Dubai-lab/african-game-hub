// Checks the production build (dist/), not the dev server: the landing page must be real HTML
// before any JavaScript runs, and React must attach to it without complaint in every language.
// Run `npm run build` first; the test is skipped when there is no build.
import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { preview, type PreviewServer } from 'vite'
import { TEST_PASSWORD } from '../scripts/lib/testAccounts.ts'

const PORT = 4199
const origin = `http://localhost:${PORT}`
let server: PreviewServer | undefined

test.skip(!existsSync('dist/index.html'), 'no production build; run `npm run build` first')

test.beforeAll(async () => {
  server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'error' })
})

test.afterAll(async () => {
  // Drop any connection a browser left open, so closing the server can never hang the run.
  ;(server?.httpServer as { closeAllConnections?: () => void } | undefined)?.closeAllConnections?.()
  await new Promise((resolve) => (server ? server.httpServer.close(resolve) : resolve(null)))
})

test('the landing page is readable with JavaScript switched off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(origin)
  await expect(page.locator('h1')).toHaveText('Your move.')
  await expect(page.locator('h2')).toHaveText(['Games to play online', 'How it works', 'Fair play', 'Online games across Africa'])
  await expect(page.getByRole('link', { name: 'Play chess free' })).toBeVisible()
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/landing\/og\.jpg$/)
  await context.close()
})

for (const locale of ['en-US', 'fr-FR']) {
  test(`React attaches to the prerendered page without errors (${locale})`, async ({ browser }) => {
    const context = await browser.newContext({ locale })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(origin)
    await expect(page.locator('h1')).toHaveText(locale === 'fr-FR' ? 'À vous de jouer.' : 'Your move.')
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])

    // Other routes are served the same file; the landing markup must not leak into them.
    await page.goto(`${origin}/lobby`)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('h1')).toHaveCount(1)
    await context.close()
  })
}

test('offline: the installed app still opens, shows the saved wallet and profile, and says it is offline', async ({ browser }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US' })
  const page = await context.newPage()
  await page.goto(`${origin}/login`)
  await page.getByLabel('Email').fill('e2e-player@example.com')
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('balance-bonus')).toHaveText(/^[\d,]+$/)
  const balance = await page.getByTestId('balance-bonus').textContent()

  // Visit the pages once while online, so there is something saved to show later.
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByText('@e2e_player')).toBeVisible()
  await page.getByRole('link', { name: 'Wallet' }).click()
  await expect(page.getByTestId('ledger').getByRole('listitem').first()).toBeVisible()
  // The service worker (the offline app shell) must be in control, and the saved copy written
  // (it is written about a second after new data arrives).
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForTimeout(2500)
  await page.reload()
  await expect(page.getByTestId('ledger').getByRole('listitem').first()).toBeVisible()
  await page.waitForTimeout(3000)

  await context.setOffline(true)
  await page.reload()

  // No connection at all: the app opens anyway, from what is stored on the phone.
  await expect(page.getByText('You are offline. Online play needs a connection.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Wallet', level: 1 })).toBeVisible()
  await expect(page.getByTestId('balance-bonus')).toHaveText(balance!)
  await expect(page.getByTestId('ledger').getByRole('listitem').first()).toBeVisible()
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByText('@e2e_player')).toBeVisible()
  await expect(page.getByTestId('rating-blitz')).toBeVisible()

  // Practice against a friend on the same phone works with no connection.
  await page.getByRole('link', { name: 'Play', exact: true }).click()
  await page.getByTestId('game-chess').click()
  await page.getByTestId('game-play').click()
  await page.getByRole('link', { name: 'Play on this device' }).click()
  await page.getByRole('button', { name: 'Start game' }).click()
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByRole('button', { name: 'e4', exact: true })).toBeVisible()

  // Back online: the banner goes away by itself.
  await context.setOffline(false)
  await page.getByRole('link', { name: 'Lobby' }).click()
  await expect(page.getByText('You are offline. Online play needs a connection.')).toHaveCount(0)
  await context.close()
})

test('the security policy is in both entry pages and the app works under it, chess engine included', async ({ browser }) => {
  test.setTimeout(120_000)
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, locale: 'en-US' })
  const page = await context.newPage()
  const blocked: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) blocked.push(message.text())
  })
  for (const path of ['/', '/login']) {
    await page.goto(origin + path)
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co")
    expect(policy).not.toContain("'unsafe-eval'")
  }
  // An injected inline script does not run.
  const ran = await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__injected = true'
    document.body.appendChild(script)
    return (window as unknown as { __injected?: boolean }).__injected === true
  })
  expect(ran).toBe(false)
  blocked.length = 0

  await page.getByLabel('Email').fill('e2e-player@example.com')
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByTestId('balance-bonus')).toHaveText(/^[\d,]+$/)
  // The chess engine: a worker running WebAssembly.
  const best = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker('/engine/stockfish.wasm.js')
        const timer = setTimeout(() => reject(new Error('engine did not answer')), 25_000)
        worker.onerror = (event) => reject(new Error(event.message))
        worker.onmessage = (event) => {
          const line = String(event.data)
          if (line.startsWith('bestmove')) {
            clearTimeout(timer)
            worker.terminate()
            resolve(line.split(' ')[1]!)
          }
        }
        worker.postMessage('uci')
        worker.postMessage('position fen 6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1')
        worker.postMessage('go depth 6')
      }),
  )
  expect(best).toBe('a1a8')
  // A game screen with canvas drawing and sound.
  await page.goto(origin + '/play/pool/computer')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('pool-table')).toBeVisible()
  await page.waitForTimeout(1000)
  expect(blocked).toEqual([])
  await context.close()
})

test('search engines are told what each page is, and which pages are not for them', async ({ page, request }) => {
  // The landing page says what it is before any JavaScript runs.
  const html = await (await request.get(origin)).text()
  expect(html).toContain('<title>Play Chess, Ludo, Draughts &amp; Pool Online Free | African Game Hub</title>')
  expect(html).toMatch(/<meta\s+name="description"\s+content="Play chess, ludo, draughts \(checkers\) and 8-ball pool online/)
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!)
  expect(data['@graph'].map((entry: { '@type': string }) => entry['@type'])).toEqual(['Organization', 'WebSite', 'WebApplication'])

  // The file every other page starts from makes none of the landing page's claims.
  const shell = await (await request.get(`${origin}/app.html`)).text()
  expect(shell).not.toContain('rel="canonical"')
  expect(shell).not.toContain('application/ld+json')

  // A public page: its own title and address, and it may be listed.
  await page.goto(`${origin}/terms`)
  await expect(page).toHaveTitle('Terms of use | African Game Hub')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/terms$/)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/)
  await page.goto(`${origin}/signup`)
  await expect(page).toHaveTitle('Create your account | African Game Hub')
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Create a free African Game Hub account/)

  // An address that is not a page, and the pages behind the log-in, are not for listing.
  await page.goto(`${origin}/no-such-page`)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)

  // Back on the landing page (moving inside the app), its tags return.
  await page.goto(origin)
  await expect(page).toHaveTitle('Play Chess, Ludo, Draughts & Pool Online Free | African Game Hub')
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)

  const robots = await (await request.get(`${origin}/robots.txt`)).text()
  expect(robots).toMatch(/^User-agent: \*\n/)
  // Only a build for the hub's real address has a sitemap; any other tells search engines to stay away.
  if (robots.includes('Sitemap:')) {
    expect(robots).toContain('Disallow: /lobby\n')
    const sitemap = await (await request.get(`${origin}/sitemap.xml`)).text()
    expect(sitemap.match(/<loc>/g)).toHaveLength(8)
    expect(sitemap).toMatch(/<loc>https:\/\/[^<]+\/responsible-gaming<\/loc>/)
  } else {
    expect(robots).toBe('User-agent: *\nDisallow: /\n')
  }
})
