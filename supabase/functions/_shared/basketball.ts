// Street basketball, half court: the whole game in one file.
//
// The game server will run this file to decide every match (it is the only judge of where the
// ball goes, of baskets and of the score); the app runs the very same file to draw the game and,
// in practice, to play against the computer. It is written to give the same answer everywhere:
// a fixed time step of 1/60 s, the game's own source of chance (seeded, stored in the state), and
// nothing that depends on the device.
//
// The rules (street rules, half court):
//   * One basket. A basket from inside the arc is worth 1, from beyond it 2. First to 11 wins.
//   * Each possession starts with a "check" at the top of the key.
//   * After the defence wins the ball (a rebound or a steal) it must be taken back beyond the arc
//     before it can be shot. An offensive rebound can go straight back up.
//   * After a basket, the other side takes the ball out. The ball out of bounds goes to the side
//     that did not touch it last.
//   * A 12-second shot clock. It starts again when a shot touches the rim, or the ball changes hands.
//
// Units are metres and seconds. The court lies on the ground (y up). x runs across the court;
// z runs from the baseline (z = 0) to the half-court line (z = 14): street rules, one basket,
// on a full court.

export const TICK = 1 / 60
export const G = 9.81
export const COURT = { halfWidth: 7.5, depth: 14 } as const
export const BALL_R = 0.12
export const RIM = { x: 0, y: 3.05, z: 1.575, r: 0.229, tube: 0.012 } as const
// The board's face, as on the court drawn (public/basketball/court.v3.glb).
export const BOARD = { z: 1.25, halfWidth: 0.91, bottom: 2.75, top: 3.97 } as const
/** The arc: further than this from the rim (along the ground), a basket is worth 2. */
export const ARC = 6.75
/** Where every possession starts. */
export const CHECK = { x: 0, z: 8.6 } as const
export const TO_WIN = 11
export const SHOT_CLOCK = 12
/** How long the shoot button is best held for: release then for a perfect shot. */
export const PERFECT_RELEASE = 0.55
/** A jump shot is gathered for this long before the shooter rises (a layup goes straight up). */
export const GATHER = 0.22
/** Closer than this to the basket with the ball, Shoot is a dunk. */
export const DUNK_RANGE = 1.6
/** A layup from closer than this (and further than a dunk). */
export const LAYUP_RANGE = 2.2
/** The ball goes through the rim this long after the dunk begins: the top of the jump. */
export const DUNK_SLAM = 0.46
export const PLAYER_R = 0.38

export type Team = 0 | 1
/** What a player asks for in one tick. `mx`/`mz` is the direction to move, at most 1 long. */
export type Input = { mx: number; mz: number; shoot: boolean; action: boolean; jump: boolean }
export const NO_INPUT: Input = { mx: 0, mz: 0, shoot: false, action: false, jump: false }

export type Player = {
  id: number
  team: Team
  x: number
  z: number
  vx: number
  vz: number
  /** Which way they face (radians; 0 looks down the court toward the basket, along -z). */
  face: number
  /** Height off the ground, and speed upward, when jumping. */
  y: number
  vy: number
  /** Seconds the shoot button has been held, while shooting. */
  shootT: number | null
  /** Seconds before a crossover or a steal can be tried again. */
  cooldown: number
  /** Seconds left of a stumble (beaten by a crossover, or a reach that missed). */
  stumble: number
  /** Seconds left of the burst of speed after a crossover. */
  burst: number
  /** On the way up for a dunk. */
  dunk: boolean
  /** The buttons as they were last tick, to tell a press from a hold. */
  held: { shoot: boolean; action: boolean; jump: boolean }
}

export type Shot = { by: number; team: Team; points: 1 | 2; touchedRim: boolean; quality: number; dunk?: boolean }

export type Ball = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** The player holding the ball, or null when it is loose or in the air. */
  holder: number | null
  shot: Shot | null
  /** The team that touched it last (for the ball out of bounds). */
  lastTouch: Team
  /** The player who let go of it last, and how long ago (nobody catches their own shot at once). */
  releasedBy: number | null
  sinceRelease: number
  /** Where in the dribble the ball is (radians). */
  dribble: number
}

