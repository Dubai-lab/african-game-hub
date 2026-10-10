// Makes the pictures on the game cards from the full-size originals.
// Usage: npm run game-art
//
// The originals live in art-src/games/ (kept out of the repository and out of the website: one
// of them is 13 MB). Each is cut to the shape of a game card and saved small, as WebP, in
// public/games/, which is what the site serves. A budget phone on mobile data downloads a few
// tens of kilobytes per picture instead of megabytes.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from '@playwright/test'

const SOURCE = join(process.cwd(), 'art-src', 'games')
const OUT = join(process.cwd(), 'public', 'games')
// The card shows its picture 6 wide to 5 high; this is twice the size of the largest card.
const WIDTH = 720
const HEIGHT = 600
// Which original belongs to which game (by its id in the games registry), and which part of
// the picture to keep in view when it is cut to shape (0 to 1 across, 0 to 1 down).
const GAMES: Record<string, { file: RegExp; focus: [number, number] }> = {
  chess: { file: /^chess\./i, focus: [0.5, 0.5] },
  draughts: { file: /^(checker|draughts)\./i, focus: [0.5, 0.5] },
  ludo: { file: /^ludo\./i, focus: [0.5, 0.5] },
  pool: { file: /^pool\./i, focus: [0.4, 0.55] },
}
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

if (!existsSync(SOURCE)) throw new Error(`No originals found: put them in ${SOURCE}`)
mkdirSync(OUT, { recursive: true })
const files = readdirSync(SOURCE)

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [game, { file, focus }] of Object.entries(GAMES)) {
  const name = files.find((candidate) => file.test(candidate))
  if (!name) {
    console.log(`${game}: no original, skipped`)
    continue
  }
  const type = TYPES[extname(name).toLowerCase()]
  if (!type) throw new Error(`${name}: not a picture this script reads`)
  const source = `data:${type};base64,${readFileSync(join(SOURCE, name)).toString('base64')}`
  const webp = await page.evaluate(
    async ({ source, width, height, focus }) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      // Fill the card, keeping the chosen part of the picture in view.
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
      const w = image.naturalWidth * scale
      const h = image.naturalHeight * scale
      const context = canvas.getContext('2d')!
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, (width - w) * focus[0], (height - h) * focus[1], w, h)
      return canvas.toDataURL('image/webp', 0.8).split(',')[1]!
    },
    { source, width: WIDTH, height: HEIGHT, focus },
  )
  const bytes = Buffer.from(webp, 'base64')
  writeFileSync(join(OUT, `${game}.webp`), bytes)
  console.log(`${game}: ${name} -> public/games/${game}.webp (${(bytes.length / 1024).toFixed(0)} KB)`)
}
await browser.close()
