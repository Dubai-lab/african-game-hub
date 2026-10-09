// Ludo's rules in the app, for one purpose only: practice against the computer, where there is
// no opponent to cheat and nothing at stake. Online games never use this file to decide
// anything; there the server's copy of these rules (supabase/migrations/*_ludo*.sql and
// *_tables_of_four.sql) is the only authority. The two must agree, and the tests check this
// file against the same situations as the database tests. The screens also use the read-only
// helpers here (which pieces can move, whether a full count is on) to light up the board.
import { HOME, type Seat, SEATS, STAR_SQUARES, START, YARD } from './board'

export type LudoEvent = {
  /** The player (their first colour). */
  seat: Seat
  /** The colour of the piece that moved, when the player holds two. */
  color?: Seat
  /** The throw as it fell (one die or two). */
  dice?: number[]
  /** How far the piece moved: one die, or both for a full count. */
  die?: number
  piece?: number
  from?: number
  to?: number
  captured?: number
  /** The piece captured and went straight home. */
  lay?: boolean
  /** Both dice were played on this piece as one move. */
  full?: boolean
  /** Every die showed six for the third throw in a row: the turn was lost. */
  forfeit?: boolean
  /** This move brought home the last piece the player had out. */
  finished?: boolean
  /** The player left the table ('resignation' or 'timeout'). */
  left?: string
}

/** The state of a table, as the screens need it. Online it comes from the server. */
export type LudoState = {
  positions: Partial<Record<Seat, number[]>>
  /** Which colours each player holds: one each, or two each when both sides are played. */
  teams: Partial<Record<Seat, Seat[]>>
  turn: Seat
  phase: 'roll' | 'move' | 'over'
  /** One die or two. */
  diceCount: number
  /** A piece that captures goes straight home. */
  lay: boolean
  /** The last throw as it fell. */
  rolled: number[]
  /** The dice from that throw still to be played. */
  dice: number[]
  turnNo: number
  /** Server time by which the player to act must act, in milliseconds; null when there is no clock. */
  deadline: number | null
  lastEvent: LudoEvent | null
  /** Players in the order they brought every piece home. */
  places: Seat[]
  /** Players who left the table. */
  gone: Seat[]
}

export type LocalGame = LudoState & {
  /** Throws of all sixes in a row. */
  sixes: number
  /** This throw has earned another: every die showed six. Nothing else earns one. */
  extra: boolean
}

export type Play = { color: Seat; piece: number; die: number }

/** Who sits where: two players opposite each other, or holding alternate corners with both sides. */
export function teamsFor(players: number, sides = 1): Partial<Record<Seat, Seat[]>> {
  if (players === 2 && sides === 2) return { red: ['red', 'yellow'], green: ['green', 'blue'] }
  const seats: Seat[] = players === 2 ? ['red', 'yellow'] : SEATS.slice(0, Math.min(Math.max(players, 2), 4))
  return Object.fromEntries(seats.map((seat) => [seat, [seat]]))
}

export function newLocalGame(setup: { players: number; pieces: number; dice?: number; sides?: number; lay?: boolean }): LocalGame {
  const teams = teamsFor(setup.players, setup.sides)
  const colors = Object.values(teams).flat()
  return {
    positions: Object.fromEntries(colors.map((color) => [color, Array.from({ length: setup.pieces }, () => YARD)])),
    teams,
    turn: 'red',
    phase: 'roll',
    diceCount: setup.dice ?? 2,
    lay: setup.lay ?? true,
    rolled: [],
    dice: [],
    sixes: 0,
    extra: false,
    turnNo: 0,
    deadline: null,
    lastEvent: null,
    places: [],
    gone: [],
  }
}

/** A fair throw of one die, from the browser's secure random source. */
export function throwDie(): number {
  const bytes = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(bytes)
    if (bytes[0]! < 252) return (bytes[0]! % 6) + 1
  }
}
export const throwDice = (count: number): number[] => Array.from({ length: count }, throwDie)

export function movable(positions: readonly number[], die: number): number[] {
  return positions.flatMap((p, piece) => ((p === YARD && die === 6) || (p >= 0 && p + die <= HOME) ? [piece] : []))
}

const playing = (game: LudoState): Seat[] => SEATS.filter((seat) => game.teams[seat] && !game.places.includes(seat) && !game.gone.includes(seat))

function nextSeat(game: LudoState, from: Seat): Seat {
  const active = playing(game)
  return [...SEATS, ...SEATS].slice(SEATS.indexOf(from) + 1).find((seat) => active.includes(seat)) ?? from
}

