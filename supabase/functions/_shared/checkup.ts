// Check Up: the shape-matching card game played across Nigeria and West Africa. The whole rule
// book, in one file.
//
// The server judges every card with this file (the checkup-action function), and the app uses
// the very same file for practice against the computer and to show which cards may be played.
// It is plain arithmetic on plain data: no clock, no randomness of its own (a shuffle is given a
// source of chance by whoever calls it), so it gives the same answer everywhere.
//
// The game, as agreed with the owner (11 October 2026):
//   * 54 cards: circles and triangles 1-5, 7, 8, 10-14; crosses and squares 1-3, 5, 7, 10, 11,
//     13, 14; stars 1-5, 7, 8; and five Whot cards numbered 20.
//   * Two to four players, six cards each. Play a card of the same shape or the same number as
//     the card on top, or a Whot card (and name the shape that must follow). A player who
//     cannot, or would rather not, goes to market: draws one card, and the turn passes.
//   * 1  Hold on: the same player plays again.
//     2  Pick two: the next player draws two, unless they play a 2 of their own, which passes
//        the cards on, two more each time.
//     5  Pick three: the same, in threes, defended with a 5.
//     8  Suspension: the next player misses a turn.
//     14 General market: every other player draws one card, and the same player plays again.
//     20 Whot: goes on anything; the player names the shape to follow.
//   * The first player to finish their cards wins. If the market is finished first, everyone
//     counts what they hold (a star counts double, a Whot counts 20) and the lowest count wins;
//     equal lowest counts are a draw.
//   * A player who lets their turn run out twice in a row, or who leaves, is out of the game:
//     their cards are put aside and the others play on. The last player left wins.

export const SHAPES = ['c', 't', 'x', 's', 'r'] as const
/** c circle, t triangle, x cross, s square, r star. */
export type Shape = (typeof SHAPES)[number]
/** A card is its shape letter and its number ("c7", "r4"); a Whot card is "w20". */
export type Card = string
export type Seat = string

export const WHOT: Card = 'w20'
const WIDE = [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]
const NARROW = [1, 2, 3, 5, 7, 10, 11, 13, 14]
const STARS = [1, 2, 3, 4, 5, 7, 8]

/** The whole pack, in a fixed order. */
export const DECK: readonly Card[] = [
  ...WIDE.map((n) => `c${n}`),
  ...WIDE.map((n) => `t${n}`),
  ...NARROW.map((n) => `x${n}`),
  ...NARROW.map((n) => `s${n}`),
  ...STARS.map((n) => `r${n}`),
  WHOT, WHOT, WHOT, WHOT, WHOT,
]

export const CARDS_EACH = 6
/** Turns a player may let run out in a row before they are out of the game. */
export const MISSES_ALLOWED = 1

export const isWhot = (card: Card) => card === WHOT
export const numberOf = (card: Card) => Number(card.slice(1))
/** The shape of a card; null for a Whot card, which has none of its own. */
export const shapeOf = (card: Card): Shape | null => (isWhot(card) ? null : (card[0] as Shape))
const isCard = (card: unknown): card is Card => typeof card === 'string' && DECK.includes(card)

/** What a card counts for when the cards are counted: its number, doubled for a star. */
export const valueOf = (card: Card) => (shapeOf(card) === 'r' ? numberOf(card) * 2 : numberOf(card))
export const handTotal = (cards: readonly Card[]) => cards.reduce((sum, card) => sum + valueOf(card), 0)

/** Cards waiting to be picked: which number put them there (2 or 5) and how many so far. */
export type Pending = { number: 2 | 5; count: number }

export type Over = {
  /** finished: someone played their last card. market: the market ran out and the cards were counted. last_standing: everyone else left. */
  reason: 'finished' | 'market' | 'last_standing'
  /** Null when the count was level: a draw. */
  winner: Seat | null
  /** What each player still in the game held, counted. */
  totals: Record<Seat, number>
}

