// The computer player for practice games. It sees the game as a player would and presses the
// same buttons a player can: it moves, crosses over, shoots with the timing meter, reaches for
// steals and jumps to block. It cannot do anything a person could not.
import { ARC, fromRim, type Game, type Input, NO_INPUT, PERFECT_RELEASE, RIM, TICK } from '../../../supabase/functions/_shared/basketball'

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
export type Mind = { releaseAt: number | null; random: () => number; wasHolding: boolean }

export function newMind(seed: number): Mind {
  let state = seed | 0
  return {
    releaseAt: null,
    wasHolding: false,
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
    const near = Math.hypot(ball.x - me.x, ball.z - me.z) < 1.1
    return { ...NO_INPUT, ...toward(me.x, me.z, leadX, leadZ, level.speed), jump: near && ball.y > 2.3 && ball.vy < 0 && me.y === 0 }
  }

  const holder = game.players.find((p) => p.id === ball.holder)!
  // A teammate has it: find space on the far side.
  if (holder.team === me.team) {
    return { ...NO_INPUT, ...toward(me.x, me.z, -holder.x * 0.8, 6, level.speed * 0.8) }
  }

  // Defence: between the ball and the basket, a step off.
  const dx = RIM.x - holder.x
  const dz = RIM.z - holder.z
  const d = Math.max(0.1, Math.hypot(dx, dz))
  const goal = toward(me.x, me.z, holder.x + (dx / d) * 1.05, holder.z + (dz / d) * 1.05, level.speed)
  const close = Math.hypot(holder.x - me.x, holder.z - me.z)
  const jump = holder.shootT !== null && holder.shootT > 0.15 && close < 1.5 && me.y === 0 && mind.random() < level.blockChance * 6 * TICK
  const steal = holder.shootT === null && close < 1.1 && me.cooldown === 0 && mind.random() < level.stealRate * TICK
  return { ...NO_INPUT, ...goal, jump, action: steal }
}
