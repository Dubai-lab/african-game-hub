// Pool: the table, the physics of a shot, and the rules of 8-ball and 9-ball.
//
// One file, used in two places. The server (the pool-action Edge Function) runs it to decide
// what a shot did: that result is the only one that counts. The app runs the very same code to
// draw the shot as it happens, so what a player watches is what the server will say.
//
// For the two to agree to the last decimal, a shot is described in whole numbers only, and the
// simulation uses nothing but + - * / and square roots, which every JavaScript engine computes
// identically. (No sine or cosine in here: those can differ in the last digit between engines,
// and on a pool table the last digit matters.)
//
// Units: millimetres and seconds. The table is a 9-foot table's playing surface. The balls are
// about a quarter larger than real ones (as in most pool games for phones), so that they can
// be seen and aimed at on a small screen; the pockets are larger to match.

export const TABLE = { w: 2540, h: 1270, r: 36 } as const
export type Variant = '8ball' | '9ball'
/** n is the number on the ball; 0 is the cue ball. */
export type Ball = { n: number; x: number; y: number; in: boolean }
export type Seat = 1 | 2
export type Group = 'solids' | 'stripes'

/**
 * What a player asks for, in whole numbers:
 *  - dx, dy: the direction of the cue, as a vector (any length; the app sends it times a million);
 *  - power: 1 to 1000 (thousandths of the hardest shot);
 *  - spinX: side (-100 left to 100 right); spinY: -100 (draw, backspin) to 100 (follow, topspin);
 *  - cue: where to put the cue ball first, when the player has ball in hand;
 *  - pocket: 8-ball, when shooting at the 8: the pocket called for it (its place in POCKETS).
 */
export type Shot = { dx: number; dy: number; power: number; spinX: number; spinY: number; cue?: { x: number; y: number }; pocket?: number }

export type PoolState = {
  variant: Variant
  balls: Ball[]
  turn: Seat
  breakShot: boolean
  ballInHand: boolean
  /** 8-ball: which seat has the solids (1 to 7); null while the table is open. */
  solidsSeat: Seat | null
  /** Fouls in a row by each seat (9-ball: three lose the game). */
  fouls: [number, number]
}

export type Foul = 'scratch' | 'no_contact' | 'wrong_ball' | 'no_rail' | 'bad_placement'
export type ShotResult = {
  /** Balls pocketed by this shot, in order (the cue ball, 0, included). */
  pocketed: number[]
  firstHit: number | null
  foul: Foul | null
  /** Balls put back on the table by the rules (the 8 or 9 pocketed when it did not count). */
  respotted: number[]
  winner: Seat | null
  /** Why the game ended, when it did. */
  reason: 'eight_ball' | 'nine_ball' | 'eight_early' | 'eight_foul' | 'eight_wrong_pocket' | 'three_fouls' | null
  /** The shooter keeps the table. */
  again: boolean
}

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------
const R = TABLE.r
const D = R * 2
/**
 * Pocket centres and how close a ball's centre must come to drop. The pockets sit back in the
 * rail, outside the playing surface, so only their mouths open onto the cloth. Corners are a
 * little wider than the middle pockets.
 */
export const POCKETS: readonly { x: number; y: number; r: number }[] = [
  { x: -16, y: -16, r: 90 },
  { x: TABLE.w / 2, y: -26, r: 84 },
  { x: TABLE.w + 16, y: -16, r: 90 },
  { x: -16, y: TABLE.h + 16, r: 90 },
  { x: TABLE.w / 2, y: TABLE.h + 26, r: 84 },
  { x: TABLE.w + 16, y: TABLE.h + 16, r: 90 },
]
export const HEAD_STRING = TABLE.w / 4
export const FOOT_SPOT = { x: (TABLE.w * 3) / 4, y: TABLE.h / 2 }
export const HEAD_SPOT = { x: HEAD_STRING, y: TABLE.h / 2 }

