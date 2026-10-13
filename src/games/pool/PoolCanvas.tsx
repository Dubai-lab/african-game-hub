import { useEffect, useRef, useContext } from 'react'
import { onCue, pullAlongCue, Sideways, touchIn } from './sideways'
import { type Ball, canPlaceCue, POCKETS, TABLE } from '../../../supabase/functions/_shared/pool'
import { type CueId, CUES } from './cues'
import { paintTable, RAIL } from './tablePaint'

export { RAIL }

// The pool table, drawn on a canvas. Nothing here is an image file: the table is painted once
// in code (see tablePaint.ts), and every ball is a true sphere, lit from a lamp above the table
// and shaded pixel by pixel, with its number and stripe wrapped round it: polished, so the lamp
// shows in it as a bright spot, the room as a softer glow, and the cloth as a tint underneath.
// As a ball travels its surface turns by exactly the distance rolled, so the numbers roll with it.

const R = TABLE.r
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
      const toLamp = Math.max(0, x * HX + y * HY + z * HZ)
      // The lamp itself, small and bright, and the lit room round it, wide and soft.
      const gleam = Math.pow(toLamp, 90) * 0.95 + Math.pow(toLamp, 9) * 0.16
      // Round the edge the surface turns away from the eye: it darkens there, and a polished
      // ball picks up a little of the light that comes off the cloth.
      const turnedAway = 1 - z
      const light = (0.3 + 0.78 * diffuse) * (1 - 0.34 * turnedAway * turnedAway)
      const bounce = Math.max(0, y * 0.7 + 0.3) * turnedAway * turnedAway * 26
      // Soften the very edge, so the ball is round and not stair-stepped.
      const edge = Math.min(1, (1 - Math.sqrt(d2)) * half)
      data[at] = Math.min(255, r * light + 255 * gleam + bounce * 0.6)
      data[at + 1] = Math.min(255, g * light + 255 * gleam + bounce)
      data[at + 2] = Math.min(255, b * light + 255 * gleam + bounce * 0.7)
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
  cue: CueId
  /** The whole aiming line (where the struck ball and the cue ball go), or only as far as the first ball. */
  guide: 'full' | 'short'
  /** The pocket called for the 8, ringed on the table; null when none is. */
  called: number | null
  /** The player must call a pocket: touching one calls it. */
  canCall: boolean
  onCall: (pocket: number) => void
  /** The cue on the table may be taken hold of and pulled back to shoot. */
  canShoot: boolean
  /** The cue is being pulled back: 0 to 1. */
  onPull: (power: number) => void
  /** Let go: shoot with this power, 0 to 1. */
  onShoot: (power: number) => void
}

/** A touch this close to a pocket (in the table's own measure) calls it: a fingertip, not a pin. */
const POCKET_REACH = 300
/** Pulling the cue on the table this far back gives full power. */
const FULL_PULL = 620
/** A pull shorter than this is a change of mind, not a shot. */
const LEAST_PULL = 0.04

