import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ClockState, newClock, pressClock, remainingMs, stopClock, TENTHS_BELOW_MS } from '@/games/chess/engine/clock'
import { applyMove, type Color, type DraughtsState, type Played, replay } from '../../../supabase/functions/_shared/draughts'
import { feedback } from './sound'

export type Outcome = { winner: Color | null; reason: string }

/**
 * What the draughts table needs from whoever is running the game. A practice game on this
 * device and an online game both provide this same shape, so they share one screen.
 */
export type DraughtsController = {
  state: DraughtsState
  played: Played[]
  turn: Color
  clock: ClockState
  outcome: Outcome | null
  drawOfferBy: Color | null
  /** Plays the move that visits these squares. False when there is no such move just now. */
  tryMove: (path: number[]) => boolean
  resign: (color: Color) => void
  offerDraw: (color: Color) => void
  respondToDraw: (accept: boolean) => void
}

type Config = {
  baseMs: number
  incrementMs: number
  /** False for untimed practice: the clocks never start. */
  timed?: boolean
  /** Where to keep the game on this device, so that a refresh (or a closed tab) does not lose it. */
  saveKey?: string
}

type GameState = { paths: number[][]; clock: ClockState; outcome: Outcome | null }

const fresh = (config: Config): GameState => ({ paths: [], clock: newClock(config.baseMs, config.incrementMs), outcome: null })
const other = (color: Color): Color => (color === 'w' ? 'b' : 'w')
const START = replay([])!

/** A game saved earlier under this key, if it is whole and still being played. */
function saved(key: string | undefined): GameState | null {
  if (!key) return null
  try {
    const state = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<GameState> | null
    if (!state || state.outcome || !Array.isArray(state.paths) || typeof state.clock !== 'object' || state.clock === null) return null
    // Must be a game that can really be played through from the start, and is not over.
    const game = replay(state.paths)
    if (!game || game.result) return null
    return { paths: state.paths, clock: state.clock, outcome: null }
  } catch {
    return null
  }
}

/** A whole game of draughts played on this device: the rules, the clocks and resignation. */
export function useLocalDraughtsGame(config: Config) {
  const [state, setState] = useState<GameState>(() => saved(config.saveKey) ?? fresh(config))
  // Written down after every move; forgotten once the game is over.
  const saveKey = config.saveKey
  useEffect(() => {
    if (!saveKey) return
    try {
      if (state.outcome) localStorage.removeItem(saveKey)
      else localStorage.setItem(saveKey, JSON.stringify(state))
    } catch {
      // Private browsing: the game simply is not kept.
    }
  }, [state, saveKey])
  // Callbacks read the latest state from here, so a fast second tap never acts on a stale game.
  const live = useRef(state)
  const commit = useCallback((next: GameState) => {
    live.current = next
    setState(next)
  }, [])
  const warned = useRef<Record<Color, boolean>>({ w: false, b: false })
  const timed = config.timed !== false

  const game = useMemo(() => replay(state.paths) ?? START, [state.paths])

  const finish = useCallback(
    (outcome: Outcome) => {
      const current = live.current
      if (current.outcome) return
      commit({ ...current, outcome, clock: stopClock(current.clock, Date.now()) })
      feedback('gameEnd')
    },
    [commit],
  )

  const tryMove = useCallback(
    (path: number[]): boolean => {
      const before = live.current
      if (before.outcome) return false
      const position = replay(before.paths)
      const step = position && applyMove(position.state, path)
      if (!step) return false

      const now = Date.now()
      const clock = timed ? pressClock(before.clock, step.move.color, now) : before.clock
      commit({ paths: [...before.paths, step.move.path], clock: step.result ? stopClock(clock, now) : clock, outcome: step.result })
      feedback(step.move.promoted ? 'promote' : step.move.captures.length > 0 ? 'capture' : 'move')
      if (step.result) setTimeout(() => feedback('gameEnd'), 260)
      return true
    },
    [commit, timed],
  )

  // The device watches the clocks in a practice game: time running out, and the warning before it.
  const running = state.clock.running
  const over = state.outcome !== null
  useEffect(() => {
    if (!running || over) return
    const id = setInterval(() => {
      const current = live.current
      const side = current.clock.running
      if (!side || current.outcome) return
      const left = remainingMs(current.clock, side, Date.now())
      if (left <= 0) finish({ winner: other(side), reason: 'timeout' })
      else if (left <= TENTHS_BELOW_MS && !warned.current[side]) {
        warned.current[side] = true
        feedback('lowTime')
      }
    }, 100)
    return () => clearInterval(id)
  }, [running, over, finish])

  const resign = useCallback((color: Color) => finish({ winner: other(color), reason: 'resignation' }), [finish])

  /** Takes back the last `plies` moves. For practice games only; the clocks are left as they are. */
  const undo = useCallback(
    (plies: number) => {
      const current = live.current
      if (current.outcome || plies <= 0 || current.paths.length === 0) return
      commit({ ...current, paths: current.paths.slice(0, Math.max(0, current.paths.length - plies)) })
    },
    [commit],
  )

  const restart = useCallback(
    (next: Config = config) => {
      warned.current = { w: false, b: false }
      commit(fresh(next))
    },
    [commit, config],
  )

  const controller: DraughtsController = {
    state: game.state,
    played: game.played,
    turn: game.state.turn,
    clock: state.clock,
    outcome: state.outcome,
    drawOfferBy: null,
    tryMove,
    resign,
    // The computer does not bargain: draws by agreement are for games between people.
    offerDraw: () => undefined,
    respondToDraw: () => undefined,
  }
  return { ...controller, undo, restart }
}
