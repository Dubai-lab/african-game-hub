// International draughts (10 x 10), the rules of the World Draughts Federation (FMJD).
//
// One file holds the whole game. The draughts-action Edge Function runs it to decide every
// move; the app runs the very same file to show which moves are on offer and to play against
// the computer. The app never tells the server what a move did: it sends the squares a piece
// visits, and the server works the rest out from the game it has stored.
//
// The rules, in short:
//   * 50 dark squares, numbered 1 to 50 from the top left as White sees the board. Black starts
//     on 1-20, White on 31-50. White moves first.
//   * A man moves one square diagonally forward. It captures forward and backward, by jumping
//     an enemy piece on the next square to the empty square just beyond.
//   * A king (a man that ENDS its move on the far row) moves any distance along a diagonal, and
//     captures from a distance, landing on any empty square beyond the piece it takes.
//   * Capturing is compulsory, and the move that takes the MOST pieces must be played. A king
//     counts as one piece, like a man. With several such moves, the player chooses.
//   * Pieces taken are lifted only when the whole move is over. Until then they stay in the
//     way: no piece may be jumped twice.
//   * A man that passes the far row in the middle of a capture and jumps on is not crowned.
//   * A player who cannot move (no pieces, or all blocked) has lost.
//   * Drawn: the same position three times with the same player to move; 25 moves each of
//     kings only with nothing taken; 16 moves each once it is three pieces (a king among them)
//     against a lone king; 5 moves each once it is one or two pieces (a king among them)
//     against a lone king.

export type Color = 'w' | 'b'
/** 50 characters, square 1 first: '.' empty, 'w' 'b' men, 'W' 'B' kings. */
export type Board = string
/** A position as numbers, for speed: 0 empty, 1 white man, 2 white king, -1 black man, -2 black king. */
export type Cells = Int8Array

export type Move = {
  /** Every square the piece stands on, first to last (numbered 1-50). Two squares for a plain move. */
  path: number[]
  /** The squares of the pieces taken, in the order they are jumped. */
  captures: number[]
}

export type EndReason = 'no_pieces' | 'blocked' | 'repetition' | 'king_moves' | 'endgame'
export type Result = { winner: Color | null; reason: EndReason }

export type DraughtsState = {
  board: Board
  turn: Color
  /** Moves in a row, counting both players', that moved a king and took nothing. */
  kingPlies: number
  /** Which lone-king ending the game is in, and how many moves have been played in it. */
  endgame: 'three' | 'two' | null
  endgamePlies: number
  /** Positions since the last man move or capture (only those can ever come round again). */
  history: string[]
}

export type Played = Move & {
  color: Color
  /** "32-28", or "28x19" for a capture. */
  notation: string
  king: boolean
  promoted: boolean
  boardAfter: Board
}

export const START: Board = 'b'.repeat(20) + '.'.repeat(10) + 'w'.repeat(20)

// Both players' moves count, so these are twice the numbers in the rules.
export const KING_MOVES_LIMIT = 50
export const THREE_V_ONE_LIMIT = 32
export const TWO_V_ONE_LIMIT = 10

export const rowOf = (index: number) => Math.floor(index / 5)
/** Column 0-9 of a square, by its index 0-49. The top row's dark squares are columns 1, 3, 5, 7, 9. */
export const colOf = (index: number) => (index % 5) * 2 + (rowOf(index) % 2 === 0 ? 1 : 0)