/** The balls racked for the break, cue ball on the head spot. Always the same arrangement. */
export function rack(variant: Variant): Ball[] {
  const rows =
    variant === '8ball'
      ? [[1], [9, 2], [10, 8, 3], [4, 14, 11, 5], [6, 13, 15, 7, 12]]
      : [[1], [2, 3], [4, 9, 5], [6, 7], [8]]
  // Rows are a hair apart so that no two balls start out overlapping.
  const gap = D + 0.4
  const rowStep = gap * 0.8660254
  const balls: Ball[] = [{ n: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, in: false }]
  rows.forEach((row, i) => {
    row.forEach((n, j) => {
      balls.push({ n, x: FOOT_SPOT.x + i * rowStep, y: FOOT_SPOT.y + (j - (row.length - 1) / 2) * gap, in: false })
    })
  })
  return balls
}

export const groupOf = (n: number): Group | null => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null)

/** Whether the cue ball may be put here: on the table, clear of every other ball. */
export function canPlaceCue(balls: readonly Ball[], x: number, y: number, behindHeadString: boolean): boolean {
  if (!(x >= R && x <= TABLE.w - R && y >= R && y <= TABLE.h - R)) return false
  if (behindHeadString && x > HEAD_STRING) return false
  for (const ball of balls) {
    if (ball.n === 0 || ball.in) continue
    const ex = ball.x - x
    const ey = ball.y - y
    if (ex * ex + ey * ey < D * D + 1) return false
  }
  return true
}

/** A free place for a ball at or behind a spot, moving toward the nearer end rail until clear. */
function freeSpot(balls: readonly Ball[], from: { x: number; y: number }, step: number): { x: number; y: number } {
  let x = from.x
  for (let i = 0; i < 400; i++) {
    let clear = x >= R && x <= TABLE.w - R
    if (clear) {
      for (const ball of balls) {
        if (ball.in) continue
        const ex = ball.x - x
        const ey = ball.y - from.y
        if (ex * ex + ey * ey < D * D + 1) {
          clear = false
          break
        }
      }
    }
    if (clear) return { x, y: from.y }
    x += step
    if (x > TABLE.w - R || x < R) {
      // Ran out of table that way: look the other way from the spot.
      step = -step
      x = from.x + step
    }
  }
  return from
}

// ---------------------------------------------------------------------------------------------
// The physics of one shot
// ---------------------------------------------------------------------------------------------
const DT = 0.002
/** The hardest shot, in millimetres a second. */
const MAX_SPEED = 8200
/** Cloth: a steady pull plus a little that grows with speed. */
const DECEL = 300
const DRAG = 0.34
const CUSHION = 0.74
const BALL_BOUNCE = 0.955
const STOPPED = 4
const MAX_STEPS = 16000

export type Frame = { x: Float64Array; y: Float64Array }
export type SimEvent = { step: number; kind: 'ball' | 'rail' | 'pocket'; n: number; speed: number }
export type Sim = {
  balls: Ball[]
  pocketed: number[]
  /** Which pocket each of those fell into (its place in POCKETS), in the same order. */
  pockets: number[]
  firstHit: number | null
  /** After the cue ball first touched a ball, something reached a rail or a pocket. */
  railAfterHit: boolean
  steps: number
}

/**
 * Plays a shot from the given position until every ball has stopped. `watch` is called every
 * `every` steps with where the balls are, and `hear` with each knock, for drawing and sound:
 * neither can change the outcome.
 */
