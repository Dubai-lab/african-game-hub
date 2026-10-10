// Makes the pictures on the game cards from the full-size originals.
// Usage: npm run game-art
//
// The originals live in art-src/games/ (kept out of the repository and out of the website:
// each is over a megabyte). Each is cut to the shape of a game card and saved small, as WebP,
// in public/games/, which is what the site serves. A budget phone on mobile data downloads
// about twenty kilobytes per picture instead of a megabyte.
//
// art-src/games/light/ holds the same pictures on a light ground; those go to
// public/games/light/.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from '@playwright/test'

const SOURCE = join(process.cwd(), 'art-src', 'games')
const OUT = join(process.cwd(), 'public', 'games')
// The card shows its picture 6 wide to 5 high; this is twice the size of the largest card.
const WIDTH = 720
const HEIGHT = 600
const ZOOM = 1.16
// Which original belongs to which game, by its id in the games registry.
const GAMES: Record<string, RegExp> = {
  chess: /^chess\./i,
  draughts: /^(checker|draughts)\./i,
  ludo: /^ludo\./i,
  pool: /^pool\./i,
  penalty: /^penalty\./i,
}
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
const SETS = [
  { source: SOURCE, out: OUT, label: 'public/games' },
  { source: join(SOURCE, 'light'), out: join(OUT, 'light'), label: 'public/games/light' },
]

if (!existsSync(SOURCE)) throw new Error(`No originals found: put them in ${SOURCE}`)

const browser = await chromium.launch()
const page = await browser.newPage()
for (const set of SETS) {
  if (!existsSync(set.source)) continue
  mkdirSync(set.out, { recursive: true })
  const files = readdirSync(set.source)
  for (const [game, pattern] of Object.entries(GAMES)) {
    const name = files.find((candidate) => pattern.test(candidate))
    if (!name) {
      console.log(`${game}: no original in ${set.source}, skipped`)
      continue
    }
    const type = TYPES[extname(name).toLowerCase()]
    if (!type) throw new Error(`${name}: not a picture this script reads`)
    const source = `data:${type};base64,${readFileSync(join(set.source, name)).toString('base64')}`
    const webp = await page.evaluate(
      async ({ source, width, height, zoom }) => {
        const image = new Image()
        image.src = source
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        // Fill the card, keeping the middle of the picture in view, and come in a little closer:
        // the originals leave room round the subject, and on a phone the card is small.
        const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom
        const w = image.naturalWidth * scale
        const h = image.naturalHeight * scale
        const context = canvas.getContext('2d')!
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
        return canvas.toDataURL('image/webp', 0.86).split(',')[1]!
      },
      { source, width: WIDTH, height: HEIGHT, zoom: ZOOM },
    )
    const bytes = Buffer.from(webp, 'base64')
    writeFileSync(join(set.out, `${game}.webp`), bytes)
    console.log(`${game}: ${name} -> ${set.label}/${game}.webp (${(bytes.length / 1024).toFixed(0)} KB)`)
  }
}
await browser.close()