export type GameEvent =
  | { type: 'bounce'; speed: number }
  | { type: 'rim'; speed: number }
  | { type: 'board' }
  | { type: 'shot'; by: number; quality: number; points: 1 | 2; dunk?: boolean }
  | { type: 'score'; team: Team; points: 1 | 2; swish: boolean; dunk?: boolean }
  | { type: 'block'; by: number }
  | { type: 'steal'; by: number }
  | { type: 'reach'; by: number }
  | { type: 'crossover'; by: number; broke: boolean }
  | { type: 'rebound'; by: number; offensive: boolean }
  | { type: 'turnover'; reason: 'out' | 'shot_clock' }
  | { type: 'check'; team: Team }
  | { type: 'cleared' }
  | { type: 'over'; winner: Team }

export type Phase = 'check' | 'live' | 'dead' | 'over'

export type Game = {
  tick: number
  phase: Phase
  /** Seconds spent in the current phase. */
  phaseT: number
  players: Player[]
  ball: Ball
  score: [number, number]
  /** The team with the ball (or about to have it). */
  offense: Team
  /** The offence must take the ball beyond the arc before shooting. */
  mustClear: boolean
  shotClock: number
  /** The game's own source of chance. */
  rng: number
  winner: Team | null
  /** What happened during the last tick, for sound and pictures. */
  events: GameEvent[]
}

// ---- Chance ---------------------------------------------------------------------------------

