import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { act, deal, EMPTY_BOARD, evaluate, isSound, type Judge, type Laid, SIZE } from '../../../supabase/functions/_shared/words'
import { chooseAction, findPlays, indexWords } from './computer'

// The real word list, as the app and the server use it.
const index = indexWords(readFileSync('public/words/en.txt', 'utf8').split('\n').filter(Boolean))

function chance(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const lay = (word: string, row: number, col: number): Laid[] => [...word].map((letter, i) => ({ row, col: col + i, letter }))

describe('the word list', () => {
  it('is the whole list, small letters only, two to fifteen letters', () => {
    expect(index.words.length).toBeGreaterThan(160_000)
    expect(index.words.every((word) => /^[a-z]{2,15}$/.test(word))).toBe(true)
    expect(index.has('cat')).toBe(true)
    expect(index.has('aa')).toBe(true)
    expect(index.has('zzzz')).toBe(false)
    // The server's copy holds the same words.
    const server = readFileSync('supabase/functions/_shared/wordlist.en.ts', 'utf8')
    expect(server.split('`')[1]!.split('\n')).toHaveLength(index.words.length)
  })
})

describe('the computer opponent', () => {
  it('opens through the middle square with a real word from its tiles', () => {
    const plays = findPlays(EMPTY_BOARD, [...'retainx'], index)
    expect(plays.length).toBeGreaterThan(0)
    const best = plays[0]!
    expect(index.has(best.word)).toBe(true)
    expect(best.tiles.some((tile) => tile.row === 7 && tile.col === 7)).toBe(true)
    expect(evaluate(EMPTY_BOARD, best.tiles)).toMatchObject({ ok: true, score: best.score })
    // Best first.
    for (let i = 1; i < plays.length; i++) expect(plays[i]!.score).toBeLessThanOrEqual(plays[i - 1]!.score)
  })

  it('joins what is down, and every word it makes crossing is a real word', () => {
    const first = evaluate(EMPTY_BOARD, lay('cat', 7, 6))
    if (!first.ok) throw new Error('setup')
    const plays = findPlays(first.board, [...'seronia'], index)
    expect(plays.length).toBeGreaterThan(0)
    for (const play of plays) {
      const made = evaluate(first.board, play.tiles)
      if (!made.ok) throw new Error(`the computer laid tiles the rules refuse: ${made.code}`)
      for (const word of made.words) expect(index.has(word.word), word.word).toBe(true)
    }
  })

  it('uses a blank where it has no tile, and only then', () => {
    const plays = findPlays(EMPTY_BOARD, [...'ca?'], index)
    const cat = plays.find((play) => play.word.length === 3)
    expect(cat).toBeDefined()
    expect(cat!.tiles.filter((tile) => tile.blank)).toHaveLength(1)
    expect(cat!.tiles.filter((tile) => !tile.blank).map((tile) => tile.letter).sort()).toEqual(['a', 'c'])
  })

  it('with nothing to play, swaps while the bag has tiles and passes when it has not', () => {
    // Seven q's make no word.
    expect(chooseAction(EMPTY_BOARD, [...'qqqqqqq'], 50, index)).toEqual({ type: 'swap', tiles: [...'qqqqqqq'] })
    expect(chooseAction(EMPTY_BOARD, [...'qqqqqqq'], 3, index)).toEqual({ type: 'pass' })
  })

  it('plays whole games against itself by the rules, to the end', { timeout: 120_000 }, () => {
    const judge: Judge = { isWord: index.has, random: chance(11) }
    for (let game = 0; game < 2; game++) {
      const random = chance(game + 5)
      let state = deal(['1', '2'], random)
      let turns = 0
      while (!state.over) {
        const seat = state.turn
        const action = chooseAction(state.board, state.racks[seat]!, state.bag.length, index, random)
        const played = act(state, seat, action, judge)
        if (!played.ok) throw new Error(`game ${game}: the computer was refused (${played.code} ${played.words ?? ''})`)
        state = played.state
        expect(isSound(state)).toBe(true)
        if (++turns > 400) throw new Error(`game ${game} did not end`)
      }
      // A real game was played: words went down, and someone scored.
      expect([...state.board].filter((square) => square !== '.').length).toBeGreaterThan(30)
      expect(Math.max(...Object.values(state.over.scores))).toBeGreaterThan(100)
      expect(state.board).toHaveLength(SIZE * SIZE)
    }
  })
})