export type CheckUpState = {
  /** Everyone who sat down, in the order of play. */
  seats: Seat[]
  /** Those who have left the game or let their time run out too often. */
  out: Seat[]
  hands: Record<Seat, Card[]>
  /** The cards still to be drawn. The next one drawn is the LAST in the list. */
  market: Card[]
  /** The card on top of the played pile. */
  top: Card
  /** After a Whot card: the shape that must follow. */
  called: Shape | null
  turn: Seat
  pending: Pending | null
  /** Goes up by one with everything that happens: a request made on an old picture is refused. */
  moveNo: number
  /** How many turns in a row each player has let run out. */
  missed: Record<Seat, number>
  over: Over | null
}

export type Action = { type: 'play'; card: Card; call?: Shape } | { type: 'draw' }

/** What happened, for everyone at the table to be shown. Never names a card that was drawn. */
export type TableEvent = {
  seat: Seat
  kind: 'play' | 'draw' | 'timeout' | 'out'
  card?: Card
  call?: Shape
  /** How many cards this player drew. */
  drew?: number
  /** General market: who else drew. */
  market?: Seat[]
  /** Suspension: who missed their turn. */
  skipped?: Seat
}

export type Refusal = 'GAME_OVER' | 'NOT_YOUR_TURN' | 'NOT_YOUR_CARD' | 'CARD_NOT_ALLOWED' | 'CALL_A_SHAPE' | 'BAD_REQUEST'
export type Played = { ok: true; state: CheckUpState; event: TableEvent } | { ok: false; code: Refusal }

const copy = (state: CheckUpState): CheckUpState => ({
  ...state,
  seats: [...state.seats],
  out: [...state.out],
  hands: Object.fromEntries(Object.entries(state.hands).map(([seat, cards]) => [seat, [...cards]])),
  market: [...state.market],
  pending: state.pending && { ...state.pending },
  missed: { ...state.missed },
  over: state.over && { ...state.over, totals: { ...state.over.totals } },
})

/** The players still in the game, in the order of play. */
export const playing = (state: CheckUpState): Seat[] => state.seats.filter((seat) => !state.out.includes(seat))

/** Who plays after this seat: the next player still in the game. */
export function nextSeat(state: CheckUpState, from: Seat): Seat {
  const at = state.seats.indexOf(from)
  for (let step = 1; step <= state.seats.length; step++) {
    const seat = state.seats[(at + step) % state.seats.length]!
    if (!state.out.includes(seat)) return seat
  }
  return from
}

/**
 * A fresh game: the pack shuffled, six cards each, and a plain card turned up to start on.
 * `random` gives a number from 0 up to (not including) 1, like Math.random; the server uses its
 * own source of chance (the database deals a real game; this is for practice and for tests).
 */
export function deal(seats: Seat[], random: () => number): CheckUpState {
  const pack = [...DECK]
  for (let i = pack.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pack[i], pack[j]] = [pack[j]!, pack[i]!]
  }
  const hands: Record<Seat, Card[]> = {}
  for (const seat of seats) hands[seat] = pack.splice(pack.length - CARDS_EACH, CARDS_EACH)
  // The game starts on a card that does nothing: the first one in the market that is plain.
  let at = pack.length - 1
  while (!isPlain(pack[at]!)) at--
  const [top] = pack.splice(at, 1)
  return { seats: [...seats], out: [], hands, market: pack, top: top!, called: null, turn: seats[0]!, pending: null, moveNo: 0, missed: Object.fromEntries(seats.map((seat) => [seat, 0])), over: null }
}

/** A card with no effect of its own. */
export const isPlain = (card: Card) => ![1, 2, 5, 8, 14, 20].includes(numberOf(card))

