import { applyShot, type Ball, canPlaceCue, HEAD_SPOT, POCKETS, type PoolState, type Shot, TABLE, targets } from '../../../supabase/functions/_shared/pool'

// The computer's pool player, for practice. It looks for a ball it may hit that has a clear
// road to a pocket, tries the most promising shots out with the game's own physics, and then
// plays the best of them with a hand as steady as its level allows.

export type Level = 'easy' | 'medium' | 'hard'
const R = TABLE.r
const D = R * 2
/** How many shots are tried out before choosing, and how far (in degrees) the cue may wander. */
const SKILL: Record<Level, { tries: number; wobble: number }> = {
  easy: { tries: 0, wobble: 1.5 },
  medium: { tries: 3, wobble: 0.5 },
  hard: { tries: 8, wobble: 0.08 },
}
/** The point to send a ball to for each pocket: just inside its mouth. */
const MOUTHS = POCKETS.map((p) => ({ x: Math.min(Math.max(p.x, 30), TABLE.w - 30), y: Math.min(Math.max(p.y, 30), TABLE.h - 30) }))

type Point = { x: number; y: number }
type Plan = { dx: number; dy: number; power: number; cue?: Point; pocket: number; score: number }

/** Whether any ball (other than those named) lies across the road from a to b. */
function blocked(balls: readonly Ball[], a: Point, b: Point, skip: readonly number[]): boolean {
  const lx = b.x - a.x
  const ly = b.y - a.y
  const length2 = lx * lx + ly * ly
  if (length2 === 0) return false
  for (const ball of balls) {
    if (ball.in || skip.includes(ball.n)) continue
    const along = Math.min(1, Math.max(0, ((ball.x - a.x) * lx + (ball.y - a.y) * ly) / length2))
    const ox = a.x + lx * along - ball.x
    const oy = a.y + ly * along - ball.y
    if (ox * ox + oy * oy < D * D) return true
  }
  return false
}

const powerFor = (distance: number) => Math.round(Math.min(850, Math.max(190, 120 + distance * 0.055)))

/** Every way of cutting a ball the player may hit into a pocket, from where the cue ball is (or could be put). */
function pots(state: PoolState, cue: Point, mayPlace: boolean): Plan[] {
  const plans: Plan[] = []
  for (const n of targets(state)) {
    const ball = state.balls.find((b) => b.n === n)!
    MOUTHS.forEach((mouth, pocket) => {
      const tx = mouth.x - ball.x
      const ty = mouth.y - ball.y
      const toPocket = Math.hypot(tx, ty)
      if (toPocket < 1) return
      const ux = tx / toPocket
      const uy = ty / toPocket
      // A middle pocket only takes a ball that comes at it fairly squarely.
      if ((pocket === 1 || pocket === 4) && Math.abs(uy) < 0.4) return
      // Where the cue ball must be at the moment it touches the ball.
      const ghost = { x: ball.x - ux * D, y: ball.y - uy * D }
      if (ghost.x < R || ghost.x > TABLE.w - R || ghost.y < R || ghost.y > TABLE.h - R) return
      if (blocked(state.balls, ball, mouth, [0, n])) return

      const from: (Point | undefined)[] = [undefined]
      // With the cue ball in hand: straight behind the ball, at a comfortable distance.
      if (mayPlace) for (const back of [350, 550, 200]) from.unshift({ x: ghost.x - ux * back, y: ghost.y - uy * back })
      for (const place of from) {
        if (place && !canPlaceCue(state.balls, place.x, place.y, false)) continue
        const start = place ?? cue
        const vx = ghost.x - start.x
        const vy = ghost.y - start.y
        const toBall = Math.hypot(vx, vy)
        if (toBall < 1) continue
        const cut = (vx * ux + vy * uy) / toBall
        if (cut < 0.3) continue
        if (blocked(state.balls, start, ghost, [0, n])) continue
        plans.push({
          dx: vx,
          dy: vy,
          power: powerFor(toBall + toPocket / (cut * cut) + 500),
          ...(place ? { cue: place } : {}),
          pocket,
          score: (cut * cut) / (1 + (toBall + toPocket) / 1500),
        })
        if (place) break
      }
    })
  }
  return plans.sort((a, b) => b.score - a.score)
}

