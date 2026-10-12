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
// about half as large again as real ones (as in most pool games for phones), so that they can
// be seen and aimed at on a small screen, and so that a ball looks the right size beside a
// pocket; the pockets are sized to match (see POCKETS).

export const TABLE = { w: 2540, h: 1270, r: 42 } as const
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
 * The cushions and the pockets, as on a real table.
 *
 * A cushion's nose runs along each side of the cloth, and stops short of every pocket. Where
 * it stops it is cut back at an angle (the jaw), so that each pocket has a mouth, between the
 * tips of two cushions, that narrows a little toward the hole. The hole itself is in the rail,
 * behind the line of the cushions: at a corner, out beyond the corner of the cloth; at the
 * middle of a long side, behind the cushion.
 *
 * What a ball meets, then: the flat of a cushion, which turns it back; the tip or the face of
 * a jaw, which turns it aside (into the pocket, or out of it: the rattle); or the mouth, where
 * there is nothing to stop it. A ball drops when its centre comes over the hole, or crosses the
 * line of the cushions, which it can only do in a mouth.
 *
 * All of it is here, in numbers, and the table is drawn from the same numbers (tablePaint.ts),
 * so that what the player sees is what the ball meets.
 */
/** How far along the cloth's edge from a corner the cushion's nose begins. The mouth of a corner pocket is this times the square root of two: 164 mm, a little under two balls. */
export const CORNER_CUT = 116
/** Half the mouth of a middle pocket, along the cushion: 176 mm in all, a little over two balls. */
export const MIDDLE_CUT = 88
/** How far a cushion stands out from the wood of the rail. */
export const CUSHION_DEPTH = 48
/** How much further toward the pocket the back of a cushion runs than its nose: the slope of the jaw. */
export const CORNER_JAW = 40
export const MIDDLE_JAW = 14

/** Pocket centres (the middle of each hole), and how close a ball's centre must come to drop into it. */
export const POCKETS: readonly { x: number; y: number; r: number }[] = [
  { x: -26, y: -26, r: 68 },
  { x: TABLE.w / 2, y: -40, r: 62 },
  { x: TABLE.w + 26, y: -26, r: 68 },
  { x: -26, y: TABLE.h + 26, r: 68 },
  { x: TABLE.w / 2, y: TABLE.h + 40, r: 62 },
  { x: TABLE.w + 26, y: TABLE.h + 26, r: 68 },
]

/** A jaw: the angled end of a cushion, from the tip of its nose back to the wood. `rail` is 1 for a cushion along a short side, 2 along a long side. */
export type Jaw = { ax: number; ay: number; bx: number; by: number; rail: 1 | 2 }
export const JAWS: readonly Jaw[] = (() => {
  const W = TABLE.w
  const H = TABLE.h
  const jaws: Jaw[] = []
  // The long sides (top, then bottom): a jaw at each corner end and one each side of the middle pocket.
  for (const [y, out] of [[0, -1], [H, 1]] as const) {
    const back = y + out * CUSHION_DEPTH
    jaws.push({ ax: CORNER_CUT, ay: y, bx: CORNER_CUT - CORNER_JAW, by: back, rail: 2 })
    jaws.push({ ax: W / 2 - MIDDLE_CUT, ay: y, bx: W / 2 - MIDDLE_CUT + MIDDLE_JAW, by: back, rail: 2 })
    jaws.push({ ax: W / 2 + MIDDLE_CUT, ay: y, bx: W / 2 + MIDDLE_CUT - MIDDLE_JAW, by: back, rail: 2 })
    jaws.push({ ax: W - CORNER_CUT, ay: y, bx: W - CORNER_CUT + CORNER_JAW, by: back, rail: 2 })
  }
  // The short sides (left, then right): a jaw at each end.
  for (const [x, out] of [[0, -1], [W, 1]] as const) {
    const back = x + out * CUSHION_DEPTH
    jaws.push({ ax: x, ay: CORNER_CUT, bx: back, by: CORNER_CUT - CORNER_JAW, rail: 1 })
    jaws.push({ ax: x, ay: H - CORNER_CUT, bx: back, by: H - CORNER_CUT + CORNER_JAW, rail: 1 })
  }
  return jaws
})()

