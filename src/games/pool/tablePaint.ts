import { CORNER_CUT, CORNER_JAW, CUSHION_DEPTH, MIDDLE_CUT, MIDDLE_JAW, POCKET_RIM, POCKETS, TABLE } from '../../../supabase/functions/_shared/pool'

// The pool table without the balls, painted once for a given size.
//
// The design is the hub's own (the owner's design, kept in /pooltable as a drawing and the
// script that made it): a lacquered frame with a carved band of scrollwork let into each rail,
// ringed sights, plain wood round every pocket, cushions with a bevelled nose, and the hub's
// mark on the cloth inside a sunburst. Here it is in the hub's colours, indigo and gold, and it
// is drawn straight onto a canvas: no image file, no filters, so it looks the same on every
// phone and costs nothing while a game is being played.
//
// Its measurements are not the drawing's but the game's: the cushions, their cut ends and the
// pockets are drawn from the very numbers the physics uses, so what the player sees is what
// the ball meets.

/** Wood and cushion around the playing surface, in millimetres: room for the carved band. */
export const RAIL = 140
/** How far a cushion stands out from the wood onto the slate: the same number the physics uses. */
const LIP = CUSHION_DEPTH
/** The design is drawn in units of a thousandth of the table's length; this many millimetres each. */
const U = TABLE.w / 1000

export type ClothColors = { bed: string; cloth: readonly [string, string, string]; cushion: readonly [string, string, string] }

/** The frame's colours: the hub's indigo, with gold for everything carved or inlaid. */
const FRAME = {
  top: '#3a49bd',
  middle: '#232f8a',
  bottom: '#141b52',
  edge: 'rgba(170, 182, 255, 0.6)',
  bandBase: '#0a0e33',
  carveShadow: '#02030c',
  carve: '#c0912f',
  carveLight: '#ffe9a6',
  gold: '#f5c542',
  ivory: '#fbf4e4',
  ink: '#070a26',
}

/** The scrollwork, one repeat of it (58 units long, 27 high), as the design draws it. */
const SCROLL_LINES = [
  'M0 14 C7 3 18 3 23 10 C27 16 21 20 17 17 C14 14 17 10 20 12',
  'M29 14 C36 25 47 25 52 18 C56 12 50 8 46 11 C43 14 46 18 49 16',
  'M23 10 C26 14 28 14 29 14 M52 18 C55 16 57 14 58 14',
]
const SCROLL_FINE = 'M3 22 C10 25 16 24 22 20 M32 6 C39 3 45 4 51 8'
const SCROLL_LEAVES = ['M8 18 q4 -3 8 2 q-5 3 -8 -2Z', 'M37 9 q4 3 8 -2 q-5 -3 -8 2Z']
const SCROLL_DOTS: readonly [number, number][] = [[27, 4], [56, 24]]
const TILE_W = 58
const TILE_H = 27

