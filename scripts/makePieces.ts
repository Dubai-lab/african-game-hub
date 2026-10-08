// Draws the hub's own chess pieces ("Solid") and writes them as SVG files.
// Usage: node scripts/makePieces.ts
//
// An original set, drawn here from plain shapes: solid bodies with a dark outline, shaded from
// the upper left, a small gleam on each head and a soft shadow underneath. Nothing is traced or
// copied from any other set. Change a shape below and run the script again to redraw all twelve.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'src', 'games', 'chess', 'pieces', 'hub')

type Tone = { light: string; mid: string; dark: string; line: string; gleam: string; detail: string }
const TONES: Record<'w' | 'b', Tone> = {
  w: { light: '#ffffff', mid: '#f1ede4', dark: '#bdb6a6', line: '#2a2a33', gleam: '#ffffff', detail: '#2a2a33' },
  b: { light: '#7a7a88', mid: '#44444f', dark: '#17171d', line: '#08080b', gleam: '#b9b9c6', detail: '#d8d8e2' },
}

// The foot every piece stands on, and the body most of them share.
const FOOT = 'M22 90 C22 84 26 81 31 80 L69 80 C74 81 78 84 78 90 Z'
const body = (top: number, half: number) =>
  `M${50 - half} ${top} C${52 - half} ${top + 13} 37 ${top + 22} 31 80 L69 80 C63 ${top + 22} ${48 + half} ${top + 13} ${50 + half} ${top} Z`
const collar = (y: number, rx: number) => `M${50 - rx} ${y} a${rx} 4.2 0 1 0 ${rx * 2} 0 a${rx} 4.2 0 1 0 ${-rx * 2} 0 Z`
const ball = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`

type Piece = { shapes: string[]; details?: string[]; gleam: [number, number, number, number] }
const PIECES: Record<string, Piece> = {
  P: {
    shapes: [body(44, 9), collar(45, 14), ball(50, 29, 13.5), FOOT],
    gleam: [45, 24, 4.5, 6],
  },
  R: {
    shapes: [
      // Tower and battlements in one outline.
      'M29 16 H40 V23 H46 V16 H54 V23 H60 V16 H71 V33 L64 39 V62 L70 80 H30 L36 62 V39 L29 33 Z',
      FOOT,
    ],
    details: ['M36 39 H64', 'M36 62 H64'],
    gleam: [41, 48, 3, 8],
  },
  B: {
    shapes: [body(48, 9.5), collar(49, 15), 'M50 13 C63 24 66 34 59 47 H41 C34 34 37 24 50 13 Z', ball(50, 10, 4.2), FOOT],
    // The cut in the mitre.
    details: ['M53 22 L45 33'],
    gleam: [44, 30, 3.5, 7],
  },
  Q: {
    shapes: [
      body(55, 11),
      collar(56, 17),
      // The crown: five points.
      'M25 27 L35 54 H65 L75 27 L63 41 L58 21 L50 40 L42 21 L37 41 Z',
      ball(25, 25, 4.3),
      ball(42, 19, 4.3),
      ball(58, 19, 4.3),
      ball(75, 25, 4.3),
      ball(50, 15, 4.6),
      FOOT,
    ],
    gleam: [42, 46, 3, 5.5],
  },
  K: {
    shapes: [
      body(55, 11),
      collar(56, 17),
      // The cross, then the crown under it.
      'M46.5 5 H53.5 V11 H59.5 V18 H53.5 V26 H46.5 V18 H40.5 V11 H46.5 Z',
      'M30 33 C30 27 42 25 50 25 C58 25 70 27 70 33 L64 54 H36 Z',
      FOOT,
    ],
    details: ['M50 30 V50'],
    gleam: [40, 38, 3, 7],
  },
  N: {
    shapes: [
      // A horse's head and neck, looking left: ear, brow, muzzle, jaw, chest, mane.
      'M31 80 C31 66 42 60 43 49 C38 53 30 56 25 52 C20 48 22 41 27 36 C34 29 36 19 47 14 L48 6 L56 12 C70 16 78 31 77 49 C76 62 70 71 70 80 Z',
      FOOT,
    ],
    details: ['M57 13 C66 21 71 34 70 50', 'M26 47 L29 44'],
    gleam: [58, 34, 3.5, 9],
  },
}

function draw(color: 'w' | 'b', letter: string): string {
  const tone = TONES[color]
  const piece = PIECES[letter]!
  const [gx, gy, grx, gry] = piece.gleam
  const eye = letter === 'N' ? `<circle cx="42" cy="27" r="2.6" fill="${tone.detail}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs>
<linearGradient id="s" x1="0.15" y1="0.1" x2="0.9" y2="0.95">
<stop offset="0" stop-color="${tone.light}"/><stop offset="0.45" stop-color="${tone.mid}"/><stop offset="1" stop-color="${tone.dark}"/>
</linearGradient>
<radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="50" cy="91" rx="34" ry="6" fill="url(#g)"/>
<g fill="url(#s)" stroke="${tone.line}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round">
${piece.shapes.map((d) => `<path d="${d}"/>`).join('\n')}
</g>
<g fill="none" stroke="${tone.detail}" stroke-width="2.6" stroke-linecap="round" opacity="${color === 'w' ? 0.85 : 0.7}">
${(piece.details ?? []).map((d) => `<path d="${d}"/>`).join('\n')}
</g>
${eye}
<ellipse cx="${gx}" cy="${gy}" rx="${grx}" ry="${gry}" fill="${tone.gleam}" opacity="${color === 'w' ? 0.9 : 0.45}" transform="rotate(-20 ${gx} ${gy})"/>
</svg>
`
}

mkdirSync(OUT, { recursive: true })
for (const color of ['w', 'b'] as const) {
  for (const letter of Object.keys(PIECES)) writeFileSync(join(OUT, `${color}${letter}.svg`), draw(color, letter))
}
console.log(`Wrote 12 pieces to ${OUT}`)