/** The table and everything on it. Draws what it is given; the server decides what happens. */
export function PoolCanvas({ balls, vertical, aim, power, ballInHand, behindHeadString, targets, onAim, onPlace, label, cloth, cue: cueId, guide, called, canCall, onCall, canShoot, onPull, onShoot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The screen this table is on may be drawn turned (see sideways.ts).
  const sideways = useContext(Sideways)
  const screenTurned = useRef(sideways)
  screenTurned.current = sideways
  // True while the cue ball is in the player's fingers (ball in hand): the cue and its aiming
  // line are put away until the ball is set down, so that only the ball follows the finger.
  const carried = useRef(false)
  const live = useRef({ balls, aim, power, ballInHand, behindHeadString, targets, onAim, onPlace, guide, called, canCall, onCall, cueId, canShoot, onPull, onShoot })
  live.current = { balls, aim, power, ballInHand, behindHeadString, targets, onAim, onPlace, guide, called, canCall, onCall, cueId, canShoot, onPull, onShoot }

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
    // Balls on their way down a pocket: from where each was last seen on the cloth, into the hole.
    const dropping = new Map<number, { fromX: number; fromY: number; toX: number; toY: number; since: number; picture: HTMLCanvasElement }>()
    const DROP_MS = 240

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
      table = paintTable(canvas.width, canvas.height, vertical, scale, CLOTHS[cloth])
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
        // Thrown by the lamp, away from it: wide and soft.
        const cast = ctx.createRadialGradient(sx + rp * 0.34, sy + rp * 0.44, rp * 0.25, sx + rp * 0.34, sy + rp * 0.44, rp * 1.45)
        cast.addColorStop(0, 'rgba(0, 0, 0, 0.46)')
        cast.addColorStop(0.6, 'rgba(0, 0, 0, 0.2)')
        cast.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = cast
        ctx.beginPath()
        ctx.arc(sx + rp * 0.34, sy + rp * 0.44, rp * 1.45, 0, Math.PI * 2)
        ctx.fill()
        // Where the ball rests on the cloth: small and dark, so it sits on the table and does not float.
        const rest = ctx.createRadialGradient(sx + rp * 0.08, sy + rp * 0.12, rp * 0.5, sx + rp * 0.08, sy + rp * 0.12, rp * 1.12)
        rest.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
        rest.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = rest
        ctx.beginPath()
        ctx.arc(sx + rp * 0.08, sy + rp * 0.12, rp * 1.12, 0, Math.PI * 2)
        ctx.fill()
      }

      const cue = state.balls.find((b) => b.n === 0 && !b.in)

      // The line of aim: to where the cue ball will first touch something, and on from there.
      if (state.aim && cue && !carried.current) {
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

      // A ball that has just gone: it is seen to roll over the lip and down, growing smaller and
      // darker as it sinks, instead of vanishing at the mouth of the pocket.
      const now = performance.now()
      for (const ball of state.balls) {
        const seen = last.get(ball.n)
        if (!ball.in) {
          dropping.delete(ball.n)
          continue
        }
        if (!seen) continue
        last.delete(ball.n)
        const picture = sprites.get(ball.n)
        if (!picture) continue
        // The hole nearest to where it was last seen.
        let hole = POCKETS[0]!
        let nearest = Infinity
        for (const pocket of POCKETS) {
          const [px, py] = toScreen(pocket.x, pocket.y)
          const away = (px - seen.x) * (px - seen.x) + (py - seen.y) * (py - seen.y)
          if (away < nearest) {
            nearest = away
            hole = pocket
          }
        }
        const [toX, toY] = toScreen(hole.x, hole.y)
        dropping.set(ball.n, { fromX: seen.x, fromY: seen.y, toX, toY, since: now, picture })
      }
      for (const [n, drop] of dropping) {
        const part = (now - drop.since) / DROP_MS
        if (part >= 1) {
          dropping.delete(n)
          continue
        }
        // Quick over the lip, then sinking.
        const along = 1 - (1 - part) * (1 - part)
        const size = rp * 2 * (1 - 0.5 * part)
        ctx.globalAlpha = 1 - part * part
        ctx.drawImage(drop.picture, drop.fromX + (drop.toX - drop.fromX) * along - size / 2, drop.fromY + (drop.toY - drop.fromY) * along - size / 2, size, size)
        ctx.globalAlpha = 1
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
      if (state.aim && cue && !carried.current) {
        const length = Math.hypot(state.aim.dx, state.aim.dy) || 1
        const [sx, sy] = toScreen(cue.x, cue.y)
        const [tx, ty] = toScreen(cue.x + state.aim.dx / length, cue.y + state.aim.dy / length)
        const angle = Math.atan2(ty - sy, tx - sx)
        ctx.save()
        ctx.translate(sx, sy)
        ctx.rotate(angle)
        const back = rp * (1.6 + state.power * 5)
        const stick = Math.max(canvas.width, canvas.height) * 0.44
        const style = CUES[state.cueId]
        const tipHalf = rp * 0.17
        const buttHalf = rp * 0.42
        // How thick the cue is at a point along it (0 at the tip, 1 at the butt): it tapers.
        const halfAt = (part: number) => tipHalf + (buttHalf - tipHalf) * part
        const xAt = (part: number) => -back - stick * part
        /** A length of the cue, from one point along it to another, filled with this paint. */
        const span = (from: number, to: number, paint: string | CanvasGradient) => {
          ctx.fillStyle = paint
          ctx.beginPath()
          ctx.moveTo(xAt(from), -halfAt(from))
          ctx.lineTo(xAt(to), -halfAt(to))
          ctx.lineTo(xAt(to), halfAt(to))
          ctx.lineTo(xAt(from), halfAt(from))
          ctx.closePath()
          ctx.fill()
        }
        // Round, not flat: light along the top of the cue, shade along the bottom.
        const round = (colors: readonly [string, string, string]) => {
          const paint = ctx.createLinearGradient(0, -buttHalf, 0, buttHalf)
          paint.addColorStop(0, colors[2])
          paint.addColorStop(0.3, colors[0])
          paint.addColorStop(0.62, colors[1])
          paint.addColorStop(1, colors[2])
          return paint
        }

        // Its shadow on the cloth, a little below it: the cue is held just above the table.
        ctx.save()
        ctx.rotate(-angle)
        ctx.translate(rp * 0.3, rp * 0.42)
        ctx.rotate(angle)
        ctx.globalAlpha = 0.3
        span(0, 1, '#000000')
        ctx.restore()

        // Shaft, then the butt with its wrap, from the tip back.
        span(0.035, 0.56, round(style.shaft))
        span(0.56, 1, round([style.buttLight, style.butt, style.buttDark]))
        // The wrap where the hand holds it: fine turns of thread.
        span(0.7, 0.88, round(style.wrap))
        ctx.save()
        ctx.beginPath()
        ctx.rect(xAt(0.88), -buttHalf, xAt(0.7) - xAt(0.88), buttHalf * 2)
        ctx.clip()
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'
        ctx.lineWidth = Math.max(0.6, rp * 0.03)
        for (let turn = xAt(0.88); turn < xAt(0.7); turn += Math.max(1.6, rp * 0.1)) {
          ctx.beginPath()
          ctx.moveTo(turn, -buttHalf)
          ctx.lineTo(turn + rp * 0.08, buttHalf)
          ctx.stroke()
        }
        ctx.restore()
        // Points of inlay running up from the butt into the shaft, and rings where the pieces join.
        ctx.fillStyle = style.band
        for (const side of [-1, 1]) {
          ctx.beginPath()
          ctx.moveTo(xAt(0.56), side * halfAt(0.56) * 0.92)
          ctx.lineTo(xAt(0.4), side * halfAt(0.4) * 0.12)
          ctx.lineTo(xAt(0.56), side * halfAt(0.56) * 0.2)
          ctx.closePath()
          ctx.fill()
        }
        const brass = round(['#fff0b8', '#c9962e', '#6f4c10'])
        span(0.555, 0.575, brass)
        span(0.69, 0.7, style.band)
        span(0.88, 0.89, style.band)
        span(0.975, 1, round(['#5a5a60', '#26262a', '#0c0c0e']))
        // The ferrule (ivory white) and the leather tip, blue with chalk.
        span(0.012, 0.035, round(['#ffffff', '#efe9da', '#b9b2a0']))
        span(0, 0.012, round(['#7fb2f0', '#3d7fd6', '#1f4f96']))
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

    // A finger on the cue ball (with ball in hand) carries it. A finger on the cue itself takes
    // hold of it: pulling back draws it, and letting go shoots. Anywhere else, dragging turns
    // the cue about the cue ball by as much as the finger goes round it: the cue never jumps to
    // where the table was touched, and dragging far from the ball turns it very finely.
    let carrying = false
    let turning: { finger: number; aim: number } | null = null
    let pulling: { from: { x: number; y: number }; power: number } | null = null
    const point = (event: PointerEvent): [number, number] => {
      const [across, down] = touchIn(canvas, event.clientX, event.clientY, screenTurned.current)
      return toTable(across * canvas.width, down * canvas.height)
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
      if (pulling) {
        pulling.power = pullAlongCue(pulling.from, { x, y }, state.aim, FULL_PULL)
        state.onPull(pulling.power)
        return
      }
      if (!turning || Math.hypot(x - cue.x, y - cue.y) < R * 0.8) return
      const angle = turning.aim + Math.atan2(y - cue.y, x - cue.x) - turning.finger
      state.onAim({ dx: Math.cos(angle), dy: Math.sin(angle) })
    }
    const down = (event: PointerEvent) => {
      const state = live.current
      const cue = state.balls.find((b) => b.n === 0 && !b.in)
      if (!state.aim || !cue) return
      const [x, y] = point(event)
      if (state.canCall) {
        // A touch on a pocket, or near enough for a fingertip, calls it: the nearest one.
        let nearest = -1
        let distance = POCKET_REACH
        for (let i = 0; i < POCKETS.length; i++) {
          const at = mouth(i)
          const away = Math.hypot(x - at.x, y - at.y)
          if (away < distance) {
            nearest = i
            distance = away
          }
        }
        if (nearest >= 0) return state.onCall(nearest)
      }
      carrying = state.ballInHand && Math.hypot(x - cue.x, y - cue.y) < R * 2.5
      carried.current = carrying
      // The cue as it lies on the table (see where it is drawn): from just behind the ball.
      const held = !carrying && state.canShoot && onCue({ x, y }, cue, state.aim, R * 1.6, R * 1.6 + (TABLE.w + RAIL * 2) * 0.42, Math.max(R * 3.2, 100))
      pulling = held ? { from: { x, y }, power: 0 } : null
      turning = carrying || held ? null : { finger: Math.atan2(y - cue.y, x - cue.x), aim: Math.atan2(state.aim.dy, state.aim.dx) }
      canvas.setPointerCapture(event.pointerId)
      if (carrying) act(event)
    }
    const move = (event: PointerEvent) => {
      if (carrying || turning || pulling) act(event)
    }
    const up = (event: PointerEvent) => {
      const state = live.current
      if (pulling) {
        const power = pulling.power
        pulling = null
        state.onPull(0)
        // Letting go shoots; a cancelled touch (a call coming in, the screen locking) does not.
        if (event.type === 'pointerup' && power >= LEAST_PULL) state.onShoot(power)
      }
      carrying = false
      carried.current = false
      turning = null
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
