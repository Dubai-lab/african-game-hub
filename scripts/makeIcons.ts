// Renders the PNG app icons from public/icon.svg, so phones can install the app with a proper
// icon. Run again if the icon changes: npm run icons
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const publicDir = join(process.cwd(), 'public')
const svg = readFileSync(join(publicDir, 'icon.svg'), 'utf8')
// The artwork sits in the middle 47% of the square, inside the "safe zone" Android keeps when it
// crops an icon to a circle or squircle, so the same picture serves as the maskable icon.
const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

const browser = await chromium.launch()
try {
  for (const { file, size } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(
      `<body style="margin:0"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body>`,
    )
    await page.screenshot({ path: join(publicDir, file), type: 'png' })
    await page.close()
    console.log(`wrote public/${file}`)
  }
} finally {
  await browser.close()
}
