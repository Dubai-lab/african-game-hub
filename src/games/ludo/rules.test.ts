import { describe, expect, it } from 'vitest'
import { applyMove, applyRoll, canFull, chooseMove, plays, type LocalGame, newLocalGame, teamsFor, throwDice, throwDie } from './rules'

// The same situations as supabase/tests/ludo.test.ts: the practice rules must match the server's.

const one = (over: Partial<LocalGame>): LocalGame => ({ ...newLocalGame({ players: 2, pieces: 2, dice: 1, lay: false }), ...over })
const two = (over: Partial<LocalGame>): LocalGame => ({ ...newLocalGame({ players: 2, pieces: 4, dice: 2, lay: false }), ...over })
/** A throw that has just fallen and still has to be played. */
const thrown = (game: LocalGame, dice: number[]): LocalGame => ({ ...game, rolled: dice, dice, phase: 'move', extra: dice.every((die) => die === 6) })

describe('practice rules', () => {
  it('seats two players opposite each other, more players round the board, and both sides on alternate corners', () => {
    expect(teamsFor(2)).toEqual({ red: ['red'], yellow: ['yellow'] })
    expect(Object.keys(teamsFor(3))).toEqual(['red', 'green', 'yellow'])
    expect(Object.keys(teamsFor(4))).toEqual(['red', 'green', 'yellow', 'blue'])
    expect(teamsFor(2, 2)).toEqual({ red: ['red', 'yellow'], green: ['green', 'blue'] })
  })

  it('throws fair dice', () => {
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 6000; i++) counts[throwDie()]!++
    expect(counts[0]).toBe(0)
    for (const count of counts.slice(1)) {
      expect(count).toBeGreaterThan(850)
      expect(count).toBeLessThan(1150)
    }
    expect(throwDice(2)).toHaveLength(2)
  })
})

describe('one die', () => {
  it('without a six nothing leaves the yard and the turn passes; a six brings a piece out and rolls again', () => {
    expect(applyRoll(one({}), [3])).toMatchObject({ turn: 'yellow', phase: 'roll', positions: { red: [-1, -1] }, turnNo: 1 })
    expect(applyRoll(one({}), [6])).toMatchObject({ turn: 'red', phase: 'roll', sixes: 1, positions: { red: [0, -1] } })
  })

  it('a third six in a row loses the turn', () => {
    const after = applyRoll(one({ sixes: 2, positions: { red: [5, 9], yellow: [-1, -1] } }), [6])
    expect(after).toMatchObject({ turn: 'yellow', sixes: 0, positions: { red: [5, 9] }, lastEvent: { forfeit: true } })
  })

  it('asks the player only when there is a real choice', () => {
    const choice = applyRoll(one({ positions: { red: [5, 9], yellow: [-1, -1] } }), [2])
    expect(choice).toMatchObject({ phase: 'move', dice: [2], turn: 'red' })
    expect(applyMove(choice, { piece: 1, die: 2 })).toMatchObject({ positions: { red: [5, 11] }, turn: 'yellow', phase: 'roll' })
  })

  it('captures on an ordinary square, never on a safe square, and a capture earns no extra throw', () => {
    // Red's square 30 is yellow's square 4.
    const hit = applyMove(thrown(one({ positions: { red: [27, 5], yellow: [4, 4] } }), [3]), { piece: 0, die: 3 })
    expect(hit).toMatchObject({ positions: { red: [30, 5], yellow: [-1, -1] }, turn: 'yellow', lastEvent: { captured: 2 } })
    // Square 34 is a star.
    const safe = applyMove(thrown(one({ positions: { red: [31, 5], yellow: [8, 6] } }), [3]), { piece: 0, die: 3 })
    expect(safe).toMatchObject({ positions: { red: [34, 5], yellow: [8, 6] }, turn: 'yellow' })
  })

  it('home needs the exact number; the last piece home wins', () => {
    expect(applyRoll(one({ positions: { red: [56, 54], yellow: [3, -1] } }), [3])).toMatchObject({ turn: 'yellow', positions: { red: [56, 54] } })
    expect(applyRoll(one({ positions: { red: [56, 54], yellow: [3, -1] } }), [2])).toMatchObject({ phase: 'over', places: ['red'], lastEvent: { finished: true } })
  })

  it('with three or four players the turn goes round the board', () => {
    let table: LocalGame = newLocalGame({ players: 4, pieces: 2, dice: 1 })
    const order = []
    for (let i = 0; i < 5; i++) {
      order.push(table.turn)
      table = applyRoll(table, [2])
    }
    expect(order).toEqual(['red', 'green', 'yellow', 'blue', 'red'])
  })
})

