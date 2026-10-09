import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// The result of a game, shown the moment it ends: in the middle of the screen, the same for
// every game on the hub. Who won comes first and biggest, then why, then what it earned or
// cost, then what to do next. It can be closed to look at the board, and opened again.

export type ResultTone = 'win' | 'loss' | 'draw' | 'neutral'

const HEAD: Record<ResultTone, string> = {
  win: 'bg-brand text-brand-ink',
  loss: 'bg-ink text-surface',
  draw: 'bg-primary text-surface',
  neutral: 'bg-line text-ink',
}

/** Our own small marks: a star for a win, a lowered flag for a loss, level bars for a draw. */
function Emblem({ tone }: { tone: ResultTone }) {
  return (
    <svg viewBox="0 0 48 48" className="size-14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <circle cx="24" cy="24" r="21" strokeWidth="2.5" opacity="0.35" />
      {tone === 'win' && <path d="M24 10l4.2 8.6 9.4 1.3-6.8 6.6 1.6 9.4L24 31.4l-8.4 4.5 1.6-9.4-6.8-6.6 9.4-1.3z" fill="currentColor" stroke="none" />}
      {tone === 'loss' && (
        <>
          <path d="M16 36V13" />
          <path d="M16 14h17l-4 6 4 6H16z" fill="currentColor" />
        </>
      )}
      {tone === 'draw' && <path d="M14 19h20M14 29h20" strokeWidth="4.5" />}
      {tone === 'neutral' && <path d="M15 24h18" strokeWidth="4.5" />}
    </svg>
  )
}

type Props = {
  /** "You won", "Draw", "White wins". */
  title: string
  tone: ResultTone
  /** Why the game ended: "By checkmate." */
  reason: ReactNode
  /** The numbers (see ResultStat), then the buttons. */
  children?: ReactNode
  onClose: () => void
  /** The words on the way out, for example "Look at the board". */
  closeLabel: string
}

export function ResultDialog({ title, tone, reason, children, onClose, closeLabel }: Props) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/65 p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="game-over"
        data-tone={tone}
        onClick={(event) => event.stopPropagation()}
        className="result-in flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-panel shadow-[0_18px_50px_rgba(13,17,48,0.45)]"
      >
        <div className={`relative flex flex-col items-center gap-1 px-12 pb-4 pt-5 text-center ${HEAD[tone]}`}>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="absolute end-1 top-1 flex size-11 items-center justify-center rounded-full text-2xl font-bold leading-none opacity-80 focus-visible:outline-2 focus-visible:outline-current"
          >
            <span aria-hidden="true">×</span>
          </button>
          <Emblem tone={tone} />
          <h2 className="font-display text-3xl font-extrabold leading-tight">{title}</h2>
          <p className="text-sm font-semibold opacity-90" data-testid="game-over-reason">
            {reason}
          </p>
        </div>
        <div className="band shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {children}
          <button type="button" onClick={onClose} className="-mt-1 min-h-11 w-full font-semibold text-primary underline underline-offset-4">
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The row of numbers under the result: rating, tokens, games won. One, two or three across. */
export function ResultStats({ children }: { children: ReactNode }) {
  return <dl className="grid auto-cols-fr grid-flow-col gap-2">{children}</dl>
}

const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '±0')
const toneOf = (value: number) => (value > 0 ? 'text-palm' : value < 0 ? 'text-hibiscus' : 'text-muted')

type StatProps = {
  label: string
  /** The figure itself (a rating, a count). Left out when only the change matters (tokens). */
  value?: ReactNode
  /** How much it moved; shown signed and coloured. */
  change?: number
  testId?: string
}

export function ResultStat({ label, value, change, testId }: StatProps) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-surface px-2 py-2.5 text-center" data-testid={testId}>
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1.5 font-display text-2xl font-extrabold tabular-nums">
        {value !== undefined && <span>{value}</span>}
        {change !== undefined && <span className={value !== undefined ? `text-base ${toneOf(change)}` : toneOf(change)}>{signed(change)}</span>}
      </dd>
    </div>
  )
}
