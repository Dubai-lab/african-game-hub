// The computer player for practice games. It sees the game as a player would and presses the
// same buttons a player can: it moves, crosses over, shoots with the timing meter, reaches for
// steals and jumps to block. It cannot do anything a person could not.
import { ARC, fromRim, type Game, type Input, NO_INPUT, PERFECT_RELEASE, RIM, TICK, teammate } from '../../../supabase/functions/_shared/basketball'

export type LevelId = 'easy' | 'medium' | 'hard'
export type Level = {
  id: LevelId
  /** How far off the perfect release its shots are, at most (seconds). */
  releaseError: number
  /** How often, when the shooter is close, it jumps to block. */
  blockChance: number
  /** How often per second it reaches for the ball when close. */
  stealRate: number
  /** How open it wants to be before it shoots from outside. */
  openGap: number
  speed: number
}

export const LEVELS: Level[] = [
  { id: 'easy', releaseError: 0.28, blockChance: 0.15, stealRate: 0.25, openGap: 1.2, speed: 0.75 },
  { id: 'medium', releaseError: 0.14, blockChance: 0.4, stealRate: 0.55, openGap: 1.6, speed: 0.9 },
  { id: 'hard', releaseError: 0.06, blockChance: 0.65, stealRate: 0.9, openGap: 2, speed: 1 },
]
export const levelById = (id: unknown): Level => LEVELS.find((level) => level.id === id) ?? LEVELS[1]!

/** What the computer remembers between ticks: when it means to let go of its shot. */
export type Mind = {
  releaseAt: number | null
  random: () => number
  wasHolding: boolean
  /** For the shot being taken now: whether it decided to go up and contest it (decided once). */
  contest: boolean | null
}

