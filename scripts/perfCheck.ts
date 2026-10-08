// Measures what a first visit costs on a budget phone: bytes downloaded and time to first
// content, with the network and processor slowed down. Usage: npm run build && npm run perf
//
// The built site is served with gzip (as any real host does) and loaded in a phone-sized
// browser throttled to a slow connection and a 4x slower processor.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium, devices } from '@playwright/test'

const dist = join(process.cwd(), 'dist')
if (!existsSync(join(dist, 'index.html'))) throw new Error('No build found. Run `npm run build` first.')

const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.txt': 'text/plain',
}
const compressible = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.txt'])
const zipped = new Map<string, Buffer>()

const server = createServer((request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0]!)
  let file = join(dist, path)
  // As the host is configured: '/' is the prerendered landing page, every other route the app shell.
  if (path === '/') file = join(dist, 'index.html')
  else if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'app.html')
  const ext = extname(file)
  response.setHeader('Content-Type', types[ext] ?? 'application/octet-stream')
  if (compressible.has(ext)) {
    if (!zipped.has(file)) zipped.set(file, gzipSync(readFileSync(file)))
    response.setHeader('Content-Encoding', 'gzip')
    response.end(zipped.get(file))
  } else {
    createReadStream(file).pipe(response)
  }
})
await new Promise<void>((resolve) => server.listen(4188, resolve))

// Roughly "a mid-range Android phone on a weak 3G/4G signal".
const PROFILES = {
  'slow 4G': { latency: 150, download: (1.6 * 1024 * 1024) / 8, upload: (750 * 1024) / 8 },
  '3G': { latency: 300, download: (750 * 1024) / 8, upload: (250 * 1024) / 8 },
}
const ROUTES = ['/', '/login', '/signup']

const browser = await chromium.launch()
const results: Record<string, string | number>[] = []
try {
  for (const [profileName, network] of Object.entries(PROFILES)) {
    for (const route of ROUTES) {
      // A fresh context every time: nothing cached, no service worker, like a first visit.
      const context = await browser.newContext({ ...devices['Pixel 5'], locale: 'en-US', serviceWorkers: 'block' })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: network.latency,
        downloadThroughput: network.download,
        uploadThroughput: network.upload,
      })
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

      const bytes = { js: 0, css: 0, font: 0, image: 0, html: 0, other: 0 }
      cdp.on('Network.loadingFinished', () => {})
      const sizes = new Map<string, { type: string; url: string }>()
      cdp.on('Network.responseReceived', (event) => sizes.set(event.requestId, { type: event.type, url: event.response.url }))
      cdp.on('Network.loadingFinished', (event) => {
        const info = sizes.get(event.requestId)
        // Only what our own site sent; calls to the database are tiny and vary.
        if (!info || !info.url.startsWith('http://localhost:4188')) return
        const kind =
          info.type === 'Script' ? 'js' : info.type === 'Stylesheet' ? 'css' : info.type === 'Font' ? 'font'
          : info.type === 'Image' ? 'image' : info.type === 'Document' ? 'html' : 'other'
        bytes[kind] += event.encodedDataLength
      })

      await page.goto(`http://localhost:4188${route}`, { waitUntil: 'load', timeout: 120_000 })
      // Give late, lazy downloads (the 3D scene on the landing page) time to finish.
      await page.waitForTimeout(route === '/' ? 12_000 : 3000)

      const timing = await page.evaluate(
        () =>
          new Promise<{ fcp: number; lcp: number }>((resolve) => {
            const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0
            let lcp = 0
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime)
            }).observe({ type: 'largest-contentful-paint', buffered: true })
            setTimeout(() => resolve({ fcp, lcp }), 300)
          }),
      )
      const kb = (n: number) => Math.round(n / 1024)
      results.push({
        network: profileName,
        page: route,
        'first content (s)': (timing.fcp / 1000).toFixed(1),
        'main content (s)': (timing.lcp / 1000).toFixed(1),
        'JS KB': kb(bytes.js),
        'CSS KB': kb(bytes.css),
        'fonts KB': kb(bytes.font),
        'images KB': kb(bytes.image),
        'total KB': kb(Object.values(bytes).reduce((a, b) => a + b, 0)),
        '3D loaded': (await page.locator('canvas').count()) > 0 ? 'yes' : 'no',
      })
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}

console.table(results)
process.exit(0)