describe('two dice', () => {
  it('each die is a move of its own, in the order the player chooses', () => {
    const start = applyRoll(two({ positions: { red: [10, 20, -1, -1], yellow: [-1, -1, -1, -1] } }), [3, 5])
    expect(start).toMatchObject({ phase: 'move', dice: [3, 5], turn: 'red' })
    // A die that is not lying there, or a piece that cannot use it, changes nothing.
    expect(applyMove(start, { piece: 0, die: 4 })).toBe(start)
    expect(applyMove(start, { piece: 2, die: 3 })).toBe(start)
    const first = applyMove(start, { piece: 0, die: 5 })
    expect(first).toMatchObject({ positions: { red: [15, 20, -1, -1] }, dice: [3], phase: 'move', turn: 'red' })
    expect(applyMove(first, { piece: 1, die: 3 })).toMatchObject({ positions: { red: [15, 23, -1, -1] }, dice: [], phase: 'roll', turn: 'yellow' })
  })

  it('a six on one die brings a piece out, and the other die then moves it on; a six is not a double', () => {
    const start = applyRoll(two({ positions: { red: [-1, -1, -1, -1], yellow: [5, -1, -1, -1] } }), [6, 3])
    // Out with the six alone, or the full count: the player is asked.
    expect(start.phase).toBe('move')
    expect(applyMove(start, { piece: 0, die: 3 })).toBe(start)
    expect(applyMove(start, { piece: 0, die: 6 })).toMatchObject({ positions: { red: [3, -1, -1, -1] }, turn: 'yellow', phase: 'roll' })
  })

  it('only a double six earns another throw; any other double passes the turn; a third double six loses it', () => {
    const twos = applyRoll(two({ positions: { red: [10, 20, -1, -1], yellow: [-1, -1, -1, -1] } }), [2, 2])
    expect(applyMove(applyMove(twos, { piece: 0, die: 2 }), { piece: 1, die: 2 })).toMatchObject({ turn: 'yellow', phase: 'roll', sixes: 0, positions: { red: [12, 22, -1, -1] } })
    const sixes = applyRoll(two({ positions: { red: [10, 20, -1, -1], yellow: [-1, -1, -1, -1] } }), [6, 6])
    const done = applyMove(applyMove(sixes, { piece: 0, die: 6 }), { piece: 1, die: 6 })
    expect(done).toMatchObject({ turn: 'red', phase: 'roll', sixes: 1, positions: { red: [16, 26, -1, -1] } })
    expect(applyRoll({ ...done, sixes: 2 }, [6, 6])).toMatchObject({ turn: 'yellow', sixes: 0, lastEvent: { forfeit: true } })
    expect(applyRoll({ ...done, sixes: 2 }, [4, 4]).lastEvent?.forfeit).toBeUndefined()
  })

  it('a die no piece can use is lost, and a throw nothing can use passes the turn', () => {
    const home = applyRoll(two({ positions: { red: [54, 56, 56, -1], yellow: [-1, -1, -1, -1] } }), [5, 2])
    // Bringing a piece home earns no extra throw either.
    expect(home).toMatchObject({ positions: { red: [56, 56, 56, -1] }, turn: 'yellow', phase: 'roll', dice: [] })
    expect(applyRoll(two({}), [3, 4])).toMatchObject({ turn: 'yellow', phase: 'roll', dice: [] })
  })
})

