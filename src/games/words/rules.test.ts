import { describe, expect, it } from 'vitest'
import { act, ALL_TILES, bonusAt, cell, deal, EMPTY_BOARD, evaluate, isSound, type Judge, type Laid, leave, playing, RACK_SIZE, rackValue, SIZE, TILE_COUNTS, TILE_VALUES, timeout, type WordsState } from '../../../supabase/functions/_shared/words'

/** The same "chance" every run, so a failing game can be played again. */
function chance(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const WORDS = new Set(['cat', 'cats', 'at', 'as', 'ta', 'scat', 'act', 'quiz', 'zo', 'oat', 'coat', 'to', 'it', 'retains', 'ax', 'ox', 'on', 'no'])
const judge: Judge = { isWord: (word) => WORDS.has(word), random: chance(7) }
/** Tiles for a word laid from a square, across or down. A capital letter is a blank standing for it. */
const lay = (word: string, row: number, col: number, across = true): Laid[] =>
  [...word].map((letter, i) => ({ row: across ? row : row + i, col: across ? col + i : col, letter: letter.toLowerCase(), ...(letter !== letter.toLowerCase() ? { blank: true } : {}) }))
/** A board with these words already down. */
function boardWith(...words: [string, number, number, boolean?][]) {
  let board = EMPTY_BOARD
  for (const [word, row, col, across = true] of words) {
    const squares = [...board]
    for (const tile of lay(word, row, col, across)) squares[tile.row * SIZE + tile.col] = tile.blank ? tile.letter.toUpperCase() : tile.letter
    board = squares.join('')
  }
  return board
}
function table(racks: Record<string, string>, extra: Partial<WordsState> = {}): WordsState {
  const seats = Object.keys(racks)
  const zero = () => Object.fromEntries(seats.map((s) => [s, 0]))
  return { seats, out: [], board: EMPTY_BOARD, racks: Object.fromEntries(seats.map((s) => [s, [...racks[s]!]])), bag: [], scores: zero(), turn: seats[0]!, scoreless: 0, moveNo: 0, missed: zero(), over: null, ...extra }
}
const ok = (played: ReturnType<typeof act>) => {
  if (!played.ok) throw new Error(`refused: ${played.code}`)
  return played
}

describe('the tiles and the board', () => {
  it('a hundred tiles, two of them blank, and every letter has a value', () => {
    expect(ALL_TILES).toHaveLength(100)
    expect(TILE_COUNTS['?']).toBe(2)
    for (const tile of Object.keys(TILE_COUNTS)) expect(TILE_VALUES[tile]).toBeGreaterThanOrEqual(0)
    expect(rackValue(['q', 'z', '?', 'a'])).toBe(21)
  })

  it('the bonus squares mirror each other four ways, and the middle doubles the first word', () => {
    expect(bonusAt(7, 7)).toBe('DW')
    const counts: Record<string, number> = {}
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const bonus = bonusAt(r, c)
        expect(bonusAt(SIZE - 1 - r, c)).toBe(bonus)
        expect(bonusAt(r, SIZE - 1 - c)).toBe(bonus)
        expect(bonusAt(c, r)).toBe(bonus)
        if (bonus) counts[bonus] = (counts[bonus] ?? 0) + 1
      }
    }
    expect(counts.TW).toBe(8)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeLessThan(70)
  })
})