export function simulate(
  start: readonly Ball[],
  shot: Shot,
  watch?: (balls: readonly Ball[], step: number) => void,
  hear?: (event: SimEvent) => void,
  every = 4,
): Sim {
  const balls = start.map((b) => ({ ...b }))
  const count = balls.length
  const vx = new Float64Array(count)
  const vy = new Float64Array(count)
  const cue = balls.findIndex((b) => b.n === 0)
  const length = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy)
  const pocketed: number[] = []
  const pockets: number[] = []
  let firstHit: number | null = null
  let railAfterHit = false
  // Spin is spent the first time it matters: follow or draw on the first ball, side on the first rail.
  let follow = shot.spinY / 100
  let side = shot.spinX / 100

  if (cue >= 0 && length > 0 && !balls[cue]!.in) {
    const speed = (MAX_SPEED * shot.power) / 1000
    vx[cue] = (shot.dx / length) * speed
    vy[cue] = (shot.dy / length) * speed
  }

  let step = 0
  for (; step < MAX_STEPS; step++) {
    let moving = false

    for (let i = 0; i < count; i++) {
      const ball = balls[i]!
      if (ball.in) continue
      const speed = Math.sqrt(vx[i]! * vx[i]! + vy[i]! * vy[i]!)
      if (speed === 0) continue
      const slower = speed - (DECEL + DRAG * speed) * DT
      if (slower <= STOPPED) {
        vx[i] = 0
        vy[i] = 0
        continue
      }
      vx[i] = (vx[i]! * slower) / speed
      vy[i] = (vy[i]! * slower) / speed
      ball.x += vx[i]! * DT
      ball.y += vy[i]! * DT
      moving = true

      // A pocket takes the ball before the cushion can turn it away.
      let dropped = -1
      for (let p = 0; p < POCKETS.length; p++) {
        const pocket = POCKETS[p]!
        const px = ball.x - pocket.x
        const py = ball.y - pocket.y
        if (px * px + py * py < pocket.r * pocket.r) {
          dropped = p
          break
        }
      }
      if (dropped >= 0) {
        ball.in = true
        vx[i] = 0
        vy[i] = 0
        pocketed.push(ball.n)
        pockets.push(dropped)
        if (firstHit !== null) railAfterHit = true
        hear?.({ step, kind: 'pocket', n: ball.n, speed: slower })
        continue
      }

      // Cushions. Side spin on the cue ball throws it along the first rail it meets.
      let rail = 0
      if (ball.x < R) {
        ball.x = R
        vx[i] = -vx[i]! * CUSHION
        rail = 1
      } else if (ball.x > TABLE.w - R) {
        ball.x = TABLE.w - R
        vx[i] = -vx[i]! * CUSHION
        rail = 1
      }
      if (ball.y < R) {
        ball.y = R
        vy[i] = -vy[i]! * CUSHION
        rail = 2
      } else if (ball.y > TABLE.h - R) {
        ball.y = TABLE.h - R
        vy[i] = -vy[i]! * CUSHION
        rail = 2
      }
      if (rail !== 0) {
        if (i === cue && side !== 0) {
          const push = side * 0.28 * slower
          if (rail === 1) vy[i] = vy[i]! + (vx[i]! > 0 ? push : -push)
          else vx[i] = vx[i]! + (vy[i]! > 0 ? -push : push)
          side = 0
        }
        if (firstHit !== null) railAfterHit = true
        hear?.({ step, kind: 'rail', n: ball.n, speed: slower })
      }
    }

    // Ball against ball: equal weights, so they trade the part of their motion along the line
    // between their centres. Gone over three times each step, so that a knock travels through
    // balls that are touching (the rack on the break) instead of stopping at the first one.
    for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < count; i++) {
      const a = balls[i]!
      if (a.in) continue
      for (let j = i + 1; j < count; j++) {
        const b = balls[j]!
        if (b.in) continue
        const nx = b.x - a.x
        const ny = b.y - a.y
        const dist2 = nx * nx + ny * ny
        if (dist2 >= D * D || dist2 === 0) continue
        const dist = Math.sqrt(dist2)
        const ux = nx / dist
        const uy = ny / dist
        // Push them apart so they only just touch.
        const overlap = (D - dist) / 2
        a.x -= ux * overlap
        a.y -= uy * overlap
        b.x += ux * overlap
        b.y += uy * overlap
        const closing = (vx[i]! - vx[j]!) * ux + (vy[i]! - vy[j]!) * uy
        if (closing <= 0) continue
        const cueSpeed = i === cue ? Math.sqrt(vx[i]! * vx[i]! + vy[i]! * vy[i]!) : 0
        const cueDirX = cueSpeed > 0 ? vx[i]! / cueSpeed : 0
        const cueDirY = cueSpeed > 0 ? vy[i]! / cueSpeed : 0
        const impulse = (closing * (1 + BALL_BOUNCE)) / 2
        vx[i] = vx[i]! - impulse * ux
        vy[i] = vy[i]! - impulse * uy
        vx[j] = vx[j]! + impulse * ux
        vy[j] = vy[j]! + impulse * uy
        if (i === cue && firstHit === null) {
          firstHit = b.n
          // Follow carries the cue ball on after the hit; draw brings it back.
          if (follow !== 0) {
            vx[i] = vx[i]! + cueDirX * follow * 0.5 * cueSpeed
            vy[i] = vy[i]! + cueDirY * follow * 0.5 * cueSpeed
            follow = 0
          }
        }
        hear?.({ step, kind: 'ball', n: b.n, speed: closing })
      }
    }

    if (watch && step % every === 0) watch(balls, step)
    if (!moving) break
  }
  watch?.(balls, step)
  return { balls, pocketed, pockets, firstHit, railAfterHit, steps: step }
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------
const other = (seat: Seat): Seat => (seat === 1 ? 2 : 1)

