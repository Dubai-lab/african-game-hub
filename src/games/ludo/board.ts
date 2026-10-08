// The Ludo board as numbers, for drawing only. The rules themselves run on the server
// (supabase/migrations/*_ludo.sql); the figures here must match the ones documented there.
//
// The board is a 15 x 15 grid. A cell is [column, row], counted from the top-left corner.

export const SEATS = ['red', 'green', 'yellow', 'blue'] as const
export type Seat = (typeof SEATS)[number]
export type Cell = readonly [number, number]

export const HOME = 56
export const YARD = -1
/** The square on the shared track where each colour enters. */
export const START: Record<Seat, number> = { red: 0, green: 13, yellow: 26, blue: 39 }
/** Start squares and stars: a piece standing here cannot be captured. */
export const SAFE_SQUARES = [0, 8, 13, 21, 26, 34, 39, 47] as const
export const STAR_SQUARES = [8, 21, 34, 47] as const

export const SEAT_COLOR: Record<Seat, string> = { red: '#d1264f', green: '#0b7a55', yellow: '#f5b700', blue: '#1f2a7a' }

const line = (from: Cell, to: Cell): Cell[] => {
  const cells: Cell[] = []
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))
  for (let i = 0; i <= steps; i++) {
    cells.push([from[0] + Math.sign(to[0] - from[0]) * i, from[1] + Math.sign(to[1] - from[1]) * i])
  }
  return cells
}

/** The 52 squares of the outer track, clockwise, starting from red's start square. */
export const TRACK: readonly Cell[] = [
  ...line([1, 6], [5, 6]),
  ...line([6, 5], [6, 0]),
  [7, 0],
  ...line([8, 0], [8, 5]),
  ...line([9, 6], [14, 6]),
  [14, 7],
  ...line([14, 8], [9, 8]),
  ...line([8, 9], [8, 14]),
  [7, 14],
  ...line([6, 14], [6, 9]),
  ...line([5, 8], [0, 8]),
  [0, 7],
  [0, 6],
]

/** Each colour's home column: five squares, then home itself (progress 51 to 56). */
export const HOME_COLUMN: Record<Seat, readonly Cell[]> = {
  red: line([1, 7], [6, 7]),
  green: line([7, 1], [7, 6]),
  yellow: line([13, 7], [8, 7]),
  blue: line([7, 13], [7, 8]),
}

/** Top-left corner of each colour's yard (a 6 x 6 block). */
export const YARD_CORNER: Record<Seat, Cell> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] }
const YARD_SPOTS: readonly Cell[] = [
  [1.5, 1.5],
  [3.5, 1.5],
  [1.5, 3.5],
  [3.5, 3.5],
]

/** Where a piece is drawn, given how far it has travelled. */
export function cellOf(seat: Seat, progress: number, piece: number): Cell {
  if (progress <= YARD) {
    const corner = YARD_CORNER[seat]
    const spot = YARD_SPOTS[piece % 4]!
    return [corner[0] + spot[0], corner[1] + spot[1]]
  }
  if (progress <= 50) return TRACK[(START[seat] + progress) % 52]!
  return HOME_COLUMN[seat][Math.min(progress, HOME) - 51]!
}

/** Which pieces can move with this throw. For highlighting only: the server decides. */
export function movablePieces(progress: readonly number[], die: number): number[] {
  return progress.flatMap((p, piece) => ((p === YARD && die === 6) || (p >= 0 && p + die <= HOME) ? [piece] : []))
}
