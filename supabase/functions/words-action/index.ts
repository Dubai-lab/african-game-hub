// Everything a Word Battle player can ask for: lay tiles, swap tiles, pass, leave the game, or
// point out that the turn clock has run out.
//
// A turn is judged HERE, on the server, with the rules in ../_shared/words.ts and the word list
// beside it, against the whole game as the database holds it: every rack and the bag. The app
// sends only "these tiles on these squares". It is never sent anyone else's tiles, cannot choose
// what it draws, and cannot send a score or a result. Order of checks:
//   1. who is asking (session token)
//   2. the game is on and they are in it
//   3. the turn is allowed by the rules, every word it makes is in the word list, on the
//      position the app was looking at
//   4. recorded by the database under a row lock, only if the game has not moved meanwhile
//      (see public.words_store)
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'
import { WORD_LIST_EN } from '../_shared/wordlist.en.ts'
import { act, isSound, type Judge, leave, type Played, RACK_SIZE, SIZE, timeout, type WordsState } from '../_shared/words.ts'

// Read once, when the function starts, and kept for every request it serves.
const WORDS = new Set(WORD_LIST_EN.split('\n'))
const judge: Judge = {
  isWord: (word) => WORDS.has(word),
  // Where swapped tiles go back into the bag: from the system's own source of chance.
  random: () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32,
}

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['place', 'swap', 'pass', 'leave', 'claim']),
  /** Laying tiles: where each goes and which letter it is (or stands for, if it is a blank). */
  tiles: z.optional(
    z
      .array(z.object({ row: z.int().min(0).max(SIZE - 1), col: z.int().min(0).max(SIZE - 1), letter: z.string().regex(/^[a-z]$/), blank: z.optional(z.boolean()) }))
      .min(1)
      .max(RACK_SIZE),
  ),
  /** Swapping: the tiles to put back. */
  swap: z.optional(z.array(z.string().regex(/^[a-z?]$/)).min(1).max(RACK_SIZE)),
  /** The last state of the game the app has seen. A request made on an old picture is refused. */
  move_no: z.int().min(0).max(100_000),
})

type Context = { status: string; seat: string | null; late: boolean; state: WordsState }

serve(body, async ({ userId, body }) => {
  const context = await admin.rpc('words_context', { p_match_id: body.match_id, p_user_id: userId })
  if (context.error) throw context.error
  const game = context.data as Context | null

  if (!game || !game.seat) return refuse('NOT_A_PLAYER')
  if (game.status !== 'active') return refuse('GAME_OVER')
  const state = game.state
  if (!isSound(state)) {
    console.error('[words] stored game is not a sound position', body.match_id)
    return refuse('CORRUPT_GAME')
  }
  // A cheap early answer; the database checks again under a lock.
  if (state.moveNo !== body.move_no) return refuse('OUT_OF_SYNC')

  let played: Played
  if (body.action === 'claim') {
    // Anyone at the table may point out that the clock has run out; the database's clock decides.
    if (!game.late) return refuse('NOT_YET')
    played = timeout(state, judge)
  } else if (body.action === 'leave') {
    played = leave(state, game.seat)
  } else if (body.action === 'pass') {
    played = act(state, game.seat, { type: 'pass' }, judge)
  } else if (body.action === 'swap') {
    if (!body.swap) return refuse('BAD_REQUEST')
    played = act(state, game.seat, { type: 'swap', tiles: body.swap }, judge)
  } else {
    if (!body.tiles) return refuse('BAD_REQUEST')
    played = act(state, game.seat, { type: 'place', tiles: body.tiles }, judge)
  }
  // A word that is not in the list is named, so the player knows which one to change.
  if (!played.ok) return played.words ? json({ ok: false, code: played.code, words: played.words }) : refuse(played.code)

  const stored = await admin.rpc('words_store', {
    p_match_id: body.match_id,
    p_expected_move: state.moveNo,
    p_state: played.state,
    p_event: played.event,
  })
  if (stored.error) throw stored.error
  const result = stored.data as { ok: boolean; code?: string }
  return result.ok ? json({ ok: true }) : refuse(result.code ?? 'SERVER_ERROR')
})
