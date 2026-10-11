// Word Battle: the crossword game of letter tiles. The whole rule book, in one file.
//
// The server judges every turn with this file (the words-action function), and the app uses
// the very same file to show what a turn would score before it is played, and for practice
// against the computer. It is plain arithmetic on plain data: no clock, no randomness of its
// own, and no word list of its own (whoever calls it says whether a word is a word), so it
// gives the same answer everywhere.
//
// The game, as agreed with the owner (12 October 2026): two to four players (two unless the
// players choose a bigger table), seven tiles each from a bag of a hundred.
//   * A turn is one of: lay tiles in one straight line to make a word that joins the tiles
//     already down (the first word covers the middle square); swap some tiles for new ones
//     (only while the bag still holds seven); or pass.
//   * Every row of two or more touching tiles made or lengthened by the turn must be a word.
//   * Each word scores the sum of its tiles. A square that doubles or triples a letter, or the
//     whole word, counts only for a tile laid on it this turn. All seven tiles in one turn
//     earns 50 more. A blank tile stands for any letter and scores nothing.
//   * The game ends when the bag is empty and a player has laid their last tile, or when
//     every player has had two turns in a row without scoring. Tiles left on a rack are taken
//     off that player's score; a player who goes out gains what the others were left with.
//     The highest score wins; level highest scores are a draw.
//   * A player who lets their turn run out twice in a row, or who leaves, is out of the game:
//     their tiles are put aside and the others play on. The last player left wins.
//
// The board and the tiles are the hub's own. The squares that double and triple are laid out
// to our own plan, not that of any published game.

export const SIZE = 15
export const RACK_SIZE = 7
export const ALL_TILES_BONUS = 50
/** Turns a player may let run out in a row before they are out of the game. */
export const MISSES_ALLOWED = 1

export type Seat = string
/** On a rack or in the bag: a letter 'a' to 'z', or '?' for a blank. */
export type Tile = string

/** How many of each tile the bag starts with: a hundred in all. */
export const TILE_COUNTS: Record<Tile, number> = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4, m: 2, n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1, '?': 2,
}
/** What each letter scores: the rarer it is in English words, the more. A blank scores nothing. */
export const TILE_VALUES: Record<Tile, number> = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3, n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10, '?': 0,
}
/** The whole bag, in a fixed order. */
export const ALL_TILES: readonly Tile[] = Object.entries(TILE_COUNTS).flatMap(([tile, count]) => Array.from({ length: count }, () => tile))

/** A square's bonus: double or triple the letter laid on it, or the whole word. */
export type Bonus = 'DL' | 'TL' | 'DW' | 'TW' | null
// One quarter of the board (its top left), row by row; the other three mirror it. The middle
// square, where the first word must lie, doubles that word.
const QUARTER = [
  '...T..t.',
  '..d..D..',
  '.d..d...',
  'T..t...D',
  '..d...d.',
  '.D...t..',
  't...d...',
  '...D...D',
]
const BONUS_OF: Record<string, Bonus> = { '.': null, d: 'DL', t: 'TL', D: 'DW', T: 'TW' }
const fold = (n: number) => (n < 8 ? n : SIZE - 1 - n)
/** The bonus of a square, if it has one. */
export const bonusAt = (row: number, col: number): Bonus => BONUS_OF[QUARTER[fold(row)]![fold(col)]!]!
export const CENTRE = 7

/**
 * The board: 225 characters, row by row. '.' is an empty square, a small letter is a tile, and
 * a CAPITAL letter is a blank tile standing for that letter (it scores nothing).
 */
