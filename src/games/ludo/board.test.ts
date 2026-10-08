import { describe, expect, it } from 'vitest'
import { cellOf, HOME, HOME_COLUMN, movablePieces, SEATS, START, TRACK, YARD } from './board'

const key = (cell: readonly [number, number]) => cell.join(',')

describe('the Ludo board', () => {
  it('has a track of 52 different squares that joins up into a loop', () => {
    expect(TRACK).toHaveLength(52)
    expect(new Set(TRACK.map(key)).size).toBe(52)
    for (let i = 0; i < 52; i++) {
      const [a, b] = [TRACK[i]!, TRACK[(i + 1) % 52]!]
      // Each step goes to a neighbouring cell (corners step diagonally round the centre).
      expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))).toBe(1)
    }
  })

  it('gives each colour a start a quarter of the way round, and a home column off the track', () => {
    expect(SEATS.map((seat) => key(TRACK[START[seat]]!))).toEqual(['1,6', '8,1', '13,8', '6,13'])
    const track = new Set(TRACK.map(key))
    for (const seat of SEATS) {
      expect(HOME_COLUMN[seat]).toHaveLength(6)
      for (const cell of HOME_COLUMN[seat]) expect(track.has(key(cell))).toBe(false)
      // The column begins beside the last track square that colour visits.
      const last = TRACK[(START[seat] + 50) % 52]!
      const first = HOME_COLUMN[seat][0]!
      expect(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1])).toBe(1)
    }
  })

  it('places a piece from its progress: yard, track, home column, home', () => {
    expect(cellOf('red', YARD, 0)).toEqual([1.5, 1.5])
    expect(cellOf('yellow', YARD, 3)).toEqual([12.5, 12.5])
    expect(cellOf('red', 0, 0)).toEqual([1, 6])
    expect(cellOf('yellow', 0, 0)).toEqual([13, 8])
    // Red's square 26 is yellow's start: the same cell.
    expect(cellOf('red', 26, 0)).toEqual(cellOf('yellow', 0, 0))
    expect(cellOf('red', 50, 0)).toEqual([0, 7])
    expect(cellOf('red', 51, 0)).toEqual([1, 7])
    expect(cellOf('red', HOME, 0)).toEqual([6, 7])
    expect(cellOf('yellow', HOME, 0)).toEqual([8, 7])
  })

  it('knows which pieces a throw can move', () => {
    expect(movablePieces([YARD, 10, 54, HOME], 6)).toEqual([0, 1])
    expect(movablePieces([YARD, 10, 54, HOME], 2)).toEqual([1, 2])
    expect(movablePieces([YARD, YARD], 3)).toEqual([])
  })
})
