import { describe, expect, it } from 'vitest'
import {
  applyMove,
  type Board,
  type Color,
  type DraughtsState,
  generate,
  initialState,
  legalMoves,
  play,
  replay,
  START,
  toCells,
  type Cells,
} from '../../../supabase/functions/_shared/draughts'

// The rules of international draughts, checked one by one against the official rules, and the
// move generator as a whole against the published move counts for the game.

function position(pieces: Partial<Record<'w' | 'W' | 'b' | 'B', number[]>>): Board {
  const board = '.'.repeat(50).split('')
  for (const [piece, squares] of Object.entries(pieces)) for (const square of squares) board[square - 1] = piece
  return board.join('')
}
const at = (board: Board, turn: Color, more: Partial<DraughtsState> = {}): DraughtsState => ({ board, turn, kingPlies: 0, endgame: null, endgamePlies: 0, history: [board + turn], ...more })
const paths = (board: Board, turn: Color) => legalMoves({ board, turn }).map((move) => move.path.join(' '))

function perft(cells: Cells, turn: Color, depth: number): number {
  const moves = generate(cells, turn)
  if (depth === 1) return moves.length
  let total = 0
  for (const move of moves) total += perft(play(cells, move).cells, turn === 'w' ? 'b' : 'w', depth - 1)
  return total
}

describe('the board', () => {
  it('starts with twenty men each, Black on 1-20 and White on 31-50, White to move', () => {
    const state = initialState()
    expect(state.board).toBe('bbbbbbbbbbbbbbbbbbbb..........wwwwwwwwwwwwwwwwwwww')
    expect(state.turn).toBe('w')
  })

  it('gives White nine first moves, all one square forward', () => {
    expect(paths(START, 'w').sort()).toEqual(['31 26', '31 27', '32 27', '32 28', '33 28', '33 29', '34 29', '34 30', '35 30'].sort())
  })

  it('agrees with the known number of games of each length from the start', () => {
    const start = toCells(START)
    expect([1, 2, 3, 4, 5, 6].map((depth) => perft(start, 'w', depth))).toEqual([9, 81, 658, 4265, 27117, 167140])
  }, 60_000)
})

describe('men', () => {
  it('move forward only, never backward', () => {
    expect(paths(position({ w: [28], b: [5] }), 'w').sort()).toEqual(['28 22', '28 23'])
    expect(paths(position({ w: [50], b: [23] }), 'b').sort()).toEqual(['23 28', '23 29'])
  })

  it('capture backward as well as forward', () => {
    expect(paths(position({ w: [22], b: [28] }), 'w')).toEqual(['22 33'])
    expect(paths(position({ w: [33], b: [28] }), 'w')).toEqual(['33 22'])
  })

  it('cannot jump a piece with another standing right behind it', () => {
    expect(paths(position({ w: [33], b: [28, 22] }), 'w')).toEqual(['33 29'])
  })
})