export function newMind(seed: number): Mind {
  let state = seed | 0
  return {
    releaseAt: null,
    wasHolding: false,
    contest: null,
    random: () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), state | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

const toward = (fromX: number, fromZ: number, toX: number, toZ: number, scale = 1): Pick<Input, 'mx' | 'mz'> => {
  const dx = toX - fromX
  const dz = toZ - fromZ
  const d = Math.sqrt(dx * dx + dz * dz)
  if (d < 0.15) return { mx: 0, mz: 0 }
  const s = Math.min(1, d / 0.8) * scale
  return { mx: (dx / d) * s, mz: (dz / d) * s }
}

/** The buttons the computer presses this tick, as player `id`. */
export function think(game: Game, id: number, level: Level, mind: Mind): Input {
  if (game.phase !== 'live') return NO_INPUT
  const me = game.players.find((p) => p.id === id)!
  const ball = game.ball
  const opponents = game.players.filter((p) => p.team !== me.team)
  const nearest = opponents.reduce((a, b) => (Math.hypot(a.x - me.x, a.z - me.z) < Math.hypot(b.x - me.x, b.z - me.z) ? a : b))
  const gap = Math.hypot(nearest.x - me.x, nearest.z - me.z)

  // With the ball.
  if (ball.holder === id) {
    mind.wasHolding = true
    // A shot under way: let go at the moment it chose.
    if (me.shootT !== null) {
      return { ...NO_INPUT, shoot: me.shootT < (mind.releaseAt ?? PERFECT_RELEASE) }
    }
    const distance = fromRim(me.x, me.z)
    // 2v2: pass when the teammate calls for it, or when crowded with the teammate open.
    const mate = teammate(game, me)
    if (mate && me.cooldown === 0) {
      const mateGap = Math.min(...opponents.map((o) => Math.hypot(o.x - mate.x, o.z - mate.z)))
      const lane = laneOpen(game, me, mate)
      if (mate.calling > 0 && lane && mind.random() < 6 * TICK) return { ...NO_INPUT, pass: true }
      if (gap < 1.4 && mateGap > 1.4 && lane && mind.random() < 2 * TICK) return { ...NO_INPUT, pass: true }
      // Moving the ball round, out on the perimeter.
      if (distance > 6 && mateGap > 1.2 && lane && mind.random() < 0.5 * TICK) return { ...NO_INPUT, pass: true }
      // Back out beyond the arc after winning the ball: a teammate already out there can take it.
      if (game.mustClear && fromRim(mate.x, mate.z) > ARC + 0.4 && lane && mind.random() < 2 * TICK) return { ...NO_INPUT, pass: true }
    }
    const shoot = () => {
      mind.releaseAt = PERFECT_RELEASE + (mind.random() * 2 - 1) * level.releaseError
      return { ...NO_INPUT, shoot: true }
    }
    // After winning the ball back, take it beyond the arc first.
    if (game.mustClear) {
      const dx = me.x - RIM.x
      const dz = me.z - RIM.z
      const d = Math.max(0.1, Math.hypot(dx, dz))
      return { ...NO_INPUT, ...toward(me.x, me.z, RIM.x + (dx / d) * (ARC + 1), RIM.z + (dz / d) * (ARC + 1), level.speed) }
    }
    if (distance < 1.7) return shoot()
    if (gap > level.openGap && distance < 7.6 && mind.random() < 3 * TICK) return shoot()
    if (game.shotClock < 2.5 && distance < 8) return shoot()
    // Drive to the basket, round the side the defender is not on.
    const side = nearest.x > me.x ? -1 : 1
    const target = toward(me.x, me.z, RIM.x + side * 0.9, RIM.z + 0.9, level.speed)
    const cross = gap < 1.2 && me.cooldown === 0 && mind.random() < 1.5 * TICK
    return { ...NO_INPUT, ...target, action: cross }
  }
  mind.wasHolding = false
  mind.releaseAt = null

  // Nobody has the ball: go and get it, and jump for a rebound in reach.
  if (ball.holder === null) {
    const leadX = ball.x + ball.vx * 0.35
    const leadZ = ball.z + ball.vz * 0.35
    // Up for a rebound only when the ball is coming down within reach.
    const near = Math.hypot(ball.x - me.x, ball.z - me.z) < 0.8
    return { ...NO_INPUT, ...toward(me.x, me.z, leadX, leadZ, level.speed), jump: near && ball.y > 2.2 && ball.y < 3.1 && ball.vy < 0 && me.y === 0 }
  }

  const holder = game.players.find((p) => p.id === ball.holder)!
  // A teammate has it: find space on the far side, and call for it when open.
  if (holder.team === me.team) {
    const open = Math.min(...opponents.map((o) => Math.hypot(o.x - me.x, o.z - me.z)))
    const call = open > 1.5 && me.calling === 0 && mind.random() < 1 * TICK
    return { ...NO_INPUT, ...toward(me.x, me.z, -holder.x * 0.8, 6, level.speed * 0.8), pass: call }
  }

  // 2v2 defence, man to man: each guards the opponent in the same place on the other side; the
  // one whose man is off the ball stays between him and the basket, a little toward the ball.
  const mine = opponents[game.players.filter((p) => p.team === me.team).indexOf(me)] ?? holder
  if (mine.id !== holder.id) {
    const mx = mine.x + (RIM.x - mine.x) * 0.3 + (holder.x - mine.x) * 0.15
    const mz = mine.z + (RIM.z - mine.z) * 0.3 + (holder.z - mine.z) * 0.15
    return { ...NO_INPUT, ...toward(me.x, me.z, mx, mz, level.speed) }
  }

  // Defence: between the ball and the basket, a step off.
  const dx = RIM.x - holder.x
  const dz = RIM.z - holder.z
  const d = Math.max(0.1, Math.hypot(dx, dz))
  const goal = toward(me.x, me.z, holder.x + (dx / d) * 1.05, holder.z + (dz / d) * 1.05, level.speed)
  const close = Math.hypot(holder.x - me.x, holder.z - me.z)
  // A shot going up: decide once whether to go up with it, and only from close by; then leave
  // the ground as the shooter does.
  if (holder.shootT === null) mind.contest = null
  else if (mind.contest === null) mind.contest = close < 1.4 && mind.random() < level.blockChance
  const jump = mind.contest === true && holder.shootT !== null && holder.shootT >= 0.2 && me.y === 0
  const steal = holder.shootT === null && close < 1.1 && me.cooldown === 0 && mind.random() < level.stealRate * TICK
  return { ...NO_INPUT, ...goal, jump, action: steal }
}

/** No opponent standing in the line between the two (where they could take the pass). */
function laneOpen(game: Game, from: { x: number; z: number; team: number }, to: { x: number; z: number }): boolean {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.max(0.01, Math.hypot(dx, dz))
  return game.players.every((o) => {
    if (o.team === from.team) return true
    const along = ((o.x - from.x) * dx + (o.z - from.z) * dz) / length
    if (along < 0 || along > length) return true
    const off = Math.abs((o.x - from.x) * dz - (o.z - from.z) * dx) / length
    return off > 0.9
  })
}