const pass = (game: LocalGame): LocalGame => ({ ...game, turn: nextSeat(game, game.turn), phase: 'roll', dice: [], extra: false, sixes: 0 })

/** Every single-die move there is for this player with the dice lying there, allowed or not. */
function everyPlay(game: LudoState, seat: Seat): Play[] {
  const dice = [...new Set(game.dice)]
  return (game.teams[seat] ?? []).flatMap((color) => dice.flatMap((die) => movable(game.positions[color] ?? [], die).map((piece) => ({ color, piece, die }))))
}

/**
 * The single-die moves this player is allowed to make. Both dice must be played whenever that
 * is possible: with two dice still lying there, a move is allowed only if the other die can be
 * played after it, as long as there is some way of playing both (such a move, or the full
 * count). When there is no such way, any move may be made and the other die is lost.
 */
export function plays(game: LudoState, seat: Seat = game.turn): Play[] {
  const all = everyPlay(game, seat)
  if (game.dice.length !== 2) return all
  const keepsOtherAlive = all.filter((play) => {
    const other = game.dice[0] === play.die ? game.dice[1]! : game.dice[0]!
    const { positions } = preview(game, seat, play.color, play.piece, play.die)
    return (game.teams[seat] ?? []).some((color) => movable(positions[color] ?? [], other).length > 0)
  })
  return keepsOtherAlive.length > 0 || fullCountPieces(game, seat).length > 0 ? keepsOtherAlive : all
}

/** Whether this piece may take both dice as one move: the full count. */
export function canFull(game: LudoState, color: Seat, piece: number): boolean {
  if (game.dice.length !== 2) return false
  const at = game.positions[color]?.[piece]
  if (at === undefined) return false
  // From the yard a six is needed to come out; the other die is then walked.
  return at === YARD ? game.dice.includes(6) : at >= 0 && at + game.dice[0]! + game.dice[1]! <= HOME
}

/** Every piece of this player that could take the full count. */
export function fullCountPieces(game: LudoState, seat: Seat = game.turn): { color: Seat; piece: number }[] {
  return (game.teams[seat] ?? []).flatMap((color) => (game.positions[color] ?? []).flatMap((_, piece) => (canFull(game, color, piece) ? [{ color, piece }] : [])))
}

/**
 * What moving this piece would do, without doing it: where it lands, what it captures, where it
 * ends (home at once if it captured and the game is played with lay) and the board afterwards.
 */
export function preview(game: LudoState, seat: Seat, color: Seat, piece: number, steps: number) {
  const own = game.teams[seat] ?? [color]
  const from = game.positions[color]![piece]!
  const landed = from === YARD ? steps - 6 : from + steps
  const square = landed <= 50 ? (START[color] + landed) % 52 : null
  // Only the stars shelter. A gate (a start square) shelters nobody: landing on an opponent
  // there captures, as on any other square. One piece lands, so one piece is captured, however
  // many are stacked on the square; the rest stay and play on. (Colours are looked at in the
  // same order as on the server: alphabetical.)
  const safe = square !== null && (STAR_SQUARES as readonly number[]).includes(square)
  const captures: { color: Seat; piece: number }[] = []
  if (square !== null && !safe) {
    for (const other of [...SEATS].sort()) {
      if (own.includes(other)) continue
      const index = game.positions[other]?.findIndex((progress) => progress >= 0 && progress <= 50 && (START[other] + progress) % 52 === square) ?? -1
      if (index >= 0) {
        captures.push({ color: other, piece: index })
        break
      }
    }
  }
  const to = captures.length > 0 && game.lay ? HOME : landed
  const positions: LudoState['positions'] = { ...game.positions, [color]: game.positions[color]!.map((p, i) => (i === piece ? to : p)) }
  for (const hit of captures) positions[hit.color] = positions[hit.color]!.map((p, i) => (i === hit.piece ? YARD : p))
  return { from, landed, to, square, safe, captures, positions }
}

/** Moves one piece, by one die or by both, and takes the dice used out of the throw. */
function movePiece(game: LocalGame, color: Seat, piece: number, die: number, full: boolean): LocalGame {
  const seat = game.turn
  const steps = full ? game.dice[0]! + game.dice[1]! : die
  const { from, to, landed, captures, positions } = preview(game, seat, color, piece, steps)
  // Lay: the piece that captured has done its work and has gone straight home.
  const lay = to !== landed
  const dice = full ? [] : [...game.dice]
  if (!full) dice.splice(dice.indexOf(die), 1)
  const event: LudoEvent = { seat, color, dice: game.rolled, die: steps, piece, from, to, captured: captures.length, full, ...(lay ? { lay: true } : {}) }

  // In practice the game ends with its first winner.
  if ((game.teams[seat] ?? []).every((own) => positions[own]!.every((p) => p === HOME))) {
    return { ...game, positions, dice: [], extra: false, places: [seat], phase: 'over', lastEvent: { ...event, finished: true } }
  }
  return { ...game, positions, dice, lastEvent: event }
}

