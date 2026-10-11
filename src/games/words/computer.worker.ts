// The word list, and the computer's thinking, kept off the main thread so the board stays
// smooth. The list (about 170,000 words) is fetched once, the first time practice is opened,
// and then kept on the phone; it is never part of the app's own download.
//
// Two questions can be asked of it:
//   check  are these words in the list?           (the player's own turn, in practice)
//   think  what should the computer play here?
import type { Board, Tile } from '../../../supabase/functions/_shared/words'
import { chooseAction, indexWords, type WordIndex } from './computer'

type Request = { id: number; type: 'load' } | { id: number; type: 'check'; words: string[] } | { id: number; type: 'think'; board: Board; rack: Tile[]; bagCount: number }

let index: Promise<WordIndex> | null = null
const load = () =>
  (index ??= fetch('/words/en.txt')
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error('The word list could not be fetched'))))
    .then((text) => indexWords(text.split('\n').filter(Boolean)))
    .catch((error) => {
      // Let the next request try again (the phone may have been offline).
      index = null
      throw error
    }))

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    const words = await load()
    if (request.type === 'load') self.postMessage({ id: request.id, ok: true, count: words.words.length })
    else if (request.type === 'check') self.postMessage({ id: request.id, ok: true, wrong: request.words.filter((word) => !words.has(word)) })
    else self.postMessage({ id: request.id, ok: true, action: chooseAction(request.board, request.rack, request.bagCount, words) })
  } catch {
    self.postMessage({ id: request.id, ok: false })
  }
}
