import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Color, type PlayedMove, START_FEN } from '../engine/chessLogic'
import { ChessEngine } from '../engine/stockfish'
import { finishedEval, type MoveReview, type PositionEval, reviewGame, type ReviewSummary, summarise, toWhiteView } from './analysis'

// Runs the chess engine over a finished game, one position after another, on the player's own
// device. Only ever started once a game is over: there is no engine anywhere near a live game.

/** Deep enough to catch what a club player would call a mistake, quick enough for a budget phone. */
const LIMITS = { depth: 12, moveTimeMs: 450 }

export type ReviewStatus = 'idle' | 'running' | 'done' | 'failed'
export type GameReview = {
  status: ReviewStatus
  /** 0 to 1 while running. */
  progress: number
  /** One entry per move analysed so far. */
  moves: MoveReview[]
  /** The position after each move analysed so far (index 0 is the start), from White's side. */
  positions: PositionEval[]
  /** Set once the whole game has been analysed. */
  summary: ReviewSummary | null
  start: () => void
}

// Finished analyses, so stepping away and back (or reopening the result) costs nothing.
const cache = new Map<string, PositionEval[]>()
const remember = (key: string, positions: PositionEval[]) => {
  cache.set(key, positions)
  if (cache.size > 6) cache.delete(cache.keys().next().value!)
}

const IDLE: { status: ReviewStatus; positions: PositionEval[] } = { status: 'idle', positions: [] }

export function useGameReview(played: readonly PlayedMove[], over: boolean): GameReview {
  const key = useMemo(() => played.map((move) => move.uci).join(' '), [played])
  const [state, setState] = useState<{ key: string; status: ReviewStatus; positions: PositionEval[] }>({ key: '', status: 'idle', positions: [] })
  const engine = useRef<ChessEngine | null>(null)
  const run = useRef(0)

  const stop = useCallback(() => {
    run.current++
    engine.current?.dispose()
    engine.current = null
  }, [])

  // A new game, a rematch, or a move taken back: whatever was analysed no longer applies.
  useEffect(() => {
    const done = over ? cache.get(key) : undefined
    setState({ key, status: done ? 'done' : 'idle', positions: done ?? [] })
    return stop
  }, [key, over, stop])

  const start = useCallback(() => {
    if (!over || played.length === 0 || engine.current || cache.has(key)) return
    const id = ++run.current
    const mine = new ChessEngine()
    engine.current = mine
    setState({ key, status: 'running', positions: [] })

    void (async () => {
      const positions: PositionEval[] = []
      try {
        for (let i = 0; i <= played.length; i++) {
          const fen = i === 0 ? START_FEN : played[i - 1]!.fenAfter
          const position = finishedEval(fen) ?? toWhiteView(await mine.analyse(fen, LIMITS), fen.split(' ')[1] as Color)
          if (run.current !== id) return
          positions.push(position)
          setState({ key, status: 'running', positions: [...positions] })
        }
        remember(key, positions)
        setState({ key, status: 'done', positions })
      } catch {
        if (run.current === id) setState({ key, status: 'failed', positions: [] })
      } finally {
        if (engine.current === mine) {
          mine.dispose()
          engine.current = null
        }
      }
    })()
  }, [key, over, played])

  const current = state.key === key ? state : IDLE
  const moves = useMemo(() => reviewGame(played, current.positions), [played, current.positions])
  const summary = useMemo(() => (current.status === 'done' ? summarise(moves) : null), [current.status, moves])

  return {
    status: current.status,
    progress: played.length === 0 ? 0 : Math.min(1, current.positions.length / (played.length + 1)),
    moves,
    positions: current.positions,
    summary,
    start,
  }
}