/** When nothing can be pocketed: simply reach a ball the player may hit. */
function touches(state: PoolState, cue: Point): Plan[] {
  const plans: Plan[] = []
  for (const n of targets(state)) {
    const ball = state.balls.find((b) => b.n === n)!
    const dx = ball.x - cue.x
    const dy = ball.y - cue.y
    const distance = Math.hypot(dx, dy)
    if (distance < 1) continue
    for (const off of [0, 0.6, -0.6]) {
      // Aimed a little to one side of centre, in case the full ball is hidden.
      const ax = dx - (dy / distance) * off * D
      const ay = dy + (dx / distance) * off * D
      const open = !blocked(state.balls, cue, { x: cue.x + ax, y: cue.y + ay }, [0, n])
      plans.push({ dx: ax, dy: ay, power: powerFor(distance + 1500), pocket: 0, score: (open ? 0.1 : 0.01) / (1 + distance / 1000) })
    }
  }
  return plans.sort((a, b) => b.score - a.score)
}

function toShot(state: PoolState, plan: Plan, wobble: number, calling: boolean): Shot {
  const turn = ((Math.random() * 2 - 1) * wobble * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const length = Math.hypot(plan.dx, plan.dy) || 1
  const ux = plan.dx / length
  const uy = plan.dy / length
  return {
    dx: Math.round((ux * cos - uy * sin) * 1_000_000),
    dy: Math.round((ux * sin + uy * cos) * 1_000_000),
    power: plan.power,
    spinX: 0,
    spinY: 0,
    ...(state.ballInHand && plan.cue ? { cue: plan.cue } : {}),
    ...(calling ? { pocket: plan.pocket } : {}),
  }
}

/** The shot the computer plays, for the player whose turn it is. */
export function chooseShot(state: PoolState, level: Level): Shot {
  const skill = SKILL[level]
  const me = state.turn
  const must = targets(state)
  const calling = state.variant === '8ball' && must.length === 1 && must[0] === 8

  if (state.breakShot) {
    // The break: from a little off the head spot, hard, at the front ball of the rack.
    const front = state.balls.find((b) => b.n === 1)!
    const cue = { x: HEAD_SPOT.x, y: HEAD_SPOT.y + 90 }
    return toShot(state, { dx: front.x - cue.x, dy: front.y - cue.y, power: 960, cue, pocket: 0, score: 0 }, skill.wobble / 3, false)
  }

  const ball = state.balls.find((b) => b.n === 0)!
  let cue: Point = { x: ball.x, y: ball.y }
  if (state.ballInHand && !canPlaceCue(state.balls, cue.x, cue.y, false)) {
    // Wherever the cue ball lies is taken: any free place will do to start from.
    search: for (let x = R * 2; x < TABLE.w; x += 90) {
      for (let y = R * 2; y < TABLE.h; y += 90) {
        if (canPlaceCue(state.balls, x, y, false)) {
          cue = { x, y }
          break search
        }
      }
    }
  }
  const withCue = (plan: Plan): Plan => (state.ballInHand && !plan.cue ? { ...plan, cue } : plan)
  const plans = [...pots(state, cue, state.ballInHand), ...touches(state, cue)].map(withCue)
  if (plans.length === 0) return toShot(state, { dx: 1, dy: 0, power: 400, cue, pocket: 0, score: 0 }, 0, calling)

  // Try the best few out, exactly as they would be played, and keep the one that turns out best.
  let best = plans[0]!
  let bestWorth = -Infinity
  for (const plan of plans.slice(0, skill.tries)) {
    const played = applyShot(state, toShot(state, plan, 0, calling))
    if (!played) continue
    const { result } = played
    const worth = (result.winner === me ? 1000 : result.winner !== null ? -1000 : result.foul ? -100 : result.again ? 100 : 0) + plan.score
    if (worth > bestWorth) {
      bestWorth = worth
      best = plan
    }
    if (worth >= 100) break
  }
  return toShot(state, best, skill.wobble, calling)
}
