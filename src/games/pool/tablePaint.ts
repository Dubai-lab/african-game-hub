import { CORNER_CUT, CORNER_JAW, CUSHION_DEPTH, MIDDLE_CUT, MIDDLE_JAW, POCKETS, TABLE } from '../../../supabase/functions/_shared/pool'

// The pool table without the balls, painted once for a given size. Nothing here is an image
// file, and nothing is taken from another game: the frame is our own, a dark hardwood with a
// band of inlaid diamonds along each rail (the hub's textile band), brass at the pockets, and
// the hub's mark woven faintly into the cloth.
//
// It is painted as a real table is built, from the floor up: the frame, the slate and cloth,
// the cushions standing on it, the shadows they throw, then the pockets cut through all of it.

/** Wood and cushion around the playing surface, in millimetres. */
export const RAIL = 112
/** How far a cushion stands out from the wood onto the slate: the same number the physics uses. */
const LIP = CUSHION_DEPTH

export type ClothColors = { bed: string; cloth: readonly [string, string, string]; cushion: readonly [string, string, string] }

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
  const frame = () => {
    ctx.beginPath()
    ctx.roundRect(-RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, 96)
  }

  // ---- The frame: dark hardwood, rounded over at its outer edge ----
  const wood = ctx.createLinearGradient(0, -RAIL, 0, H + RAIL)
  wood.addColorStop(0, '#5b2c12')
  wood.addColorStop(0.08, '#7c421c')
  wood.addColorStop(0.5, '#6a3616')
  wood.addColorStop(0.92, '#55290f')
  wood.addColorStop(1, '#3a1b09')
  ctx.fillStyle = wood
  frame()
  ctx.fill()
  ctx.save()
  frame()
  ctx.clip()
  // Grain: long streaks that run with each rail, so the wood turns the corners as joinery does.
  const streak = (along: 'x' | 'y', from: number, to: number, at: number, spread: number) => {
    ctx.strokeStyle = random() > 0.55 ? `rgba(30, 12, 2, ${0.1 + random() * 0.14})` : `rgba(255, 205, 140, ${0.04 + random() * 0.07})`
    ctx.lineWidth = 1.5 + random() * 4.5
    const a = at + (random() - 0.5) * spread
    const b = a + (random() - 0.5) * 14
    const c = a + (random() - 0.5) * 14
    ctx.beginPath()
    if (along === 'x') {
      ctx.moveTo(from, a)
      ctx.bezierCurveTo(from + (to - from) * 0.33, b, from + (to - from) * 0.66, c, to, a + (random() - 0.5) * 8)
    } else {
      ctx.moveTo(a, from)
      ctx.bezierCurveTo(b, from + (to - from) * 0.33, c, from + (to - from) * 0.66, a + (random() - 0.5) * 8, to)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 90; i++) {
    streak('x', -RAIL, W + RAIL, -RAIL / 2, RAIL)
    streak('x', -RAIL, W + RAIL, H + RAIL / 2, RAIL)
  }
  for (let i = 0; i < 50; i++) {
    streak('y', -RAIL, H + RAIL, -RAIL / 2, RAIL)
    streak('y', -RAIL, H + RAIL, W + RAIL / 2, RAIL)
  }
  // The rounded-over edge: light along the top and left, shade along the bottom and right.
  for (const [inset, color, line] of [
    [5, 'rgba(255, 226, 180, 0.42)', 5],
    [13, 'rgba(255, 226, 180, 0.13)', 9],
  ] as const) {
    ctx.strokeStyle = color
    ctx.lineWidth = line
    ctx.beginPath()
    ctx.roundRect(-RAIL + inset, -RAIL + inset, W + RAIL * 2 - inset * 2, H + RAIL * 2 - inset * 2, 96 - inset)
    ctx.stroke()
  }
  const shade = ctx.createLinearGradient(-RAIL, -RAIL, W + RAIL, H + RAIL)
  shade.addColorStop(0, 'rgba(255, 240, 210, 0.10)')
  shade.addColorStop(0.5, 'rgba(0, 0, 0, 0)')
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.30)')
  ctx.fillStyle = shade
  ctx.fillRect(-RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2)
  ctx.restore()

  // ---- The inlay: a band of diamonds along each rail, between two fine lines of brass ----
  const band = RAIL - LIP // the wood that shows, from the frame's edge to the cushion's back
  const middle = -(LIP + band * 0.52) // the middle of the band, measured out from the cloth
  const half = band * 0.2
  const diamond = (x: number, y: number, w: number, h: number, fill: string, edge = 'rgba(20, 8, 0, 0.55)') => {
    ctx.beginPath()
    ctx.moveTo(x, y - h)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x, y + h)
    ctx.lineTo(x - w, y)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  /** One rail's inlay, from `from` to `to` along it. `place` turns "along, out" into table x, y. */
  const inlay = (from: number, to: number, sights: number[], place: (along: number, out: number) => [number, number]) => {
    for (const side of [-1, 1]) {
      const [x1, y1] = place(from, middle + side * half)
      const [x2, y2] = place(to, middle + side * half)
      ctx.strokeStyle = 'rgba(232, 188, 92, 0.75)'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    const step = 46
    const count = Math.floor((to - from) / step)
    const start = from + ((to - from) - count * step) / 2
    for (let i = 0; i <= count; i++) {
      const along = start + i * step
      if (sights.some((sight) => Math.abs(sight - along) < step * 0.9)) continue
      const [x, y] = place(along, middle)
      // Gold, hibiscus and ivory by turns: the colours of the hub's band.
      diamond(x, y, 10, 10, ['#e2b24a', '#b3263f', '#efe3c4'][i % 3]!)
    }
    // The sights players aim by: a larger ivory diamond in a brass ring.
    for (const sight of sights) {
      const [x, y] = place(sight, middle)
      const ring = ctx.createLinearGradient(x - 16, y - 16, x + 16, y + 16)
      ring.addColorStop(0, '#fff0b8')
      ring.addColorStop(0.5, '#c9962e')
      ring.addColorStop(1, '#7a5512')
      ctx.fillStyle = ring
      ctx.beginPath()
      ctx.arc(x, y, 17, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#2a1408'
      ctx.beginPath()
      ctx.arc(x, y, 13, 0, Math.PI * 2)
      ctx.fill()
      diamond(x, y, 8, 11, '#f6efd9', 'rgba(0, 0, 0, 0.25)')
    }
  }
  const sightsLong = [1, 2, 3].map((i) => (W * i) / 8)
  const clear = 150 // how far the inlay keeps from a pocket
  inlay(clear, W / 2 - clear, sightsLong, (a, o) => [a, o])
  inlay(W / 2 + clear, W - clear, sightsLong.map((x) => W - x), (a, o) => [a, o])
  inlay(clear, W / 2 - clear, sightsLong, (a, o) => [a, H - o])
  inlay(W / 2 + clear, W - clear, sightsLong.map((x) => W - x), (a, o) => [a, H - o])
  const sightsShort = [1, 2, 3].map((i) => (H * i) / 4)
  inlay(clear, H - clear, sightsShort, (a, o) => [o, a])
  inlay(clear, H - clear, sightsShort, (a, o) => [W - o, a])

  // ---- Brass at the pockets: a plate let into the wood behind each one ----
  // (Laid before the slate, which covers the part of it that would lie on the cloth.)
  POCKETS.forEach((pocket, index) => {
    const radius = pocket.r - 6
    const outX = index === 1 || index === 4 ? 0 : pocket.x < W / 2 ? -1 : 1
    const outY = pocket.y < H / 2 ? -1 : 1
    const length = Math.hypot(outX, outY)
    const cx = pocket.x + (outX / length) * 14
    const cy = pocket.y + (outY / length) * 14
    const plate = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius)
    plate.addColorStop(0, '#fff1bd')
    plate.addColorStop(0.35, '#d6a43a')
    plate.addColorStop(0.7, '#8f6416')
    plate.addColorStop(1, '#e0b757')
    ctx.fillStyle = plate
    ctx.beginPath()
    ctx.arc(cx, cy, radius + 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(40, 20, 0, 0.6)'
    ctx.lineWidth = 2.5
    ctx.stroke()
    // A fine line engraved round it.
    ctx.strokeStyle = 'rgba(90, 55, 5, 0.55)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2)
    ctx.stroke()
  })

  // ---- The slate and its cloth ----
  ctx.fillStyle = colors.bed
  ctx.fillRect(-LIP, -LIP, W + LIP * 2, H + LIP * 2)
  // Lighter under the lamp in the middle, falling away toward the rails.
  const cloth = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.66)
  cloth.addColorStop(0, colors.cloth[0])
  cloth.addColorStop(0.55, colors.cloth[1])
  cloth.addColorStop(1, colors.cloth[2])
  ctx.fillStyle = cloth
  ctx.fillRect(0, 0, W, H)
  // The nap: short fibres lying mostly one way, as a brushed cloth does.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.045)'
    ctx.fillRect(random() * W, random() * H, 4 + random() * 9, 2 + random() * 1.5)
  }

  // The hub's mark, woven into the cloth: four squares, and the name under them.
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.globalAlpha = 0.085
  const tile = 92
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(-tile, -tile - 40, tile, tile)
  ctx.fillRect(0, -40, tile, tile)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, -tile - 40, tile, tile)
  ctx.fillRect(-tile, -40, tile, tile)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 7
  ctx.strokeRect(-tile - 16, -tile - 56, tile * 2 + 32, tile * 2 + 32)
  ctx.globalAlpha = 0.11
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 62px 'Ojuju Variable', 'Trebuchet MS', system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('AFRICAN GAME HUB', 0, tile + 30)
  ctx.restore()

  // The head string and the two spots, faintly.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.17)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(W / 4, 0)
  ctx.lineTo(W / 4, H)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)'
  for (const x of [W / 4, (W * 3) / 4]) {
    ctx.beginPath()
    ctx.arc(x, H / 2, 7, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- The cushions: a strip of cloth-covered rubber along each side, cut back at the pockets ----
  // Where each cushion's nose begins and ends, measured from the corners and from the middle.
  // (The same cuts and the same slopes as the physics: what is drawn is what the ball meets.)
  const cornerCut = CORNER_CUT
  const middleCut = MIDDLE_CUT
  /** One cushion, from one tip of its nose to the other; `jaw1` and `jaw2` are how far its back runs on past each tip. */
  const cushion = (x1: number, y1: number, x2: number, y2: number, inward: [number, number], jaw1: number, jaw2: number) => {
    const [ix, iy] = inward
    const [ax, ay] = x1 === x2 ? [0, 1] : [1, 0]
    ctx.beginPath()
    ctx.moveTo(x1 - ax * jaw1 - ix * LIP, y1 - ay * jaw1 - iy * LIP)
    ctx.lineTo(x2 + ax * jaw2 - ix * LIP, y2 + ay * jaw2 - iy * LIP)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x1, y1)
    ctx.closePath()
    // Dark where it meets the wood, rising to the light along its nose.
    const face = ctx.createLinearGradient(x1 - ix * LIP, y1 - iy * LIP, x1, y1)
    face.addColorStop(0, colors.cushion[0])
    face.addColorStop(0.55, colors.cushion[1])
    face.addColorStop(0.9, colors.cushion[2])
    face.addColorStop(1, colors.cushion[1])
    ctx.fillStyle = face
    ctx.fill()
    // The seam against the wood, and the light caught along the nose.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(x1 - ax * jaw1 - ix * LIP, y1 - ay * jaw1 - iy * LIP)
    ctx.lineTo(x2 + ax * jaw2 - ix * LIP, y2 + ay * jaw2 - iy * LIP)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x1 - ix * 5, y1 - iy * 5)
    ctx.lineTo(x2 - ix * 5, y2 - iy * 5)
    ctx.stroke()
    // The cut faces of the two jaws: darker than the top of the cushion, with a hard edge.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - ax * jaw1 - ix * LIP, y1 - ay * jaw1 - iy * LIP)
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 + ax * jaw2 - ix * LIP, y2 + ay * jaw2 - iy * LIP)
    ctx.stroke()
  }

  // The shadow the cushions throw onto the cloth (drawn first: the cushions stand over it).
  const fall = 40
  for (const [x, y, w, h, gx, gy] of [[0, 0, W, fall, 0, 1], [0, H - fall, W, fall, 0, -1], [0, 0, fall, H, 1, 0], [W - fall, 0, fall, H, -1, 0]] as const) {
    const fade = ctx.createLinearGradient(gx < 0 ? x + w : x, gy < 0 ? y + h : y, gx > 0 ? x + w : x, gy > 0 ? y + h : y)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0.34)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = fade
    ctx.fillRect(x, y, w, h)
  }
  cushion(cornerCut, 0, W / 2 - middleCut, 0, [0, 1], CORNER_JAW, MIDDLE_JAW)
  cushion(W / 2 + middleCut, 0, W - cornerCut, 0, [0, 1], MIDDLE_JAW, CORNER_JAW)
  cushion(cornerCut, H, W / 2 - middleCut, H, [0, -1], CORNER_JAW, MIDDLE_JAW)
  cushion(W / 2 + middleCut, H, W - cornerCut, H, [0, -1], MIDDLE_JAW, CORNER_JAW)
  cushion(0, cornerCut, 0, H - cornerCut, [1, 0], CORNER_JAW, CORNER_JAW)
  cushion(W, cornerCut, W, H - cornerCut, [-1, 0], CORNER_JAW, CORNER_JAW)

  // ---- The pockets: brass round the mouth, a leather lip, and a hole with depth to it ----
  POCKETS.forEach((pocket, index) => {
    const px = pocket.x
    const py = pocket.y
    // The hole is drawn just inside the line a ball's centre must cross to drop.
    const radius = pocket.r - 6
    // Which way is "out of the table" from this pocket: the brass sits on that side.
    const outX = index === 1 || index === 4 ? 0 : px < W / 2 ? -1 : 1
    const outY = py < H / 2 ? -1 : 1
    const length = Math.hypot(outX, outY)
    const ox = outX / length
    const oy = outY / length

    // The leather lip round the hole.
    ctx.fillStyle = '#241710'
    ctx.beginPath()
    ctx.arc(px, py, radius + 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.18)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(px, py, radius + 2.5, 0, Math.PI * 2)
    ctx.stroke()

    // The hole: black at the bottom, which lies toward the outside of the table, and a little
    // light on the far wall, so it reads as a drop and not a painted disc.
    const hole = ctx.createRadialGradient(px + ox * radius * 0.28, py + oy * radius * 0.28, radius * 0.1, px, py, radius)
    hole.addColorStop(0, '#000000')
    hole.addColorStop(0.62, '#070708')
    hole.addColorStop(0.86, '#17171b')
    hole.addColorStop(1, '#34343c')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fill()
    // The far wall of the pocket catches the lamp: a pale crescent just inside the rim.
    const turn = Math.atan2(oy, ox)
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(150, 150, 168, 0.5)'
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.arc(px, py, radius - 6, turn - 1.05, turn + 1.05)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(205, 205, 220, 0.35)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(px, py, radius - 3, turn - 0.8, turn + 0.8)
    ctx.stroke()
    // A step down inside, where the leather ends and the drop begins.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(px + ox * radius * 0.1, py + oy * radius * 0.1, radius * 0.7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineCap = 'butt'
    // The near wall is in shadow.
    const near = ctx.createRadialGradient(px - ox * radius * 0.9, py - oy * radius * 0.9, radius * 0.2, px - ox * radius * 0.9, py - oy * radius * 0.9, radius * 1.25)
    near.addColorStop(0, 'rgba(0, 0, 0, 0.75)')
    near.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = near
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fill()
  })

  return canvas
}
