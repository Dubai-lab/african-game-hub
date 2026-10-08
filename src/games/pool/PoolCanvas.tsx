import { useEffect, useRef } from 'react'
import { type Ball, canPlaceCue, POCKETS, TABLE } from '../../../supabase/functions/_shared/pool'

// The pool table, drawn on a canvas. Nothing here is an image file: the cloth, the wooden
// rails and the pockets are painted once in code, and every ball is a true sphere, lit from
// above and shaded pixel by pixel, with its number and stripe wrapped round it. As a ball
// travels its surface turns by exactly the distance rolled, so the numbers roll with it.

const R = TABLE.r
/** Wood and cushion around the playing surface, in millimetres. */
const RAIL = 150
const BALL_COLOR: Record<number, [number, number, number]> = {
  0: [247, 245, 236],
  1: [246, 196, 0],
  2: [28, 78, 216],
  3: [222, 28, 44],
  4: [104, 46, 160],
  5: [245, 124, 0],
  6: [16, 148, 84],
  7: [134, 30, 22],
  8: [22, 22, 26],
}
const colorOf = (n: number) => BALL_COLOR[n > 8 ? n - 8 : n]!

type Mat = [number, number, number, number, number, number, number, number, number]
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
]
/** A turn of `angle` about the unit axis (x, y, 0), which lies in the table. */
function roll(x: number, y: number, angle: number): Mat {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [t * x * x + c, t * x * y, s * y, t * x * y, t * y * y + c, -s * x, -s * y, s * x, c]
}

