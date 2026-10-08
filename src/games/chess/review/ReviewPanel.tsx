import { useTranslation } from 'react-i18next'
import { Button } from '@/core/ui/Button'
import type { Color, PlayedMove } from '../engine/chessLogic'
import { formatEval, GRADES, type Grade, type SideSummary, winChance } from './analysis'
import type { GameReview } from './useGameReview'

/** One mark and one colour per grade, used on the move list, the board and the tables. */
export const GRADE_STYLE: Record<Grade, { mark: string; color: string }> = {
  brilliant: { mark: '!!', color: '#0b8fa3' },
  best: { mark: '★', color: '#0b7a55' },
  excellent: { mark: '✓', color: '#4f8f24' },
  good: { mark: '•', color: '#5b6b8c' },
  inaccuracy: { mark: '?!', color: '#b88a00' },
  mistake: { mark: '?', color: '#d9730d' },
  miss: { mark: '✕', color: '#d1264f' },
  blunder: { mark: '??', color: '#9e1030' },
}

export function GradeMark({ grade, className = '' }: { grade: Grade; className?: string }) {
  const style = GRADE_STYLE[grade]
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.7rem] font-extrabold leading-none text-white ${className}`}
      style={{ backgroundColor: style.color }}
    >
      {style.mark}
    </span>
  )
}

export function ReviewProgress({ review }: { review: GameReview }) {
  const { t } = useTranslation()
  const percent = Math.round(review.progress * 100)
  return (
    <div role="status" data-testid="review-progress">
      <p className="text-sm font-semibold text-muted">{t('chess.review.analysing', { percent })}</p>
      <div className="mt-1 h-2 bg-line" aria-hidden="true">
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** The three numbers on the result card: what went well, and what did not. */
export function ReviewTiles({ side }: { side: SideSummary }) {
  const { t } = useTranslation()
  const tiles: { grade: Grade; label: string; count: number }[] = [
    { grade: 'best', label: t('chess.review.grade.best'), count: side.counts.best + side.counts.brilliant },
    { grade: 'excellent', label: t('chess.review.grade.excellent'), count: side.counts.excellent },
    { grade: 'blunder', label: t('chess.review.mistakes'), count: side.counts.mistake + side.counts.miss + side.counts.blunder },
  ]
  return (
    <dl className="grid grid-cols-3 gap-2" data-testid="review-tiles">
      {tiles.map((tile) => (
        <div key={tile.grade} className="flex flex-col items-center border-2 border-line bg-surface px-1 py-2">
          <dd className="flex items-center gap-1.5 font-display text-2xl font-extrabold tabular-nums" style={{ color: GRADE_STYLE[tile.grade].color }}>
            <GradeMark grade={tile.grade} />
            {tile.count}
          </dd>
          <dt className="text-xs font-semibold text-muted">{tile.label}</dt>
        </div>
      ))}
    </dl>
  )
}

type PanelProps = {
  review: GameReview
  played: readonly PlayedMove[]
  /** The ply shown on the board (0 is the starting position). */
  shownPly: number
  names: Record<Color, string>
  /**
   * Which half to draw, so the screen can put the move list between them: 'now' is the
   * position on the board (who is better, and the verdict on the move), 'summary' the whole
   * game (accuracy and the count of each grade).
   */
  part: 'now' | 'summary'
}

/** Game review beside the board: who is better, accuracy, every grade counted, and a note on the move shown. */
export function ReviewPanel({ review, played, shownPly, names, part }: PanelProps) {
  const { t } = useTranslation()
  if (part === 'summary' && !review.summary) return null

  if (review.status === 'idle') {
    return <Button onClick={review.start}>{t('chess.review.start')}</Button>
  }
  if (review.status === 'failed') {
    return (
      <div className="flex flex-col gap-2" role="alert">
        <p className="text-sm font-semibold text-hibiscus">{t('chess.review.failed')}</p>
        <Button variant="ghost" onClick={review.start}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  const position = review.positions[shownPly]
  const move = shownPly > 0 ? played[shownPly - 1] : undefined
  const graded = shownPly > 0 ? review.moves[shownPly - 1] : undefined
  const whiteShare = position ? winChance(position.cp) : 50

  return (
    <section aria-label={t(part === 'now' ? 'chess.review.title' : 'chess.review.summary')} className="flex shrink-0 flex-col gap-2" data-testid={`review-${part}`}>
      {part === 'now' && (
        <>
      {review.status === 'running' && <ReviewProgress review={review} />}

      {/* Who is better in the position on the board: the light part is White's share. */}
      <div className="flex items-center gap-2">
        <div className="relative h-4 flex-1 border-2 border-ink bg-ink" role="img" aria-label={t('chess.review.balance', { score: position ? formatEval(position) : '…' })}>
          <div className="h-full bg-panel transition-[width] duration-300" style={{ width: `${whiteShare}%` }} />
        </div>
        <span className="w-12 text-end text-sm font-bold tabular-nums" data-testid="review-eval">
          {position ? formatEval(position) : '…'}
        </span>
      </div>

      <p className="min-h-10 text-sm" data-testid="review-note">
        {move && graded ? (
          <>
            <GradeMark grade={graded.grade} className="me-1.5 align-middle" />
            <strong>
              {Math.ceil(move.ply / 2)}
              {move.color === 'w' ? '.' : '…'} {move.san}
            </strong>{' '}
            {t(`chess.review.note.${graded.grade}`)}
            {graded.better && <> {t('chess.review.better', { move: graded.better.san })}</>}
          </>
        ) : move ? (
          <span className="text-muted">{t('chess.review.waiting')}</span>
        ) : (
          <span className="text-muted">{t('chess.review.hint')}</span>
        )}
      </p>

        </>
      )}

      {part === 'summary' && review.summary && (
        <table className="w-full text-sm leading-tight tabular-nums" data-testid="review-table">
          <thead>
            <tr className="font-semibold">
              <th scope="col" className="w-1/3 truncate text-start font-semibold">
                {names.w}
              </th>
              <td />
              <th scope="col" className="w-1/3 truncate text-end font-semibold">
                {names.b}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b-2 border-line font-display text-xl font-extrabold">
              <td data-testid="accuracy-w">{review.summary.w.accuracy.toFixed(1)}</td>
              <th scope="row" className="text-center font-sans text-xs font-semibold text-muted">
                {t('chess.review.accuracy')}
              </th>
              <td className="text-end" data-testid="accuracy-b">
                {review.summary.b.accuracy.toFixed(1)}
              </td>
            </tr>
            {GRADES.map((grade) => (
              <tr key={grade} style={{ color: GRADE_STYLE[grade].color }}>
                <td className="font-bold">{review.summary!.w.counts[grade]}</td>
                <th scope="row" className="py-0.5 text-center font-semibold">
                  <GradeMark grade={grade} className="me-1.5" />
                  {t(`chess.review.grade.${grade}`)}
                </th>
                <td className="text-end font-bold">{review.summary!.b.counts[grade]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