export function isValidShot(shot: Shot): boolean {
  const whole = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  return (
    whole(shot.dx, -2_000_000, 2_000_000) &&
    whole(shot.dy, -2_000_000, 2_000_000) &&
    (shot.dx !== 0 || shot.dy !== 0) &&
    whole(shot.power, 1, 1000) &&
    whole(shot.spinX, -100, 100) &&
    whole(shot.spinY, -100, 100) &&
    (shot.pocket === undefined || whole(shot.pocket, 0, POCKETS.length - 1)) &&
    (shot.cue === undefined || (typeof shot.cue.x === 'number' && typeof shot.cue.y === 'number' && Number.isFinite(shot.cue.x) && Number.isFinite(shot.cue.y)))
  )
}

/** The group a seat is shooting at in 8-ball, or null while the table is open. */
export function groupFor(state: PoolState, seat: Seat): Group | null {
  if (state.solidsSeat === null) return null
  return state.solidsSeat === seat ? 'solids' : 'stripes'
}

/** The ball(s) the player to shoot must hit first. For showing the player; the rules below decide. */
export function targets(state: PoolState): number[] {
  const onTable = state.balls.filter((b) => !b.in && b.n !== 0).map((b) => b.n)
  if (state.variant === '9ball') return onTable.length > 0 ? [Math.min(...onTable)] : []
  const group = groupFor(state, state.turn)
  if (group === null) return onTable.filter((n) => n !== 8)
  const mine = onTable.filter((n) => groupOf(n) === group)
  return mine.length > 0 ? mine : [8]
}

/**
 * Plays one shot by the player whose turn it is and applies the rules to what happened.
 * Returns the new state of the game, or null when the shot itself is not allowed.
 */