describe('capturing', () => {
  it('is compulsory', () => {
    // White would like to play any of its other men, but must take.
    expect(paths(position({ w: [33, 45, 46], b: [28] }), 'w')).toEqual(['33 22'])
  })

  it('must take the most pieces: two beats one', () => {
    expect(paths(position({ w: [33], b: [28, 17, 29] }), 'w')).toEqual(['33 22 11'])
  })

  it('counts a king as one piece, the same as a man', () => {
    // Taking the one king is not better than taking the one man: both are allowed.
    expect(paths(position({ w: [33], b: [28], B: [29] }), 'w').sort()).toEqual(['33 22', '33 24'])
  })

  it('leaves the choice to the player when two captures take equally many', () => {
    expect(paths(position({ w: [33], b: [28, 29] }), 'w').sort()).toEqual(['33 22', '33 24'])
  })

  it('never jumps the same piece twice, though the piece may pass its own starting square', () => {
    // Four men in a ring round the white man: it takes all four, either way round, and stops
    // where it began.
    const moves = legalMoves({ board: position({ w: [32], b: [28, 18, 17, 27] }), turn: 'w' })
    expect(moves.map((m) => m.path.join(' ')).sort()).toEqual(['32 21 12 23 32', '32 23 12 21 32'])
    expect(moves.every((m) => m.captures.length === 4)).toBe(true)
  })

  it('lifts the taken pieces only at the end: a piece already jumped still blocks the way', () => {
    // The king takes 28, 24 and 34 and arrives on 39, looking back along the line through 28
    // at the man on 22. With 28 lifted it could take a fourth; 28 is still there, so it cannot.
    const moves = legalMoves({ board: position({ W: [46], b: [28, 24, 34, 22] }), turn: 'w' })
    expect(Math.max(...moves.map((m) => m.captures.length))).toBe(3)
    const played = applyMove(at(position({ W: [46], b: [28, 24, 34, 22] }), 'w'), moves[0]!.path)!
    expect(played.state.board).toBe(position({ W: [moves[0]!.path.at(-1)!], b: [22].filter((s) => !moves[0]!.captures.includes(s)).concat([28, 24, 34].filter((s) => !moves[0]!.captures.includes(s))) }))
  })
})

describe('kings', () => {
  it('a man that ends its move on the far row is crowned', () => {
    const played = applyMove(at(position({ w: [7], b: [50] }), 'w'), [7, 1])!
    expect(played.move.promoted).toBe(true)
    expect(played.state.board[0]).toBe('W')
    const black = applyMove(at(position({ w: [1], b: [44] }), 'b'), [44, 50])!
    expect(black.state.board[49]).toBe('B')
  })

  it('a man that only passes the far row while capturing is not crowned', () => {
    const played = applyMove(at(position({ w: [12], b: [8, 9, 50] }), 'w'), [12, 3, 14])!
    expect(played.move.promoted).toBe(false)
    expect(played.state.board[13]).toBe('w')
    expect(played.move.captures).toEqual([8, 9])
  })

  it('move any distance along a diagonal, in all four directions, until something is in the way', () => {
    expect(paths(position({ W: [28], w: [50], b: [1] }), 'w').filter((p) => p.startsWith('28 ')).length).toBe(16)
    // Its own man on 28 cuts the long line short.
    expect(paths(position({ W: [46], w: [28], b: [1] }), 'w').filter((p) => p.startsWith('46 '))).toEqual(['46 41', '46 37', '46 32'])
  })

  it('capture from a distance and may land on any free square beyond', () => {
    expect(paths(position({ W: [46], b: [28] }), 'w')).toEqual(['46 23', '46 19', '46 14', '46 10', '46 5'])
  })

  it('must still take the most: only the landing square that allows the second capture is legal', () => {
    // After taking 28 the king can turn at 19 to take 13 as well; stopping anywhere else takes one.
    const moves = legalMoves({ board: position({ W: [46], b: [28, 13] }), turn: 'w' })
    expect(moves.every((m) => m.captures.length === 2 && m.path[1] === 19)).toBe(true)
    expect(moves.length).toBeGreaterThan(0)
  })
})

