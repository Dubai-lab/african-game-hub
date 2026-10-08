import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/core/ui/Button'
import type { Color, Outcome, PieceSymbol, PlayedMove } from '../engine/chessLogic'
import { type ClockState, formatClock, LOW_TIME_MS, remainingMs, TENTHS_BELOW_MS } from '../engine/clock'
import type { PieceSet } from '../pieces/usePieceSet'
import type { Grade } from '../review/analysis'
import { GRADE_STYLE, ReviewProgress, ReviewTiles } from '../review/ReviewPanel'
import type { GameReview } from '../review/useGameReview'

/**
 * One player's clock. It counts down smoothly on the device between updates, but it only ever
 * shows what follows from the clock values it is given: it never decides that time has run out.
 */
export function Clock({ clock, color }: { clock: ClockState; color: Color }) {
  const { t } = useTranslation()
  const active = clock.running === color
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    let frame = 0
    let last = 0
    const tick = (time: number) => {
      // Ten updates a second is enough for tenths, and far cheaper than every frame.
      if (time - last >= 100) {
        last = time
        setNow(Date.now())
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, clock.since])

  const left = remainingMs(clock, color, now)
  const low = left <= LOW_TIME_MS
  return (
    <div
      role="timer"
      aria-label={t(color === 'w' ? 'chess.clockWhite' : 'chess.clockBlack')}
      data-testid={`clock-${color}`}
      data-active={active}
      className={`min-w-[5.5rem] px-3 py-1.5 text-end font-sans text-2xl font-bold tabular-nums ${
        low ? 'bg-hibiscus text-white' : active ? 'bg-brand text-brand-ink' : 'bg-line/60 text-muted'
      } ${left < TENTHS_BELOW_MS ? 'min-w-[6.5rem]' : ''}`}
    >
      {formatClock(left)}
    </div>
  )
}

const VALUE_ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p']

type PlayerCardProps = {
  name: string
  color: Color
  flag?: string
  rating?: number
  /** Pieces this player has taken (they belong to the other colour). */
  captured: PieceSymbol[]
  lead: number
  /** Left out in untimed games. */
  clock?: ClockState
  toMove: boolean
  pieceSet: PieceSet
}

export function PlayerCard({ name, color, flag, rating, captured, lead, clock, toMove, pieceSet }: PlayerCardProps) {
  const theirs = color === 'w' ? 'b' : 'w'
  const sorted = [...captured].sort((a, b) => VALUE_ORDER.indexOf(a) - VALUE_ORDER.indexOf(b))
  return (
    <div className="flex items-center gap-3" data-testid={`player-${color}`}>
      <div
        aria-hidden="true"
        className={`flex size-11 shrink-0 items-center justify-center border-2 font-display text-lg font-extrabold ${
          color === 'w' ? 'border-ink bg-panel text-ink' : 'border-ink bg-ink text-surface'
        }`}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 truncate font-bold">
          {flag && <span aria-hidden="true">{flag}</span>}
          <span className="truncate">{name}</span>
          {rating !== undefined && <span className="text-sm font-semibold tabular-nums text-muted">{rating}</span>}
          {toMove && <span className="size-2 shrink-0 rounded-full bg-palm" aria-hidden="true" />}
        </p>
        <p className="flex h-5 items-center" data-testid={`captured-${color}`}>
          {sorted.map((piece, index) => (
            <img
              key={index}
              src={pieceSet.urls[theirs + piece.toUpperCase()]}
              alt=""
              className={`size-5 ${index > 0 && sorted[index - 1] === piece ? '-ms-2.5' : index > 0 ? '-ms-0.5' : ''}`}
            />
          ))}
          {lead > 0 && <span className="ms-1.5 text-sm font-bold tabular-nums text-muted">+{lead}</span>}
        </p>
      </div>
      {clock && <Clock clock={clock} color={color} />}
    </div>
  )
}

type MoveListProps = {
  played: PlayedMove[]
  /** The ply being shown on the board (0 is the starting position). */
  viewPly: number
  onView: (ply: number) => void
  /** Game review: how good each move was (index 0 is the first move). */
  grades?: (Grade | undefined)[]
}

