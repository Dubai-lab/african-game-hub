import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chessboard } from 'react-chessboard'
import { type Color, type PieceSymbol, premoveTargets, type Promotion, type Square, type Target } from '../engine/chessLogic'
import type { PieceSet } from '../pieces/usePieceSet'
import { preloadChessSounds } from '../sound/sounds'
import type { MoveResult } from '../useLocalChessGame'
import type { BoardTheme } from './themes'

type Props = {
  fen: string
  orientation: 'white' | 'black'
  /** False while looking back through earlier moves, and once the game is over. */
  interactive: boolean
  /** Side to move in `fen`. */
  turn: Color
  /** Which pieces this device may move. */
  movable: Color | 'both' | 'none'
  lastMove: { from: string; to: string } | null
  /** The king's square when the side to move is in check. */
  checkSquare: string | null
  targetsFor: (square: Square) => Target[]
  onMove: (from: Square, to: Square, promotion?: Promotion) => MoveResult
  theme: BoardTheme
  pieceSet: PieceSet
  /** False in data-saver mode: pieces jump instead of sliding. */
  animate?: boolean
  /** Let the player queue a move while it is the opponent's turn (games against one opponent only). */
  premoves?: boolean
  /** Game review: an arrow for the move that would have been better. */
  arrows?: { from: string; to: string; color: string }[]
  /** Game review: the square the move landed on, coloured by how good the move was. */
  tint?: { square: string; color: string } | null
}

const PROMOTIONS: Promotion[] = ['q', 'r', 'b', 'n']
const PREMOVE_TINT = 'rgba(209, 38, 79, 0.5)'
const CHECK_GLOW = 'radial-gradient(circle, rgba(209,38,79,0.95) 0%, rgba(209,38,79,0.6) 42%, rgba(209,38,79,0) 74%)'