/**
 * After a throw, and after each move: plays whatever is forced, stops for the player when
 * there is a real choice, and ends the throw when nothing more can be played.
 */
function settle(start: LocalGame): LocalGame {
  let game = start
  for (;;) {
    if (game.phase === 'over') return game
    const open = plays(game)
    const fulls = fullCountPieces(game)
    if (open.length === 0) {
      if (fulls.length === 0) return game.extra ? { ...game, phase: 'roll', dice: [], extra: false } : pass(game)
      // Only the full count is open. With one piece that can take it, there is nothing to choose.
      if (new Set(fulls.map((full) => `${full.color}:${game.positions[full.color]![full.piece]}`)).size > 1) return { ...game, phase: 'move' }
      game = movePiece(game, fulls[0]!.color, fulls[0]!.piece, 0, true)
      continue
    }
    // A real choice: more than one die to play, pieces that would end up in different places,
    // or the chance to take both dice on one piece.
    const places = new Set(open.map((play) => `${play.color}:${game.positions[play.color]![play.piece]}`))
    if (new Set(open.map((play) => play.die)).size > 1 || places.size > 1 || fulls.length > 0) return { ...game, phase: 'move' }
    game = movePiece(game, open[0]!.color, open[0]!.piece, open[0]!.die, false)
  }
}

/** The player to move has thrown these dice. */
export function applyRoll(game: LocalGame, thrown: number[]): LocalGame {
  const bonus = thrown.every((die) => die === 6)
  const event: LudoEvent = { seat: game.turn, dice: thrown, die: thrown[0] }
  if (bonus && game.sixes === 2) {
    return { ...pass(game), rolled: thrown, lastEvent: { ...event, forfeit: true }, turnNo: game.turnNo + 1 }
  }
  return settle({ ...game, rolled: thrown, dice: thrown, extra: bonus, sixes: bonus ? game.sixes + 1 : 0, lastEvent: event, turnNo: game.turnNo + 1 })
}

/** The player to move plays a piece: with one of the dice lying there, or with both (`full`). */
export function applyMove(game: LocalGame, move: { color?: Seat; piece: number; die?: number | null; full?: boolean }): LocalGame {
  const color = move.color ?? game.turn
  if (!(game.teams[game.turn] ?? []).includes(color)) return game
  if (move.full) {
    if (!canFull(game, color, move.piece)) return game
    return settle({ ...movePiece(game, color, move.piece, 0, true), turnNo: game.turnNo + 1 })
  }
  const die = move.die ?? 0
  if (!plays(game).some((play) => play.color === color && play.piece === move.piece && play.die === die)) return game
  return settle({ ...movePiece(game, color, move.piece, die, false), turnNo: game.turnNo + 1 })
}

/**
 * The computer's choice among its legal moves, the full count included. Not deep: it takes a
 * capture or a way home when one is offered, brings pieces out on a six, likes safe squares,
 * and otherwise keeps its most advanced piece moving. A fair sparring partner.
 */
export function chooseMove(game: LocalGame): { color: Seat; piece: number; die: number | null; full: boolean } {
  const seat = game.turn
  const score = (color: Seat, piece: number, steps: number) => {
    const { from, landed: to, safe, captures } = preview(game, seat, color, piece, steps)
    return captures.length * 60 + (to === HOME ? 45 : 0) + (from === YARD ? 30 : 0) + (safe ? 12 : 0) + (to > 50 && from <= 50 ? 10 : 0) + to * 0.2
  }
  let best = { color: seat, piece: -1, die: null as number | null, full: false, score: -Infinity }
  for (const play of plays(game)) {
    const value = score(play.color, play.piece, play.die)
    if (value > best.score) best = { ...play, full: false, score: value }
  }
  // A full count is worth taking only when where it lands beats playing the dice apart.
  for (const { color, piece } of fullCountPieces(game)) {
    const value = score(color, piece, game.dice[0]! + game.dice[1]!) - 20
    if (value > best.score) best = { color, piece, die: null, full: true, score: value }
  }
  return { color: best.color, piece: best.piece, die: best.die, full: best.full }
}