describe('laying tiles', () => {
  it('the first word must cover the middle square and be more than one letter', () => {
    expect(evaluate(EMPTY_BOARD, lay('cat', 0, 0))).toEqual({ ok: false, code: 'FIRST_ON_CENTRE' })
    expect(evaluate(EMPTY_BOARD, lay('a', 7, 7))).toEqual({ ok: false, code: 'ONE_LETTER' })
    const first = evaluate(EMPTY_BOARD, lay('cat', 7, 6))
    // c3 + a1 + t1, doubled by the middle square.
    expect(first).toMatchObject({ ok: true, score: 10, words: [{ word: 'cat', score: 10 }] })
    if (first.ok) expect(cell(first.board, 7, 7)).toBe('a')
  })

  it('tiles must lie in one line with no hole, on empty squares of the board', () => {
    expect(evaluate(EMPTY_BOARD, [])).toEqual({ ok: false, code: 'NO_TILES' })
    expect(evaluate(EMPTY_BOARD, [{ row: 7, col: 7, letter: 'a' }, { row: 8, col: 8, letter: 't' }])).toEqual({ ok: false, code: 'NOT_IN_LINE' })
    expect(evaluate(EMPTY_BOARD, [{ row: 7, col: 7, letter: 'a' }, { row: 7, col: 9, letter: 't' }])).toEqual({ ok: false, code: 'GAP' })
    expect(evaluate(EMPTY_BOARD, [{ row: 7, col: 14, letter: 'a' }, { row: 7, col: 15, letter: 't' }])).toEqual({ ok: false, code: 'OFF_BOARD' })
    const board = boardWith(['cat', 7, 6])
    expect(evaluate(board, lay('at', 7, 7))).toEqual({ ok: false, code: 'SQUARE_TAKEN' })
    expect(evaluate(board, [{ row: 2, col: 2, letter: 'a' }, { row: 2, col: 2, letter: 't' }])).toEqual({ ok: false, code: 'SQUARE_TAKEN' })
  })

  it('later words must join what is already down', () => {
    const board = boardWith(['cat', 7, 6])
    expect(evaluate(board, lay('at', 0, 0))).toEqual({ ok: false, code: 'NOT_JOINED' })
    // Lengthening a word: only the new tile's square can earn a bonus (this one has none).
    expect(evaluate(board, lay('s', 7, 9))).toMatchObject({ ok: true, words: [{ word: 'cats', score: 6 }], score: 6 })
    // A hole filled by an old tile is no hole: s . . . across the c-a-t.
    expect(evaluate(board, [{ row: 7, col: 5, letter: 's' }])).toMatchObject({ ok: true, words: [{ word: 'scat', score: 6 }] })
  })

  it('every row of tiles the turn makes is a word, and each is scored', () => {
    const board = boardWith(['cat', 7, 6])
    // "as" down from the a of cat makes one word; laying "at" under "ca" makes three.
    expect(evaluate(board, lay('s', 8, 7))).toMatchObject({ ok: true, words: [{ word: 'as', score: 2 }] })
    const under = evaluate(board, lay('at', 8, 6))
    expect(under.ok && under.words.map((w) => w.word).sort()).toEqual(['at', 'at', 'ca'])
    // One tile beside a word and under nothing makes just the one word, down or across.
    expect(evaluate(board, lay('o', 6, 8))).toMatchObject({ ok: true, words: [{ word: 'ot', score: 2 }] })
  })

  it('a bonus square counts for the tile laid on it, and only that turn', () => {
    // Row 3, column 0 triples the word; column 3 triples its letter.
    expect(bonusAt(3, 0)).toBe('TW')
    expect(bonusAt(3, 3)).toBe('TL')
    const board = boardWith(['cat', 3, 1], ['x', 7, 7])
    // "s" on the triple-word square in front of cat: (1 + 3 + 1 + 1) x 3. The t of cat lies on
    // the triple-letter square but was laid earlier, so it counts once.
    expect(evaluate(board, lay('s', 3, 0))).toMatchObject({ ok: true, words: [{ word: 'scat', score: 18 }] })
  })

  it('a blank stands for a letter and scores nothing; all seven tiles earn fifty more', () => {
    const blank = evaluate(EMPTY_BOARD, lay('cAt', 7, 6))
    expect(blank).toMatchObject({ ok: true, words: [{ word: 'cat', score: 8 }] })
    if (blank.ok) expect(cell(blank.board, 7, 7)).toBe('A')
    const all = evaluate(EMPTY_BOARD, lay('retains', 7, 4))
    // Seven one-point letters, doubled by the middle, plus fifty. (Column 4 of row 7 has no bonus.)
    expect(all).toMatchObject({ ok: true, score: 7 * 2 + 50 })
  })
})

