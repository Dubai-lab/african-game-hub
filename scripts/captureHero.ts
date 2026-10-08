// Renders the hero's still picture and the link-preview image from the live 3D scene, so both
// always match it. Run again whenever the scene or the palette changes: npm run capture:hero
//
//   public/landing/hero-poster.webp  what every visitor sees first, and all that low-end phones get
//   public/landing/og.jpg            the picture shown when a link is shared (1200 x 630)
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const outDir = join(process.cwd(), 'public', 'landing')
mkdirSync(outDir, { recursive: true })

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'warn' })
await server.listen()
const url = 'http://localhost:5199/?force3d&capture'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

try {
  // Still picture: the scene's own canvas, with a transparent background.
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1.2, locale: 'en-US' })
  await page.goto(url)
  await page.waitForFunction(() => '__heroCapture' in window, undefined, { timeout: 60_000 })
  await page.waitForTimeout(800)
  const dataUrl = await page.evaluate(() => (window as unknown as { __heroCapture: () => string }).__heroCapture())
  if (!dataUrl.startsWith('data:image/webp')) throw new Error('This browser could not encode WebP')
  const poster = join(outDir, 'hero-poster.webp')
  writeFileSync(poster, Buffer.from(dataUrl.split(',')[1]!, 'base64'))
  const size = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    return `${canvas.width}x${canvas.height}`
  })
  console.log(`hero-poster.webp  ${size}  ${(statSync(poster).size / 1024).toFixed(1)} KB`)
  await page.close()

  // Link preview: the top of the real page at the size WhatsApp, Facebook and X expect.
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, locale: 'en-US' })
  await og.goto(url)
  await og.waitForFunction(() => '__heroCapture' in window, undefined, { timeout: 60_000 })
  await og.waitForTimeout(1200)
  const ogPath = join(outDir, 'og.jpg')
  await og.screenshot({ path: ogPath, type: 'jpeg', quality: 84 })
  console.log(`og.jpg            1200x630  ${(statSync(ogPath).size / 1024).toFixed(1)} KB`)
  await og.close()
} finally {
  await browser.close()
  await server.close()
}