/** The next number in [0, 1) from the game's own source (mulberry32). */
function chance(game: Game): number {
  let t = (game.rng = (game.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ---- Setting out ----------------------------------------------------------------------------

const hypot = (x: number, z: number) => Math.sqrt(x * x + z * z)
/** How far a point on the ground is from the rim. */
export const fromRim = (x: number, z: number) => hypot(x - RIM.x, z - RIM.z)
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

function newPlayer(id: number, team: Team): Player {
  return { id, team, x: 0, z: 0, vx: 0, vz: 0, face: 0, y: 0, vy: 0, shootT: null, cooldown: 0, stumble: 0, burst: 0, dunk: false, held: { shoot: false, action: false, jump: false } }
}

/** A new game for `teamSize` players a side (1 or 2). Players 0..teamSize-1 are team 0. */
export function newGame(seed: number, teamSize: 1 | 2 = 1): Game {
  const players = Array.from({ length: teamSize * 2 }, (_, i) => newPlayer(i, i < teamSize ? 0 : 1))
  const game: Game = {
    tick: 0,
    phase: 'check',
    phaseT: 0,
    players,
    ball: { x: CHECK.x, y: 1, z: CHECK.z, vx: 0, vy: 0, vz: 0, holder: null, shot: null, lastTouch: 0, releasedBy: null, sinceRelease: 99, dribble: 0 },
    score: [0, 0],
    offense: 0,
    mustClear: false,
    shotClock: SHOT_CLOCK,
    rng: seed | 0,
    winner: null,
    events: [],
  }
  game.offense = chance(game) < 0.5 ? 0 : 1
  setCheck(game)
  return game
}

/** Everyone to their places for a check at the top of the key. */
function setCheck(game: Game) {
  const attackers = game.players.filter((p) => p.team === game.offense)
  const defenders = game.players.filter((p) => p.team !== game.offense)
  attackers.forEach((p, i) => place(p, CHECK.x + (i === 0 ? 0 : 3.2), CHECK.z + (i === 0 ? 0 : -2.2)))
  defenders.forEach((p, i) => place(p, CHECK.x + (i === 0 ? 0 : 2.6), CHECK.z - (i === 0 ? 1.4 : 3.6)))
  const carrier = attackers[0]!
  const ball = game.ball
  ball.holder = carrier.id
  ball.shot = null
  ball.vx = ball.vy = ball.vz = 0
  ball.lastTouch = game.offense
  ball.releasedBy = null
  ball.dribble = 0
  holdBall(game, carrier)
  game.mustClear = false
  game.shotClock = SHOT_CLOCK
  game.phase = 'check'
  game.phaseT = 0
  game.events.push({ type: 'check', team: game.offense })
}

function place(p: Player, x: number, z: number) {
  p.x = x
  p.z = z
  p.vx = p.vz = p.y = p.vy = 0
  p.shootT = null
  p.dunk = false
  p.stumble = p.burst = 0
  // Facing the basket.
  p.face = Math.atan2(-(RIM.x - x), -(RIM.z - z)) || 0
}

// ---- One tick -------------------------------------------------------------------------------

/** Moves the game on by one tick, with each player's input (by player id). */
export function step(game: Game, inputs: readonly Input[]): Game {
  game.events = []
  game.tick++
  game.phaseT += TICK

  if (game.phase === 'over') return game
  if (game.phase === 'check') {
    // Everyone stands still for a moment, then play.
    for (const p of game.players) p.held = { shoot: inputs[p.id]?.shoot ?? false, action: inputs[p.id]?.action ?? false, jump: inputs[p.id]?.jump ?? false }
    holdBall(game, game.players.find((p) => p.id === game.ball.holder) ?? game.players[0]!)
    if (game.phaseT >= 1) {
      game.phase = 'live'
      game.phaseT = 0
    }
    return game
  }
  if (game.phase === 'dead') {
    // The ball drops on its own; the players slow to a stop.
    for (const p of game.players) {
      p.vx *= 0.9
      p.vz *= 0.9
      p.x += p.vx * TICK
      p.z += p.vz * TICK
      landPlayer(p)
    }
    if (game.ball.holder === null) flyBall(game, false)
    if (game.phaseT >= 1.4) setCheck(game)
    return game
  }

  for (const p of game.players) movePlayer(game, p, inputs[p.id] ?? NO_INPUT)
  separate(game)
  for (const p of game.players) act(game, p, inputs[p.id] ?? NO_INPUT)

  const ball = game.ball
  if (ball.holder !== null) {
    const holder = game.players.find((p) => p.id === ball.holder)!
    holdBall(game, holder)
    if (game.mustClear && fromRim(holder.x, holder.z) > ARC + 0.25 && holder.team === game.offense) {
      game.mustClear = false
      game.events.push({ type: 'cleared' })
    }
  } else {
    ball.sinceRelease += TICK
    flyBall(game, true)
    pickUp(game)
  }

  // The shot clock runs while the offence has the ball in hand.
  if (ball.holder !== null && game.players.find((p) => p.id === ball.holder)!.team === game.offense) {
    game.shotClock -= TICK
    if (game.shotClock <= 0) turnover(game, 'shot_clock')
  }
  return game
}

function movePlayer(game: Game, p: Player, input: Input) {
  p.cooldown = Math.max(0, p.cooldown - TICK)
  p.burst = Math.max(0, p.burst - TICK)
  const holding = game.ball.holder === p.id
  let mx = Number.isFinite(input.mx) ? input.mx : 0
  let mz = Number.isFinite(input.mz) ? input.mz : 0
  const length = hypot(mx, mz)
  if (length > 1) {
    mx /= length
    mz /= length
  }
  if (p.stumble > 0) {
    p.stumble = Math.max(0, p.stumble - TICK)
    mx = mz = 0
  }
  // On the way up for a dunk the player is carried at the basket by the jump: no steering.
  if (p.dunk) {
    p.x = clamp(p.x + p.vx * TICK, -COURT.halfWidth - 0.6, COURT.halfWidth + 0.6)
    p.z = clamp(p.z + p.vz * TICK, 0.35, COURT.depth + 0.6)
    landPlayer(p)
    p.face = Math.atan2(-(RIM.x - p.x), -(RIM.z - p.z))
    return
  }
  // Rising into a shot, a player all but stops.
  const speed = (holding ? 4.7 : 5.3) * (p.shootT !== null ? 0.15 : 1) + (p.burst > 0 ? 2.6 : 0)
  const grip = p.y > 0 ? 1.5 : 11
  p.vx += (mx * speed - p.vx) * Math.min(1, grip * TICK)
  p.vz += (mz * speed - p.vz) * Math.min(1, grip * TICK)
  p.x = clamp(p.x + p.vx * TICK, -COURT.halfWidth - 0.6, COURT.halfWidth + 0.6)
  p.z = clamp(p.z + p.vz * TICK, 0.35, COURT.depth + 0.6)
  // Out of the way of the post holding the basket.
  if (Math.abs(p.x) < 0.5 && p.z < 0.8) p.z = 0.8
  landPlayer(p)

  // A defender close to the ball keeps facing it, and slides; anyone else faces where they go.
  const carrier = game.ball.holder !== null ? game.players.find((q) => q.id === game.ball.holder) : undefined
  const guarding = !holding && carrier !== undefined && carrier.team !== p.team && hypot(carrier.x - p.x, carrier.z - p.z) < 3
  if (guarding) p.face = Math.atan2(-(carrier.x - p.x), -(carrier.z - p.z))
  else if (hypot(p.vx, p.vz) > 0.6) p.face = Math.atan2(-p.vx, -p.vz)
  else if (holding || p.shootT !== null) p.face = Math.atan2(-(RIM.x - p.x), -(RIM.z - p.z))
  else {
    const ball = game.ball
    p.face = Math.atan2(-(ball.x - p.x), -(ball.z - p.z))
  }
}

function landPlayer(p: Player) {
  if (p.y > 0 || p.vy > 0) {
    p.vy -= G * TICK
    p.y += p.vy * TICK
    if (p.y <= 0) {
      p.y = 0
      p.vy = 0
    }
  }
}

/** Two players never stand in the same place: each is pushed half the way out. */
function separate(game: Game) {
  const ps = game.players
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!
      const b = ps[j]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const d = hypot(dx, dz)
      const min = PLAYER_R * 2
      if (d < min) {
        const nx = d > 1e-6 ? dx / d : 1
        const nz = d > 1e-6 ? dz / d : 0
        const push = (min - d) / 2
        a.x -= nx * push
        a.z -= nz * push
        b.x += nx * push
        b.z += nz * push
      }
    }
  }
}

function act(game: Game, p: Player, input: Input) {
  const pressed = { shoot: input.shoot && !p.held.shoot, action: input.action && !p.held.action, jump: input.jump && !p.held.jump }
  p.held = { shoot: input.shoot, action: input.action, jump: input.jump }
  const ball = game.ball
  const holding = ball.holder === p.id

  if (holding) {
    if (p.shootT !== null && p.dunk) {
      p.shootT += TICK
      // At the top of the jump the ball goes through, whatever the button.
      if (p.shootT >= DUNK_SLAM) slam(game, p)
      return
    }
    if (p.shootT !== null) {
      const before = p.shootT
      p.shootT += TICK
      // The ball gathered, the shooter rises: the top of the jump comes about when a perfect
      // shot is let go.
      if (before < GATHER && p.shootT >= GATHER && p.y === 0 && fromRim(p.x, p.z) >= LAYUP_RANGE) {
        p.vy = 2.6
        p.y = 0.001
      }
      // Let go of the button, or hold it far too long: the ball goes up.
      if (!input.shoot || p.shootT >= 1.2) release(game, p)
      return
    }
    if (pressed.shoot && p.stumble === 0) {
      // Taking it back is the rule after the defence wins the ball.
      if (game.mustClear) return
      p.shootT = 0
      const distance = fromRim(p.x, p.z)
      if (distance < DUNK_RANGE) {
        // A dunk: up, and carried to the rim so as to arrive just in front of it at the top.
        p.dunk = true
        p.vy = 4.6
        p.y = 0.001
        const aimX = RIM.x + ((p.x - RIM.x) / Math.max(distance, 0.01)) * 0.35
        const aimZ = RIM.z + ((p.z - RIM.z) / Math.max(distance, 0.01)) * 0.35
        p.vx = (aimX - p.x) / DUNK_SLAM
        p.vz = (aimZ - p.z) / DUNK_SLAM
        return
      }
      // A layup goes straight up; a jump shot is gathered first (above).
      if (distance < LAYUP_RANGE) {
        p.vy = 3.3
        p.y = 0.001
      }
      return
    }
    if (pressed.action && p.cooldown === 0) {
      // A crossover: a burst of speed, and a defender close by may be left behind.
      p.cooldown = 1.1
      p.burst = 0.35
      ball.dribble = 0
      let broke = false
      for (const d of game.players) {
        if (d.team === p.team) continue
        if (hypot(d.x - p.x, d.z - p.z) < 1.4 && chance(game) < 0.3) {
          d.stumble = 0.55
          broke = true
        }
      }
      game.events.push({ type: 'crossover', by: p.id, broke })
    }
    return
  }

  if (pressed.jump && p.y === 0 && p.stumble === 0) {
    p.vy = 3.4
    p.y = 0.001
  }
  if (pressed.action && p.cooldown === 0 && p.stumble === 0 && ball.holder !== null) {
    const holder = game.players.find((q) => q.id === ball.holder)!
    if (holder.team === p.team) return
    p.cooldown = 1
    const near = hypot(holder.x - p.x, holder.z - p.z) < 1.15
    // A ball being shot cannot be stolen; one just crossed over is harder to reach.
    if (near && holder.shootT === null && chance(game) < (holder.burst > 0 ? 0.08 : 0.3)) {
      game.events.push({ type: 'steal', by: p.id })
      giveBall(game, p)
    } else {
      p.stumble = 0.4
      game.events.push({ type: 'reach', by: p.id })
    }
  }
}

/** The ball in a player's hand: bounced beside them while they move, held high as they shoot. */
function holdBall(game: Game, p: Player) {
  const ball = game.ball
  const side = 0.32
  // To the player's right hand (facing along -z when face is 0).
  const rx = Math.cos(p.face)
  const rz = -Math.sin(p.face)
  const fx = -Math.sin(p.face)
  const fz = -Math.cos(p.face)
  if (p.dunk) {
    ball.x = p.x + fx * 0.3
    ball.z = p.z + fz * 0.3
    ball.y = 2.4 + p.y
  } else if (p.shootT !== null) {
    ball.x = p.x + fx * 0.2
    ball.z = p.z + fz * 0.2
    ball.y = 2.0 + p.y + Math.min(p.shootT, 0.4) * 0.6
  } else {
    const before = Math.sin(ball.dribble)
    ball.dribble += TICK * Math.PI * 2 * (hypot(p.vx, p.vz) > 1 ? 2.3 : 1.7)
    const after = Math.sin(ball.dribble)
    if (before > 0 && after <= 0) game.events.push({ type: 'bounce', speed: 3 })
    ball.x = p.x + rx * side + fx * 0.25
    ball.z = p.z + rz * side + fz * 0.25
    ball.y = BALL_R + Math.abs(Math.sin(ball.dribble)) * 0.82
  }
  ball.vx = p.vx
  ball.vz = p.vz
  ball.vy = 0
}

/** The ball leaves the shooter's hands toward the rim, as well aimed as the shot deserves. */
function release(game: Game, shooter: Player) {
  const ball = game.ball
  const held = shooter.shootT ?? 0
  shooter.shootT = null
  const distance = fromRim(shooter.x, shooter.z)
  const layup = distance < LAYUP_RANGE
  const points: 1 | 2 = distance > ARC ? 2 : 1
  // How well the release was timed: 1 at the perfect moment, 0 a long way off it.
  const quality = clamp(1 - Math.abs(held - PERFECT_RELEASE) / 0.35, 0, 1)

  // A defender close by and in the air when the ball goes up may block it.
  for (const d of game.players) {
    if (d.team === shooter.team) continue
    if (hypot(d.x - shooter.x, d.z - shooter.z) < 1.3 && d.y > 0.3 && chance(game) < 0.75) {
      game.events.push({ type: 'block', by: d.id })
      const away = Math.atan2(shooter.x - d.x, shooter.z - d.z)
      ball.holder = null
      ball.shot = null
      ball.vx = Math.sin(away) * 3.5
      ball.vz = Math.cos(away) * 3.5
      ball.vy = 1.5
      ball.lastTouch = d.team
      ball.releasedBy = d.id
      ball.sinceRelease = 0
      return
    }
  }
  // How much a defender close by spoils the shot.
  let contest = 0
  for (const d of game.players) {
    if (d.team === shooter.team) continue
    const c = hypot(d.x - shooter.x, d.z - shooter.z)
    contest = Math.max(contest, c < 1 ? 1 : c < 2 ? (2 - c) : 0)
  }
  const spread = layup ? (1 - quality) * 0.035 + contest * 0.04 : (1 - quality) * 0.11 + distance * 0.0035 + contest * 0.05
  const aimError = (chance(game) * 2 - 1) * spread
  const powerError = (chance(game) * 2 - 1) * spread * 0.55

  // A shot aims at the middle of the rim, a touch toward the back.
  const sx = ball.x
  const sz = ball.z
  const sy = ball.y
  const tx = RIM.x
  const tz = RIM.z - 0.03
  const dx = tx - sx
  const dz = tz - sz
  const d = Math.max(0.3, hypot(dx, dz))
  const h = RIM.y - sy
  // A good shot comes down steeply into the basket: a high arc, higher still from further out.
  let angle = ((layup ? 66 : 57 + Math.min(distance, 8) * 0.5) * Math.PI) / 180
  if (d * Math.tan(angle) <= h + 0.05) angle = Math.atan((h + 0.6) / d)
  const speed = Math.sqrt((G * d * d) / (2 * Math.cos(angle) ** 2 * (d * Math.tan(angle) - h))) * (1 + powerError)
  const heading = Math.atan2(dx, dz) + aimError
  const across = speed * Math.cos(angle)
  ball.vx = Math.sin(heading) * across
  ball.vz = Math.cos(heading) * across
  ball.vy = speed * Math.sin(angle)
  ball.holder = null
  ball.shot = { by: shooter.id, team: shooter.team, points, touchedRim: false, quality }
  ball.lastTouch = shooter.team
  ball.releasedBy = shooter.id
  ball.sinceRelease = 0
  game.events.push({ type: 'shot', by: shooter.id, quality, points })
}

/** The dunk at the top of the jump: through the rim, unless a defender up there gets a hand to it. */
function slam(game: Game, dunker: Player) {
  const ball = game.ball
  dunker.shootT = null
  dunker.dunk = false
  for (const d of game.players) {
    if (d.team === dunker.team) continue
    if (hypot(d.x - dunker.x, d.z - dunker.z) < 1 && d.y > 0.4 && chance(game) < 0.4) {
      game.events.push({ type: 'block', by: d.id })
      ball.holder = null
      ball.shot = null
      ball.x = RIM.x
      ball.z = RIM.z + 0.6
      ball.y = RIM.y
      ball.vx = (chance(game) - 0.5) * 3
      ball.vz = 3.5
      ball.vy = 1
      ball.lastTouch = d.team
      ball.releasedBy = d.id
      ball.sinceRelease = 0
      return
    }
  }
  ball.holder = null
  ball.x = RIM.x
  ball.z = RIM.z
  ball.y = RIM.y + 0.16
  ball.vx = ball.vz = 0
  ball.vy = -3
  ball.shot = { by: dunker.id, team: dunker.team, points: 1, touchedRim: true, quality: 1, dunk: true }
  ball.lastTouch = dunker.team
  ball.releasedBy = dunker.id
  ball.sinceRelease = 0
  game.events.push({ type: 'shot', by: dunker.id, quality: 1, points: 1, dunk: true })
}

/** The ball in the air or rolling: gravity, the floor, the board, the rim, and the basket. */
function flyBall(game: Game, live: boolean) {
  const ball = game.ball
  const steps = 4
  const dt = TICK / steps
  for (let s = 0; s < steps; s++) {
    const before = { x: ball.x, y: ball.y, z: ball.z }
    ball.vy -= G * dt
    ball.x += ball.vx * dt
    ball.y += ball.vy * dt
    ball.z += ball.vz * dt

    // The floor.
    if (ball.y < BALL_R) {
      ball.y = BALL_R
      if (Math.abs(ball.vy) > 0.8) game.events.push({ type: 'bounce', speed: Math.abs(ball.vy) })
      ball.vy = -ball.vy * 0.72
      ball.vx *= 0.86
      ball.vz *= 0.86
      if (Math.abs(ball.vy) < 0.25) ball.vy = 0
      ball.shot = null
    }

    // The backboard, from the front.
    if (ball.z - BALL_R < BOARD.z && before.z - BALL_R >= BOARD.z && Math.abs(ball.x) < BOARD.halfWidth && ball.y > BOARD.bottom && ball.y < BOARD.top) {
      ball.z = BOARD.z + BALL_R
      ball.vz = -ball.vz * 0.6
      ball.vx *= 0.85
      game.events.push({ type: 'board' })
    }

    // The rim: a thin ring. The ball bounces off the point of it nearest to the ball.
    const dx = ball.x - RIM.x
    const dz = ball.z - RIM.z
    const across = hypot(dx, dz)
    const cx = RIM.x + (across > 1e-6 ? (dx / across) * RIM.r : RIM.r)
    const cz = RIM.z + (across > 1e-6 ? (dz / across) * RIM.r : 0)
    const nx = ball.x - cx
    const ny = ball.y - RIM.y
    const nz = ball.z - cz
    const gap = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (gap < BALL_R + RIM.tube && gap > 1e-6) {
      const ux = nx / gap
      const uy = ny / gap
      const uz = nz / gap
      const into = ball.vx * ux + ball.vy * uy + ball.vz * uz
      if (into < 0) {
        ball.vx -= 1.55 * into * ux
        ball.vy -= 1.55 * into * uy
        ball.vz -= 1.55 * into * uz
        ball.vx *= 0.93
        ball.vz *= 0.93
        game.events.push({ type: 'rim', speed: -into })
        if (ball.shot) ball.shot.touchedRim = true
        game.shotClock = SHOT_CLOCK
      }
      const push = BALL_R + RIM.tube - gap
      ball.x += ux * push
      ball.y += uy * push
      ball.z += uz * push
    }

    // Through the hoop: the middle of the ball drops through the ring, inside it.
    if (live && before.y >= RIM.y && ball.y < RIM.y && ball.vy < 0 && fromRim(ball.x, ball.z) < RIM.r - 0.03) {
      score(game)
      if (game.phase !== 'live') return
    }
    // The net slows a ball falling through it.
    if (ball.y < RIM.y && ball.y > RIM.y - 0.45 && fromRim(ball.x, ball.z) < RIM.r) {
      ball.vx *= 0.9
      ball.vz *= 0.9
      ball.vy *= 0.96
    }
  }

  // Out of bounds.
  if (live && ball.y < 1.2 && (Math.abs(ball.x) > COURT.halfWidth + 0.3 || ball.z > COURT.depth + 0.3 || ball.z < -0.3)) {
    turnover(game, 'out', ball.lastTouch === 0 ? 1 : 0)
  }
}

function score(game: Game) {
  const ball = game.ball
  const shot = ball.shot
  const team = shot?.team ?? ball.lastTouch
  const points: 1 | 2 = shot?.points ?? 1
  game.score[team] += points
  game.events.push({ type: 'score', team, points, swish: shot !== null && !shot.touchedRim, dunk: shot?.dunk ?? false })
  ball.shot = null
  if (game.score[team] >= TO_WIN) {
    game.winner = team
    game.phase = 'over'
    game.phaseT = 0
    game.events.push({ type: 'over', winner: team })
    return
  }
  // The other side takes it out.
  game.offense = team === 0 ? 1 : 0
  game.phase = 'dead'
  game.phaseT = 0
}

function turnover(game: Game, reason: 'out' | 'shot_clock', to?: Team) {
  game.events.push({ type: 'turnover', reason })
  game.offense = to ?? (game.offense === 0 ? 1 : 0)
  game.ball.holder = null
  game.ball.shot = null
  for (const p of game.players) {
    p.shootT = null
    p.dunk = false
  }
  game.phase = 'dead'
  game.phaseT = 0
}

/** A loose ball is caught by the first player who can reach it. */
function pickUp(game: Game) {
  const ball = game.ball
  let best: Player | null = null
  let bestGap = Infinity
  for (const p of game.players) {
    if (p.stumble > 0) continue
    if (ball.releasedBy === p.id && ball.sinceRelease < 0.6) continue
    const gap = hypot(ball.x - p.x, ball.z - p.z)
    // A player reaches about 2.3 m up standing, more when jumping.
    const reach = 2.3 + p.y * 1.2
    if (gap < 0.6 && ball.y < reach && gap < bestGap) {
      best = p
      bestGap = gap
    }
  }
  if (best) giveBall(game, best)
}

function giveBall(game: Game, p: Player) {
  const ball = game.ball
  const wasShot = ball.shot !== null || ball.releasedBy !== null
  ball.holder = p.id
  ball.shot = null
  ball.lastTouch = p.team
  ball.releasedBy = null
  game.shotClock = SHOT_CLOCK
  if (p.team !== game.offense) {
    // The defence has it: now they attack, and must take it back first.
    game.offense = p.team
    game.mustClear = fromRim(p.x, p.z) <= ARC + 0.25
    if (wasShot) game.events.push({ type: 'rebound', by: p.id, offensive: false })
  } else if (wasShot) {
    game.events.push({ type: 'rebound', by: p.id, offensive: true })
  }
}

/** A copy of a game, for looking ahead or keeping a picture of it. */
export function cloneGame(game: Game): Game {
  return {
    ...game,
    players: game.players.map((p) => ({ ...p, held: { ...p.held } })),
    ball: { ...game.ball, shot: game.ball.shot ? { ...game.ball.shot } : null },
    score: [game.score[0], game.score[1]],
    events: [...game.events],
  }
}
