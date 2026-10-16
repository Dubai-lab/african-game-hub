import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { notationOf, type Pits, type Played, type Side } from '../../../supabase/functions/_shared/oware'

// The board. It shows a position and the pits that may be played, reports the pit the player
// chooses, and draws each move being sown, seed by seed; it decides nothing about the game.
//
// The player's own row is always the near one, read from their left, so seeds always travel
// left to right along the near row and right to left along the far one (anticlockwise).

type Props = {
  /** What the pits hold. */
  pits: Pits
  /** The side whose row is nearest the player. */
  near: Side
  /** The pits that may be played now (empty when it is not this player's turn). */
  playable: number[]
  onPlay: (pit: number) => void
  /** The move that led to this position, drawn being sown when it is new. */
  lastMove: (Played & { from: Pits; ply: number }) | null
  animate: boolean
}

// The colours of the seeds: the grey and brown of the nicker seeds the game is played with.
const SEED_TONES = [
  ['#b9b2a3', '#7d7466'],
  ['#9c8f7d', '#5e5345'],
  ['#c9c1b1', '#8a8172'],
  ['#8a7a66', '#4f4335'],
]
const SHOWN = 20
const golden = Math.PI * (3 - Math.sqrt(5))

/**
 * How big the seeds are drawn: large while a pit holds a few, smaller as it fills, so that a pit
 * never looks empty and a full one still shows its seeds.
 */
const seedScale = (count: number) => (count <= 4 ? 1.55 : count <= 7 ? 1.35 : count <= 12 ? 1.12 : 0.95)

/** Where each seed lies in a pit: a loose spiral, the same every time for the same count. */
const spots = (count: number) => {
  const scale = seedScale(count)
  return Array.from({ length: Math.min(count, SHOWN) }, (_, k) => {
    const r = Math.min(31, 7.4 * scale * Math.sqrt(k + 0.35))
    const a = k * golden
    return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a), rot: (k * 53) % 180, tone: SEED_TONES[k % SEED_TONES.length]!, scale }
  })
}