/** NEXT[index * 4 + direction]: the neighbouring square, or -1 off the board. Directions: 0 up-left, 1 up-right, 2 down-left, 3 down-right. */
export const NEXT = new Int8Array(200)
for (let index = 0; index < 50; index++) {
  const row = rowOf(index)
  const col = colOf(index)
  ;[[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([dr, dc], direction) => {
    const r = row + dr!
    const c = col + dc!
    NEXT[index * 4 + direction] = r < 0 || r > 9 || c < 0 || c > 9 ? -1 : r * 5 + Math.floor(c / 2)
  })
}

const CODES: Record<string, number> = { '.': 0, w: 1, W: 2, b: -1, B: -2 }
const CHARS = ['B', 'b', '.', 'w', 'W']

export function toCells(board: Board): Cells {
  const cells = new Int8Array(50)
  for (let i = 0; i < 50; i++) cells[i] = CODES[board[i]!] ?? 0
  return cells
}

export function toBoard(cells: Cells): Board {
  let board = ''
  for (let i = 0; i < 50; i++) board += CHARS[cells[i]! + 2]
  return board
}

export const isBoard = (value: unknown): value is Board => typeof value === 'string' && /^[.wWbB]{50}$/.test(value)

/** Internal moves use indexes 0-49; `path` and `captures` there are indexes, not square numbers. */
type Raw = { path: number[]; captures: number[] }

function collectCaptures(cells: Cells, from: number, sign: number, out: Raw[]) {
  const piece = cells[from]!
  const king = piece === 2 * sign
  const path = [from]
  const taken: number[] = []
  // The piece has left its square: it may come back over it during the move.
  cells[from] = 0

  const walk = (at: number) => {
    let jumped = false
    for (let direction = 0; direction < 4; direction++) {
      let over = NEXT[at * 4 + direction]!
      if (king) while (over >= 0 && cells[over] === 0) over = NEXT[over * 4 + direction]!
      // An enemy piece that has not been jumped already in this move.
      if (over < 0 || cells[over]! * sign >= 0 || taken.includes(over)) continue
      let land = NEXT[over * 4 + direction]!
      while (land >= 0 && cells[land] === 0) {
        jumped = true
        taken.push(over)
        path.push(land)
        walk(land)
        path.pop()
        taken.pop()
        if (!king) break
        land = NEXT[land * 4 + direction]!
      }
    }
    if (!jumped && taken.length > 0) out.push({ path: [...path], captures: [...taken] })
  }
  walk(from)
  cells[from] = piece
}

/** Every legal move for the side to play, as indexes. Captures, when there are any, are the only moves, and only the longest. */
export function generate(cells: Cells, turn: Color): Raw[] {
  const sign = turn === 'w' ? 1 : -1
  const captures: Raw[] = []
  for (let from = 0; from < 50; from++) if (cells[from]! * sign > 0) collectCaptures(cells, from, sign, captures)
  if (captures.length > 0) {
    let most = 0
    for (const move of captures) if (move.captures.length > most) most = move.captures.length
    return captures.filter((move) => move.captures.length === most)
  }

  const moves: Raw[] = []
  // White plays up the board (toward square 1), Black down.
  const forward = turn === 'w' ? [0, 1] : [2, 3]
  for (let from = 0; from < 50; from++) {
    const piece = cells[from]!
    if (piece * sign <= 0) continue
    if (piece === sign) {
      for (const direction of forward) {
        const to = NEXT[from * 4 + direction]!
        if (to >= 0 && cells[to] === 0) moves.push({ path: [from, to], captures: [] })
      }
    } else {
      for (let direction = 0; direction < 4; direction++) {
        let to = NEXT[from * 4 + direction]!
        while (to >= 0 && cells[to] === 0) {
          moves.push({ path: [from, to], captures: [] })
          to = NEXT[to * 4 + direction]!
        }
      }
    }
  }
  return moves
}

/** Plays a move on a copy of the position. Returns the new position and whether the piece was crowned. */
export function play(cells: Cells, move: Raw): { cells: Cells; promoted: boolean } {
  const next = new Int8Array(cells)
  const from = move.path[0]!
  const to = move.path[move.path.length - 1]!
  let piece = next[from]!
  next[from] = 0
  for (const taken of move.captures) next[taken] = 0
  // Crowned only where the move ends.
  const promoted = (piece === 1 && rowOf(to) === 0) || (piece === -1 && rowOf(to) === 9)
  if (promoted) piece *= 2
  next[to] = piece
  return { cells: next, promoted }
}

const numbered = (move: Raw): Move => ({ path: move.path.map((i) => i + 1), captures: move.captures.map((i) => i + 1) })

export function initialState(): DraughtsState {
  return { board: START, turn: 'w', kingPlies: 0, endgame: null, endgamePlies: 0, history: [START + 'w'] }
}

/** Every legal move in a position, in square numbers. */
export function legalMoves(state: Pick<DraughtsState, 'board' | 'turn'>): Move[] {
  return generate(toCells(state.board), state.turn).map(numbered)
}

/** The lone-king ending a position is, if it is one. */
function endgameOf(cells: Cells): DraughtsState['endgame'] {
  const count = { w: 0, b: 0, wk: 0, bk: 0 }
  for (let i = 0; i < 50; i++) {
    const piece = cells[i]!
    if (piece > 0) count.w++
    if (piece < 0) count.b++
    if (piece === 2) count.wk++
    if (piece === -2) count.bk++
  }
  for (const [alone, aloneKings, others, otherKings] of [[count.w, count.wk, count.b, count.bk], [count.b, count.bk, count.w, count.wk]] as const) {
    if (alone !== 1 || aloneKings !== 1 || otherKings < 1) continue
    if (others === 3) return 'three'
    if (others <= 2) return 'two'
  }
  return null
}

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((square, i) => square === b[i])

/**
 * Plays the move that visits exactly these squares. Null when there is no such legal move.
 * `result` is set when the move ends the game.
 */
export function applyMove(state: DraughtsState, path: number[]): { state: DraughtsState; move: Played; result: Result | null } | null {
  const cells = toCells(state.board)
  const wanted = path.map((square) => square - 1)
  const raw = generate(cells, state.turn).find((move) => samePath(move.path, wanted))
  if (!raw) return null

  const king = Math.abs(cells[raw.path[0]!]!) === 2
  const after = play(cells, raw)
  const board = toBoard(after.cells)
  const turn: Color = state.turn === 'w' ? 'b' : 'w'
  const capture = raw.captures.length > 0
  const quiet = king && !capture

  const key = board + turn
  const endgame = endgameOf(after.cells)
  const next: DraughtsState = {
    board,
    turn,
    kingPlies: quiet ? state.kingPlies + 1 : 0,
    endgame,
    // The count starts with the move after the one that brought the ending about.
    endgamePlies: endgame !== null && endgame === state.endgame ? state.endgamePlies + 1 : 0,
    // A man's move or a capture can never be undone, so nothing before it can come round again.
    history: quiet ? [...state.history, key] : [key],
  }

  const from = raw.path[0]! + 1
  const to = raw.path[raw.path.length - 1]! + 1
  const move: Played = {
    ...numbered(raw),
    color: state.turn,
    notation: `${from}${capture ? 'x' : '-'}${to}`,
    king,
    promoted: after.promoted,
    boardAfter: board,
  }

  let result: Result | null = null
  if (generate(after.cells, turn).length === 0) {
    const sign = turn === 'w' ? 1 : -1
    result = { winner: state.turn, reason: after.cells.some((piece) => piece * sign > 0) ? 'blocked' : 'no_pieces' }
  } else if (next.history.filter((seen) => seen === key).length >= 3) {
    result = { winner: null, reason: 'repetition' }
  } else if (next.kingPlies >= KING_MOVES_LIMIT) {
    result = { winner: null, reason: 'king_moves' }
  } else if ((endgame === 'three' && next.endgamePlies >= THREE_V_ONE_LIMIT) || (endgame === 'two' && next.endgamePlies >= TWO_V_ONE_LIMIT)) {
    result = { winner: null, reason: 'endgame' }
  }
  return { state: next, move, result }
}

/**
 * Plays a whole game through from the start. Null when the moves do not replay (a damaged
 * record). `result` is the board's own verdict after the last move, if the game ended there.
 */
export function replay(paths: number[][]): { state: DraughtsState; played: Played[]; result: Result | null } | null {
  let state = initialState()
  const played: Played[] = []
  let result: Result | null = null
  for (const path of paths) {
    if (result) return null
    const step = applyMove(state, path)
    if (!step) return null
    state = step.state
    played.push(step.move)
    result = step.result
  }
  return { state, played, result }
}

/** Men and kings each side has on the board. */
export function material(board: Board): Record<Color, { men: number; kings: number }> {
  const count = { w: { men: 0, kings: 0 }, b: { men: 0, kings: 0 } }
  for (const piece of board) {
    if (piece === 'w') count.w.men++
    else if (piece === 'W') count.w.kings++
    else if (piece === 'b') count.b.men++
    else if (piece === 'B') count.b.kings++
  }
  return count
}
