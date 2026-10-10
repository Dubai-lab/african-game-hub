// The app's icons, from the hub's own mark: the four board squares of public/icon.svg.
// Usage: npm run icons
//
// First this writes assets/logo.png (the mark on a clear ground). The icon tool
// (@capacitor/assets) then cuts the iPhone icon and both phones' splash screens from it. Last,
// with --android, this draws the Android launcher icons itself: the tool's own come out on a
// clear ground and too small.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const INDIGO = '#1f2a7a'
const squares = `
  <rect x="136" y="136" width="120" height="120" fill="#f5b700"/>
  <rect x="256" y="256" width="120" height="120" fill="#f5b700"/>
  <rect x="256" y="136" width="120" height="120" fill="#eef0fa"/>
  <rect x="136" y="256" width="120" height="120" fill="#eef0fa"/>`
const svg = (inner) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner}</svg>`)
const png = (inner, size, file) => sharp(svg(inner), { density: 300 }).resize(size, size).png().toFile(file)

if (!process.argv.includes('--android')) {
  mkdirSync('assets', { recursive: true })
  await png(squares, 1024, 'assets/logo.png')
  console.log('assets/logo.png written')
} else {
  const res = join('android', 'app', 'src', 'main', 'res')
  // Launcher icon sizes in pixels: the plain icon is 48dp, an adaptive layer 108dp.
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  // No phone that can run the app has so coarse a screen; the tool's icons for it are wrong.
  rmSync(join(res, 'mipmap-ldpi'), { recursive: true, force: true })
  for (const [name, scale] of Object.entries(densities)) {
    const dir = join(res, `mipmap-${name}`)
    mkdirSync(dir, { recursive: true })
    // Android 8 and later: two layers, which the phone cuts to its own shape. The mark sits
    // inside the middle two thirds, the part no shape cuts into.
    await png(`<rect width="512" height="512" fill="${INDIGO}"/>`, 108 * scale, join(dir, 'ic_launcher_background.png'))
    await png(squares, 108 * scale, join(dir, 'ic_launcher_foreground.png'))
    // Android 7: one finished picture, square with soft corners, and a round one.
    const bigger = `<g transform="translate(256 256) scale(1.3) translate(-256 -256)">${squares}</g>`
    await png(`<rect width="512" height="512" rx="84" fill="${INDIGO}"/>${bigger}`, 48 * scale, join(dir, 'ic_launcher.png'))
    await png(`<circle cx="256" cy="256" r="256" fill="${INDIGO}"/>${bigger}`, 48 * scale, join(dir, 'ic_launcher_round.png'))
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`
  for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) writeFileSync(join(res, 'mipmap-anydpi-v26', file), adaptive)
  console.log('Android launcher icons written')
}
