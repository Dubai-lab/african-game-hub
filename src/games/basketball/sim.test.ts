import { describe, expect, it } from 'vitest'
import {
  ARC,
  CHECK,
  DUNK_RANGE,
  cloneGame,
  fromRim,
  type Game,
  type GameEvent,
  type Input,
  newGame,
  NO_INPUT,
  PERFECT_RELEASE,
  RIM,
  step,
  TICK,
  TO_WIN,
} from '../../../supabase/functions/_shared/basketball'
import { levelById, newMind, think } from './ai'

// The street basketball simulation: shooting, the rim and the basket, possession, the street
// rules, and whole games between two computer players.

const idle = (game: Game): Input[] => game.players.map(() => NO_INPUT)

/** Runs ticks until `until` says stop (or a limit), collecting every event. */
function run(game: Game, inputs: (g: Game) => Input[], until: (g: Game) => boolean, limit = 60 * 30): GameEvent[] {
  const events: GameEvent[] = []
  for (let i = 0; i < limit && !until(game); i++) {
    step(game, inputs(game))
    events.push(...game.events)
  }
  return events
}

/** A live game with player 0 holding the ball at (x, z), alone with nobody near. */
function alone(x: number, z: number, seed = 1): Game {
  const game = newGame(seed)
  game.offense = 0
  // Through the check.
  run(game, idle, (g) => g.phase === 'live', 200)
  const shooter = game.players[0]!
  const other = game.players[1]!
  game.offense = 0
  game.ball.holder = 0
  game.mustClear = false
  shooter.x = x
  shooter.z = z
  other.x = 7
  other.z = 10.5
  return game
}

/** Holds the shoot button for `holdFor` seconds, then lets go, and waits for the shot to end. */
function shoot(game: Game, holdFor: number): GameEvent[] {
  let held = 0
  return run(
    game,
    (g) => {
      held += TICK
      return g.players.map((p) => (p.id === 0 ? { ...NO_INPUT, shoot: held <= holdFor + TICK } : NO_INPUT))
    },
    (g) => g.phase !== 'live' || (held > holdFor + 0.2 && g.ball.shot === null && g.ball.holder === null && g.ball.y < 0.3),
    60 * 6,
  )
}