export type Board = string
export const EMPTY_BOARD: Board = '.'.repeat(SIZE * SIZE)
export const cell = (board: Board, row: number, col: number) => board[row * SIZE + col]!
const filled = (board: Board, row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE && cell(board, row, col) !== '.'
/** What a square on the board scores: nothing for a blank. */
const worth = (square: string) => (square >= 'a' && square <= 'z' ? TILE_VALUES[square]! : 0)

/** One tile being laid: where, and which letter. `blank` when the tile used is a blank standing for it. */
export type Laid = { row: number; col: number; letter: string; blank?: boolean }

export type PlayRefusal = 'NO_TILES' | 'OFF_BOARD' | 'SQUARE_TAKEN' | 'NOT_IN_LINE' | 'GAP' | 'FIRST_ON_CENTRE' | 'NOT_JOINED' | 'ONE_LETTER'
export type Scored = { word: string; score: number }
export type Evaluated = { ok: true; words: Scored[]; score: number; board: Board } | { ok: false; code: PlayRefusal }

/**
 * Works out a turn of tiles on a board: whether it is laid as the rules ask, the words it
 * makes, and what it scores. It does NOT say whether those are real words: that is the word
 * list's business (see `act`).
 */
export function evaluate(board: Board, tiles: readonly Laid[]): Evaluated {
  if (tiles.length === 0) return { ok: false, code: 'NO_TILES' }
  const squares = [...board]
  const laid = new Set<number>()
  for (const tile of tiles) {
    if (!Number.isInteger(tile.row) || !Number.isInteger(tile.col) || tile.row < 0 || tile.row >= SIZE || tile.col < 0 || tile.col >= SIZE) return { ok: false, code: 'OFF_BOARD' }
    const at = tile.row * SIZE + tile.col
    if (squares[at] !== '.' || laid.has(at)) return { ok: false, code: 'SQUARE_TAKEN' }
    laid.add(at)
    squares[at] = tile.blank ? tile.letter.toUpperCase() : tile.letter
  }
  const next = squares.join('')
  const oneRow = tiles.every((tile) => tile.row === tiles[0]!.row)
  const oneCol = tiles.every((tile) => tile.col === tiles[0]!.col)
  if (!oneRow && !oneCol) return { ok: false, code: 'NOT_IN_LINE' }

  /** The row of touching tiles through a square, across or down: its letters and what it scores. */
  const wordThrough = (row: number, col: number, across: boolean): (Scored & { from: number; to: number }) | null => {
    const dr = across ? 0 : 1
    const dc = across ? 1 : 0
    let r = row
    let c = col
    while (filled(next, r - dr, c - dc)) {
      r -= dr
      c -= dc
    }
    const from = across ? c : r
    let word = ''
    let sum = 0
    let times = 1
    while (filled(next, r, c)) {
      const square = cell(next, r, c)
      word += square.toLowerCase()
      const bonus = laid.has(r * SIZE + c) ? bonusAt(r, c) : null
      sum += worth(square) * (bonus === 'DL' ? 2 : bonus === 'TL' ? 3 : 1)
      if (bonus === 'DW') times *= 2
      if (bonus === 'TW') times *= 3
      r += dr
      c += dc
    }
    return word.length >= 2 ? { word, score: sum * times, from, to: (across ? c : r) - 1 } : null
  }

  // A single tile makes its word whichever way it has neighbours; several lie along their line.
  const across = tiles.length > 1 ? oneRow : wordThrough(tiles[0]!.row, tiles[0]!.col, true) !== null || !wordThrough(tiles[0]!.row, tiles[0]!.col, false)
  const main = wordThrough(tiles[0]!.row, tiles[0]!.col, across)
  // Every tile laid must be part of the one row of tiles: no hole between them.
  if (tiles.length > 1 && (!main || tiles.some((tile) => (across ? tile.col : tile.row) < main.from || (across ? tile.col : tile.row) > main.to))) return { ok: false, code: 'GAP' }

  const words: Scored[] = []
  if (main) words.push({ word: main.word, score: main.score })
  for (const tile of tiles) {
    const crossing = wordThrough(tile.row, tile.col, !across)
    if (crossing) words.push({ word: crossing.word, score: crossing.score })
  }

  if (board === EMPTY_BOARD || !board.match(/[a-zA-Z]/)) {
    // The first word of the game.
    if (!laid.has(CENTRE * SIZE + CENTRE)) return { ok: false, code: 'FIRST_ON_CENTRE' }
    if (!main) return { ok: false, code: 'ONE_LETTER' }
  } else {
    // Joined to what is down: the main word runs through an old tile, or a crossing word was made.
    const lengthLaid = tiles.length
    const joined = words.length > 1 || (main !== null && main.word.length > lengthLaid)
    if (!joined) return { ok: false, code: 'NOT_JOINED' }
  }
  if (words.length === 0) return { ok: false, code: 'ONE_LETTER' }

  const score = words.reduce((sum, word) => sum + word.score, 0) + (tiles.length === RACK_SIZE ? ALL_TILES_BONUS : 0)
  return { ok: true, words, score, board: next }
}

export type Over = {
  /** finished: a player laid their last tile with the bag empty. stalled: nobody scored for two rounds. last_standing: everyone else left. */
  reason: 'finished' | 'stalled' | 'last_standing'
  /** Null when the highest scores are level: a draw. */
  winner: Seat | null
  /** The final scores, after the tiles left on the racks were counted. */
  scores: Record<Seat, number>
}

export type WordsState = {
  /** Everyone who sat down, in the order of play. */
  seats: Seat[]
  /** Those who have left the game or let their time run out too often. */
  out: Seat[]
  board: Board
  racks: Record<Seat, Tile[]>
  /** The tiles still to be drawn. The next one drawn is the LAST in the list. */
  bag: Tile[]
  scores: Record<Seat, number>
  turn: Seat
  /** Turns in a row, by anyone, that scored nothing. */
  scoreless: number
  /** Goes up by one with everything that happens: a request made on an old picture is refused. */
  moveNo: number
  /** How many turns in a row each player has let run out. */
  missed: Record<Seat, number>
  over: Over | null
}

export type Action = { type: 'place'; tiles: Laid[] } | { type: 'swap'; tiles: Tile[] } | { type: 'pass' }

/** What happened, for everyone at the table to be shown. Never names a tile that was drawn or swapped. */
export type TableEvent = {
  seat: Seat
  kind: 'place' | 'swap' | 'pass' | 'timeout' | 'out'
  /** The words made, and what the turn scored. */
  words?: Scored[]
  score?: number
  /** The squares laid on this turn, to light them up. */
  squares?: number[]
  /** How many tiles were swapped. */
  swapped?: number
}

export type Refusal = PlayRefusal | 'GAME_OVER' | 'NOT_YOUR_TURN' | 'NOT_YOUR_TILE' | 'NOT_A_WORD' | 'BAG_TOO_LOW' | 'BAD_REQUEST'
export type Played = { ok: true; state: WordsState; event: TableEvent } | { ok: false; code: Refusal; words?: string[] }
/** What the rules need from outside: the word list, and a source of chance for putting swapped tiles back. */
export type Judge = { isWord: (word: string) => boolean; random: () => number }

const copy = (state: WordsState): WordsState => ({
  ...state,
  seats: [...state.seats],
  out: [...state.out],
  racks: Object.fromEntries(Object.entries(state.racks).map(([seat, tiles]) => [seat, [...tiles]])),
  bag: [...state.bag],
  scores: { ...state.scores },
  missed: { ...state.missed },
  over: state.over && { ...state.over, scores: { ...state.over.scores } },
})

/** The players still in the game, in the order of play. */
export const playing = (state: Pick<WordsState, 'seats' | 'out'>): Seat[] => state.seats.filter((seat) => !state.out.includes(seat))

/** Who plays after this seat: the next player still in the game. */
export function nextSeat(state: Pick<WordsState, 'seats' | 'out'>, from: Seat): Seat {
  const at = state.seats.indexOf(from)
  for (let step = 1; step <= state.seats.length; step++) {
    const seat = state.seats[(at + step) % state.seats.length]!
    if (!state.out.includes(seat)) return seat
  }
  return from
}

export const rackValue = (rack: readonly Tile[]) => rack.reduce((sum, tile) => sum + (TILE_VALUES[tile] ?? 0), 0)

/**
 * A fresh game: the bag shuffled and seven tiles each. `random` gives a number from 0 up to
 * (not including) 1, like Math.random; the server uses its own source of chance (the database
 * deals a real game; this is for practice and for tests).
 */
export function deal(seats: Seat[], random: () => number): WordsState {
  const bag = [...ALL_TILES]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j]!, bag[i]!]
  }
  const racks: Record<Seat, Tile[]> = {}
  for (const seat of seats) racks[seat] = bag.splice(bag.length - RACK_SIZE, RACK_SIZE)
  const zero = () => Object.fromEntries(seats.map((seat) => [seat, 0]))
  return { seats: [...seats], out: [], board: EMPTY_BOARD, racks, bag, scores: zero(), turn: seats[0]!, scoreless: 0, moveNo: 0, missed: zero(), over: null }
}