export function ChessBoard({
  fen,
  orientation,
  interactive,
  turn,
  movable,
  lastMove,
  checkSquare,
  targetsFor,
  onMove,
  theme,
  pieceSet,
  animate = true,
  premoves = false,
  arrows,
  tint,
}: Props) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Square | null>(null)
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null)
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null)
  // A move queued for the moment the opponent has replied.
  const [premove, setPremove] = useState<{ from: Square; to: Square } | null>(null)

  useEffect(preloadChessSounds, [])

  // A new position (a move, a rollback, stepping through history) clears any half-made move.
  useEffect(() => {
    setSelected(null)
    setSelectedPiece(null)
    setPromotion(null)
  }, [fen, interactive])

  const mayMove = (pieceType: string) => {
    const color = pieceType[0] as Color
    return interactive && color === turn && (movable === 'both' || movable === color)
  }

  // Waiting for the opponent, with one's own pieces: a move can be queued.
  const waiting = interactive && premoves && (movable === 'w' || movable === 'b') && turn !== movable
  const mayPremove = (pieceType: string) => waiting && pieceType[0] === movable

  // The turn has come: play the queued move like any other. The usual checks decide whether it
  // is legal now; if not it is dropped without fuss. A pawn reaching the last rank becomes a queen.
  useEffect(() => {
    if (!premove) return
    if (!interactive || !premoves || movable === 'both' || movable === 'none') return setPremove(null)
    if (turn !== movable) return
    const { from, to } = premove
    setPremove(null)
    if (onMove(from, to) === 'promotion') onMove(from, to, 'q')
  }, [premove, turn, movable, interactive, premoves, onMove, fen])

  const targets = useMemo<Target[]>(() => {
    if (!selected) return []
    if (waiting && selectedPiece) {
      const piece = selectedPiece[1]!.toLowerCase() as PieceSymbol
      return premoveTargets(selected, piece, selectedPiece[0] as Color).map((to) => ({ to, capture: false }))
    }
    return targetsFor(selected)
  }, [selected, selectedPiece, waiting, targetsFor])

  const select = (square: Square | null, pieceType: string | null = null) => {
    setSelected(square)
    setSelectedPiece(square ? pieceType : null)
  }

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {}
    const add = (square: string, style: CSSProperties) => {
      styles[square] = { ...styles[square], ...style }
    }
    // Tints are inset shadows so they sit over the square colour without replacing it.
    if (lastMove) {
      add(lastMove.from, { boxShadow: `inset 0 0 0 100vmax ${theme.lastMove}` })
      add(lastMove.to, { boxShadow: `inset 0 0 0 100vmax ${theme.lastMove}` })
    }
    if (tint) add(tint.square, { boxShadow: `inset 0 0 0 100vmax ${tint.color}99` })
    if (checkSquare) add(checkSquare, { backgroundImage: CHECK_GLOW })
    if (premove) {
      add(premove.from, { boxShadow: `inset 0 0 0 100vmax ${PREMOVE_TINT}` })
      add(premove.to, { boxShadow: `inset 0 0 0 100vmax ${PREMOVE_TINT}` })
    }
    if (selected) add(selected, { boxShadow: `inset 0 0 0 100vmax ${theme.selected}` })
    for (const target of targets) {
      add(target.to, {
        backgroundImage: target.capture
          ? // A ring around a piece that can be taken.
            `radial-gradient(circle, transparent 0 61%, ${theme.hint} 62% 79%, transparent 80%)`
          : // A dot on an empty square the piece can move to.
            `radial-gradient(circle, ${theme.hint} 0 21%, transparent 22%)`,
        cursor: 'pointer',
      })
    }
    return styles
  }, [lastMove, checkSquare, selected, targets, theme, premove, tint])

  function attempt(from: Square, to: Square): MoveResult {
    const result = onMove(from, to)
    if (result === 'promotion') setPromotion({ from, to })
    select(null)
    return result
  }

  function queue(from: Square, to: Square) {
    setPremove({ from, to })
    select(null)
  }

  return (
    <div className="relative aspect-square w-full touch-none select-none" data-testid="chess-board" data-shaded={animate} data-turn={turn} data-premove={premove ? premove.from + premove.to : undefined}>
      <Chessboard
        options={{
          id: 'board',
          position: fen,
          boardOrientation: orientation,
          pieces: pieceSet.render,
          lightSquareStyle: { backgroundColor: theme.light },
          darkSquareStyle: { backgroundColor: theme.dark },
          squareStyles,
          dropSquareStyle: { boxShadow: `inset 0 0 0 4px ${theme.selected}` },
          lightSquareNotationStyle: { color: theme.dark, fontWeight: 700 },
          darkSquareNotationStyle: { color: theme.light, fontWeight: 700 },
          // Small coordinates tucked into the corners, clear of the pieces.
          alphaNotationStyle: { fontSize: '10px', bottom: 1, right: 3, lineHeight: 1 },
          numericNotationStyle: { fontSize: '10px', top: 2, left: 2, lineHeight: 1 },
          animationDurationInMs: animate ? 180 : 0,
          showAnimations: animate,
          allowDrawingArrows: false,
          arrows: (arrows ?? []).map((arrow) => ({ startSquare: arrow.from, endSquare: arrow.to, color: arrow.color })),
          allowDragOffBoard: false,
          allowDragging: interactive,
          canDragPiece: ({ piece }) => mayMove(piece.pieceType) || mayPremove(piece.pieceType),
          // Picking a piece up shows where it can go, exactly as tapping it does.
          onPieceDrag: ({ piece, square }) => {
            if (square && (mayMove(piece.pieceType) || mayPremove(piece.pieceType))) select(square as Square, piece.pieceType)
          },
          onPieceDrop: ({ piece, sourceSquare, targetSquare }) => {
            // Dropped back where it started: treat it as a tap, keep the piece selected.
            if (!targetSquare || targetSquare === sourceSquare) return false
            if (mayPremove(piece.pieceType)) {
              const reachable = premoveTargets(sourceSquare as Square, piece.pieceType[1]!.toLowerCase() as PieceSymbol, piece.pieceType[0] as Color)
              if (reachable.includes(targetSquare as Square)) queue(sourceSquare as Square, targetSquare as Square)
              // The piece goes back to its square; the queued move is shown by the tint.
              return false
            }
            return attempt(sourceSquare as Square, targetSquare as Square) === 'ok'
          },
          onSquareClick: ({ piece, square }) => {
            const tapped = square as Square
            if (selected && targets.some((target) => target.to === tapped)) {
              if (waiting) queue(selected, tapped)
              else attempt(selected, tapped)
            } else if (piece && (mayMove(piece.pieceType) || mayPremove(piece.pieceType))) {
              // Choosing a piece again replaces whatever was queued.
              setPremove(null)
              select(selected === tapped ? null : tapped, piece.pieceType)
            } else {
              // A tap anywhere else cancels a selection or a queued move.
              select(null)
              setPremove(null)
            }
          },
          onSquareRightClick: () => {
            select(null)
            setPremove(null)
          },
        }}
      />

      {promotion && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-ink/45"
          onClick={() => setPromotion(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-label={t('chess.promotion.title')}
            className="flex gap-1 border-2 border-ink bg-panel p-2 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            {PROMOTIONS.map((piece) => (
              <button
                key={piece}
                type="button"
                aria-label={t(`chess.piece.${piece}`)}
                className="size-16 bg-surface active:bg-brand focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => {
                  const { from, to } = promotion
                  setPromotion(null)
                  onMove(from, to, piece)
                }}
              >
                <img src={pieceSet.urls[turn + piece.toUpperCase()]} alt="" className="size-full" draggable={false} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