/**
 * How much room a ball's centre has in the mouth of each pocket, in millimetres: the width of
 * the mouth between the tips of the cushions, less the ball itself. (For the tests, and for
 * anyone tuning the table.)
 */
export function pocketOpening(index: number): number {
  const corner = index !== 1 && index !== 4
  // 1.41421356 is the square root of two: a corner's mouth runs across the diagonal.
  return (corner ? CORNER_CUT * 1.41421356 : MIDDLE_CUT * 2) - TABLE.r * 2
}
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

      // A pocket takes the ball before a cushion can turn it away: its centre is over the hole.
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

      // The flat of a cushion, between its two jaws: the ball's centre comes no nearer than its
      // own radius, and is turned back. Side spin on the cue ball throws it along the first
      // rail it meets.
      let rail = 0
      if (dropped < 0) {
        if (ball.y >= CORNER_CUT && ball.y <= TABLE.h - CORNER_CUT) {
          if (ball.x < R) {
            ball.x = R
            vx[i] = -vx[i]! * CUSHION
            rail = 1
          } else if (ball.x > TABLE.w - R) {
            ball.x = TABLE.w - R
            vx[i] = -vx[i]! * CUSHION
            rail = 1
          }
        }
        if ((ball.x >= CORNER_CUT && ball.x <= TABLE.w / 2 - MIDDLE_CUT) || (ball.x >= TABLE.w / 2 + MIDDLE_CUT && ball.x <= TABLE.w - CORNER_CUT)) {
          if (ball.y < R) {
            ball.y = R
            vy[i] = -vy[i]! * CUSHION
            rail = 2
          } else if (ball.y > TABLE.h - R) {
            ball.y = TABLE.h - R
            vy[i] = -vy[i]! * CUSHION
            rail = 2
          }
        }

        // Past the line of the cushions: that can only be in the mouth of a pocket, and the
        // ball is in it. (Whichever hole is nearest.)
        if (ball.x < 0 || ball.x > TABLE.w || ball.y < 0 || ball.y > TABLE.h) {
          let nearest = 0
          for (let p = 0; p < POCKETS.length; p++) {
            const pocket = POCKETS[p]!
            const px = ball.x - pocket.x
            const py = ball.y - pocket.y
            const away = px * px + py * py
            if (dropped < 0 || away < nearest) {
              dropped = p
              nearest = away
            }
          }
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

      // The jaws: the angled end of each cushion, from the tip of its nose back to the wood.
      // The ball is turned aside from the nearest point of whichever one it has run into, as
      // from anything round or flat: into the pocket, or out of it.
      if (rail === 0 && (ball.x < R + CORNER_CUT || ball.x > TABLE.w - R - CORNER_CUT || (ball.x > TABLE.w / 2 - MIDDLE_CUT - R && ball.x < TABLE.w / 2 + MIDDLE_CUT + R)) && (ball.y < R + CORNER_CUT || ball.y > TABLE.h - R - CORNER_CUT)) {
        for (let j = 0; j < JAWS.length; j++) {
          const jaw = JAWS[j]!
          const sx = jaw.bx - jaw.ax
          const sy = jaw.by - jaw.ay
          // How far along the jaw the nearest point lies: 0 at the tip, 1 at the wood.
          let along = ((ball.x - jaw.ax) * sx + (ball.y - jaw.ay) * sy) / (sx * sx + sy * sy)
          if (along < 0) along = 0
          else if (along > 1) along = 1
          const nx = ball.x - (jaw.ax + sx * along)
          const ny = ball.y - (jaw.ay + sy * along)
          const gap2 = nx * nx + ny * ny
          if (gap2 >= R * R || gap2 === 0) continue
          const gap = Math.sqrt(gap2)
          const ux = nx / gap
          const uy = ny / gap
          // Clear of it again, and turned back by as much of its motion as was into it.
          ball.x += ux * (R - gap)
          ball.y += uy * (R - gap)
          const into = vx[i]! * ux + vy[i]! * uy
          if (into < 0) {
            vx[i] = vx[i]! - (1 + CUSHION) * into * ux
            vy[i] = vy[i]! - (1 + CUSHION) * into * uy
            rail = jaw.rail
          }
        }
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