/** The end: tiles left on a rack come off that player's score, and go to a player who went out. */
function finish(state: WordsState, reason: Over['reason'], wentOut: Seat | null) {
  const scores = { ...state.scores }
  const left = playing(state)
  if (reason !== 'last_standing') {
    let pool = 0
    for (const seat of left) {
      const value = rackValue(state.racks[seat]!)
      scores[seat] = scores[seat]! - value
      pool += value
    }
    if (wentOut) scores[wentOut] = scores[wentOut]! + pool
  }
  let winner: Seat | null
  if (reason === 'last_standing') winner = left[0] ?? null
  else {
    const best = Math.max(...left.map((seat) => scores[seat]!))
    const leaders = left.filter((seat) => scores[seat] === best)
    winner = leaders.length === 1 ? leaders[0]! : null
  }
  state.scores = scores
  state.over = { reason, winner, scores }
}

/** Takes a turn for the player whose turn it is. */
export function act(before: WordsState, seat: Seat, action: Action, judge: Judge): Played {
  if (before.over) return { ok: false, code: 'GAME_OVER' }
  if (before.turn !== seat || before.out.includes(seat)) return { ok: false, code: 'NOT_YOUR_TURN' }
  const state = copy(before)
  state.moveNo++
  state.missed[seat] = 0
  const rack = state.racks[seat]!
  /** Takes these tiles off the rack; false (rack untouched) if any is not there. */
  const spend = (tiles: readonly Tile[]) => {
    const rest = [...rack]
    for (const tile of tiles) {
      const at = rest.indexOf(tile)
      if (at < 0) return false
      rest.splice(at, 1)
    }
    rack.splice(0, rack.length, ...rest)
    return true
  }

  if (action.type === 'pass') {
    state.scoreless++
    state.turn = nextSeat(state, seat)
    if (state.scoreless >= playing(state).length * 2) finish(state, 'stalled', null)
    return { ok: true, state, event: { seat, kind: 'pass' } }
  }

  if (action.type === 'swap') {
    if (!Array.isArray(action.tiles) || action.tiles.length === 0 || action.tiles.length > RACK_SIZE || !action.tiles.every((tile) => typeof tile === 'string' && tile in TILE_COUNTS)) return { ok: false, code: 'BAD_REQUEST' }
    if (state.bag.length < RACK_SIZE) return { ok: false, code: 'BAG_TOO_LOW' }
    if (!spend(action.tiles)) return { ok: false, code: 'NOT_YOUR_TILE' }
    // New tiles are drawn first, then the old ones go back in at places chosen by chance.
    for (let i = 0; i < action.tiles.length; i++) rack.push(state.bag.pop()!)
    for (const tile of action.tiles) state.bag.splice(Math.floor(judge.random() * (state.bag.length + 1)), 0, tile)
    state.scoreless++
    state.turn = nextSeat(state, seat)
    if (state.scoreless >= playing(state).length * 2) finish(state, 'stalled', null)
    return { ok: true, state, event: { seat, kind: 'swap', swapped: action.tiles.length } }
  }

  if (action.type !== 'place' || !Array.isArray(action.tiles) || action.tiles.length > RACK_SIZE) return { ok: false, code: 'BAD_REQUEST' }
  if (!action.tiles.every((tile) => tile && typeof tile.letter === 'string' && /^[a-z]$/.test(tile.letter))) return { ok: false, code: 'BAD_REQUEST' }
  if (!spend(action.tiles.map((tile) => (tile.blank ? '?' : tile.letter)))) return { ok: false, code: 'NOT_YOUR_TILE' }
  const laid = evaluate(state.board, action.tiles)
  if (!laid.ok) return { ok: false, code: laid.code }
  const wrong = laid.words.map((scored) => scored.word).filter((word) => !judge.isWord(word))
  if (wrong.length > 0) return { ok: false, code: 'NOT_A_WORD', words: wrong }

  state.board = laid.board
  state.scores[seat] = state.scores[seat]! + laid.score
  state.scoreless = 0
  while (rack.length < RACK_SIZE && state.bag.length > 0) rack.push(state.bag.pop()!)
  const event: TableEvent = { seat, kind: 'place', words: laid.words, score: laid.score, squares: action.tiles.map((tile) => tile.row * SIZE + tile.col) }
  if (rack.length === 0) finish(state, 'finished', seat)
  else state.turn = nextSeat(state, seat)
  return { ok: true, state, event }
}