export function applyShot(
  state: PoolState,
  shot: Shot,
  watch?: (balls: readonly Ball[], step: number) => void,
  hear?: (event: SimEvent) => void,
): { state: PoolState; result: ShotResult } | null {
  if (!isValidShot(shot)) return null
  const shooter = state.turn
  const before = state.balls.map((b) => ({ ...b }))
  const cueBall = before.find((b) => b.n === 0)
  if (!cueBall) return null

  // Ball in hand: the cue ball goes where the player says, if that is a legal place.
  if (state.ballInHand) {
    const place = shot.cue ?? { x: cueBall.x, y: cueBall.y }
    if (!canPlaceCue(before, place.x, place.y, state.breakShot)) return null
    cueBall.x = place.x
    cueBall.y = place.y
    cueBall.in = false
  }

  const mustHit = targets({ ...state, balls: before })
  const shootingEight = state.variant === '8ball' && mustHit.length === 1 && mustHit[0] === 8
  // The 8 is a called shot: the player names the pocket before shooting at it.
  if (shootingEight && shot.pocket === undefined) return null
  const sim = simulate(before, shot, watch, hear)
  const balls = sim.balls
  const sunk = sim.pocketed.filter((n) => n !== 0)
  const scratch = sim.pocketed.includes(0)

  let foul: Foul | null = null
  if (scratch) foul = 'scratch'
  else if (sim.firstHit === null) foul = 'no_contact'
  // On an 8-ball break any ball may be hit first.
  else if (!(state.variant === '8ball' && state.breakShot) && !mustHit.includes(sim.firstHit)) foul = 'wrong_ball'
  else if (!sim.railAfterHit && sunk.length === 0) foul = 'no_rail'

  const result: ShotResult = { pocketed: sim.pocketed, firstHit: sim.firstHit, foul, respotted: [], winner: null, reason: null, again: false }
  const next: PoolState = { ...state, balls, breakShot: false, ballInHand: false, fouls: [state.fouls[0], state.fouls[1]] }
  const respot = (n: number) => {
    const ball = balls.find((b) => b.n === n)!
    const spot = freeSpot(balls, FOOT_SPOT, D + 1)
    ball.x = spot.x
    ball.y = spot.y
    ball.in = false
    result.respotted.push(n)
  }

  if (state.variant === '9ball') {
    if (sunk.includes(9)) {
      if (foul === null) {
        result.winner = shooter
        result.reason = 'nine_ball'
      } else {
        respot(9)
      }
    }
    if (result.winner === null) {
      if (foul !== null) {
        next.fouls[shooter - 1] = state.fouls[shooter - 1]! + 1
        if (next.fouls[shooter - 1]! >= 3) {
          result.winner = other(shooter)
          result.reason = 'three_fouls'
        }
      } else {
        next.fouls[shooter - 1] = 0
        result.again = sunk.length > 0
      }
    }
  } else {
    const eight = sunk.includes(8)
    if (eight && state.breakShot) {
      // The 8 on the break does not end the game: it goes back on its spot.
      respot(8)
    } else if (eight) {
      const where = sim.pockets[sim.pocketed.indexOf(8)]
      if (shootingEight && foul === null && where === shot.pocket) {
        result.winner = shooter
        result.reason = 'eight_ball'
      } else {
        result.winner = other(shooter)
        result.reason = !shootingEight ? 'eight_early' : foul !== null ? 'eight_foul' : 'eight_wrong_pocket'
      }
    }
    if (result.winner === null && foul === null) {
      const others = sunk.filter((n) => n !== 8)
      if (state.breakShot) {
        // Anything down on the break keeps the table; the groups stay open.
        result.again = others.length > 0
      } else if (state.solidsSeat === null) {
        // Open table: the first ball down decides who has which group.
        if (others.length > 0) {
          const first = groupOf(others[0]!)!
          next.solidsSeat = first === 'solids' ? shooter : other(shooter)
          result.again = true
        }
      } else {
        const mine = groupFor(state, shooter)
        result.again = others.some((n) => groupOf(n) === mine)
      }
    }
  }

  if (result.winner === null) {
    if (foul !== null) {
      next.turn = other(shooter)
      next.ballInHand = true
    } else if (!result.again) {
      next.turn = other(shooter)
    }
    // A pocketed cue ball comes back for whoever shoots next, who will place it.
    const cue = balls.find((b) => b.n === 0)!
    if (cue.in) {
      const spot = freeSpot(balls, HEAD_SPOT, -(D + 1))
      cue.x = spot.x
      cue.y = spot.y
      cue.in = false
    }
  }
  return { state: next, result }
}