describe('full count', () => {
  it('one piece takes both dice as a single move and touches nothing on the way', () => {
    // Yellow stands on red's square 14. Played apart, the 4 would capture there; ten goes past.
    const start = thrown(two({ lay: true, positions: { red: [10, -1, -1, -1], yellow: [40, -1, -1, -1] } }), [4, 6])
    const after = applyMove(start, { piece: 0, full: true })
    expect(after).toMatchObject({ positions: { red: [20, -1, -1, -1], yellow: [40, -1, -1, -1] }, dice: [], turn: 'yellow', lastEvent: { full: true, die: 10, captured: 0 } })
  })

  it('from the yard it needs a six, never overshoots home, and needs both dice unplayed', () => {
    const start = thrown(two({ positions: { red: [-1, 50, -1, -1], yellow: [-1, -1, -1, -1] } }), [6, 4])
    expect(canFull(start, 'red', 1)).toBe(false)
    expect(applyMove(start, { piece: 0, full: true }).positions.red).toEqual([4, 50, -1, -1])
    const none = thrown(two({ positions: { red: [-1, 10, -1, -1], yellow: [-1, -1, -1, -1] } }), [5, 4])
    expect(canFull(none, 'red', 0)).toBe(false)
    expect(canFull({ ...none, dice: [4] }, 'red', 1)).toBe(false)
  })
})

describe('lay', () => {
  it('a piece that captures goes straight home and the captured piece goes back', () => {
    // Red's square 30 is yellow's square 4.
    const start = thrown(two({ lay: true, positions: { red: [27, 40, -1, -1], yellow: [4, 9, -1, -1] } }), [3, 1])
    const after = applyMove(start, { piece: 0, die: 3 })
    expect(after.positions).toMatchObject({ red: [56, 41, -1, -1], yellow: [-1, 9, -1, -1] })
    expect(after).toMatchObject({ turn: 'yellow', phase: 'roll' })
  })

  it('switched off, the capturing piece stays where it landed', () => {
    const start = thrown(two({ lay: false, positions: { red: [27, 40, -1, -1], yellow: [4, 9, -1, -1] } }), [3, 1])
    expect(applyMove(start, { piece: 0, die: 3 }).positions.red![0]).toBe(30)
  })
})

describe('both sides', () => {
  const both = (over: Partial<LocalGame>): LocalGame => ({ ...newLocalGame({ players: 2, pieces: 2, dice: 2, sides: 2, lay: false }), ...over })

  it('one throw is played on either of the player’s colours, and the turn passes to the other player', () => {
    const start = thrown(both({ positions: { red: [10, -1], yellow: [20, -1], green: [4, -1], blue: [-1, -1] } }), [3, 5])
    expect(applyMove(start, { color: 'green', piece: 0, die: 3 })).toBe(start)
    const after = applyMove(applyMove(start, { color: 'yellow', piece: 0, die: 5 }), { color: 'red', piece: 0, die: 3 })
    expect(after.positions).toMatchObject({ red: [13, -1], yellow: [25, -1] })
    expect(after).toMatchObject({ turn: 'green', phase: 'roll' })
  })

  it('a player never captures their own other colour, and wins only with every piece of both home', () => {
    // Yellow's square 4 is red's square 30.
    const own = applyMove(thrown(both({ positions: { red: [27, 56], yellow: [4, 56], green: [-1, -1], blue: [-1, -1] } }), [3, 1]), { color: 'red', piece: 0, die: 3 })
    expect(own.positions).toMatchObject({ red: [30, 56], yellow: [4, 56] })
    const nearly = applyMove(thrown(both({ positions: { red: [54, 56], yellow: [40, 56], green: [3, -1], blue: [-1, -1] } }), [2, 4]), { color: 'red', piece: 0, die: 2 })
    expect(nearly.phase).not.toBe('over')
    const won = applyRoll(both({ positions: { red: [56, 56], yellow: [55, 56], green: [3, -1], blue: [-1, -1] } }), [1, 3])
    expect(won).toMatchObject({ phase: 'over', places: ['red'] })
  })
})

describe('the computer', () => {
  it('takes a capture, then a way home, then brings a piece out, choosing the die as well as the piece', () => {
    expect(chooseMove(thrown(one({ positions: { red: [27, 50], yellow: [4, -1] } }), [3]))).toMatchObject({ piece: 0, die: 3, full: false })
    expect(chooseMove(thrown(one({ positions: { red: [10, 53], yellow: [-1, -1] } }), [3]))).toMatchObject({ piece: 1, die: 3 })
    expect(chooseMove(thrown(one({ positions: { red: [10, -1], yellow: [-1, -1] } }), [6]))).toMatchObject({ piece: 1, die: 6 })
    // Two dice: the 3 captures (red's square 30 is yellow's square 4), the 5 does not.
    expect(chooseMove(thrown(two({ positions: { red: [27, 40, -1, -1], yellow: [4, -1, -1, -1] } }), [5, 3]))).toMatchObject({ color: 'red', piece: 0, die: 3 })
    // The full count is taken when only it reaches the capture (27 + 2 + 1).
    expect(chooseMove(thrown(two({ positions: { red: [27, -1, -1, -1], yellow: [4, -1, -1, -1] } }), [2, 1]))).toMatchObject({ piece: 0, full: true })
  })
})

