// Flags on computers that cannot draw them.
//
// A country's flag is written as an emoji. Phones draw it; Windows has no flag pictures in its
// fonts and shows the two letters instead ("RW" for Rwanda). For those devices only, the site
// brings its own small font of flags (public/fonts/TwemojiCountryFlags.woff2, see ASSETS.md).
// A device that already draws flags is left alone and downloads nothing.

/** Whether this device draws a flag emoji as a picture (in colour) and not as letters. */
function drawsFlags(): boolean {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 24
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return true
    context.textBaseline = 'top'
    context.font = '20px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
    // The flag of Rwanda. Drawn as letters it is one colour; drawn as a flag it has several.
    context.fillText('\u{1F1F7}\u{1F1FC}', 0, 0)
    const pixels = context.getImageData(0, 0, 24, 24).data
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! === 0) continue
      // Any pixel that is not a shade of grey means colour, which means a real flag.
      if (Math.abs(pixels[i]! - pixels[i + 1]!) > 24 || Math.abs(pixels[i + 1]! - pixels[i + 2]!) > 24) return true
    }
    return false
  } catch {
    return true
  }
}

/** Run once when the app starts. Marks the page so the flag font is used where it is needed. */
export function applyOwnFlags() {
  if (typeof document === 'undefined') return
  if (!drawsFlags()) document.documentElement.classList.add('own-flags')
}