/** A player is out of the game: their tiles are put aside and the others play on. */
export function leave(before: WordsState, seat: Seat): Played {
  if (before.over) return { ok: false, code: 'GAME_OVER' }
  if (!before.seats.includes(seat) || before.out.includes(seat)) return { ok: false, code: 'BAD_REQUEST' }
  const state = copy(before)
  state.moveNo++
  const after = nextSeat(state, seat)
  const theirTurn = state.turn === seat
  state.out.push(seat)
  state.racks[seat] = []
  if (theirTurn) state.turn = after
  if (playing(state).length === 1) finish(state, 'last_standing', null)
  return { ok: true, state, event: { seat, kind: 'out' } }
}

/**
 * The player to move has let their time run out. The first time, the turn is passed for them;
 * if it happens again on their very next turn, they are out of the game.
 */
export function timeout(before: WordsState, judge: Judge): Played {
  if (before.over) return { ok: false, code: 'GAME_OVER' }
  const seat = before.turn
  if (before.missed[seat]! >= MISSES_ALLOWED) return leave(before, seat)
  const passed = act(before, seat, { type: 'pass' }, judge)
  if (!passed.ok) return passed
  passed.state.missed[seat] = before.missed[seat]! + 1
  return { ok: true, state: passed.state, event: { ...passed.event, kind: 'timeout' } }
}

/** Is this a position the rules could have produced? No tile that is not in the bag's hundred, and none too many. */
export function isSound(state: WordsState): boolean {
  if (typeof state.board !== 'string' || state.board.length !== SIZE * SIZE || !/^[.a-zA-Z]+$/.test(state.board)) return false
  const left = { ...TILE_COUNTS }
  const take = (tile: Tile) => tile in left && --left[tile]! >= 0
  for (const square of state.board) if (square !== '.' && !take(square >= 'A' && square <= 'Z' ? '?' : square)) return false
  for (const tile of [...Object.values(state.racks).flat(), ...state.bag]) if (!take(tile)) return false
  return state.seats.includes(state.turn) && state.seats.every((seat) => Array.isArray(state.racks[seat]) && state.racks[seat]!.length <= RACK_SIZE && Number.isInteger(state.scores[seat]))
}
