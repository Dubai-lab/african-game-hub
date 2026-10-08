import { describe, expect, it } from 'vitest'
import {
  boardOutcome,
  canMate,
  kingSquare,
  legalTargets,
  material,
  needsPromotion,
  replay,
  sanFor,
  timeoutOutcome,
} from './chessLogic'
import { formatClock, newClock, pressClock, remainingMs, stopClock } from './clock'

describe('chess logic', () => {
  it('replays a game and classifies each move for sounds and highlights', () => {
    const { played, chess } = replay(['e4', 'd5', 'exd5', 'Nf6', 'Bb5+', 'c6', 'Nf3', 'cxb5', 'O-O'])
    expect(played.map((m) => m.kind)).toEqual([
      'move', 'move', 'capture', 'move', 'move', 'move', 'move', 'capture', 'castle',
    ])
    expect(played[4]).toMatchObject({ san: 'Bb5+', uci: 'f1b5', check: true, color: 'w', ply: 5 })
    expect(played[8]).toMatchObject({ san: 'O-O', uci: 'e1g1' })
    expect(chess.turn()).toBe('b')
  })

  it('refuses illegal moves', () => {
    const { chess } = replay(['e4'])
    expect(sanFor(chess, 'e7', 'e5')).toBe('e5')
    expect(sanFor(chess, 'e7', 'e4')).toBeNull()
    // It is Black's turn: White cannot move again.
    expect(sanFor(chess, 'd2', 'd4')).toBeNull()
    expect(() => replay(['e4', 'e4'])).toThrow()
  })

  it('lists legal targets and marks captures, including en passant', () => {
    const { chess } = replay(['e4', 'a6', 'e5', 'd5'])
    const targets = legalTargets(chess, 'e5')
    expect(targets).toEqual(
      expect.arrayContaining([
        { to: 'e6', capture: false },
        { to: 'd6', capture: true },
      ]),
    )
    expect(targets).toHaveLength(2)
    expect(legalTargets(chess, 'e4')).toEqual([])
  })

  it('knows when a pawn move needs a promotion choice', () => {
    const { chess } = replay([], '8/P6k/8/8/8/8/8/K7 w - - 0 1')
    expect(needsPromotion(chess, 'a7', 'a8')).toBe(true)
    expect(needsPromotion(chess, 'a1', 'a2')).toBe(false)
    expect(sanFor(chess, 'a7', 'a8', 'n')).toBe('a8=N')
    expect(replay(['a8=Q'], '8/P6k/8/8/8/8/8/K7 w - - 0 1').played[0]!.kind).toBe('promote')
  })

  it('detects checkmate, stalemate and dead positions', () => {
    const mate = replay(['f3', 'e5', 'g4', 'Qh4#']).chess
    expect(boardOutcome(mate)).toEqual({ winner: 'b', reason: 'checkmate' })
    expect(kingSquare(mate, 'w')).toBe('e1')
    expect(boardOutcome(replay([], '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').chess)).toEqual({ winner: null, reason: 'stalemate' })
    expect(boardOutcome(replay([], '8/8/4k3/8/8/3K4/8/8 w - - 0 1').chess)).toEqual({ winner: null, reason: 'insufficient' })
    expect(boardOutcome(replay(['e4']).chess)).toBeNull()
    const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']
    expect(boardOutcome(replay(shuffle).chess)).toEqual({ winner: null, reason: 'repetition' })
  })

  it('counts captured pieces and the material lead', () => {
    const { chess } = replay(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qxg2', 'Bxg2'])
    const m = material(chess.fen())
    // White took a pawn and the queen; Black took two pawns.
    expect(m.captured.w).toEqual(['q', 'p'])
    expect(m.captured.b).toEqual(['p', 'p'])
    expect(m.lead).toEqual({ w: 8, b: 0 })
    expect(material(replay([]).chess.fen())).toEqual({ captured: { w: [], b: [] }, lead: { w: 0, b: 0 } })
  })

  it('draws a timeout when the side that still has time cannot mate', () => {
    const loneKing = '8/8/4k3/8/8/3K1P2/8/8 w - - 0 1'
    expect(canMate(loneKing, 'w')).toBe(true)
    expect(canMate(loneKing, 'b')).toBe(false)
    // White flags: Black has only a king, so it is a draw, not a win.
    expect(timeoutOutcome(loneKing, 'w')).toEqual({ winner: null, reason: 'timeout' })
    expect(timeoutOutcome(loneKing, 'b')).toEqual({ winner: 'w', reason: 'timeout' })
    expect(canMate('8/8/4k3/8/8/3K1B2/8/8 w - - 0 1', 'w')).toBe(false)
  })
})

describe('chess clock', () => {
  it('starts on the first move, then charges the mover and adds the increment', () => {
    let clock = newClock(180_000, 2000)
    expect(remainingMs(clock, 'w', 5000)).toBe(180_000)

    clock = pressClock(clock, 'w', 1000) // White's first move: clocks start, Black is on the move.
    expect(clock).toMatchObject({ whiteMs: 180_000, running: 'b', since: 1000 })
    expect(remainingMs(clock, 'b', 4000)).toBe(177_000)
    expect(remainingMs(clock, 'w', 4000)).toBe(180_000)

    clock = pressClock(clock, 'b', 6000) // Black used 5s, gets 2s back.
    expect(clock).toMatchObject({ blackMs: 177_000, running: 'w', since: 6000 })
  })

  it('never goes below zero and freezes when stopped', () => {
    const clock = pressClock(newClock(1000, 0), 'w', 0)
    expect(remainingMs(clock, 'b', 5000)).toBe(0)
    const stopped = stopClock(clock, 400)
    expect(stopped).toMatchObject({ blackMs: 600, whiteMs: 1000, running: null })
    expect(remainingMs(stopped, 'b', 99_999)).toBe(600)
  })

  it('formats minutes and seconds, with tenths under ten seconds', () => {
    expect(formatClock(300_000)).toBe('5:00')
    expect(formatClock(299_001)).toBe('5:00')
    expect(formatClock(61_000)).toBe('1:01')
    expect(formatClock(10_000)).toBe('0:10')
    expect(formatClock(9999)).toBe('0:09.9')
    expect(formatClock(450)).toBe('0:00.4')
    expect(formatClock(0)).toBe('0:00.0')
    expect(formatClock(-50)).toBe('0:00.0')
    expect(formatClock(3_600_000)).toBe('1:00:00')
  })
})

describe('computer levels', () => {
  it('reads engine moves, including promotions, and rejects anything malformed', async () => {
    const { parseUciMove, LEVELS, levelById } = await import('./levels')
    expect(parseUciMove('e2e4')).toEqual({ from: 'e2', to: 'e4', promotion: undefined })
    expect(parseUciMove('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' })
    expect(parseUciMove('(none)')).toBeNull()
    expect(parseUciMove('e2e9')).toBeNull()
    expect(parseUciMove('e7e8k')).toBeNull()
    // Levels get steadily stronger, and an unknown saved level falls back to a real one.
    expect(LEVELS.map((l) => l.skill)).toEqual([...LEVELS.map((l) => l.skill)].sort((a, b) => a - b))
    expect(LEVELS.map((l) => l.depth)).toEqual([...LEVELS.map((l) => l.depth)].sort((a, b) => a - b))
    expect(levelById('grandmaster-9000').id).toBe('easy')
  })
})

describe('premove targets', () => {
  it('offer where a piece could travel, ignoring what is in the way now', async () => {
    const { premoveTargets } = await import('./chessLogic')
    // A rook in the corner may be queued anywhere along its file and rank, even through pieces.
    expect(premoveTargets('a1', 'r', 'w')).toHaveLength(14)
    expect(premoveTargets('a1', 'r', 'w')).toEqual(expect.arrayContaining(['a8', 'h1']))
    expect(premoveTargets('g1', 'n', 'w').sort()).toEqual(['e2', 'f3', 'h3'])
    // A pawn: one or two forward from its start, and both captures.
    expect(premoveTargets('e7', 'p', 'b').sort()).toEqual(['d6', 'e5', 'e6', 'f6'])
    expect(premoveTargets('e4', 'p', 'w').sort()).toEqual(['d5', 'e5', 'f5'])
    // The king from its starting square may also be queued to castle.
    expect(premoveTargets('e1', 'k', 'w')).toEqual(expect.arrayContaining(['g1', 'c1', 'd2', 'f1']))
    expect(premoveTargets('e2', 'k', 'w')).not.toContain('g2')
    // Never its own square, never off the board.
    for (const target of premoveTargets('h8', 'q', 'b')) expect(target).toMatch(/^[a-h][1-8]$/)
    expect(premoveTargets('h8', 'q', 'b')).not.toContain('h8')
  })
})
