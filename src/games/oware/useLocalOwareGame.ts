import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ClockState, newClock, pressClock, remainingMs, stopClock, TENTHS_BELOW_MS } from '@/games/chess/engine/clock'
import { applyMove, type OwareState, type Played, replay, type Side } from '../../../supabase/functions/_shared/oware'
import { feedback } from './sound'

export type Outcome = { winner: Side | null; reason: string }

/** The shared clock speaks of white and black; Oware's South moves first, as White does. */
export const clockColor = (side: Side): 'w' | 'b' => (side === 's' ? 'w' : 'b')

/**
 * What the Oware table needs from whoever is running the game. A practice game on this device
 * and an online game both provide this same shape, so they share one screen.
 */
export type OwareController = {
  state: OwareState
  played: Played[]
  turn: Side
  clock: ClockState
  outcome: Outcome | null
  drawOfferBy: Side | null
  /** Plays this pit. False when it may not be played just now. */
  tryMove: (pit: number) => boolean
  resign: (side: Side) => void
  offerDraw: (side: Side) => void
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

type GameState = { moves: number[]; clock: ClockState; outcome: Outcome | null }

const fresh = (config: Config): GameState => ({ moves: [], clock: newClock(config.baseMs, config.incrementMs), outcome: null })
const START = replay([])!

/** A game saved earlier under this key, if it is whole and still being played. */
function saved(key: string | undefined): GameState | null {
  if (!key) return null
  try {
    const state = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<GameState> | null
    if (!state || state.outcome || !Array.isArray(state.moves) || typeof state.clock !== 'object' || state.clock === null) return null
    // Must be a game that can really be played through from the start, and is not over.
    const game = replay(state.moves)
    if (!game || game.result) return null
    return { moves: state.moves, clock: state.clock, outcome: null }
  } catch {
    return null
  }
}

/** A whole game of Oware played on this device: the rules, the clocks and resignation. */
export function useLocalOwareGame(config: Config) {
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
  const warned = useRef<Record<Side, boolean>>({ s: false, n: false })
  const timed = config.timed !== false

  const game = useMemo(() => replay(state.moves) ?? START, [state.moves])

  const finish = useCallback(
    (outcome: Outcome) => {
      const current = live.current
      if (current.outcome) return
      commit({ ...current, outcome, clock: stopClock(current.clock, Date.now()) })
    },
    [commit],
  )

  const tryMove = useCallback(
    (pit: number): boolean => {
      const before = live.current
      if (before.outcome) return false
      const position = replay(before.moves)
      const step = position && applyMove(position.state, pit)
      if (!step) return false

      const now = Date.now()
      const clock = timed ? pressClock(before.clock, clockColor(step.move.side), now) : before.clock
      // The board plays the move out, with its sounds; the table sounds the end of the game.
      commit({ moves: [...before.moves, pit], clock: step.result ? stopClock(clock, now) : clock, outcome: step.result })
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
      const color = current.clock.running
      if (!color || current.outcome) return
      const side: Side = color === 'w' ? 's' : 'n'
      const left = remainingMs(current.clock, color, Date.now())
      if (left <= 0) finish({ winner: side === 's' ? 'n' : 's', reason: 'timeout' })
      else if (left <= TENTHS_BELOW_MS && !warned.current[side]) {
        warned.current[side] = true
        feedback('lowTime')
      }
    }, 100)
    return () => clearInterval(id)
  }, [running, over, finish])

  const resign = useCallback((side: Side) => finish({ winner: side === 's' ? 'n' : 's', reason: 'resignation' }), [finish])

  /** Takes back the last `plies` moves. For practice games only; the clocks are left as they are. */
  const undo = useCallback(
    (plies: number) => {
      const current = live.current
      if (current.outcome || plies <= 0 || current.moves.length === 0) return
      commit({ ...current, moves: current.moves.slice(0, Math.max(0, current.moves.length - plies)) })
    },
    [commit],
  )

  const restart = useCallback(
    (next: Config = config) => {
      warned.current = { s: false, n: false }
      commit(fresh(next))
    },
    [commit, config],
  )

  const controller: OwareController = {
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