/** The digits of each ball, drawn once, to be wrapped onto the sphere. */
const glyphs = new Map<number, Uint8ClampedArray>()
const GLYPH = 48
function glyph(n: number): Uint8ClampedArray {
  let data = glyphs.get(n)
  if (!data) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = GLYPH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.font = `800 ${n > 9 ? 30 : 36}px system-ui, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(n), GLYPH / 2, GLYPH / 2 + 2)
    data = ctx.getImageData(0, 0, GLYPH, GLYPH).data
    glyphs.set(n, data)
  }
  return data
}

// Light from above and a little toward the top-left of the screen.
const LX = -0.36
const LY = -0.48
const LZ = 0.8
// Halfway between the light and the eye, for the gleam.
const HL = Math.hypot(LX, LY, LZ + 1)
const HX = LX / HL
const HY = LY / HL
const HZ = (LZ + 1) / HL
const SPOT = 0.9 // cosine of the half-angle of the white number disc

/** Paints one ball into `image`, turned by `m`. */
function shade(image: ImageData, n: number, m: Mat) {
  const size = image.width
  const data = image.data
  const half = size / 2
  const [cr, cg, cb] = colorOf(n)
  const striped = n > 8
  const digits = n === 0 ? null : glyph(n)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5 - half) / half
      const y = (py + 0.5 - half) / half
      const d2 = x * x + y * y
      const at = (py * size + px) * 4
      if (d2 > 1) {
        data[at + 3] = 0
        continue
      }
      const z = Math.sqrt(1 - d2)
      // The same point in the ball's own frame (the matrix is a rotation: its inverse is its transpose).
      const bx = m[0] * x + m[3] * y + m[6] * z
      const by = m[1] * x + m[4] * y + m[7] * z
      const bz = m[2] * x + m[5] * y + m[8] * z
      let r = cr
      let g = cg
      let b = cb
      if (striped && Math.abs(bz) > 0.52) {
        r = 247
        g = 245
        b = 236
      }
      if (n === 0) {
        // Small red marks, so the spin on the cue ball can be seen.
        if (Math.abs(bx) > 0.975 || Math.abs(by) > 0.975 || Math.abs(bz) > 0.975) {
          r = 214
          g = 30
          b = 46
        }
      } else if (Math.abs(bx) > SPOT) {
        // The number, in a white disc on two opposite sides.
        r = 250
        g = 249
        b = 244
        const span = Math.sqrt(1 - SPOT * SPOT)
        const u = ((bx > 0 ? by : -by) / span) * 0.5 + 0.5
        const v = (-bz / span) * 0.5 + 0.5
        const gx = Math.floor(u * GLYPH)
        const gy = Math.floor(v * GLYPH)
        if (gx >= 0 && gy >= 0 && gx < GLYPH && gy < GLYPH && digits![(gy * GLYPH + gx) * 4 + 3]! > 110) {
          r = g = b = 18
        }
      }
      const diffuse = Math.max(0, x * LX + y * LY + z * LZ)
      const gleam = Math.pow(Math.max(0, x * HX + y * HY + z * HZ), 60)
      const light = 0.34 + 0.72 * diffuse
      // Soften the very edge, so the ball is round and not stair-stepped.
      const edge = Math.min(1, (1 - Math.sqrt(d2)) * half)
      data[at] = Math.min(255, r * light + 255 * gleam * 0.85)
      data[at + 1] = Math.min(255, g * light + 255 * gleam * 0.85)
      data[at + 2] = Math.min(255, b * light + 255 * gleam * 0.85)
      data[at + 3] = 255 * edge
    }
  }
}

/** The cloths a player can choose from: the bed under the cushions, the cloth from the lamp outward, the cushions. */
export const CLOTHS = {
  green: { bed: '#0c5f3d', cloth: ['#27a06c', '#1b8757', '#126b43'], cushion: ['#0a5335', '#178a57', '#2db47a'] },
  blue: { bed: '#0d3f6b', cloth: ['#2f86c9', '#1f6fae', '#15568c'], cushion: ['#0b3558', '#1a6aa8', '#3f97d8'] },
  red: { bed: '#5e0f1c', cloth: ['#b02a3c', '#93202f', '#741624'], cushion: ['#520c18', '#8f1e2d', '#bd3a4b'] },
} as const
export type ClothId = keyof typeof CLOTHS
export const CLOTH_IDS = Object.keys(CLOTHS) as ClothId[]
/** Where each pocket is drawn (the middle of its mouth). */
const mouth = (i: number) => ({ x: POCKETS[i]!.x, y: POCKETS[i]!.y })

/** The table without the balls, painted once for a given size. */
function paintTable(width: number, height: number, vertical: boolean, scale: number, clothId: ClothId): HTMLCanvasElement {
  const colors = CLOTHS[clothId]
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  // Everything below is drawn as if the table lay on its side; a tall screen turns it.
  if (vertical) ctx.transform(0, -scale, scale, 0, RAIL * scale, (TABLE.w + RAIL) * scale)
  else ctx.transform(scale, 0, 0, scale, RAIL * scale, RAIL * scale)
  const W = TABLE.w
  const H = TABLE.h

  // The wooden frame, with a grain of fine darker and lighter streaks.
  const wood = ctx.createLinearGradient(0, -RAIL, 0, H + RAIL)
  wood.addColorStop(0, '#6b3b17')
  wood.addColorStop(0.5, '#8a4f22')
  wood.addColorStop(1, '#5a2f11')
  ctx.fillStyle = wood
  ctx.beginPath()
  ctx.roundRect(-RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, 70)
  ctx.fill()
  ctx.save()
  ctx.clip()
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 260; i++) {
    const y = -RAIL + random() * (H + RAIL * 2)
    ctx.strokeStyle = random() > 0.5 ? 'rgba(40, 18, 4, 0.16)' : 'rgba(255, 214, 160, 0.09)'
    ctx.lineWidth = 2 + random() * 5
    ctx.beginPath()
    ctx.moveTo(-RAIL, y)
    ctx.bezierCurveTo(W * 0.3, y + random() * 30 - 15, W * 0.7, y + random() * 30 - 15, W + RAIL, y + random() * 20 - 10)
    ctx.stroke()
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(255, 225, 180, 0.35)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.roundRect(-RAIL + 8, -RAIL + 8, W + RAIL * 2 - 16, H + RAIL * 2 - 16, 64)
  ctx.stroke()

  // Cloth: lighter under the lamp in the middle, darker toward the rails, with a fine nap.
  const lip = 46
  ctx.fillStyle = colors.bed
  ctx.fillRect(-lip, -lip, W + lip * 2, H + lip * 2)
  const cloth = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.62)
  cloth.addColorStop(0, colors.cloth[0])
  cloth.addColorStop(0.6, colors.cloth[1])
  cloth.addColorStop(1, colors.cloth[2])
  ctx.fillStyle = cloth
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.05)'
    ctx.fillRect(random() * W, random() * H, 5 + random() * 6, 3)
  }

  // Cushions: a raised strip along each side, catching the light on its top edge.
  const nose = (x1: number, y1: number, x2: number, y2: number, inward: [number, number]) => {
    const [ix, iy] = inward
    const cut = 34
    const along = x1 === x2 ? [0, 1] : [1, 0]
    ctx.beginPath()
    ctx.moveTo(x1 - ix * lip, y1 - iy * lip)
    ctx.lineTo(x2 - ix * lip, y2 - iy * lip)
    ctx.lineTo(x2 - along[0]! * cut, y2 - along[1]! * cut)
    ctx.lineTo(x1 + along[0]! * cut, y1 + along[1]! * cut)
    ctx.closePath()
    const shade = ctx.createLinearGradient(x1 - ix * lip, y1 - iy * lip, x1, y1)
    shade.addColorStop(0, colors.cushion[0])
    shade.addColorStop(0.75, colors.cushion[1])
    shade.addColorStop(1, colors.cushion[2])
    ctx.fillStyle = shade
    ctx.fill()
  }
  const corner = 62
  const mid = 60
  nose(corner, 0, W / 2 - mid, 0, [0, 1])
  nose(W / 2 + mid, 0, W - corner, 0, [0, 1])
  nose(corner, H, W / 2 - mid, H, [0, -1])
  nose(W / 2 + mid, H, W - corner, H, [0, -1])
  nose(0, corner, 0, H - corner, [1, 0])
  nose(W, corner, W, H - corner, [-1, 0])

  // Shadow thrown onto the cloth by the cushions.
  for (const [x, y, w, h, gx, gy] of [[0, 0, W, 34, 0, 1], [0, H - 34, W, 34, 0, -1], [0, 0, 34, H, 1, 0], [W - 34, 0, 34, H, -1, 0]] as const) {
    const fade = ctx.createLinearGradient(gx < 0 ? x + w : x, gy < 0 ? y + h : y, gx > 0 ? x + w : gx < 0 ? x : x, gy > 0 ? y + h : gy < 0 ? y : y)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0.3)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = fade
    ctx.fillRect(x, y, w, h)
  }

  // The head string and the two spots, faintly.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(W / 4, 0)
  ctx.lineTo(W / 4, H)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
  for (const x of [W / 4, (W * 3) / 4]) {
    ctx.beginPath()
    ctx.arc(x, H / 2, 7, 0, Math.PI * 2)
    ctx.fill()
  }

  // Pockets: a dark mouth with depth, and a metal rim on the outer side.
  for (const pocket of POCKETS) {
    const px = pocket.x
    const py = pocket.y
    // The hole is drawn just inside the line a ball's centre must cross to drop.
    const radius = pocket.r - 9
    ctx.fillStyle = '#3a2a1c'
    ctx.beginPath()
    ctx.arc(px, py, radius + 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1a1310'
    ctx.beginPath()
    ctx.arc(px, py, radius + 3, 0, Math.PI * 2)
    ctx.fill()
    const hole = ctx.createRadialGradient(px, py + 6, 8, px, py, radius)
    hole.addColorStop(0, '#000000')
    hole.addColorStop(0.75, '#0b0b0d')
    hole.addColorStop(1, '#2a2a30')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  // Sights: the ivory diamonds players aim by.
  ctx.fillStyle = '#f3ead2'
  const diamond = (x: number, y: number) => {
    ctx.beginPath()
    ctx.moveTo(x, y - 13)
    ctx.lineTo(x + 9, y)
    ctx.lineTo(x, y + 13)
    ctx.lineTo(x - 9, y)
    ctx.closePath()
    ctx.fill()
  }
  for (let i = 1; i < 8; i++) {
    if (i === 4) continue
    diamond((W * i) / 8, -RAIL * 0.62)
    diamond((W * i) / 8, H + RAIL * 0.62)
  }
  for (let i = 1; i < 4; i++) {
    diamond(-RAIL * 0.62, (H * i) / 4)
    diamond(W + RAIL * 0.62, (H * i) / 4)
  }
  return canvas
}

export type Aim = { dx: number; dy: number }
type Props = {
  balls: readonly Ball[]
  /** Stand the table upright, for a phone held upright. */
  vertical: boolean
  /** Where the player is aiming; null when it is not their shot or balls are moving. */
  aim: Aim | null
  /** 0 to 1: how far back the cue is drawn. */
  power: number
  /** The player may pick up and place the cue ball. */
  ballInHand: boolean
  /** With ball in hand on the break, the cue ball stays behind the head string. */
  behindHeadString: boolean
  /** Balls the player must hit first: marked with a soft ring. */
  targets: readonly number[]
  onAim: (aim: Aim) => void
  onPlace: (x: number, y: number) => void
  label: string
  cloth: ClothId
  /** The whole aiming line (where the struck ball and the cue ball go), or only as far as the first ball. */
  guide: 'full' | 'short'
  /** The pocket called for the 8, ringed on the table; null when none is. */
  called: number | null
  /** The player must call a pocket: touching one calls it. */
  canCall: boolean
  onCall: (pocket: number) => void
}

/** The table and everything on it. Draws what it is given; the server decides what happens. */
export function PoolCanvas({ balls, vertical, aim, power, ballInHand, behindHeadString, targets, onAim, onPlace, label, cloth, guide, called, canCall, onCall }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ balls, aim, power, ballInHand, behindHeadString, targets, onAim, onPlace, guide, called, canCall, onCall })
  live.current = { balls, aim, power, ballInHand, behindHeadString, targets, onAim, onPlace, guide, called, canCall, onCall }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const spanX = (vertical ? TABLE.h : TABLE.w) + RAIL * 2
    const spanY = (vertical ? TABLE.w : TABLE.h) + RAIL * 2
    let scale = 1
    let table: HTMLCanvasElement | null = null
    let sprite: ImageData | null = null
    let spriteCanvas: HTMLCanvasElement | null = null
    const turned = new Map<number, Mat>()
    const last = new Map<number, { x: number; y: number }>()
    const sprites = new Map<number, HTMLCanvasElement>()

    const toScreen = (x: number, y: number): [number, number] =>
      vertical ? [(y + RAIL) * scale, (TABLE.w - x + RAIL) * scale] : [(x + RAIL) * scale, (y + RAIL) * scale]
    const toTable = (sx: number, sy: number): [number, number] =>
      vertical ? [TABLE.w - (sy / scale - RAIL), sx / scale - RAIL] : [sx / scale - RAIL, sy / scale - RAIL]

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(120, Math.round(canvas.clientWidth * ratio))
      canvas.width = width
      canvas.height = Math.round((width * spanY) / spanX)
      scale = width / spanX
      table = paintTable(canvas.width, canvas.height, vertical, scale, cloth)
      const size = Math.max(8, Math.ceil(R * scale * 2))
      sprite = ctx.createImageData(size, size)
      spriteCanvas = null
      sprites.clear()
    }

    function draw() {
      const state = live.current
      if (!table || !sprite) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(table, 0, 0)
      const rp = R * scale

      // The pocket called for the 8.
      if (state.called !== null && POCKETS[state.called]) {
        const at = mouth(state.called)
        const [sx, sy] = toScreen(at.x, at.y)
        const radius = (POCKETS[state.called]!.r + 22) * scale
        ctx.strokeStyle = 'rgba(255, 214, 64, 0.95)'
        ctx.lineWidth = Math.max(2.5, rp * 0.3)
        ctx.beginPath()
        ctx.arc(sx, sy, radius, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Each ball turns by the distance it has rolled since the last picture.
      for (const ball of state.balls) {
        if (ball.in) continue
        const [sx, sy] = toScreen(ball.x, ball.y)
        const before = last.get(ball.n)
        let m = turned.get(ball.n)
        if (!m) {
          // Balls start facing different ways, as they would when racked by hand.
          m = mul(roll(1, 0, ball.n * 1.7), roll(0, 1, ball.n * 2.3 + 0.6))
          turned.set(ball.n, m)
          sprites.delete(ball.n)
        }
        if (before) {
          const mx = sx - before.x
          const my = sy - before.y
          const moved = Math.hypot(mx, my)
          if (moved > 0.01 && moved < rp * 6) {
            m = mul(roll(-my / moved, mx / moved, moved / rp), m)
            turned.set(ball.n, m)
            sprites.delete(ball.n)
          }
        }
        last.set(ball.n, { x: sx, y: sy })
      }

      // Shadows first, so no ball's shadow falls on top of another ball.
      for (const ball of state.balls) {
        if (ball.in) continue
        const [sx, sy] = toScreen(ball.x, ball.y)
        const shadow = ctx.createRadialGradient(sx + rp * 0.28, sy + rp * 0.36, rp * 0.2, sx + rp * 0.28, sy + rp * 0.36, rp * 1.25)
        shadow.addColorStop(0, 'rgba(0, 0, 0, 0.5)')
        shadow.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = shadow
        ctx.beginPath()
        ctx.arc(sx + rp * 0.28, sy + rp * 0.36, rp * 1.25, 0, Math.PI * 2)
        ctx.fill()
      }

      const cue = state.balls.find((b) => b.n === 0 && !b.in)

      // The line of aim: to where the cue ball will first touch something, and on from there.
      if (state.aim && cue) {
        const length = Math.hypot(state.aim.dx, state.aim.dy) || 1
        const ux = state.aim.dx / length
        const uy = state.aim.dy / length
        let reach = Infinity
        let struck: Ball | null = null
        for (const ball of state.balls) {
          if (ball.in || ball.n === 0) continue
          const ox = ball.x - cue.x
          const oy = ball.y - cue.y
          const along = ox * ux + oy * uy
          if (along <= 0) continue
          const off2 = ox * ox + oy * oy - along * along
          if (off2 >= 4 * R * R) continue
          const t = along - Math.sqrt(4 * R * R - off2)
          if (t > 0 && t < reach) {
            reach = t
            struck = ball
          }
        }
        if (!struck) {
          const tx = ux > 0 ? (TABLE.w - R - cue.x) / ux : ux < 0 ? (R - cue.x) / ux : Infinity
          const ty = uy > 0 ? (TABLE.h - R - cue.y) / uy : uy < 0 ? (R - cue.y) / uy : Infinity
          reach = Math.min(tx, ty)
        }
        const gx = cue.x + ux * reach
        const gy = cue.y + uy * reach
        const [ax, ay] = toScreen(cue.x, cue.y)
        const [bx, by] = toScreen(gx, gy)
        ctx.lineCap = 'round'
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.lineWidth = Math.max(1.5, rp * 0.14)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(bx, by, rp, 0, Math.PI * 2)
        ctx.stroke()
        if (struck && state.guide === 'full') {
          // Where the struck ball is sent, and which way the cue ball leaves.
          const nx = (struck.x - gx) / (2 * R)
          const ny = (struck.y - gy) / (2 * R)
          const [ox, oy] = toScreen(struck.x, struck.y)
          const [px, py] = toScreen(struck.x + nx * 320, struck.y + ny * 320)
          ctx.beginPath()
          ctx.moveTo(ox, oy)
          ctx.lineTo(px, py)
          ctx.stroke()
          const side = ux * ny - uy * nx > 0 ? 1 : -1
          const [qx, qy] = toScreen(gx + ny * side * 150, gy - nx * side * 150)
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
          ctx.beginPath()
          ctx.moveTo(bx, by)
          ctx.lineTo(qx, qy)
          ctx.stroke()
        }
      }

      // A soft ring under the balls the player has to hit first.
      for (const ball of state.balls) {
        if (ball.in || !state.aim || !state.targets.includes(ball.n)) continue
        const [sx, sy] = toScreen(ball.x, ball.y)
        ctx.strokeStyle = 'rgba(255, 240, 170, 0.75)'
        ctx.lineWidth = Math.max(1.5, rp * 0.16)
        ctx.beginPath()
        ctx.arc(sx, sy, rp * 1.3, 0, Math.PI * 2)
        ctx.stroke()
      }

      // The balls themselves. A ball that has not moved keeps the picture made of it last time.
      spriteCanvas ??= document.createElement('canvas')
      for (const ball of state.balls) {
        if (ball.in) continue
        const [sx, sy] = toScreen(ball.x, ball.y)
        let picture = sprites.get(ball.n)
        if (!picture) {
          shade(sprite, ball.n, turned.get(ball.n) ?? IDENTITY)
          picture = document.createElement('canvas')
          picture.width = picture.height = sprite.width
          picture.getContext('2d')!.putImageData(sprite, 0, 0)
          sprites.set(ball.n, picture)
        }
        ctx.drawImage(picture, sx - rp, sy - rp, rp * 2, rp * 2)
      }

      // The cue: behind the cue ball, along the line of aim, drawn back by the power chosen.
      if (state.aim && cue) {
        const length = Math.hypot(state.aim.dx, state.aim.dy) || 1
        const [sx, sy] = toScreen(cue.x, cue.y)
        const [tx, ty] = toScreen(cue.x + state.aim.dx / length, cue.y + state.aim.dy / length)
        const angle = Math.atan2(ty - sy, tx - sx)
        ctx.save()
        ctx.translate(sx, sy)
        ctx.rotate(angle)
        const back = rp * (1.6 + state.power * 5)
        const stick = Math.max(canvas.width, canvas.height) * 0.42
        const grain = ctx.createLinearGradient(0, -rp * 0.3, 0, rp * 0.3)
        grain.addColorStop(0, '#f1d9a6')
        grain.addColorStop(0.5, '#c9995a')
        grain.addColorStop(1, '#8d6230')
        ctx.fillStyle = grain
        ctx.beginPath()
        ctx.moveTo(-back, -rp * 0.13)
        ctx.lineTo(-back - stick, -rp * 0.3)
        ctx.lineTo(-back - stick, rp * 0.3)
        ctx.lineTo(-back, rp * 0.13)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#2b2118'
        ctx.fillRect(-back - stick, -rp * 0.3, stick * 0.32, rp * 0.6)
        ctx.fillStyle = '#3d7fd6'
        ctx.fillRect(-back - rp * 0.22, -rp * 0.13, rp * 0.22, rp * 0.26)
        ctx.restore()
      }

      // Ball in hand: a ring round the cue ball says it can be picked up.
      if (state.ballInHand && cue && state.aim) {
        const [sx, sy] = toScreen(cue.x, cue.y)
        ctx.setLineDash([rp * 0.5, rp * 0.4])
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.lineWidth = Math.max(1.5, rp * 0.14)
        ctx.beginPath()
        ctx.arc(sx, sy, rp * 1.8, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    let frame = 0
    const loop = () => {
      draw()
      frame = requestAnimationFrame(loop)
    }
    resize()
    loop()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    // A finger on the cue ball (with ball in hand) carries it; anywhere else points the cue there.
    let carrying = false
    const point = (event: PointerEvent): [number, number] => {
      const box = canvas.getBoundingClientRect()
      return toTable(((event.clientX - box.left) / box.width) * canvas.width, ((event.clientY - box.top) / box.height) * canvas.height)
    }
    const act = (event: PointerEvent) => {
      const state = live.current
      const cue = state.balls.find((b) => b.n === 0 && !b.in)
      if (!state.aim || !cue) return
      const [x, y] = point(event)
      if (carrying) {
        if (canPlaceCue(state.balls, x, y, state.behindHeadString)) state.onPlace(x, y)
        return
      }
      const dx = x - cue.x
      const dy = y - cue.y
      if (Math.hypot(dx, dy) > R * 0.6) state.onAim({ dx, dy })
    }
    const down = (event: PointerEvent) => {
      const state = live.current
      const cue = state.balls.find((b) => b.n === 0 && !b.in)
      if (!state.aim || !cue) return
      const [x, y] = point(event)
      if (state.canCall) {
        // A touch on a pocket calls it.
        for (let i = 0; i < POCKETS.length; i++) {
          const at = mouth(i)
          if (Math.hypot(x - at.x, y - at.y) < 170) return state.onCall(i)
        }
      }
      carrying = state.ballInHand && Math.hypot(x - cue.x, y - cue.y) < R * 3
      canvas.setPointerCapture(event.pointerId)
      act(event)
    }
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0 || event.pointerType !== 'mouse') act(event)
    }
    const up = () => {
      carrying = false
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
  }, [vertical, cloth])

  return <canvas ref={canvasRef} role="img" aria-label={label} className="block w-full touch-none select-none" data-testid="pool-table" />
}