describe('the end of the game', () => {
  it('a player with no pieces left has lost', () => {
    const played = applyMove(at(position({ w: [33], b: [28] }), 'w'), [33, 22])!
    expect(played.result).toEqual({ winner: 'w', reason: 'no_pieces' })
  })

  it('a player whose pieces are all blocked has lost', () => {
    const played = applyMove(at(position({ w: [41, 47, 35], b: [36] }), 'w'), [35, 30])!
    expect(played.result).toEqual({ winner: 'w', reason: 'blocked' })
  })

  it('the same position three times with the same player to move is a draw', () => {
    let state = at(position({ W: [50, 49], B: [1, 2] }), 'w')
    const round = [[50, 44], [1, 7], [44, 50], [7, 1]]
    let result = null
    for (const path of [...round, ...round]) {
      expect(result).toBeNull()
      const step = applyMove(state, path)!
      state = step.state
      result = step.result
    }
    expect(result).toEqual({ winner: null, reason: 'repetition' })
  })

  it('25 moves each of kings only, with nothing taken, is a draw; a man move starts the count again', () => {
    const board = position({ W: [50, 49], B: [1, 2], w: [45], b: [6] })
    expect(applyMove(at(board, 'w', { kingPlies: 48 }), [50, 44])!.result).toBeNull()
    expect(applyMove(at(board, 'w', { kingPlies: 49 }), [50, 44])!.result).toEqual({ winner: null, reason: 'king_moves' })
    const man = applyMove(at(board, 'w', { kingPlies: 49 }), [45, 40])!
    expect(man.result).toBeNull()
    expect(man.state.kingPlies).toBe(0)
  })

  it('three pieces with a king against a lone king is drawn after 16 moves each', () => {
    const board = position({ W: [50, 49], w: [45], B: [1] })
    const begun = applyMove(at(board, 'w'), [50, 44])!.state
    expect(begun.endgame).toBe('three')
    expect(applyMove({ ...begun, endgamePlies: 30 }, [1, 7])!.result).toBeNull()
    expect(applyMove({ ...begun, endgamePlies: 31 }, [1, 7])!.result).toEqual({ winner: null, reason: 'endgame' })
  })

  it('one or two pieces with a king against a lone king is drawn after 5 moves each', () => {
    let state = at(position({ W: [50], B: [1] }), 'w')
    const moves = [[50, 44], [1, 7], [44, 39], [7, 12], [39, 33], [12, 3], [33, 44], [3, 9], [44, 50], [9, 4], [50, 44]]
    let result = null
    for (const path of moves) {
      expect(result).toBeNull()
      const step = applyMove(state, path)!
      state = step.state
      result = step.result
    }
    expect(result).toEqual({ winner: null, reason: 'endgame' })
    expect(state.endgamePlies).toBe(10)
  })

  it('a win on the last move of a count is still a win', () => {
    const board = position({ W: [46], B: [28] })
    expect(applyMove(at(board, 'w', { endgame: 'two', endgamePlies: 9, kingPlies: 49 }), [46, 23])!.result).toEqual({ winner: 'w', reason: 'no_pieces' })
  })
})

describe('a whole game', () => {
  it('refuses a move that is not on offer, and a path that is cut short', () => {
    expect(applyMove(initialState(), [32, 23])).toBeNull()
    expect(applyMove(initialState(), [20, 25])).toBeNull()
    expect(applyMove(at(position({ w: [33], b: [28, 17, 29] }), 'w'), [33, 22])).toBeNull()
  })

  it('writes moves the standard way and replays a record from the start', () => {
    const game = replay([[32, 28], [19, 23], [28, 19], [14, 23]])!
    expect(game.played.map((m) => m.notation)).toEqual(['32-28', '19-23', '28x19', '14x23'])
    expect(game.state.turn).toBe('w')
    expect(replay([[32, 28], [32, 28]])).toBeNull()
  })

  it('plays thousands of random moves without ever breaking its own rules', () => {
    let seed = 7
    const random = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n
    for (let game = 0; game < 40; game++) {
      let state = initialState()
      for (let ply = 0; ply < 400; ply++) {
        const moves = legalMoves(state)
        const longest = Math.max(...moves.map((m) => m.captures.length))
        expect(moves.every((m) => m.captures.length === longest && new Set(m.captures).size === m.captures.length)).toBe(true)
        const step = applyMove(state, moves[random(moves.length)]!.path)!
        const before = [...state.board].filter((c) => c !== '.').length
        expect([...step.state.board].filter((c) => c !== '.').length).toBe(before - step.move.captures.length)
        state = step.state
        if (step.result) break
        expect(legalMoves(state).length).toBeGreaterThan(0)
      }
    }
  })
})
