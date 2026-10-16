// Oware (Abapa), the sowing game of Ghana and the wider region, played to the rules used in
// tournaments.
//
// One file holds the whole game. The oware-action Edge Function runs it to decide every move;
// the app runs the very same file to show which pits may be played, to draw the sowing, and to
// play against the computer. The app sends only the pit it wants to play, and the server works
// the rest out from the game it has stored.
//
// The rules, in short:
//   * Twelve pits in two rows of six, four seeds in each: 48 seeds. Each player owns the row
//     nearer them. South moves first.
//   * A move: take every seed from one of your own pits and sow them one by one, anticlockwise,
//     into the pits that follow. A pit holding twelve or more seeds goes all the way round: the
//     pit it was emptied from is skipped.
//   * Capture: if the last seed lands in an opponent's pit and makes it two or three, those
//     seeds are taken, and so are the seeds of the pits just before it, going back, for as long
//     as they are also the opponent's and also hold two or three.
//   * Grand slam: a move that would take every seed the opponent has is played, but takes
//     nothing.
//   * Feeding: when the opponent's row is empty, a move must be played that gives them seeds, if
//     there is one.
//   * The game is won by the first to take 25 seeds. At 24 each it is a draw.
//   * The game also ends when the player to move has no move they may play (they cannot feed
//     an empty row), when the same position comes round a third time, or after 100 moves in a
//     row without a capture. Each player then takes the seeds left in their own row, and the
//     one with more has won.

export type Side = 's' | 'n'
/** Twelve counts, pit 0 first. South owns 0-5, North 6-11; sowing goes 0, 1, ... 11, 0. */
export type Pits = number[]

export type EndReason = 'majority' | 'no_moves' | 'repetition' | 'no_captures'
export type Result = { winner: Side | null; reason: EndReason }

export type OwareState = {
  pits: Pits
  /** Seeds taken so far by each player. */
  stores: Record<Side, number>
  turn: Side
  /** Moves in a row, counting both players', that took nothing. */
  quietPlies: number
  /** Positions since the last capture (only those can ever come round again). */
  history: string[]
}

export type Played = {
  side: Side
  /** The pit played, 0-11. */
  pit: number
  /** "c" for South's third pit, "C" for North's. */
  notation: string
  /** Every pit a seed was sown into, in order (a pit can appear twice in a long move). */
  sown: number[]
  /** The pits emptied by the capture, in the order they were taken (last seed's pit first). */
  captured: number[]
  /** Seeds taken by this move. */
  taken: number
  /** True when the move would have taken every seed the opponent had, and so took nothing. */
  grandSlam: boolean
  pitsAfter: Pits
}

export const SEEDS = 48
export const PITS = 12
export const TO_WIN = 25
export const NO_CAPTURE_LIMIT = 100
export const START: Pits = Array.from({ length: PITS }, () => 4)

export const other = (side: Side): Side => (side === 's' ? 'n' : 's')
/** The first pit of a side's row. */
export const rowStart = (side: Side) => (side === 's' ? 0 : 6)
export const ownerOf = (pit: number): Side => (pit < 6 ? 's' : 'n')
export const rowOf = (pits: Pits, side: Side) => pits.slice(rowStart(side), rowStart(side) + 6)
const rowTotal = (pits: Pits, side: Side) => rowOf(pits, side).reduce((sum, seeds) => sum + seeds, 0)

/** "a" to "f" across South's row from South's left; "A" to "F" across North's from North's left. */
export const notationOf = (pit: number) => (pit < 6 ? 'abcdef'[pit]! : 'ABCDEF'[pit - 6]!)

const key = (pits: Pits, turn: Side) => `${pits.join(',')}|${turn}`

export const isPits = (value: unknown): value is Pits =>
  Array.isArray(value) && value.length === PITS && value.every((seeds) => Number.isInteger(seeds) && seeds >= 0 && seeds <= SEEDS)

export function initialState(): OwareState {
  return { pits: [...START], stores: { s: 0, n: 0 }, turn: 's', quietPlies: 0, history: [key(START, 's')] }
}