/** Moves in standard notation, with buttons to step back and forward through the game. */
export function MoveList({ played, viewPly, onView, grades }: MoveListProps) {
  const { t } = useTranslation()
  const current = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [viewPly, played.length])

  const step = 'flex size-11 shrink-0 items-center justify-center border-2 border-line bg-panel text-xl font-bold disabled:opacity-40'
  return (
    // Phone: one scrolling line with a step button at each end.
    // Computer: a two-column list (White, Black) that fills the panel, with the step buttons under it.
    // (On a computer the list always keeps room for a few rows, however much else the panel holds.)
    <div className="flex shrink-0 items-center gap-2 lg:grid lg:min-h-48 lg:flex-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)_auto] lg:items-stretch">
      <button
        type="button"
        className={`${step} lg:col-start-1 lg:row-start-2 lg:w-full`}
        disabled={viewPly === 0}
        onClick={() => onView(viewPly - 1)}
        aria-label={t('chess.moves.previous')}
      >
        ‹<span className="ms-2 hidden text-sm lg:inline">{t('chess.moves.previousShort')}</span>
      </button>
      <ol
        className="flex min-h-11 flex-1 items-center gap-x-1 overflow-x-auto whitespace-nowrap border-2 border-line bg-panel px-2 lg:col-span-2 lg:row-start-1 lg:grid lg:min-h-0 lg:grid-cols-2 lg:content-start lg:items-stretch lg:gap-x-3 lg:gap-y-0.5 lg:overflow-y-auto lg:overflow-x-hidden lg:bg-surface lg:p-2"
        aria-label={t('chess.moves.title')}
      >
        {played.length === 0 && <li className="text-sm text-muted lg:col-span-2">{t('chess.moves.none')}</li>}
        {played.map((move) => (
          <li key={move.ply} className="flex items-center">
            {move.color === 'w' && <span className="me-1 text-sm tabular-nums text-muted lg:w-8">{(move.ply + 1) / 2}.</span>}
            <button
              type="button"
              ref={move.ply === viewPly ? current : undefined}
              aria-current={move.ply === viewPly ? 'step' : undefined}
              onClick={() => onView(move.ply)}
              className={`min-h-9 px-1.5 text-base font-semibold lg:flex-1 lg:text-start ${move.ply === viewPly ? 'bg-primary text-surface' : 'lg:hover:bg-line/60'}`}
            >
              {move.san}
              {grades?.[move.ply - 1] && grades[move.ply - 1] !== 'good' && grades[move.ply - 1] !== 'excellent' && grades[move.ply - 1] !== 'best' && (
                <span
                  className="ms-0.5 text-sm font-extrabold"
                  style={{ color: move.ply === viewPly ? undefined : GRADE_STYLE[grades[move.ply - 1]!].color }}
                  data-grade={grades[move.ply - 1]}
                >
                  {GRADE_STYLE[grades[move.ply - 1]!].mark}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className={`${step} lg:col-start-2 lg:row-start-2 lg:w-full`}
        disabled={viewPly >= played.length}
        onClick={() => onView(viewPly + 1)}
        aria-label={t('chess.moves.next')}
      >
        <span className="me-2 hidden text-sm lg:inline">{t('chess.moves.nextShort')}</span>›
      </button>
    </div>
  )
}

/** A small in-page dialog (confirm resign, answer a draw offer). No browser pop-ups. */
export function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:border-4"
      >
        <h2 className="font-display text-2xl font-extrabold text-primary">{title}</h2>
        {children}
      </div>
    </div>
  )
}

type GameOverProps = {
  outcome: Outcome
  /** Shown from this side's point of view ("You won"); null for a neutral view of a local game. */
  perspective: Color | null
  /** Rated games: the player's rating after this game, and how much it moved. */
  rating?: number
  ratingChange?: number
  /** Staked games only. */
  tokensChange?: number
  /** The engine's review of the game; absent when there is nothing to review. */
  review?: GameReview
  /** What to do next: play again, rematch, new game. */
  actions: React.ReactNode
  onReview: () => void
  onClose: () => void
}

/** The result, the moment a game ends: who won and why, what it cost or earned, how well it was played, and what next. */
export function GameOverSheet({ outcome, perspective, rating, ratingChange, tokensChange, review, actions, onReview, onClose }: GameOverProps) {
  const { t } = useTranslation()
  const title =
    outcome.reason === 'aborted' || outcome.reason === 'called_off'
      ? t('chess.over.aborted')
      : outcome.winner === null
      ? t('chess.over.draw')
      : perspective === null
        ? t(outcome.winner === 'w' ? 'chess.over.whiteWins' : 'chess.over.blackWins')
        : t(outcome.winner === perspective ? 'chess.over.youWon' : 'chess.over.youLost')
  const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '±0')
  const tone = (value: number) => (value > 0 ? 'text-palm' : value < 0 ? 'text-hibiscus' : 'text-muted')
  const mine = perspective && review?.summary ? review.summary[perspective] : null

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="mt-1 text-muted" data-testid="game-over-reason">
        {t(`chess.over.reason.${outcome.reason}`)}
      </p>

      {(tokensChange !== undefined || ratingChange !== undefined) && (
        <dl className="mt-4 grid grid-cols-2 gap-4 border-y-2 border-line py-3">
          {ratingChange !== undefined && (
            <div className="flex flex-col-reverse" data-testid="game-over-rating">
              <dt className="text-sm text-muted">{t('chess.over.rating')}</dt>
              <dd className="flex items-baseline gap-2 font-display text-3xl font-extrabold tabular-nums">
                {rating ?? ''}
                <span className={`text-lg ${tone(ratingChange)}`}>{signed(ratingChange)}</span>
              </dd>
            </div>
          )}
          {tokensChange !== undefined && (
            <div className="flex flex-col-reverse" data-testid="game-over-tokens">
              <dt className="text-sm text-muted">{t('chess.over.tokens')}</dt>
              <dd className={`font-display text-3xl font-extrabold tabular-nums ${tone(tokensChange)}`}>{signed(tokensChange)}</dd>
            </div>
          )}
        </dl>
      )}

      {review && (
        <div className="mt-4 flex flex-col gap-3">
          {review.status === 'running' && <ReviewProgress review={review} />}
          {mine && (
            <>
              <p className="text-sm font-semibold">
                {t('chess.review.yourAccuracy')} <span className="font-display text-xl font-extrabold tabular-nums">{mine.accuracy.toFixed(1)}</span>
              </p>
              <ReviewTiles side={mine} />
            </>
          )}
          <Button onClick={onReview} className="min-h-14 text-lg">
            {t('chess.review.open')}
          </Button>
        </div>
      )}

      <div className="mt-3">{actions}</div>
      {!review && (
        <button type="button" onClick={onClose} className="mt-2 min-h-11 w-full font-semibold text-primary underline underline-offset-4">
          {t('chess.over.close')}
        </button>
      )}
    </Sheet>
  )
}
