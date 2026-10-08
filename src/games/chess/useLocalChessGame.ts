import type { Chess } from 'chess.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import i18n from '@/core/i18n'
import { toast } from '@/core/ui/toast'
import {
  boardOutcome,
  type Color,
  needsPromotion,
  type Outcome,
  type PlayedMove,
  type Promotion,
  replay,
  sanFor,
  type Square,
  timeoutOutcome,
} from './engine/chessLogic'
import { type ClockState, newClock, pressClock, remainingMs, stopClock, TENTHS_BELOW_MS } from './engine/clock'
import { feedback } from './sound/sounds'

export type MoveResult = 'ok' | 'illegal' | 'promotion'

/**
 * What the chess table needs from whoever is running the game. Local games, games against the
 * computer and online games all provide this same shape, so they share one screen.
 */
export type ChessGameController = {
  chess: Chess
  played: PlayedMove[]
  turn: Color
  clock: ClockState
  outcome: Outcome | null
  drawOfferBy: Color | null
  tryMove: (from: Square, to: Square, promotion?: Promotion) => MoveResult
  resign: (color: Color) => void
  offerDraw: (color: Color) => void
  respondToDraw: (accept: boolean) => void
}

/**
 * Whoever has the final say on a move. A move is shown at once (optimistic) and then put to the
 * referee; if the referee says no, the move is taken back with a short message. Local games
 * have no referee. Online games will use the server as theirs.
 */
export type Referee = (move: PlayedMove) => Promise<{ ok: true } | { ok: false; messageKey?: string }>

type Config = {
  baseMs: number
  incrementMs: number
  /** False for untimed practice: the clocks never start. */
  timed?: boolean
  referee?: Referee
}

type GameState = {
  sans: string[]
  clock: ClockState
  outcome: Outcome | null
  drawOfferBy: Color | null
}

const fresh = (config: Config): GameState => ({
  sans: [],
  clock: newClock(config.baseMs, config.incrementMs),
  outcome: null,
  drawOfferBy: null,
})

const other = (color: Color): Color => (color === 'w' ? 'b' : 'w')

/** A whole game of chess played on one device: both sides, clocks, draw offers and resignation. */
export function useLocalChessGame(config: Config) {
  const [state, setState] = useState<GameState>(() => fresh(config))
  // Callbacks read the latest state from here, so a fast second tap never acts on a stale game.
  const live = useRef(state)
  const commit = useCallback((next: GameState) => {
    live.current = next
    setState(next)
  }, [])
  const referee = useRef(config.referee)
  referee.current = config.referee
  const warned = useRef<Record<Color, boolean>>({ w: false, b: false })
  const timed = config.timed !== false

  const { chess, played } = useMemo(() => replay(state.sans), [state.sans])

  const finish = useCallback(
    (outcome: Outcome) => {
      const current = live.current
      if (current.outcome) return
      commit({ ...current, outcome, clock: stopClock(current.clock, Date.now()), drawOfferBy: null })
      feedback('gameEnd')
    },
    [commit],
  )

  const tryMove = useCallback(
    (from: Square, to: Square, promotion?: Promotion): MoveResult => {
      const before = live.current
      if (before.outcome) return 'illegal'
      const position = replay(before.sans).chess
      if (!promotion && needsPromotion(position, from, to)) return 'promotion'
      const san = sanFor(position, from, to, promotion)
      if (!san) return 'illegal'

      const now = Date.now()
      const after = replay([...before.sans, san])
      const move = after.played.at(-1)!
      const end = boardOutcome(after.chess)
      const clock = timed ? pressClock(before.clock, move.color, now) : before.clock
      commit({
        sans: [...before.sans, san],
        clock: end ? stopClock(clock, now) : clock,
        outcome: end,
        // Playing on declines any draw offer on the table.
        drawOfferBy: null,
      })
      feedback(move.check && !end ? 'check' : move.kind)
      if (end) setTimeout(() => feedback('gameEnd'), 260)

      const judge = referee.current
      if (judge) {
        const takeBack = (messageKey: string) => {
          // Only undo if nothing else has happened since.
          if (live.current.sans.length !== before.sans.length + 1 || live.current.sans.at(-1) !== san) return
          commit(before)
          toast.info(i18n.t(messageKey))
        }
        judge(move)
          .then((verdict) => {
            if (!verdict.ok) takeBack(verdict.messageKey ?? 'chess.moveRejected')
          })
          .catch(() => takeBack('chess.moveNotSent'))
      }
      return 'ok'
    },
    [commit, timed],
  )

  // The device watches the clocks in a local game: flag fall and the low-time warning.
  const running = state.clock.running
  const over = state.outcome !== null
  useEffect(() => {
    if (!running || over) return
    const id = setInterval(() => {
      const current = live.current
      const side = current.clock.running
      if (!side || current.outcome) return
      const left = remainingMs(current.clock, side, Date.now())
      if (left <= 0) {
        finish(timeoutOutcome(replay(current.sans).chess.fen(), side))
      } else if (left <= TENTHS_BELOW_MS && !warned.current[side]) {
        warned.current[side] = true
        feedback('lowTime')
      }
    }, 100)
    return () => clearInterval(id)
  }, [running, over, finish])

  const resign = useCallback((color: Color) => finish({ winner: other(color), reason: 'resignation' }), [finish])

  const offerDraw = useCallback(
    (color: Color) => {
      const current = live.current
      if (current.outcome || current.drawOfferBy) return
      commit({ ...current, drawOfferBy: color })
    },
    [commit],
  )

  const respondToDraw = useCallback(
    (accept: boolean) => {
      const current = live.current
      if (!current.drawOfferBy || current.outcome) return
      if (accept) finish({ winner: null, reason: 'agreement' })
      else commit({ ...current, drawOfferBy: null })
    },
    [commit, finish],
  )

  /** Takes back the last `plies` half-moves. For practice games only; the clocks are left as they are. */
  const undo = useCallback(
    (plies: number) => {
      const current = live.current
      if (current.outcome || plies <= 0 || current.sans.length === 0) return
      commit({ ...current, sans: current.sans.slice(0, Math.max(0, current.sans.length - plies)), drawOfferBy: null })
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

  return {
    chess,
    played,
    turn: chess.turn(),
    clock: state.clock,
    outcome: state.outcome,
    drawOfferBy: state.drawOfferBy,
    tryMove,
    resign,
    offerDraw,
    respondToDraw,
    undo,
    restart,
  }
}
