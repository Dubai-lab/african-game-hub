import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Board, type Color, colOf, type Move, rowOf } from '../../../supabase/functions/_shared/draughts'
import type { DraughtsBoardTheme, PieceColours } from './themes'

// The board. It shows a position and the moves on offer in it, and reports the move the
// player chooses; it decides nothing about the game.
//
// Choosing a move: tap (or drag) a piece, then the square it goes to. A capture of several
// pieces is played one jump at a time, the piece moving as the player taps, and finishes by
// itself as soon as only one way on is left. Pieces taken stay on the board, dimmed, until the
// move is over, as the rules say.

type Sprite = { id: number; square: number; piece: string; dying?: boolean }

const STEP_MS = 190
let nextId = 1
const spritesOf = (board: Board): Sprite[] => [...board].flatMap((piece, index) => (piece === '.' ? [] : [{ id: nextId++, square: index + 1, piece }]))
const colourOf = (piece: string): Color => (piece === 'w' || piece === 'W' ? 'w' : 'b')
const isPrefix = (prefix: number[], path: number[]) => prefix.length <= path.length && prefix.every((square, i) => square === path[i])

function Piece({ colours, king, id }: { colours: PieceColours; king: boolean; id: string }) {
  return (
    <svg viewBox="0 0 100 100" className="block size-full" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor={colours.top} />
          <stop offset="100%" stopColor={colours.side} />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="60" rx="40" ry="38" fill="rgba(0,0,0,0.28)" />
      {/* A king is two pieces, one on the other. */}
      {king && <circle cx="50" cy="58" r="39" fill={colours.side} stroke={colours.edge} strokeWidth="2" />}
      <circle cx="50" cy={king ? 55 : 54} r="39" fill={colours.side} stroke={colours.edge} strokeWidth="2" />
      <circle cx="50" cy={king ? 46 : 49} r="39" fill={`url(#${id})`} stroke={colours.edge} strokeWidth="2" />
      <circle cx="50" cy={king ? 46 : 49} r="30" fill="none" stroke={colours.groove} strokeWidth="3" />
      <circle cx="50" cy={king ? 46 : 49} r="21" fill="none" stroke={colours.groove} strokeWidth="2.5" />
      {king && (
        <path
          d="M30 56 L26 33 L39 44 L50 27 L61 44 L74 33 L70 56 Z"
          fill={colours.crown}
          stroke={colours.edge}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

type Props = {
  board: Board
  /** Whose pieces start at the bottom of the screen. */
  orientation: Color
  /** The moves on offer to the person at this screen, in this position. Empty when it is not theirs to move. */
  moves: Move[]
  /** The move that led to this position, for the highlight and so the piece is seen to travel. */
  lastMove: Move | null
  onMove: (path: number[]) => void
  theme: DraughtsBoardTheme
  pieces: Record<Color, PieceColours>
  animate: boolean
  showNumbers: boolean
  showHints: boolean
}

export function DraughtsBoard({ board, orientation, moves, lastMove, onMove, theme, pieces, animate, showNumbers, showHints }: Props) {
  const { t } = useTranslation()
  const [sprites, setSprites] = useState<Sprite[]>(() => spritesOf(board))
  /** The squares the chosen piece has visited so far; its first square alone when just picked up. */
  const [partial, setPartial] = useState<number[] | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const shown = useRef(board)
  /** False while a move is being walked across the board. */
  const settled = useRef(true)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const frame = useRef<HTMLDivElement>(null)

  const place = (square: number) => {
    const index = square - 1
    const row = rowOf(index)
    const col = colOf(index)
    return orientation === 'w' ? { x: col, y: row } : { x: 9 - col, y: 9 - row }
  }

  // A new position. When it is the old one plus the last move, the piece is walked there jump
  // by jump; anything else (stepping back through the game, a reload) is simply set out afresh.
  useEffect(() => {
    if (board === shown.current) return
    const before = shown.current
    shown.current = board
    timers.current.forEach(clearTimeout)
    timers.current = []
    const walked = partial
    setPartial(null)
    setDrag(null)

    const path = lastMove?.path
    const from = path?.[0]
    const to = path?.at(-1)
    const touched = new Set([...(path ?? []), ...(lastMove?.captures ?? [])])
    const follows =
      animate &&
      path !== undefined &&
      from !== undefined &&
      to !== undefined &&
      before[from - 1] !== '.' &&
      board[to - 1] !== '.' &&
      [...board].every((piece, index) => piece === before[index] || touched.has(index + 1))
    // A move that arrives while the last one is still being shown starts from where that one ends.
    const base = settled.current ? sprites : spritesOf(before)
    const mover = follows ? base.find((s) => s.square === from) : undefined
    if (!follows || !mover) {
      settled.current = true
      setSprites(spritesOf(board))
      return
    }
    settled.current = false

    // The player may already have walked the piece part of the way by hand.
    const start = walked && isPrefix(walked, path) ? walked.length - 1 : 0
    const steps = path.slice(start + 1)
    const id = mover.id
    const taken = lastMove!.captures
    setSprites(base.map((s) => (s.id === id ? { ...s, square: path[start]! } : s)))
    steps.forEach((square, i) => {
      timers.current.push(setTimeout(() => setSprites((current) => current.map((s) => (s.id === id ? { ...s, square } : s))), i * STEP_MS + 20))
    })
    const done = steps.length * STEP_MS + 20
    // Taken pieces are lifted, and a man is crowned, when the move is over.
    timers.current.push(
      setTimeout(() => setSprites((current) => current.map((s) => (s.id === id ? { ...s, piece: board[to - 1]! } : taken.includes(s.square) ? { ...s, dying: true } : s))), done),
      setTimeout(() => {
        settled.current = true
        setSprites((current) => current.filter((s) => !s.dying))
      }, done + 260),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // When there is no longer anything to play (the game ended, the turn passed), the choice is dropped.
  const nothingToPlay = moves.length === 0
  useEffect(() => setPartial(null), [nothingToPlay])

  const candidates = useMemo(() => (partial ? moves.filter((move) => isPrefix(partial, move.path)) : []), [moves, partial])
  const targets = useMemo(() => new Set(partial ? candidates.map((move) => move.path[partial.length]!) : []), [candidates, partial])
  const movable = useMemo(() => new Set(moves.map((move) => move.path[0]!)), [moves])
  const mustCapture = moves.length > 0 && moves[0]!.captures.length > 0
  /** Pieces already jumped in the move being made. */
  const jumped = useMemo(() => new Set(partial && partial.length > 1 && candidates[0] ? candidates[0].captures.slice(0, partial.length - 1) : []), [candidates, partial])
  /** Pieces the next tap could take. */
  const threatened = useMemo(() => new Set(partial ? candidates.flatMap((move) => move.captures.slice(partial.length - 1, partial.length)) : []), [candidates, partial])

  const choose = (square: number) => {
    if (partial && targets.has(square)) {
      const next = [...partial, square]
      const left = candidates.filter((move) => isPrefix(next, move.path))
      // One way on: play it out. Otherwise wait for the next square.
      if (left.length === 1) onMove(left[0]!.path)
      else if (left.some((move) => move.path.length === next.length)) onMove(next)
      else setPartial(next)
      return true
    }
    if (movable.has(square) && !(partial && partial.length > 1)) {
      setPartial(partial?.[0] === square && partial.length === 1 ? null : [square])
      return true
    }
    // A tap anywhere else lets go of the piece (and takes back a capture begun by hand).
    setPartial(null)
    return false
  }

  // Dragging: the piece follows the finger, and is dropped on the square under it.
  const press = useRef<{ square: number; x: number; y: number; id: number; moved: boolean } | null>(null)
  const swallowClick = useRef(false)
  const squareAt = (clientX: number, clientY: number): number | null => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return null
    const x = Math.floor(((clientX - box.left) / box.width) * 10)
    const y = Math.floor(((clientY - box.top) / box.height) * 10)
    if (x < 0 || x > 9 || y < 0 || y > 9) return null
    const col = orientation === 'w' ? x : 9 - x
    const row = orientation === 'w' ? y : 9 - y
    return (row + col) % 2 === 1 ? row * 5 + Math.floor(col / 2) + 1 : null
  }
  const onPointerDown = (event: React.PointerEvent) => {
    const square = squareAt(event.clientX, event.clientY)
    const held = partial?.at(-1)
    if (square === null || !(square === held || (movable.has(square) && !(partial && partial.length > 1)))) return
    press.current = { square, x: event.clientX, y: event.clientY, id: event.pointerId, moved: false }
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const down = press.current
    if (!down || down.id !== event.pointerId) return
    if (!down.moved) {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 8) return
      down.moved = true
      frame.current?.setPointerCapture(event.pointerId)
      if (partial?.at(-1) !== down.square) setPartial([down.square])
    }
    const box = frame.current!.getBoundingClientRect()
    setDrag({ x: ((event.clientX - box.left) / box.width) * 10 - 0.5, y: ((event.clientY - box.top) / box.height) * 10 - 0.5 })
  }
  const onPointerUp = (event: React.PointerEvent) => {
    const down = press.current
    press.current = null
    if (!down || !down.moved) return
    setDrag(null)
    swallowClick.current = true
    setTimeout(() => (swallowClick.current = false), 0)
    const square = squareAt(event.clientX, event.clientY)
    // Dropped anywhere that is not a square it may go to: the piece goes back, still chosen.
    if (square !== null && targets.has(square)) choose(square)
  }

  const held = partial?.at(-1)
  const heldFrom = partial?.[0]
  const cell = 'absolute left-0 top-0 size-[10%]'
  const uid = useRef(`dp${nextId++}`).current

  return (
    <div className="p-1.5 sm:p-2" style={{ background: theme.frame }}>
      <div
        ref={frame}
        className="relative aspect-square w-full touch-none select-none"
        style={{ background: theme.light }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null
          setDrag(null)
        }}
        data-testid="draughts-board"
        data-must-capture={mustCapture}
      >
        {Array.from({ length: 50 }, (_, index) => {
          const square = index + 1
          const { x, y } = place(square)
          const piece = board[index]!
          const last = lastMove !== null && !partial && (square === lastMove.path[0] || square === lastMove.path.at(-1))
          const chosen = square === held || square === heldFrom
          const target = targets.has(square)
          const label =
            piece === '.'
              ? t('draughts.board.empty', { square })
              : t(`draughts.board.${piece === 'w' ? 'whiteMan' : piece === 'W' ? 'whiteKing' : piece === 'b' ? 'blackMan' : 'blackKing'}`, { square })
          return (
            <button
              key={square}
              type="button"
              aria-label={label}
              aria-pressed={chosen || undefined}
              data-testid={`sq-${square}`}
              data-piece={piece}
              data-target={target || undefined}
              className={`${cell} focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white`}
              style={{ transform: `translate(${x * 100}%, ${y * 100}%)`, background: theme.dark }}
              onClick={() => {
                if (swallowClick.current) return
                choose(square)
              }}
            >
              {(last || chosen) && <span className="absolute inset-0" style={{ background: chosen ? theme.selected : theme.lastMove }} />}
              {/* When a capture is compulsory, the pieces that can make it are pointed out. */}
              {mustCapture && !partial && movable.has(square) && <span className="absolute inset-[6%] rounded-full" style={{ boxShadow: `0 0 0 3px ${theme.selected}` }} />}
              {target && showHints && <span className="absolute inset-[34%] rounded-full" style={{ background: theme.hint }} />}
              {showNumbers && (
                <span className="absolute left-[6%] top-[2%] text-[clamp(7px,1.9vmin,11px)] font-semibold leading-none" style={{ color: theme.number }} aria-hidden="true">
                  {square}
                </span>
              )}
            </button>
          )
        })}

        {sprites.map((sprite) => {
          const colour = colourOf(sprite.piece)
          // The chosen piece is drawn where the player has walked it to.
          const mine = partial && sprite.square === heldFrom && !sprite.dying
          const at = mine && drag ? drag : place(mine ? held! : sprite.square)
          const taken = jumped.has(sprite.square) && !mine
          return (
            <div
              key={sprite.id}
              className={`${cell} pointer-events-none p-[0.9%] ${mine ? 'z-20' : ''}`}
              style={{
                transform: `translate(${at.x * 100}%, ${at.y * 100}%) scale(${mine && drag ? 1.15 : 1})`,
                transition: mine && drag ? 'none' : animate ? `transform ${STEP_MS - 20}ms ease-out, opacity 240ms ease-out` : 'none',
                opacity: sprite.dying ? 0 : taken ? 0.35 : 1,
              }}
            >
              <Piece colours={pieces[colour]} king={sprite.piece === 'W' || sprite.piece === 'B'} id={`${uid}-${sprite.id}`} />
              {threatened.has(sprite.square) && showHints && <span className="absolute inset-[4%] rounded-full" style={{ boxShadow: `inset 0 0 0 3px ${theme.selected}` }} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