/** Sows the seeds of one pit and applies the capture rules. Knows nothing of whose turn it is. */
export function sow(pits: Pits, pit: number): { pits: Pits; sown: number[]; captured: number[]; taken: number; grandSlam: boolean } {
  const next = [...pits]
  const side = ownerOf(pit)
  let seeds = next[pit]!
  next[pit] = 0
  const sown: number[] = []
  let at = pit
  while (seeds > 0) {
    at = (at + 1) % PITS
    // Twelve seeds or more go right round: the pit they came from is not sown into.
    if (at === pit) continue
    next[at]! += 1
    sown.push(at)
    seeds--
  }

  const captured: number[] = []
  let taken = 0
  let look = at
  while (ownerOf(look) !== side && (next[look] === 2 || next[look] === 3)) {
    captured.push(look)
    taken += next[look]!
    // Going back along the opponent's row, and no further than its first pit.
    if (look === rowStart(other(side))) break
    look -= 1
  }
  if (captured.length === 0) return { pits: next, sown, captured, taken: 0, grandSlam: false }

  // Taking everything the opponent has is not allowed: the seeds stay where they were sown.
  const left = rowOf(next, other(side)).reduce((sum, seeds, index) => sum + (captured.includes(rowStart(other(side)) + index) ? 0 : seeds), 0)
  if (left === 0) return { pits: next, sown, captured: [], taken: 0, grandSlam: true }

  for (const p of captured) next[p] = 0
  return { pits: next, sown, captured, taken, grandSlam: false }
}

/** The pits the player to move may play. Empty when they have no move. */
export function legalPits(state: Pick<OwareState, 'pits' | 'turn'>): number[] {
  const start = rowStart(state.turn)
  const own = [0, 1, 2, 3, 4, 5].map((i) => start + i).filter((pit) => state.pits[pit]! > 0)
  // An empty row must be fed if it can be.
  if (rowTotal(state.pits, other(state.turn)) > 0) return own
  return own.filter((pit) => rowTotal(sow(state.pits, pit).pits, other(state.turn)) > 0)
}

/** Each player takes the seeds left in their own row; the one with more has won. */
function split(pits: Pits, stores: Record<Side, number>, reason: EndReason): { pits: Pits; stores: Record<Side, number>; result: Result } {
  const after = { s: stores.s + rowTotal(pits, 's'), n: stores.n + rowTotal(pits, 'n') }
  return { pits: pits.map(() => 0), stores: after, result: { winner: after.s === after.n ? null : after.s > after.n ? 's' : 'n', reason } }
}

/**
 * Plays one pit for the player to move. Null when that pit may not be played. When the move ends
 * the game, `state` already shows the seeds each player was left with.
 */
export function applyMove(state: OwareState, pit: number): { state: OwareState; move: Played; result: Result | null } | null {
  if (!Number.isInteger(pit) || !legalPits(state).includes(pit)) return null
  const side = state.turn
  const sowing = sow(state.pits, pit)
  const stores = { ...state.stores, [side]: state.stores[side] + sowing.taken }
  const move: Played = {
    side,
    pit,
    notation: notationOf(pit),
    sown: sowing.sown,
    captured: sowing.captured,
    taken: sowing.taken,
    grandSlam: sowing.grandSlam,
    pitsAfter: sowing.pits,
  }
  const turn = other(side)
  const quietPlies = sowing.taken > 0 ? 0 : state.quietPlies + 1
  const position = key(sowing.pits, turn)
  const history = sowing.taken > 0 ? [position] : [...state.history, position]
  const next: OwareState = { pits: sowing.pits, stores, turn, quietPlies, history }

  if (stores.s >= TO_WIN || stores.n >= TO_WIN || (stores.s === SEEDS / 2 && stores.n === SEEDS / 2)) {
    const winner = stores.s >= TO_WIN ? 's' : stores.n >= TO_WIN ? 'n' : null
    return { state: next, move, result: { winner, reason: 'majority' } }
  }
  const ending: EndReason | null =
    legalPits(next).length === 0 ? 'no_moves' : history.filter((seen) => seen === position).length >= 3 ? 'repetition' : quietPlies >= NO_CAPTURE_LIMIT ? 'no_captures' : null
  if (ending) {
    const end = split(next.pits, next.stores, ending)
    return { state: { ...next, pits: end.pits, stores: end.stores }, move, result: end.result }
  }
  return { state: next, move, result: null }
}

/** Plays a whole game through from the start. Null if any move in it may not be played. */
export function replay(moves: number[]): { state: OwareState; played: Played[]; result: Result | null } | null {
  let state = initialState()
  const played: Played[] = []
  let result: Result | null = null
  for (const pit of moves) {
    if (result) return null
    const step = applyMove(state, pit)
    if (!step) return null
    state = step.state
    played.push(step.move)
    result = step.result
  }
  return { state, played, result }
}