/** May this card be played on the table as it stands? */
export function canPlay(state: Pick<CheckUpState, 'top' | 'called' | 'pending'>, card: Card): boolean {
  // Cards are waiting to be picked: only the same number passes them on.
  if (state.pending) return numberOf(card) === state.pending.number
  if (isWhot(card)) return true
  if (numberOf(card) === numberOf(state.top)) return true
  return shapeOf(card) === (state.called ?? shapeOf(state.top))
}

/** The cards in a hand that may be played now. */
export const playable = (state: Pick<CheckUpState, 'top' | 'called' | 'pending'>, hand: readonly Card[]): Card[] => hand.filter((card) => canPlay(state, card))

/** Draws up to `count` cards for a seat. Returns how many were drawn. */
function take(state: CheckUpState, seat: Seat, count: number): number {
  let drawn = 0
  while (drawn < count && state.market.length > 0) {
    state.hands[seat]!.push(state.market.pop()!)
    drawn++
  }
  return drawn
}

/** The cards are counted: the lowest count wins, and level lowest counts are a draw. */
function count(state: CheckUpState): Over {
  const totals = Object.fromEntries(playing(state).map((seat) => [seat, handTotal(state.hands[seat]!)]))
  const lowest = Math.min(...Object.values(totals))
  const leaders = Object.keys(totals).filter((seat) => totals[seat] === lowest)
  return { reason: 'market', winner: leaders.length === 1 ? leaders[0]! : null, totals }
}

const totalsOf = (state: CheckUpState) => Object.fromEntries(playing(state).map((seat) => [seat, handTotal(state.hands[seat]!)]))

/** After anything that takes cards from the market: if it is finished, so is the game. */
function closeIfMarketDone(state: CheckUpState) {
  if (!state.over && state.market.length === 0) state.over = count(state)
}

/** Plays a card or goes to market for the player whose turn it is. */
export function act(before: CheckUpState, seat: Seat, action: Action): Played {
  if (before.over) return { ok: false, code: 'GAME_OVER' }
  if (before.turn !== seat || before.out.includes(seat)) return { ok: false, code: 'NOT_YOUR_TURN' }
  const state = copy(before)
  state.moveNo++
  state.missed[seat] = 0
  const hand = state.hands[seat]!

  if (action.type === 'draw') {
    // To market: the cards waiting to be picked if there are any, one card otherwise.
    const drew = take(state, seat, state.pending ? state.pending.count : 1)
    state.pending = null
    state.turn = nextSeat(state, seat)
    closeIfMarketDone(state)
    return { ok: true, state, event: { seat, kind: 'draw', drew } }
  }

  if (action.type !== 'play' || !isCard(action.card)) return { ok: false, code: 'BAD_REQUEST' }
  const at = hand.indexOf(action.card)
  if (at < 0) return { ok: false, code: 'NOT_YOUR_CARD' }
  if (!canPlay(state, action.card)) return { ok: false, code: 'CARD_NOT_ALLOWED' }
  const whot = isWhot(action.card)
  if (whot && (!action.call || !SHAPES.includes(action.call))) return { ok: false, code: 'CALL_A_SHAPE' }

  hand.splice(at, 1)
  state.top = action.card
  state.called = whot ? action.call! : null
  const event: TableEvent = { seat, kind: 'play', card: action.card, ...(whot ? { call: action.call } : {}) }

  // The last card: the game is won, whatever the card would have done.
  if (hand.length === 0) {
    state.pending = null
    state.over = { reason: 'finished', winner: seat, totals: totalsOf(state) }
    return { ok: true, state, event }
  }

  const number = numberOf(action.card)
  if (number === 1) {
    // Hold on: the same player again.
  } else if (number === 2 || number === 5) {
    const each = number === 2 ? 2 : 3
    state.pending = { number, count: (state.pending?.number === number ? state.pending.count : 0) + each }
    state.turn = nextSeat(state, seat)
  } else if (number === 8) {
    const missed = nextSeat(state, seat)
    event.skipped = missed
    state.turn = nextSeat(state, missed)
  } else if (number === 14) {
    // General market: everyone else draws one, in the order of play, while cards last.
    event.market = []
    for (let other = nextSeat(state, seat); other !== seat; other = nextSeat(state, other)) {
      if (take(state, other, 1) === 1) event.market.push(other)
    }
    closeIfMarketDone(state)
  } else {
    state.turn = nextSeat(state, seat)
  }
  return { ok: true, state, event }
}