function Pit({ seeds, glow, lit, taken, from }: { seeds: number; glow: boolean; lit: boolean; taken: boolean; from: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className="block size-full" aria-hidden="true">
      {/* The hollow carved into the wood. */}
      <circle cx="50" cy="50" r="46" fill="url(#oware-hollow)" />
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
      {glow && <circle cx="50" cy="50" r="45" fill="none" stroke="#f5b700" strokeWidth="5" opacity="0.95" />}
      {from && !glow && <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(245,183,0,0.55)" strokeWidth="3" strokeDasharray="6 5" />}
      {lit && <circle cx="50" cy="50" r="42" fill="rgba(255,236,170,0.28)" />}
      {taken && <circle cx="50" cy="50" r="42" fill="rgba(79,214,156,0.32)" />}
      {spots(seeds).map((spot, k) => (
        <g key={k} transform={`translate(${spot.x} ${spot.y}) rotate(${spot.rot}) scale(${spot.scale})`}>
          <ellipse cx="0.8" cy="1.6" rx="8" ry="6.3" fill="rgba(0,0,0,0.35)" />
          <ellipse rx="8" ry="6.3" fill={spot.tone[0]} stroke={spot.tone[1]} strokeWidth="1.2" />
          <ellipse cx="-2.4" cy="-1.8" rx="2.6" ry="1.6" fill="rgba(255,255,255,0.45)" />
        </g>
      ))}
    </svg>
  )
}

type Frame = { pits: Pits; lit: number | null; taken: number[] }

export function OwareBoard({ pits, near, playable, onPlay, lastMove, animate }: Props) {
  const { t } = useTranslation()
  const far: Side = near === 's' ? 'n' : 's'
  const start = (side: Side) => (side === 's' ? 0 : 6)
  // The near row from its owner's left; the far row from the near player's left, which is the
  // far player's right: seeds go round anticlockwise.
  const nearRow = [0, 1, 2, 3, 4, 5].map((i) => start(near) + i)
  const farRow = [5, 4, 3, 2, 1, 0].map((i) => start(far) + i)

  // The move being drawn, one seed at a time. Null when the board simply shows `pits`.
  const [frame, setFrame] = useState<Frame | null>(null)
  const drawn = useRef<number | null>(null)
  // The move is read from here, so that the same move drawn again (the server confirming it, a
  // clock update) does not start its sowing over: only a different move does.
  const move = useRef(lastMove)
  move.current = lastMove
  const moveKey = lastMove ? `${lastMove.ply}:${lastMove.pit}` : '0'
  useEffect(() => {
    const lastMove = move.current
    const ply = lastMove?.ply ?? 0
    const previous = drawn.current
    drawn.current = ply
    // Only a move just played is sown before the player's eyes: not one stepped to in the record.
    if (!lastMove || !animate || previous === null || ply !== previous + 1) {
      setFrame(null)
      return
    }
    const seeds = [...lastMove.from]
    seeds[lastMove.pit] = 0
    const steps: Frame[] = [{ pits: [...seeds], lit: lastMove.pit, taken: [] }]
    for (const pit of lastMove.sown) {
      seeds[pit]! += 1
      steps.push({ pits: [...seeds], lit: pit, taken: [] })
    }
    if (lastMove.captured.length > 0) steps.push({ pits: [...seeds], lit: null, taken: lastMove.captured })
    // A long move is sown a little faster, so that no move takes more than about two seconds.
    const every = Math.max(45, Math.min(130, 1900 / steps.length))
    const timers = steps.map((step, i) => setTimeout(() => setFrame(step), i * every))
    timers.push(setTimeout(() => setFrame(null), steps.length * every + (lastMove.captured.length > 0 ? 260 : 0)))
    return () => timers.forEach(clearTimeout)
  }, [moveKey, animate])

  const shown = frame?.pits ?? pits
  const sowing = frame !== null

  const cell = (pit: number, row: 'near' | 'far') => {
    const seeds = shown[pit]!
    const can = !sowing && playable.includes(pit)
    const label = t('oware.board.pit', { pit: notationOf(pit), count: seeds })
    const count = (
      <span className={`block text-center text-sm font-bold tabular-nums ${seeds === 0 ? 'text-[#e8d6b8]/50' : 'text-[#fff4dc]'}`} aria-hidden="true">
        {seeds}
      </span>
    )
    return (
      <div key={pit} className="flex min-w-0 flex-col items-stretch gap-0.5">
        {row === 'far' && count}
        <button
          type="button"
          data-pit={pit}
          data-seeds={seeds}
          data-playable={can}
          disabled={!can}
          aria-label={label}
          onClick={() => onPlay(pit)}
          className={`relative aspect-square w-full rounded-full transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5b700] ${can ? 'cursor-pointer active:scale-95' : 'cursor-default'}`}
        >
          <Pit seeds={seeds} glow={can} lit={frame?.lit === pit} taken={frame?.taken.includes(pit) ?? false} from={!sowing && lastMove?.pit === pit} />
        </button>
        {row === 'near' && count}
      </div>
    )
  }

  return (
    <div data-testid="oware-board" data-near={near} className="relative w-full select-none rounded-[1.6rem] p-2.5 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.7)] sm:p-3.5" style={{ background: 'linear-gradient(160deg, #a5642e 0%, #7a4320 55%, #5c2f14 100%)' }}>
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <radialGradient id="oware-hollow" cx="45%" cy="40%" r="62%">
            <stop offset="0%" stopColor="#4a250f" />
            <stop offset="70%" stopColor="#331809" />
            <stop offset="100%" stopColor="#5a2e12" />
          </radialGradient>
        </defs>
      </svg>
      {/* The grain of the wood, and a lit top edge. */}
      <div className="pointer-events-none absolute inset-0 rounded-[1.6rem] opacity-25" style={{ background: 'repeating-linear-gradient(100deg, transparent 0 9px, rgba(0,0,0,0.18) 9px 11px, transparent 11px 23px)' }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-6 top-0.5 h-px bg-white/30" aria-hidden="true" />
      <div className="relative grid grid-cols-6 gap-x-1.5 gap-y-2 sm:gap-x-2.5" role="group" aria-label={t('oware.board.label')}>
        {farRow.map((pit) => cell(pit, 'far'))}
        {/* The line down the middle of the board, between the two rows. */}
        <div className="col-span-6 h-1 rounded-full bg-black/25" aria-hidden="true" />
        {nearRow.map((pit) => cell(pit, 'near'))}
      </div>
    </div>
  )
}