/** A source of numbers that is the same every time, so the grain does not change between paintings. */
function chance(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

export function paintTable(width: number, height: number, vertical: boolean, scale: number, colors: ClothColors): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  // Everything below is drawn as if the table lay on its side; a tall screen turns it.
  if (vertical) ctx.transform(0, -scale, scale, 0, RAIL * scale, (TABLE.w + RAIL) * scale)
  else ctx.transform(scale, 0, 0, scale, RAIL * scale, RAIL * scale)
  const W = TABLE.w
  const H = TABLE.h
  const random = chance(7)
  const ROUND = 40 * U
  const frame = () => {
    ctx.beginPath()
    ctx.roundRect(-RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, ROUND)
  }
  /** The four rails. Each turns "this far along the rail, this far out from the cloth" into a place on the table. */
  const rails = {
    top: (u: number, v: number): [number, number] => [u, -v],
    bottom: (u: number, v: number): [number, number] => [u, H + v],
    left: (u: number, v: number): [number, number] => [-v, u],
    right: (u: number, v: number): [number, number] => [W + v, u],
  }
  type Rail = keyof typeof rails

  // ---- The frame: lacquered, lighter along the top, with a fine bright line round its edge ----
  const lacquer = ctx.createLinearGradient(0, -RAIL, 0, H + RAIL)
  lacquer.addColorStop(0, FRAME.top)
  lacquer.addColorStop(0.45, FRAME.middle)
  lacquer.addColorStop(1, FRAME.bottom)
  ctx.fillStyle = lacquer
  frame()
  ctx.fill()
  // Lacquer is smooth: a soft sheen along the top rail and a deepening toward the bottom, and no grain.
  ctx.save()
  frame()
  ctx.clip()
  const sheen = ctx.createLinearGradient(0, -RAIL, 0, -RAIL * 0.35)
  sheen.addColorStop(0, 'rgba(190, 200, 255, 0.22)')
  sheen.addColorStop(1, 'rgba(190, 200, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(-RAIL, -RAIL, W + RAIL * 2, RAIL)
  ctx.restore()
  ctx.strokeStyle = FRAME.edge
  ctx.lineWidth = 1.5 * U
  ctx.beginPath()
  ctx.roundRect(-RAIL + 1.5 * U, -RAIL + 1.5 * U, W + RAIL * 2 - 3 * U, H + RAIL * 2 - 3 * U, ROUND - 1.5 * U)
  ctx.stroke()

  // ---- The carved bands: one let into each rail between the pockets, its ends drawn in an S ----
  const inner = LIP + 4 * U // where a band begins, out from the cloth
  const outer = RAIL - 5 * U // and where it ends, short of the frame's edge
  const sweep = 34 * U // how long each S-shaped end is
  const bandPath = (rail: Rail, from: number, to: number) => {
    const at = rails[rail]
    const path = new Path2D()
    const move = (u: number, v: number) => path.moveTo(...at(u, v))
    const line = (u: number, v: number) => path.lineTo(...at(u, v))
    const curve = (u1: number, v1: number, u2: number, v2: number, u3: number, v3: number) => path.bezierCurveTo(...at(u1, v1), ...at(u2, v2), ...at(u3, v3))
    move(from, inner)
    curve(from + sweep * 0.95, inner, from + sweep * 0.05, outer, from + sweep, outer)
    line(to - sweep, outer)
    curve(to - sweep * 0.05, outer, to - sweep * 0.95, inner, to, inner)
    path.closePath()
    return path
  }
  /** The scrollwork, in its own units, in one colour: lines, finer lines, leaves and dots. */
  const scroll = (color: string, widen = 0) => {
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2 + widen
    for (const line of SCROLL_LINES) ctx.stroke(new Path2D(line))
    ctx.lineWidth = 1.4 + widen
    ctx.stroke(new Path2D(SCROLL_FINE))
    for (const leaf of SCROLL_LEAVES) {
      const path = new Path2D(leaf)
      ctx.fill(path)
      if (widen > 0) ctx.stroke(path)
    }
    for (const [x, y] of SCROLL_DOTS) {
      ctx.beginPath()
      ctx.arc(x, y, 1.5 + widen / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.lineCap = 'butt'
  }
  const bandHigh = (outer - inner) / U // the band's height in the design's units: about one repeat of the scrollwork
  const carveBand = (rail: Rail, from: number, to: number) => {
    const path = bandPath(rail, from, to)
    ctx.fillStyle = FRAME.bandBase
    ctx.fill(path)
    ctx.save()
    ctx.clip(path)
    // Carved, not painted: each stroke is laid three times, its shadow below and to the right,
    // its body, and the light it catches above and to the left. (The light comes from the same
    // side on every rail, so the offsets are made on the table, before the band is turned.)
    for (const [dx, dy, color, widen] of [
      [1.1 * U, 1.5 * U, FRAME.carveShadow, 0.9],
      [0, 0, FRAME.carve, 0.5],
      [-0.55 * U, -0.6 * U, FRAME.carveLight, -1.1],
    ] as const) {
      ctx.save()
      ctx.translate(dx, dy)
      // Into the band's own space: x along the rail, y across it from its outer edge, in the design's units.
      if (rail === 'top') ctx.transform(U, 0, 0, U, 0, -outer)
      else if (rail === 'bottom') ctx.transform(U, 0, 0, -U, 0, H + outer)
      else if (rail === 'left') ctx.transform(0, U, U, 0, -outer, 0)
      else ctx.transform(0, U, -U, 0, W + outer, 0)
      ctx.translate(0, (bandHigh - TILE_H) / 2)
      const first = Math.floor(from / U / TILE_W) - 1
      const last = Math.ceil(to / U / TILE_W) + 1
      for (let tile = first; tile <= last; tile++) {
        ctx.save()
        ctx.translate(tile * TILE_W, 0)
        scroll(color, widen)
        ctx.restore()
      }
      ctx.restore()
    }
    ctx.restore()
    // Its edge: a dark line, and a fine gold one just inside the light.
    ctx.strokeStyle = FRAME.carveShadow
    ctx.lineWidth = 2.2 * U
    ctx.stroke(path)
    ctx.save()
    ctx.translate(-0.6 * U, -0.6 * U)
    ctx.strokeStyle = 'rgba(245, 197, 66, 0.9)'
    ctx.lineWidth = 1 * U
    ctx.stroke(path)
    ctx.restore()
  }
  // Each band keeps clear of the pockets at its ends: plain wood is left round every hole.
  const cornerHole = POCKETS[0]!.r + POCKET_RIM
  const middleHole = POCKETS[1]!.r + POCKET_RIM
  const fromCorner = -POCKETS[0]!.x + cornerHole + 12 * U
  const fromMiddle = middleHole + 14 * U
  for (const rail of ['top', 'bottom'] as const) {
    carveBand(rail, fromCorner, W / 2 - fromMiddle)
    carveBand(rail, W / 2 + fromMiddle, W - fromCorner)
  }
  for (const rail of ['left', 'right'] as const) carveBand(rail, fromCorner, H - fromCorner)

  // The line where the wood meets the cushions.
  ctx.strokeStyle = FRAME.ink
  ctx.lineWidth = 2 * U
  ctx.strokeRect(-LIP - 1.5 * U, -LIP - 1.5 * U, W + LIP * 2 + 3 * U, H + LIP * 2 + 3 * U)

  // The sights players aim by: an ivory dot in a gold ring, set into the band.
  const sight = (x: number, y: number) => {
    ctx.fillStyle = FRAME.ink
    ctx.beginPath()
    ctx.arc(x, y, 5.2 * U, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = FRAME.gold
    ctx.lineWidth = 1.3 * U
    ctx.beginPath()
    ctx.arc(x, y, 4.3 * U, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = FRAME.ivory
    ctx.beginPath()
    ctx.arc(x, y, 2.4 * U, 0, Math.PI * 2)
    ctx.fill()
  }
  const middleOfBand = (inner + outer) / 2
  for (const i of [1, 2, 3, 5, 6, 7]) for (const rail of ['top', 'bottom'] as const) sight(...rails[rail]((W * i) / 8, middleOfBand))
  for (const i of [1, 2, 3]) for (const rail of ['left', 'right'] as const) sight(...rails[rail]((H * i) / 4, middleOfBand))

  // Gold round each pocket, on the wood: a dark seat and a fine bright ring.
  // (Laid before the slate, which covers the part that would lie on the cloth.)
  ctx.save()
  frame()
  ctx.clip()
  for (const pocket of POCKETS) {
    const radius = pocket.r + POCKET_RIM
    ctx.strokeStyle = FRAME.ink
    ctx.lineWidth = 3 * U
    ctx.beginPath()
    ctx.arc(pocket.x, pocket.y, radius + 2 * U, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = FRAME.gold
    ctx.lineWidth = 1.1 * U
    ctx.beginPath()
    ctx.arc(pocket.x, pocket.y, radius + 3.8 * U, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  // ---- The slate and its cloth ----
  // Lighter under the lamp in the middle, falling away toward the rails. One piece of cloth,
  // one fall of light: it is the same in the mouth of a pocket as on the table beside it.
  const cloth = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.66)
  cloth.addColorStop(0, colors.cloth[0])
  cloth.addColorStop(0.55, colors.cloth[1])
  cloth.addColorStop(1, colors.cloth[2])
  ctx.fillStyle = cloth
  ctx.fillRect(-LIP, -LIP, W + LIP * 2, H + LIP * 2)
  // The nap: short fibres lying mostly one way, as a brushed cloth does.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.045)'
    ctx.fillRect(random() * W, random() * H, 4 + random() * 9, 2 + random() * 1.5)
  }

  // ---- The hub's mark on the cloth: the four squares in a ring, a sunburst round it, the name above and below ----
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(U, U)
  const mark = 'rgba(0, 0, 0, 0.17)'
  ctx.strokeStyle = mark
  ctx.fillStyle = mark
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(0, 0, 80, 0, Math.PI * 2)
  ctx.stroke()
  const rays = 28
  for (let i = 0; i < rays; i++) {
    const turn = (Math.PI * 2 * i) / rays
    const half = (Math.PI / rays) * 0.9
    ctx.beginPath()
    ctx.moveTo(86 * Math.cos(turn - half), 86 * Math.sin(turn - half))
    ctx.lineTo(98 * Math.cos(turn), 98 * Math.sin(turn))
    ctx.lineTo(86 * Math.cos(turn + half), 86 * Math.sin(turn + half))
    ctx.closePath()
    ctx.fill()
  }
  const square = 30
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(-square - 4, -square - 4, square * 2 + 8, square * 2 + 8, 6)
  ctx.stroke()
  ctx.fillRect(-square, -square, square, square)
  ctx.fillRect(0, 0, square, square)
  // The name, set round the ring: each letter stands on the circle.
  ctx.font = `800 21px 'Ojuju Variable', 'Arial Black', 'Trebuchet MS', system-ui, sans-serif`
  ctx.textAlign = 'center'
  const roundRing = (text: string, radius: number, above: boolean) => {
    const letters = [...text]
    const step = 0.118 // the angle from one letter to the next
    letters.forEach((letter, index) => {
      const offset = (index - (letters.length - 1) / 2) * step
      ctx.save()
      // Above the ring the word reads left to right over the top; below it, left to right under.
      ctx.rotate(above ? offset : -offset)
      ctx.translate(0, above ? -radius : radius)
      ctx.textBaseline = above ? 'alphabetic' : 'top'
      ctx.fillText(letter, 0, 0)
      ctx.restore()
    })
  }
  roundRing('AFRICAN', 103, true)
  roundRing('GAME HUB', 103, false)
  ctx.restore()

  // The head string and the two spots, faintly.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.lineWidth = 1.5 * U
  ctx.beginPath()
  ctx.moveTo(W / 4, 1)
  ctx.lineTo(W / 4, H - 1)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.36)'
  for (const x of [W / 4, (W * 3) / 4]) {
    ctx.beginPath()
    ctx.arc(x, H / 2, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- The cushions: a strip of cloth-covered rubber along each side, cut back at the pockets ----
  // (The same cuts and the same slopes as the physics: what is drawn is what the ball meets.)
  /** One cushion along a rail, from one tip of its nose to the other; `jaw1` and `jaw2` are how far its back runs on past each tip. */
  const cushion = (rail: Rail, from: number, to: number, jaw1: number, jaw2: number) => {
    const at = rails[rail]
    const shape = (points: [number, number][]) => {
      ctx.beginPath()
      points.forEach(([u, v], index) => (index === 0 ? ctx.moveTo(...at(u, v)) : ctx.lineTo(...at(u, v))))
      ctx.closePath()
    }
    // Its body, with a fine darker edge.
    shape([[from, 0], [to, 0], [to + jaw2, LIP], [from - jaw1, LIP]])
    ctx.fillStyle = colors.cushion[1]
    ctx.fill()
    ctx.strokeStyle = colors.cushion[0]
    ctx.lineWidth = 0.8 * U
    ctx.stroke()
    // Darker toward the wood: the cushion slopes up to its nose.
    const [nx, ny] = at(from, 0)
    const [bx, by] = at(from, LIP)
    const slope = ctx.createLinearGradient(bx, by, nx, ny)
    slope.addColorStop(0, 'rgba(0, 0, 0, 0.26)')
    slope.addColorStop(0.7, 'rgba(0, 0, 0, 0)')
    shape([[from, 0], [to, 0], [to + jaw2, LIP], [from - jaw1, LIP]])
    ctx.fillStyle = slope
    ctx.fill()
    // The bevel along its nose, where the light catches it.
    const deep = 4 * U
    const inset = 2.5 * U
    shape([[from, 0], [to, 0], [to - inset + (jaw2 * deep) / LIP, deep], [from + inset - (jaw1 * deep) / LIP, deep]])
    ctx.fillStyle = colors.cushion[2]
    ctx.fill()
  }

  // The shadow the cushions throw onto the cloth (drawn first: the cushions stand over it).
  // Only where a cushion stands: the mouth of a pocket has none, and no shadow.
  const fall = 40
  const shadow = (rail: Rail, from: number, to: number) => {
    const at = rails[rail]
    const [x1, y1] = at(from, 0)
    const [x2, y2] = at(from, -fall)
    const fade = ctx.createLinearGradient(x1, y1, x2, y2)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0.34)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = fade
    // It narrows to nothing at each end of the cushion: it does not stop square.
    ctx.beginPath()
    ctx.moveTo(...at(from, 0))
    ctx.lineTo(...at(to, 0))
    ctx.lineTo(...at(to - fall, -fall))
    ctx.lineTo(...at(from + fall, -fall))
    ctx.closePath()
    ctx.fill()
  }
  const noses: [Rail, number, number, number, number][] = [
    ['top', CORNER_CUT, W / 2 - MIDDLE_CUT, CORNER_JAW, MIDDLE_JAW],
    ['top', W / 2 + MIDDLE_CUT, W - CORNER_CUT, MIDDLE_JAW, CORNER_JAW],
    ['bottom', CORNER_CUT, W / 2 - MIDDLE_CUT, CORNER_JAW, MIDDLE_JAW],
    ['bottom', W / 2 + MIDDLE_CUT, W - CORNER_CUT, MIDDLE_JAW, CORNER_JAW],
    ['left', CORNER_CUT, H - CORNER_CUT, CORNER_JAW, CORNER_JAW],
    ['right', CORNER_CUT, H - CORNER_CUT, CORNER_JAW, CORNER_JAW],
  ]
  for (const [rail, from, to] of noses) shadow(rail, from, to)
  for (const [rail, from, to, jaw1, jaw2] of noses) cushion(rail, from, to, jaw1, jaw2)

  // ---- The pockets: a hole with depth to it, dark on the side of the cloth, its far wall catching the light ----
  for (const pocket of POCKETS) {
    const px = pocket.x
    const py = pocket.y
    // The hole is a little wider than the line a ball's centre must cross to drop: it goes when its centre is just over the rim.
    const radius = pocket.r + POCKET_RIM
    // Toward the middle of the table from this pocket.
    const dx = W / 2 - px
    const dy = H / 2 - py
    const away = Math.hypot(dx, dy)
    const ix = dx / away
    const iy = dy / away
    const hole = ctx.createRadialGradient(px + ix * radius * 0.56, py + iy * radius * 0.56, 0, px - ix * radius * 0.2, py - iy * radius * 0.2, radius * 1.24)
    hole.addColorStop(0, '#000000')
    hole.addColorStop(0.5, '#02030a')
    hole.addColorStop(0.78, '#141a4a')
    hole.addColorStop(0.93, '#2a348a')
    hole.addColorStop(1, '#3a49bd')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fill()
    // Its rim: pale where it meets the cloth, gold where it meets the wood.
    ctx.save()
    ctx.beginPath()
    ctx.rect(-LIP, -LIP, W + LIP * 2, H + LIP * 2)
    ctx.clip()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
    ctx.lineWidth = 1.6 * U
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.rect(-RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2)
    ctx.rect(-LIP, -LIP, W + LIP * 2, H + LIP * 2)
    ctx.clip('evenodd')
    ctx.strokeStyle = FRAME.gold
    ctx.lineWidth = 1.4 * U
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  return canvas
}
