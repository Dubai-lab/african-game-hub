// Everything the chess screens need to know about a position, built on chess.js.
// No rule of chess is written by hand here: legality, check, mate and draws all come from chess.js.
//
// On the client this is for display and instant feedback only. In online games the server
// runs the same library on the stored position and is the only authority.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'

export type { Color, PieceSymbol, Square }
export type Promotion = 'q' | 'r' | 'b' | 'n'
export type MoveKind = 'move' | 'capture' | 'castle' | 'promote'

export type PlayedMove = {
  ply: number
  san: string
  uci: string
  from: Square
  to: Square
  color: Color
  kind: MoveKind
  check: boolean
  fenAfter: string
}

export type Outcome = {
  /** Null for a draw. */
  winner: Color | null
  reason:
    | 'checkmate'
    | 'stalemate'
    | 'insufficient'
    | 'repetition'
    | 'fifty_moves'
    | 'resignation'
    | 'agreement'
    | 'timeout'
    /** A tournament game one player never started: that player loses. */
    | 'no_show'
    /** Called off before both players had moved: no winner, no rating change. */
    | 'aborted'
    /** Called off by the platform's staff: no winner, stakes returned. */
    | 'called_off'
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** Rebuilds a game from its moves. Throws if any move is illegal in its position. */
export function replay(sanMoves: readonly string[], startFen: string = START_FEN): { chess: Chess; played: PlayedMove[] } {
  const chess = new Chess(startFen)
  const played: PlayedMove[] = []
  for (const san of sanMoves) {
    const move = chess.move(san)
    played.push({
      ply: played.length + 1,
      san: move.san,
      uci: move.from + move.to + (move.promotion ?? ''),
      from: move.from,
      to: move.to,
      color: move.color,
      kind: move.promotion
        ? 'promote'
        : move.isKingsideCastle() || move.isQueensideCastle()
          ? 'castle'
          : move.isCapture() || move.isEnPassant()
            ? 'capture'
            : 'move',
      check: chess.isCheck(),
      fenAfter: move.after,
    })
  }
  return { chess, played }
}

export type Target = { to: Square; capture: boolean }

/** Where the piece on `from` may go: drives the dots and capture rings. */
export function legalTargets(chess: Chess, from: Square): Target[] {
  const seen = new Map<Square, Target>()
  for (const move of chess.moves({ square: from, verbose: true })) {
    seen.set(move.to, { to: move.to, capture: move.isCapture() || move.isEnPassant() })
  }
  return [...seen.values()]
}

export function needsPromotion(chess: Chess, from: Square, to: Square): boolean {
  return chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion !== undefined)
}

/** Tries a move on a copy of the position. Returns its SAN, or null when it is not legal. */
export function sanFor(chess: Chess, from: Square, to: Square, promotion?: Promotion): string | null {
  const probe = new Chess(chess.fen())
  try {
    return probe.move({ from, to, promotion }).san
  } catch {
    return null
  }
}

export function kingSquare(chess: Chess, color: Color): Square | null {
  return chess.findPiece({ type: 'k', color })[0] ?? null
}

/** How the game ended on the board itself, or null while it is still in play. */
export function boardOutcome(chess: Chess): Outcome | null {
  if (chess.isCheckmate()) return { winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' }
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' }
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' }
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'repetition' }
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty_moves' }
  return null
}

const START_COUNT: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const DISPLAY_ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p']

function countPieces(fen: string): Record<Color, Record<PieceSymbol, number>> {
  const counts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  }
  for (const char of fen.split(' ')[0] ?? '') {
    const lower = char.toLowerCase()
    if (lower in START_COUNT) counts[char === lower ? 'b' : 'w'][lower as PieceSymbol]++
  }
  return counts
}

export type Material = {
  /** Pieces each side has taken, strongest first (so `w` lists black pieces). */
  captured: Record<Color, PieceSymbol[]>
  /** Points ahead for each side: one of them is always 0. */
  lead: Record<Color, number>
}

export function material(fen: string): Material {
  const counts = countPieces(fen)
  const captured: Record<Color, PieceSymbol[]> = { w: [], b: [] }
  let balance = 0
  for (const type of DISPLAY_ORDER) {
    balance += (counts.w[type] - counts.b[type]) * VALUE[type]
    for (const side of ['w', 'b'] as const) {
      const taker = side === 'w' ? 'b' : 'w'
      const missing = Math.max(0, START_COUNT[type] - counts[side][type])
      for (let i = 0; i < missing; i++) captured[taker].push(type)
    }
  }
  return { captured, lead: { w: Math.max(0, balance), b: Math.max(0, -balance) } }
}

/**
 * Whether `color` could still deliver mate. A player whose opponent runs out of time only wins
 * if they could; otherwise the game is drawn (the standard FIDE rule, simplified: a lone king,
 * or king with a single bishop or knight, cannot).
 */
export function canMate(fen: string, color: Color): boolean {
  const mine = countPieces(fen)[color]
  if (mine.p + mine.r + mine.q > 0) return true
  return mine.b + mine.n >= 2
}

export function timeoutOutcome(fen: string, flagged: Color): Outcome {
  const opponent: Color = flagged === 'w' ? 'b' : 'w'
  return { winner: canMate(fen, opponent) ? opponent : null, reason: 'timeout' }
}

/**
 * Squares a player may choose for a premove (a move queued while the opponent is thinking).
 *
 * This is deliberately NOT a legality check, and no rule of chess depends on it. Nobody can know
 * what will be legal after the opponent's reply, so, as on other chess sites, a premove may
 * point anywhere the piece could travel on an otherwise empty board (including onto a square
 * one of the player's own pieces stands on now: it may have been captured by then). When the
 * turn arrives the premove is played like any other move and chess.js decides whether it is
 * legal; if it is not, it is simply dropped.
 */
export function premoveTargets(from: Square, piece: PieceSymbol, color: Color): Square[] {
  const file = from.charCodeAt(0) - 97
  const rank = Number(from[1]) - 1
  const out: Square[] = []
  const add = (f: number, r: number) => {
    if (f >= 0 && f < 8 && r >= 0 && r < 8 && (f !== file || r !== rank)) out.push((String.fromCharCode(97 + f) + (r + 1)) as Square)
  }
  const ray = (df: number, dr: number) => {
    for (let step = 1; step < 8; step++) add(file + df * step, rank + dr * step)
  }
  const straight: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const diagonal: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

  if (piece === 'r' || piece === 'q') for (const [df, dr] of straight) ray(df, dr)
  if (piece === 'b' || piece === 'q') for (const [df, dr] of diagonal) ray(df, dr)
  if (piece === 'n') {
    for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const) add(file + df, rank + dr)
  }
  if (piece === 'k') {
    for (const [df, dr] of [...straight, ...diagonal]) add(file + df, rank + dr)
    // Castling, from the king's starting square.
    if (file === 4 && rank === (color === 'w' ? 0 : 7)) {
      add(6, rank)
      add(2, rank)
    }
  }
  if (piece === 'p') {
    const forward = color === 'w' ? 1 : -1
    add(file, rank + forward)
    if (rank === (color === 'w' ? 1 : 6)) add(file, rank + 2 * forward)
    add(file - 1, rank + forward)
    add(file + 1, rank + forward)
  }
  return out
}