describe('both dice must be played; the gate', () => {
  const lay = (over: Partial<LocalGame>): LocalGame => ({ ...newLocalGame({ players: 2, pieces: 4, dice: 2, lay: true }), ...over })

  it('5 and 5, one piece out, an opponent five ahead: the piece counts all ten instead of capturing', () => {
    // Red's square 15 is yellow's square 41.
    const start = thrown(lay({ positions: { red: [10, 56, 56, 56], yellow: [41, -1, -1, -1] } }), [5, 5])
    expect(plays(start)).toEqual([])
    expect(applyMove(start, { piece: 0, die: 5 })).toBe(start)
    // Thrown for real, there is nothing to choose and it is played at once.
    const after = applyRoll(lay({ positions: { red: [10, 56, 56, 56], yellow: [41, -1, -1, -1] } }), [5, 5])
    expect(after).toMatchObject({ positions: { red: [20, 56, 56, 56], yellow: [41, -1, -1, -1] }, turn: 'yellow', phase: 'roll' })
  })

  it('3 and 2 with the capture on the 2: the 3 may go first, the 2 may not', () => {
    // Red's square 16 is yellow's square 42.
    const start = thrown(lay({ positions: { red: [14, 56, 56, 56], yellow: [42, -1, -1, -1] } }), [3, 2])
    expect(plays(start)).toEqual([{ color: 'red', piece: 0, die: 3 }])
  })

  it('a second piece that can take the other die makes the capture legal; so does playing without lay', () => {
    const two = thrown(lay({ positions: { red: [10, 30, 56, 56], yellow: [41, -1, -1, -1] } }), [5, 5])
    expect(applyMove(two, { piece: 0, die: 5 }).positions).toMatchObject({ red: [56, 35, 56, 56], yellow: [-1, -1, -1, -1] })
    const stay = thrown(lay({ lay: false, positions: { red: [10, 56, 56, 56], yellow: [41, -1, -1, -1] } }), [5, 5])
    expect(applyMove(stay, { piece: 0, die: 5 }).positions).toMatchObject({ red: [20, 56, 56, 56], yellow: [-1, -1, -1, -1] })
  })

  it('when nothing can play both dice, one is played and the other is lost', () => {
    const start = thrown(lay({ positions: { red: [54, 56, 56, 56], yellow: [-1, -1, -1, -1] } }), [5, 2])
    expect(plays(start)).toEqual([{ color: 'red', piece: 0, die: 2 }])
  })

  it('the gate: the first piece out walks the other die too and leaves the gate alone', () => {
    // Yellow stands on red's gate (yellow's square 26).
    const after = applyRoll(lay({ positions: { red: [-1, -1, -1, -1], yellow: [26, -1, -1, -1] } }), [6, 3])
    expect(after.positions).toMatchObject({ red: [3, -1, -1, -1], yellow: [26, -1, -1, -1] })
  })

  it('the gate: with a piece already out to take the other die, the six captures on the gate', () => {
    const start = thrown(lay({ positions: { red: [20, -1, -1, -1], yellow: [26, -1, -1, -1] } }), [6, 3])
    const after = applyMove(start, { piece: 1, die: 6 })
    expect(after.positions).toMatchObject({ red: [23, 56, -1, -1], yellow: [-1, -1, -1, -1] })
  })

  it('a gate shelters nobody: landing on an opponent standing on their own gate captures', () => {
    // Yellow's own gate is red's square 26.
    const start: LocalGame = { ...lay({ lay: false, positions: { red: [22, 56, 56, 56], yellow: [0, -1, -1, -1] } }), rolled: [4, 1], dice: [4], phase: 'move' }
    expect(applyMove(start, { piece: 0, die: 4 }).positions).toMatchObject({ red: [26, 56, 56, 56], yellow: [-1, -1, -1, -1] })
  })
})