/** A player is out of the game: their cards are put aside and the others play on. */
export function leave(before: CheckUpState, seat: Seat): Played {
  if (before.over) return { ok: false, code: 'GAME_OVER' }
  if (!before.seats.includes(seat) || before.out.includes(seat)) return { ok: false, code: 'BAD_REQUEST' }
  const state = copy(before)
  state.moveNo++
  const theirTurn = state.turn === seat
  // Worked out before they are marked as out, so the turn passes round them correctly.
  const after = nextSeat(state, seat)
  state.out.push(seat)
  state.hands[seat] = []
  if (theirTurn) {
    // Whatever was waiting for them goes with them.
    state.pending = null
    state.turn = after
  }
  const left = playing(state)
  if (left.length === 1) state.over = { reason: 'last_standing', winner: left[0]!, totals: totalsOf(state) }
  return { ok: true, state, event: { seat, kind: 'out' } }
}

/**
 * The player to move has let their time run out. The first time, the game goes to market for
 * them; if it happens again on their very next turn, they are out of the game.
 */
export function timeout(before: CheckUpState): Played {
  if (before.over) return { ok: false, code: 'GAME_OVER' }
  const seat = before.turn
  if (before.missed[seat]! >= MISSES_ALLOWED) return leave(before, seat)
  const drawn = act(before, seat, { type: 'draw' })
  if (!drawn.ok) return drawn
  drawn.state.missed[seat] = before.missed[seat]! + 1
  return { ok: true, state: drawn.state, event: { ...drawn.event, kind: 'timeout' } }
}

/** Is this a position the rules could have produced? Every card of the pack accounted for at most once. */
export function isSound(state: CheckUpState): boolean {
  const seen = [...Object.values(state.hands).flat(), ...state.market, state.top]
  if (!seen.every(isCard)) return false
  const left = [...DECK]
  for (const card of seen) {
    const at = left.indexOf(card)
    if (at < 0) return false
    left.splice(at, 1)
  }
  return state.seats.includes(state.turn) && state.seats.every((seat) => Array.isArray(state.hands[seat]))
}

/**
 * A simple opponent for practice. Plays a card when it can: it defends a pick, keeps its Whot
 * cards for when nothing else goes, prefers the cards that hurt (pick two, pick three, general
 * market) when an opponent is close to finishing, and otherwise sheds its heaviest card. Calls
 * the shape it holds most of.
 */
export function chooseAction(state: CheckUpState, seat: Seat): Action {
  const hand = state.hands[seat]!
  const options = playable(state, hand)
  if (options.length === 0) return { type: 'draw' }
  const ordinary = options.filter((card) => !isWhot(card))
  const threatened = playing(state).some((other) => other !== seat && state.hands[other]!.length <= 2)
  const harm = (card: Card) => ([2, 5, 14].includes(numberOf(card)) ? 1 : 0)
  const best = (cards: Card[]) => [...cards].sort((a, b) => (threatened ? harm(b) - harm(a) : 0) || valueOf(b) - valueOf(a))[0]!
  const card = ordinary.length > 0 ? best(ordinary) : WHOT
  if (!isWhot(card)) return { type: 'play', card }
  const rest = hand.filter((held) => !isWhot(held))
  const held = (shape: Shape) => rest.filter((c) => shapeOf(c) === shape).length
  const call = [...SHAPES].sort((a, b) => held(b) - held(a))[0]!
  return { type: 'play', card, call }
}