describe('setting out', () => {
  it('starts with a check at the top of the key, one side holding the ball', () => {
    const game = newGame(42)
    expect(game.phase).toBe('check')
    const carrier = game.players.find((p) => p.id === game.ball.holder)!
    expect(carrier.team).toBe(game.offense)
    expect(carrier.x).toBeCloseTo(CHECK.x)
    expect(carrier.z).toBeCloseTo(CHECK.z)
    expect(game.score).toEqual([0, 0])
  })

  it('plays the same game twice from the same seed and the same buttons', () => {
    const a = newGame(7)
    const b = newGame(7)
    const minds = [newMind(1), newMind(2)]
    const mindsB = [newMind(1), newMind(2)]
    for (let i = 0; i < 60 * 40; i++) {
      step(a, a.players.map((p) => think(a, p.id, levelById('medium'), minds[p.id]!)))
      step(b, b.players.map((p) => think(b, p.id, levelById('medium'), mindsB[p.id]!)))
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('shooting', () => {
  it('a perfectly timed shot from the free-throw line goes in nearly every time', () => {
    let made = 0
    for (let seed = 1; seed <= 20; seed++) {
      const game = alone(0, RIM.z + 4.2, seed)
      const events = shoot(game, PERFECT_RELEASE)
      if (events.some((e) => e.type === 'score')) made++
    }
    expect(made).toBeGreaterThanOrEqual(17)
  })

  it('a shot let go far too early or too late mostly misses', () => {
    let made = 0
    for (let seed = 1; seed <= 20; seed++) {
      const game = alone(2, RIM.z + 5, seed)
      if (shoot(game, seed % 2 === 0 ? 0.05 : 1.15).some((e) => e.type === 'score')) made++
    }
    expect(made).toBeLessThanOrEqual(8)
  })

  it('a basket from inside the arc is worth 1, from beyond it 2', () => {
    for (const [z, points] of [
      [RIM.z + 3, 1],
      [RIM.z + ARC + 0.6, 2],
    ] as const) {
      let scored: GameEvent | undefined
      for (let seed = 1; seed <= 30 && !scored; seed++) {
        const game = alone(0, z, seed)
        scored = shoot(game, PERFECT_RELEASE).find((e) => e.type === 'score')
      }
      expect(scored).toMatchObject({ type: 'score', team: 0, points })
    }
  })

  it('after a basket the other side checks the ball at the top of the key', () => {
    let game: Game | null = null
    for (let seed = 1; seed <= 30; seed++) {
      const g = alone(0, RIM.z + 2, seed)
      if (shoot(g, PERFECT_RELEASE).some((e) => e.type === 'score')) {
        game = g
        break
      }
    }
    expect(game).not.toBeNull()
    run(game!, idle, (g) => g.phase === 'check', 200)
    expect(game!.offense).toBe(1)
    expect(game!.players.find((p) => p.id === game!.ball.holder)!.team).toBe(1)
    expect(game!.score[0]).toBeGreaterThan(0)
  })
})

describe('dunks', () => {
  it('close to the basket with the ball, Shoot is a dunk, and it goes through at the top of the jump', () => {
    const game = alone(0.3, RIM.z + DUNK_RANGE - 0.4)
    const events = shoot(game, 0.1)
    expect(events.find((e) => e.type === 'shot')).toMatchObject({ dunk: true, points: 1 })
    expect(events.find((e) => e.type === 'score')).toMatchObject({ team: 0, points: 1, dunk: true })
  })

  it('a defender up in the air beside the rim can stop some of them', () => {
    let blocked = 0
    for (let seed = 1; seed <= 30; seed++) {
      const game = alone(0.3, RIM.z + 1.2, seed)
      const defender = game.players[1]!
      let t = 0
      const events = run(
        game,
        (g) => {
          t += TICK
          // The defender jumps with the dunker, right beside the rim.
          defender.x = 0.5
          defender.z = RIM.z + 0.7
          return g.players.map((p) => (p.id === 0 ? { ...NO_INPUT, shoot: t < 0.1 } : { ...NO_INPUT, jump: t > 0.05 && t < 0.1 }))
        },
        (g) => g.phase !== 'live' || t > 3,
      )
      if (events.some((e) => e.type === 'block')) blocked++
    }
    expect(blocked).toBeGreaterThan(3)
    expect(blocked).toBeLessThan(25)
  })
})

describe('street rules', () => {
  it('a defence that wins the ball must take it back beyond the arc before shooting', () => {
    const game = alone(0, 4)
    // The defender is handed the ball close to the basket, as a defensive rebound would.
    game.ball.holder = null
    game.ball.releasedBy = 0
    game.ball.sinceRelease = 1
    game.ball.shot = null
    const defender = game.players[1]!
    defender.x = game.ball.x = 0.5
    defender.z = game.ball.z = 3
    game.ball.y = 1
    step(game, idle(game))
    expect(game.ball.holder).toBe(1)
    expect(game.offense).toBe(1)
    expect(game.mustClear).toBe(true)
    // Pressing shoot does nothing yet.
    step(game, game.players.map((p) => (p.id === 1 ? { ...NO_INPUT, shoot: true } : NO_INPUT)))
    expect(defender.shootT).toBeNull()
    // Out beyond the arc, it is cleared.
    const events = run(
      game,
      (g) => g.players.map((p) => (p.id === 1 ? { ...NO_INPUT, mz: 1 } : NO_INPUT)),
      (g) => !g.mustClear,
      60 * 4,
    )
    expect(events.some((e) => e.type === 'cleared')).toBe(true)
    expect(fromRim(defender.x, defender.z)).toBeGreaterThan(ARC)
  })

  it('holding the ball for twelve seconds gives it away', () => {
    const game = alone(0, 8)
    const events = run(game, idle, (g) => g.offense === 1, 60 * 14)
    expect(events).toContainEqual({ type: 'turnover', reason: 'shot_clock' })
  })

  it('a ball out of bounds goes to the side that did not touch it last', () => {
    const game = alone(0, 8)
    game.ball.holder = null
    game.ball.lastTouch = 0
    game.ball.x = 7.9
    game.ball.y = 0.5
    game.ball.z = 5
    step(game, idle(game))
    expect(game.events).toContainEqual({ type: 'turnover', reason: 'out' })
    expect(game.offense).toBe(1)
  })
})

describe('whole games', () => {
  it('two computer players finish a game, first to 11, without the ball ever leaving the world', () => {
    for (const seed of [3, 11, 29]) {
      const game = newGame(seed)
      const minds = [newMind(seed), newMind(seed + 1)]
      for (let i = 0; i < 60 * 60 * 20 && game.phase !== 'over'; i++) {
        step(game, game.players.map((p) => think(game, p.id, levelById(p.id === 0 ? 'hard' : 'medium'), minds[p.id]!)))
        expect(Number.isFinite(game.ball.x + game.ball.y + game.ball.z)).toBe(true)
        expect(game.ball.y).toBeGreaterThan(0)
        expect(game.ball.y).toBeLessThan(15)
      }
      expect(game.phase).toBe('over')
      expect(Math.max(...game.score)).toBeGreaterThanOrEqual(TO_WIN)
      expect(game.score[game.winner!]).toBeGreaterThanOrEqual(TO_WIN)
    }
  }, 60_000)

  it('a copy of a game plays on exactly like the original', () => {
    const game = newGame(5)
    run(game, idle, (g) => g.phase === 'live', 200)
    const copy = cloneGame(game)
    for (let i = 0; i < 300; i++) {
      step(game, idle(game))
      step(copy, idle(copy))
    }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(game))
  })
})
