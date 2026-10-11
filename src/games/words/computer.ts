// The computer opponent for practice: finds the words its tiles can make on the board, and
// plays one of the best. It runs on the phone, in the background (see computer.worker.ts), with
// the same rule book the server judges by and the same word list.
//
// How it looks: line by line (every row and every column that touches the tiles already down),
// it tries each word of the list at each place along the line, keeping those that fit the tiles
// on the board and can be made from the rack, then lets the rule book say what each would score
// and the word list say whether the words it makes crossing are real.
import { type Board, CENTRE, cell, evaluate, type Laid, RACK_SIZE, SIZE, type Tile } from '../../../supabase/functions/_shared/words'

export type WordIndex = {
  words: string[]
  /** For each word, which letters it has: one bit per letter. A quick "could this even be made?" */
  masks: Int32Array
  has: (word: string) => boolean
}

const bit = (letter: string) => 1 << (letter.charCodeAt(0) - 97)
const maskOf = (letters: string) => {
  let mask = 0
  for (const letter of letters) mask |= bit(letter)
  return mask
}

/** Prepares the word list for searching. */
export function indexWords(list: readonly string[]): WordIndex {
  const words = list.filter((word) => word.length >= 2 && word.length <= SIZE)
  const masks = new Int32Array(words.length)
  for (let i = 0; i < words.length; i++) masks[i] = maskOf(words[i]!)
  const set = new Set(words)
  return { words, masks, has: (word) => set.has(word) }
}

export type Found = { tiles: Laid[]; score: number; word: string }

/**
 * The best turns the rack can make on the board, highest score first (up to `keep` of them).
 * Stops looking after `budgetMs`, with whatever it has found by then.
 */
export function findPlays(board: Board, rack: readonly Tile[], index: WordIndex, keep = 5, budgetMs = 2500): Found[] {
  const started = Date.now()
  const blanks = rack.filter((tile) => tile === '?').length
  const letters = rack.filter((tile) => tile !== '?')
  const rackCount = new Int8Array(26)
  for (const letter of letters) rackCount[letter.charCodeAt(0) - 97]!++
  const rackMask = maskOf(letters.join(''))
  const empty = !/[a-zA-Z]/.test(board)
  const best: Found[] = []
  const worst = () => (best.length < keep ? -1 : best[best.length - 1]!.score)

  const filled = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE && cell(board, row, col) !== '.'
  const used = new Int8Array(26)

  for (let line = 0; line < SIZE * 2; line++) {
    const across = line < SIZE
    const fixed = across ? line : line - SIZE
    const at = (i: number): [number, number] => (across ? [fixed, i] : [i, fixed])
    // What is on this line, and which of its empty squares touch a tile beside the line.
    const on: string[] = []
    const anchor: boolean[] = []
    let lineMask = 0
    let touched = false
    for (let i = 0; i < SIZE; i++) {
      const [row, col] = at(i)
      const square = cell(board, row, col)
      on.push(square === '.' ? '' : square.toLowerCase())
      if (square !== '.') {
        lineMask |= bit(square.toLowerCase())
        touched = true
      }
      const beside = across ? filled(row - 1, col) || filled(row + 1, col) : filled(row, col - 1) || filled(row, col + 1)
      anchor.push(square === '.' && beside)
      if (beside) touched = true
    }
    // A line that touches nothing can hold no word, except the middle row for the first word.
    if (empty ? !(across && fixed === CENTRE) : !touched) continue
    const allowed = lineMask | rackMask

    for (let w = 0; w < index.words.length; w++) {
      // Without a blank, a word with a letter that is neither on the rack nor on the line cannot be made.
      if (blanks === 0 && (index.masks[w]! & ~allowed) !== 0) continue
      const word = index.words[w]!
      const length = word.length
      for (let start = 0; start + length <= SIZE; start++) {
        // The word must not run on into a tile at either end.
        if ((start > 0 && on[start - 1] !== '') || (start + length < SIZE && on[start + length] !== '')) continue
        used.fill(0)
        let blanksUsed = 0
        let laid = 0
        let joined = false
        let fits = true
        for (let k = 0; k < length; k++) {
          const there = on[start + k]!
          const letter = word[k]!
          if (there !== '') {
            if (there !== letter) {
              fits = false
              break
            }
            joined = true
            continue
          }
          const code = letter.charCodeAt(0) - 97
          if (used[code]! < rackCount[code]!) used[code]!++
          else if (blanksUsed < blanks) blanksUsed++
          else {
            fits = false
            break
          }
          laid++
          if (anchor[start + k]) joined = true
          if (empty && start + k === CENTRE) joined = true
        }
        if (!fits || laid === 0 || !joined) continue

        // Which tile goes where: real letters first, a blank only where the rack has run out.
        used.fill(0)
        const tiles: Laid[] = []
        for (let k = 0; k < length; k++) {
          if (on[start + k] !== '') continue
          const [row, col] = at(start + k)
          const letter = word[k]!
          const code = letter.charCodeAt(0) - 97
          if (used[code]! < rackCount[code]!) {
            used[code]!++
            tiles.push({ row, col, letter })
          } else tiles.push({ row, col, letter, blank: true })
        }
        const result = evaluate(board, tiles)
        if (!result.ok || result.score <= worst()) continue
        // The word along the line is from the list; the words made crossing it must be too.
        if (!result.words.every((made) => index.has(made.word))) continue
        best.push({ tiles, score: result.score, word })
        best.sort((a, b) => b.score - a.score)
        if (best.length > keep) best.length = keep
      }
      if ((w & 4095) === 0 && Date.now() - started > budgetMs) return best
    }
  }
  return best
}

export type ComputerAction = { type: 'place'; tiles: Laid[] } | { type: 'swap'; tiles: Tile[] } | { type: 'pass' }

/**
 * What the computer does with its turn: one of its best few words (not always the very best,
 * so it is not played the same way every time); with no word to play, new tiles while the bag
 * has them; otherwise it passes.
 */
export function chooseAction(board: Board, rack: readonly Tile[], bagCount: number, index: WordIndex, random: () => number = Math.random): ComputerAction {
  const plays = findPlays(board, rack, index, 3)
  if (plays.length > 0) {
    // The best most of the time; now and then the second or third.
    const roll = random()
    const pick = roll < 0.7 ? 0 : roll < 0.9 ? 1 : 2
    return { type: 'place', tiles: plays[Math.min(pick, plays.length - 1)]!.tiles }
  }
  if (bagCount >= RACK_SIZE && rack.length > 0) return { type: 'swap', tiles: [...rack] }
  return { type: 'pass' }
}
