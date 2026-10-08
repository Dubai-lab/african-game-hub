import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cellOf, HOME, HOME_COLUMN, SEATS, type Seat, STAR_SQUARES, START, TRACK, YARD, YARD_CORNER } from './board'

export type Positions = Partial<Record<Seat, number[]>>

const STEP_MS = 130
/** How far the table leans away from the player, in degrees (none at all in the flat view). */
const LEAN = 26

/**
 * Pieces walk square by square instead of jumping to where the server says they are. A piece
 * sent back to its yard, or any change that is not a simple walk forward, is shown at once.
 * `onStep` is called for each square walked (for the tapping sound).
 */
export function useWalkingPieces(target: Positions, animate: boolean, onStep?: () => void): Positions {
  const [shown, setShown] = useState<Positions>(target)
  const current = useRef<Positions>(target)
  const step = useRef(onStep)
  step.current = onStep

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      let walking = false
      const next: Positions = {}
      for (const seat of SEATS) {
        const goal = target[seat]
        if (!goal) continue
        const now = current.current[seat] ?? goal
        next[seat] = goal.map((to, piece) => {
          const from = now[piece] ?? to
          // A throw moves a piece twelve squares at most; anything longer (a piece laid home
          // after a capture, a resync) is shown at once.
          if (!animate || from === to || to === YARD || to < from || to - Math.max(from, 0) > 12) return to
          walking = true
          return from === YARD ? 0 : from + 1
        })
      }
      current.current = next
      setShown(next)
      if (walking) {
        step.current?.()
        timer = setTimeout(tick, STEP_MS)
      }
    }
    tick()
    return () => clearTimeout(timer)
  }, [target, animate])

  return shown
}

type Shade = { light: string; base: string; dark: string }
/** Everything that makes one board look different from another. The squares never move. */
export type BoardTheme = {
  frame: [string, string]
  lip: string
  surface: [string, string]
  line: string
  seat: Record<Seat, Shade>
  star: string
  /** The tray in the middle where the dice are thrown. */
  tray: [string, string]
  trayRim: string
  die: { face: [string, string]; pip: string; edge: string }
}

export const BOARD_IDS = ['classic', 'wood', 'night'] as const
export type BoardId = (typeof BOARD_IDS)[number]

export const BOARDS: Record<BoardId, BoardTheme> = {
  // Clean and bright: flat strong colours on white, red dice with white pips.
  classic: {
    frame: ['#12805f', '#0a5a42'],
    lip: '#0d1130',
    surface: ['#ffffff', '#ffffff'],
    line: '#1a1a24',
    seat: {
      red: { light: '#f0364a', base: '#e0162e', dark: '#b50f24' },
      green: { light: '#1fb06a', base: '#0f9d58', dark: '#0a7a44' },
      yellow: { light: '#ffd640', base: '#fbc400', dark: '#d9a500' },
      blue: { light: '#3d6df0', base: '#1f4fd8', dark: '#173cab' },
    },
    star: '#c9ccd6',
    tray: ['#2bb3c8', '#147d94'],
    trayRim: '#0d1130',
    die: { face: ['#f2364a', '#c0122a'], pip: '#ffffff', edge: '#8f0c1e' },
  },
  // A wooden tray with an ivory surface and ivory dice.
  wood: {
    frame: ['#a8703a', '#5a3314'],
    lip: '#3a2110',
    surface: ['#fffdf5', '#efe6cf'],
    line: '#2a1c10',
    seat: {
      red: { light: '#f0627f', base: '#d1264f', dark: '#96123a' },
      green: { light: '#33ad83', base: '#0b7a55', dark: '#06513a' },
      yellow: { light: '#ffd95e', base: '#f5b700', dark: '#b98600' },
      blue: { light: '#5565d6', base: '#1f2a7a', dark: '#121952' },
    },
    star: '#d9c79a',
    tray: ['#2c7a5c', '#0c3a2a'],
    trayRim: '#d8b25a',
    die: { face: ['#ffffff', '#e3dccb'], pip: '#0d1130', edge: '#a89f88' },
  },
  // Dark slate for playing at night: bright houses, white dice.
  night: {
    frame: ['#2a3060', '#0d1130'],
    lip: '#05071a',
    surface: ['#232a52', '#1a2044'],
    line: '#5a639c',
    seat: {
      red: { light: '#ff6b83', base: '#f0405f', dark: '#b82a45' },
      green: { light: '#4ed6a0', base: '#22b47c', dark: '#16855b' },
      yellow: { light: '#ffe070', base: '#ffc82e', dark: '#cc9a14' },
      blue: { light: '#7d95ff', base: '#5470f5', dark: '#3a51c2' },
    },
    star: '#8089c2',
    tray: ['#11163a', '#070a20'],
    trayRim: '#ffc82e',
    die: { face: ['#ffffff', '#d7dcf5'], pip: '#0d1130', edge: '#8f97c9' },
  },
}