describe('a turn', () => {
  it('lays a word from the rack, scores it, draws back up to seven and passes the turn', () => {
    const state = table({ a: 'catqzxy', b: 'aaaaaaa' }, { bag: ['e', 'e', 'e', 'i', 'o'] })
    expect(act(state, 'b', { type: 'pass' }, judge)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' })
    const played = ok(act(state, 'a', { type: 'place', tiles: lay('cat', 7, 6) }, judge))
    expect(played.state.scores).toEqual({ a: 10, b: 0 })
    expect(played.state.racks.a).toEqual(['q', 'z', 'x', 'y', 'o', 'i', 'e'])
    expect(played.state.bag).toEqual(['e', 'e'])
    expect(played.state.turn).toBe('b')
    expect(played.event).toEqual({ seat: 'a', kind: 'place', words: [{ word: 'cat', score: 10 }], score: 10, squares: [7 * 15 + 6, 7 * 15 + 7, 7 * 15 + 8] })
    // The table given was not changed.
    expect(state.board).toBe(EMPTY_BOARD)
    expect(state.racks.a).toHaveLength(7)
  })

  it('refuses tiles the player does not hold, and words that are not words', () => {
    const state = table({ a: 'catqzxy', b: 'aaaaaaa' })
    expect(act(state, 'a', { type: 'place', tiles: lay('oat', 7, 6) }, judge)).toEqual({ ok: false, code: 'NOT_YOUR_TILE' })
    // A blank cannot be claimed without holding one.
    expect(act(state, 'a', { type: 'place', tiles: lay('cAt', 7, 6) }, judge)).toEqual({ ok: false, code: 'NOT_YOUR_TILE' })
    expect(act(state, 'a', { type: 'place', tiles: lay('tac', 7, 6) }, judge)).toEqual({ ok: false, code: 'NOT_A_WORD', words: ['tac'] })
    // Every word the turn makes is checked, not only the one meant.
    const board = boardWith(['cat', 7, 6])
    const crossing = act(table({ a: 'zoqqqqq', b: 'a' }, { board }), 'a', { type: 'place', tiles: lay('zo', 8, 6) }, judge)
    expect(crossing).toEqual({ ok: false, code: 'NOT_A_WORD', words: ['cz', 'ao'] })
  })

  it('a blank on the rack can be laid as any letter', () => {
    const played = ok(act(table({ a: 'c?tqzxy', b: 'a' }), 'a', { type: 'place', tiles: lay('cAt', 7, 6) }, judge))
    expect(played.state.racks.a).toEqual(['q', 'z', 'x', 'y'])
    expect(played.state.scores.a).toBe(8)
  })

  it('swapping takes new tiles and puts the old ones back, only while the bag holds seven', () => {
    const state = table({ a: 'qqzxyab', b: 'a' }, { bag: ['e', 'e', 'e', 'e', 'e', 'e', 'e'] })
    const swapped = ok(act(state, 'a', { type: 'swap', tiles: ['q', 'z'] }, judge))
    expect(swapped.state.racks.a!.sort()).toEqual(['a', 'b', 'e', 'e', 'q', 'x', 'y'])
    expect(swapped.state.bag).toHaveLength(7)
    expect(swapped.state.bag.filter((tile) => tile === 'q' || tile === 'z')).toHaveLength(2)
    // What was swapped is nobody else's business.
    expect(swapped.event).toEqual({ seat: 'a', kind: 'swap', swapped: 2 })
    expect(swapped.state.scores.a).toBe(0)
    expect(act(table({ a: 'qqzxyab', b: 'a' }, { bag: ['e', 'e', 'e'] }), 'a', { type: 'swap', tiles: ['q'] }, judge)).toEqual({ ok: false, code: 'BAG_TOO_LOW' })
    expect(act(state, 'a', { type: 'swap', tiles: ['k'] }, judge)).toEqual({ ok: false, code: 'NOT_YOUR_TILE' })
  })
})

describe('how a game ends', () => {
  it('going out with the bag empty ends it: the others lose what they hold, and it goes to the player who went out', () => {
    const board = boardWith(['cat', 7, 6])
    const state = table({ a: 's', b: 'qz' }, { board, scores: { a: 20, b: 30 } })
    const out = ok(act(state, 'a', { type: 'place', tiles: lay('s', 7, 9) }, judge))
    // a: 20 + 6 for cats + 20 from b's q and z. b: 30 - 20.
    expect(out.state.over).toEqual({ reason: 'finished', winner: 'a', scores: { a: 46, b: 10 } })
    expect(act(out.state, 'b', { type: 'pass' }, judge)).toEqual({ ok: false, code: 'GAME_OVER' })
  })

  it('emptying the rack while the bag still has tiles does not end it', () => {
    const board = boardWith(['cat', 7, 6])
    const played = ok(act(table({ a: 's', b: 'qz' }, { board, bag: ['e'] }), 'a', { type: 'place', tiles: lay('s', 7, 9) }, judge))
    expect(played.state.over).toBeNull()
    expect(played.state.racks.a).toEqual(['e'])
  })

  it('two rounds with no score end it, and what is on the racks comes off the scores', () => {
    let state = table({ a: 'qz', b: 'a' }, { scores: { a: 30, b: 12 } })
    for (const seat of ['a', 'b', 'a']) state = ok(act(state, seat, { type: 'pass' }, judge)).state
    expect(state.over).toBeNull()
    state = ok(act(state, 'b', { type: 'pass' }, judge)).state
    expect(state.over).toEqual({ reason: 'stalled', winner: 'b', scores: { a: 10, b: 11 } })
  })

  it('a score in between starts the count again, and level scores are a draw', () => {
    let state = table({ a: 'cat', b: 'a' }, { bag: ['e'], scores: { a: 0, b: 9 } })
    state = ok(act(state, 'a', { type: 'pass' }, judge)).state
    state = ok(act(state, 'b', { type: 'pass' }, judge)).state
    state = ok(act(state, 'a', { type: 'place', tiles: lay('cat', 7, 6) }, judge)).state
    expect(state.scoreless).toBe(0)
    for (const seat of ['b', 'a', 'b', 'a']) state = ok(act(state, seat, { type: 'pass' }, judge)).state
    // a: 10 for cat, less the e drawn. b: 9, less the a held.
    expect(state.over).toEqual({ reason: 'stalled', winner: 'a', scores: { a: 9, b: 8 } })
    const level = table({ a: 'a', b: 'e' }, { scores: { a: 5, b: 5 }, scoreless: 3 })
    expect(ok(act(level, 'a', { type: 'pass' }, judge)).state.over).toEqual({ reason: 'stalled', winner: null, scores: { a: 4, b: 4 } })
  })
})

describe('time running out, and leaving', () => {
  it('the first time, the turn is passed for the player; the next time in a row, they are out', () => {
    let state = table({ a: 'cat', b: 'a', c: 'e' })
    const first = ok(timeout(state, judge))
    expect(first.event).toEqual({ seat: 'a', kind: 'timeout' })
    expect(first.state.missed.a).toBe(1)
    expect(first.state.turn).toBe('b')
    state = ok(act(first.state, 'b', { type: 'pass' }, judge)).state
    state = ok(act(state, 'c', { type: 'pass' }, judge)).state
    const second = ok(timeout(state, judge))
    expect(second.event).toEqual({ seat: 'a', kind: 'out' })
    expect(second.state.out).toEqual(['a'])
    expect(second.state.racks.a).toEqual([])
    expect(second.state.turn).toBe('b')
    expect(playing(second.state)).toEqual(['b', 'c'])
    expect(second.state.over).toBeNull()
  })

  it('the last player left wins, whatever the scores', () => {
    const state = table({ a: 'cat', b: 'a' }, { scores: { a: 90, b: 3 } })
    expect(ok(leave(state, 'a')).state.over).toEqual({ reason: 'last_standing', winner: 'b', scores: { a: 90, b: 3 } })
  })
})

describe('the deal', () => {
  it('gives seven tiles each from a shuffled bag of a hundred', () => {
    for (const players of [2, 3, 4]) {
      const seats = ['1', '2', '3', '4'].slice(0, players)
      const state = deal(seats, chance(players))
      for (const seat of seats) expect(state.racks[seat]).toHaveLength(RACK_SIZE)
      expect(state.bag).toHaveLength(100 - players * RACK_SIZE)
      expect(state.board).toBe(EMPTY_BOARD)
      expect(isSound(state)).toBe(true)
    }
    expect(deal(['1', '2'], chance(1)).racks).not.toEqual(deal(['1', '2'], chance(2)).racks)
  })

  it('a position with a tile too many is not sound', () => {
    const state = deal(['1', '2'], chance(3))
    expect(isSound({ ...state, racks: { ...state.racks, '1': ['z', 'z'] }, bag: [] })).toBe(false)
    expect(isSound({ ...state, board: state.board.slice(1) })).toBe(false)
  })
})