const star = (cx: number, cy: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const radius = i % 2 === 0 ? r : r * 0.42
    return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`
  }).join(' ')

/** The painted board: frame, playing surface, four houses, and the tray for the dice. */
function Surface({ positions, glow, label, theme }: { positions: Positions; glow: Seat[]; label: string; theme: BoardTheme }) {
  const fill = (seat: Seat) => `url(#ludo-fill-${seat})`
  return (
    // The painting never takes a tap: pieces lie in the same plane, and the browser must not be
    // left to choose between them.
    <svg viewBox="-0.7 -0.7 16.4 16.4" className="pointer-events-none absolute inset-0 size-full" role="img" aria-label={label}>
      <defs>
        <linearGradient id="ludo-frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={theme.frame[0]} />
          <stop offset="1" stopColor={theme.frame[1]} />
        </linearGradient>
        <linearGradient id="ludo-surface" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={theme.surface[0]} />
          <stop offset="1" stopColor={theme.surface[1]} />
        </linearGradient>
        <linearGradient id="ludo-tray" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={theme.tray[0]} />
          <stop offset="1" stopColor={theme.tray[1]} />
        </linearGradient>
        {SEATS.map((seat) => (
          <linearGradient key={seat} id={`ludo-fill-${seat}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={theme.seat[seat].light} />
            <stop offset="1" stopColor={theme.seat[seat].base} />
          </linearGradient>
        ))}
        {SEATS.map((seat) => (
          <radialGradient key={seat} id={`ludo-pawn-${seat}`} cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.18" stopColor={theme.seat[seat].light} />
            <stop offset="0.6" stopColor={theme.seat[seat].base} />
            <stop offset="1" stopColor={theme.seat[seat].dark} />
          </radialGradient>
        ))}
      </defs>

      <rect x="-0.7" y="-0.7" width="16.4" height="16.4" rx="0.7" fill="url(#ludo-frame)" />
      <rect x="-0.12" y="-0.12" width="15.24" height="15.24" fill={theme.lip} />
      <rect width="15" height="15" fill="url(#ludo-surface)" />

      {SEATS.map((seat) => {
        const [x, y] = YARD_CORNER[seat]
        return (
          <g key={seat} opacity={positions[seat] ? 1 : 0.4}>
            <rect x={x} y={y} width="6" height="6" fill={fill(seat)} />
            <rect x={x + 0.22} y={y + 0.22} width="5.56" height="5.56" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="0.07" />
            {/* Four wells for the pieces, each with a white rim. */}
            {[0, 1, 2, 3].map((spot) => {
              const [cx, cy] = cellOf(seat, YARD, spot)
              return (
                <g key={spot}>
                  <circle cx={cx + 0.5} cy={cy + 0.5} r="0.78" fill="#ffffff" stroke={theme.line} strokeOpacity="0.35" strokeWidth="0.05" />
                  <circle cx={cx + 0.5} cy={cy + 0.5} r="0.6" fill={theme.seat[seat].dark} opacity="0.85" />
                  <circle cx={cx + 0.5} cy={cy + 0.5} r="0.5" fill={theme.seat[seat].base} />
                </g>
              )
            })}
            {glow.includes(seat) && <rect x={x + 0.1} y={y + 0.1} width="5.8" height="5.8" fill="none" stroke="#ffffff" strokeWidth="0.22" className="ludo-glow" />}
          </g>
        )
      })}

      {TRACK.map(([x, y], square) => {
        const startOf = SEATS.find((seat) => START[seat] === square)
        return (
          <g key={square}>
            <rect x={x} y={y} width="1" height="1" fill={startOf ? fill(startOf) : 'url(#ludo-surface)'} stroke={theme.line} strokeWidth="0.04" />
            {(STAR_SQUARES as readonly number[]).includes(square) && <polygon points={star(x + 0.5, y + 0.5, 0.36)} fill={theme.star} stroke={theme.line} strokeWidth="0.04" />}
            {startOf && <polygon points={star(x + 0.5, y + 0.5, 0.32)} fill="#ffffff" opacity="0.92" />}
          </g>
        )
      })}

      {SEATS.map((seat) =>
        HOME_COLUMN[seat].slice(0, 5).map(([x, y]) => (
          <rect key={`${seat}${x},${y}`} x={x} y={y} width="1" height="1" fill={fill(seat)} stroke={theme.line} strokeWidth="0.04" opacity={positions[seat] ? 1 : 0.4} />
        )),
      )}

      {/* The middle of the board is the dice tray. A piece that comes home leaves the board. */}
      <rect x="6" y="6" width="3" height="3" fill={theme.lip} />
      <rect x="6.12" y="6.12" width="2.76" height="2.76" rx="0.42" fill="url(#ludo-tray)" stroke={theme.trayRim} strokeWidth="0.08" />
      <rect width="15" height="15" fill="none" stroke={theme.line} strokeWidth="0.08" />
    </svg>
  )
}

/** A playing piece, standing up: base, body and head, lit from the upper left. */
function Pawn({ seat, theme }: { seat: Seat; theme: BoardTheme }) {
  const ink = '#1a1a24'
  return (
    <svg viewBox="0 0 40 60" className="size-full overflow-visible" aria-hidden="true">
      <ellipse cx="20" cy="52" rx="15" ry="6.5" fill={theme.seat[seat].dark} />
      <ellipse cx="20" cy="50" rx="15" ry="6.5" fill={`url(#ludo-pawn-${seat})`} stroke={ink} strokeWidth="1.3" />
      <path d="M9.5 49 C12 39 15 33 15.5 25 L24.5 25 C25 33 28 39 30.5 49 C27 52.5 13 52.5 9.5 49 Z" fill={`url(#ludo-pawn-${seat})`} stroke={ink} strokeWidth="1.3" />
      <ellipse cx="20" cy="25.5" rx="8.5" ry="3" fill={theme.seat[seat].dark} stroke={ink} strokeWidth="1" />
      <circle cx="20" cy="14" r="10.5" fill={`url(#ludo-pawn-${seat})`} stroke={ink} strokeWidth="1.3" />
    </svg>
  )
}

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
// Where each face sits on the cube (the cube's +Z points up, out of the board), and the turn
// that brings that face to the top.
const FACE_PLACE: Record<number, string> = { 1: '', 6: 'rotateX(180deg)', 2: 'rotateY(90deg)', 5: 'rotateY(-90deg)', 3: 'rotateX(-90deg)', 4: 'rotateX(90deg)' }
const FACE_UP: Record<number, string> = { 1: '', 6: 'rotateX(180deg)', 2: 'rotateY(-90deg)', 5: 'rotateY(90deg)', 3: 'rotateX(90deg)', 4: 'rotateX(-90deg)' }

/** One die as the board shows it. */
export type DieView = {
  /** The face on top; null before the first throw. */
  value: number | null
  /** Already played this turn (or thrown by someone else and finished with). */
  spent: boolean
  /** The die the player's next tap on a piece will play. */
  chosen: boolean
  /** The player may tap it to choose it. */
  pickable: boolean
}

type DieProps = DieView & { rolling: boolean; size: number; offset: number; canRoll: boolean; onTap: () => void; label: string; theme: BoardTheme }

/** A real cube. It tumbles while a throw is on its way and comes to rest with the number on top. */
function Die({ value, spent, chosen, rolling, size, offset, canRoll, onTap, label, theme }: DieProps) {
  const half = size / 2
  // Before the first throw the die rests on a one.
  const top = value ?? 1
  return (
    <button
      type="button"
      onClick={onTap}
      // The dice take a tap only to be thrown. Standing up in the middle of the board they hide
      // the squares behind them, so once thrown they let taps through to the pieces; which die
      // to play is chosen with the buttons under the board.
      disabled={!canRoll}
      aria-label={label}
      data-testid="ludo-die"
      data-value={rolling ? '' : (value ?? '')}
      data-spent={spent}
      className={`ludo-3d absolute left-1/2 top-1/2 rounded-md ${canRoll ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'} ${spent && !rolling ? 'ludo-die-spent' : ''} ${chosen && !rolling ? 'ludo-die-chosen' : ''}`}
      // A chosen die is lifted off the tray, so it is plain which one the next tap will play.
      style={
        {
          width: size,
          height: size,
          marginLeft: -half + offset,
          marginTop: -half,
          transform: `translateZ(${half + 1 + (chosen && !rolling ? size * 0.3 : 0)}px)`,
          transition: 'transform 0.15s ease-out',
          '--die-a': theme.die.face[0],
          '--die-b': theme.die.face[1],
          '--die-pip': theme.die.pip,
          '--die-edge': theme.die.edge,
        } as CSSProperties
      }
    >
      {/* The resting face is handed to the stylesheet, so the "your throw" bob can keep it on top. */}
      <span
        className={`ludo-3d absolute inset-0 block ${rolling ? 'ludo-tumble' : canRoll ? 'ludo-die-bob' : 'ludo-die-rest'}`}
        style={{ '--face': FACE_UP[top] || 'rotateX(0deg)' } as CSSProperties}
      >
        {[1, 2, 3, 4, 5, 6].map((face) => (
          <span
            key={face}
            className="ludo-die-face absolute inset-0 grid grid-cols-3 grid-rows-3"
            style={{ transform: `${FACE_PLACE[face]} translateZ(${half}px)`, padding: size * 0.15, gap: size * 0.04, borderRadius: size * 0.18 }}
          >
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className={PIPS[face]!.includes(i) ? 'ludo-pip' : ''} />
            ))}
          </span>
        ))}
      </span>
    </button>
  )
}

type Props = {
  positions: Positions
  /** The colour shown nearest the player (their own first colour); the board turns to suit. */
  bottom: Seat
  /** The colours the player holds, and the pieces of theirs that may be tapped right now. */
  mine: Seat[]
  movable: { color: Seat; piece: number }[]
  onMove: (color: Seat, piece: number) => void
  /** The colours of whoever's turn it is: their houses glow. */
  glow: Seat[]
  /** The dice in the middle of the board: one or two. */
  dice: DieView[]
  rolling: boolean
  canRoll: boolean
  onRoll: () => void
  onPickDie: (index: number) => void
  board: BoardId
  /** Looked at from straight above instead of leaning away (a setting). */
  flat?: boolean
}

/**
 * The Ludo table in three dimensions: the board leans away from the player, the pieces stand on
 * it and the dice lie in the tray at its centre. Draws what it is given; decides nothing.
 */
export function LudoBoard({ positions, bottom, mine, movable, onMove, glow, dice, rolling, canRoll, onRoll, onPickDie, board, flat = false }: Props) {
  const { t } = useTranslation()
  const theme = BOARDS[board]
  const TILT = flat ? 0 : LEAN
  const frame = useRef<HTMLDivElement>(null)
  // One square of the board in pixels: the dice are sized from it.
  const [cell, setCell] = useState(22)
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => setCell(element.clientWidth / 16.4)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Yellow's house is drawn bottom-right. For anyone else the board is turned, so that every
  // player has their own (first) house in that same corner, nearest to them.
  const quarterTurns = { yellow: 0, green: 90, red: 180, blue: 270 }[bottom]
  // Everything that stands on the board is turned back to face the player.
  const upright = `rotateZ(${-quarterTurns}deg) rotateX(${-TILT}deg)`

  // Pieces still on the board (a piece that is home has left it). Those sharing a square are
  // fanned out so each can be seen and tapped.
  const pieces = SEATS.filter((seat) => positions[seat]).flatMap((seat) =>
    positions[seat]!.flatMap((progress, piece) => (progress === HOME ? [] : [{ seat, piece, progress, cell: cellOf(seat, progress, piece) }])),
  )
  const sharing = new Map<string, number>()
  const placed = pieces.map((p) => {
    const key = p.cell.join(',')
    const index = sharing.get(key) ?? 0
    sharing.set(key, index + 1)
    return { ...p, key, index }
  })
  // The surface is inset inside the frame: 0.7 of a square on every side.
  const at = (value: number) => `${((value + 0.7) / 16.4) * 100}%`
  const square = `${100 / 16.4}%`
  const dieSize = cell * (dice.length > 1 ? 1.22 : 1.6)

  return (
    <div className="relative w-full select-none" style={{ perspective: '1300px', perspectiveOrigin: '50% 45%' }} data-testid="ludo-board" data-board={board}>
      {/* Leaning makes the far edge shorter and the near edge wider: the board is drawn a little
          smaller so the near edge stays inside the screen, and the margins take up the slack. */}
      <div
        ref={frame}
        className="ludo-3d ludo-table relative aspect-square w-full"
        style={{ transform: `scale(${flat ? 0.97 : 0.9}) rotateX(${TILT}deg) rotateZ(${quarterTurns}deg)`, marginTop: flat ? 0 : '-7%', marginBottom: flat ? 0 : '-1%' } as CSSProperties}
      >
        <Surface positions={positions} glow={glow} label={t('ludo.boardLabel')} theme={theme} />

        {/* This layer only turns the dice to face the player. It covers the board, so it must let
            every tap through; the dice themselves take taps. */}
        <div className="ludo-3d pointer-events-none absolute inset-0" style={{ transform: `rotateZ(${-quarterTurns}deg)` }}>
          {dice.map((die, index) => (
            <Die
              key={index}
              {...die}
              rolling={rolling}
              size={dieSize}
              offset={dice.length > 1 ? (index === 0 ? -1 : 1) * dieSize * 0.56 : 0}
              canRoll={canRoll}
              onTap={() => (canRoll ? onRoll() : onPickDie(index))}
              label={canRoll ? t('ludo.roll') : die.value ? t('ludo.dieShows', { value: die.value }) : t('ludo.dieIdle')}
              theme={theme}
            />
          ))}
        </div>

        {placed.map(({ seat, piece, progress, cell: where, key, index }) => {
          const together = sharing.get(key) ?? 1
          const shift = together > 1 ? (index - (together - 1) / 2) * 0.3 : 0
          const canMove = mine.includes(seat) && movable.some((m) => m.color === seat && m.piece === piece)
          return (
            <button
              key={`${seat}${piece}`}
              type="button"
              disabled={!canMove}
              onClick={() => onMove(seat, piece)}
              data-testid={`piece-${seat}-${piece}`}
              data-progress={progress}
              data-movable={canMove}
              aria-label={t(`ludo.pieceLabel.${progress === YARD ? 'yard' : 'board'}`, { color: t(`ludo.color.${seat}`), number: piece + 1 })}
              // A piece that cannot be moved lets taps through to whatever is behind it.
              className={`ludo-3d absolute transition-[left,top] duration-150 ease-linear ${canMove ? 'cursor-pointer' : 'pointer-events-none'}`}
              // (A hair above the board, so a piece is always in front of the square it stands on.)
              style={{ left: at(where[0] + shift), top: at(where[1]), width: square, height: square, transform: 'translateZ(1px)' }}
            >
              {/* Its shadow lies on the board; a piece that can be moved stands in a ring of light. */}
              <span className={`absolute inset-[8%] rounded-full ${canMove ? 'ludo-ring' : 'ludo-shadow'}`} />
              <span className="ludo-3d absolute bottom-1/2 left-[4%] block h-[150%] w-[92%] origin-bottom" style={{ transform: upright }}>
                <span className={`block size-full ${canMove ? 'ludo-hop' : ''}`}>
                  <Pawn seat={seat} theme={theme} />
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
