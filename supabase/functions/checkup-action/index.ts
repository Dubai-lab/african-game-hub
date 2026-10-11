// Everything a Check Up player can ask for: play a card, go to market, leave the game, or point
// out that the turn clock has run out.
//
// A card is judged HERE, on the server, with the rules in ../_shared/checkup.ts, against the
// whole game as the database holds it: every hand and the market. The app sends only "this
// card" (and the shape called, for a Whot card) or "to market". It is never sent anyone else's
// cards, cannot choose what it draws, and cannot send a result. Order of checks:
//   1. who is asking (session token)
//   2. the game is on and they are in it
//   3. the request is allowed by the rules, on the position the app was looking at
//   4. recorded by the database under a row lock, only if the game has not moved meanwhile
//      (see public.checkup_store)
import { z } from 'npm:zod@4'
import { act, type CheckUpState, isSound, leave, type Played, SHAPES, timeout } from '../_shared/checkup.ts'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['play', 'draw', 'leave', 'claim']),
  card: z.optional(z.string().check(z.maxLength(4))),
  call: z.optional(z.enum(SHAPES)),
  /** The last state of the game the app has seen. A request made on an old picture is refused. */
  move_no: z.int().min(0).max(100_000),
})

type Context = { status: string; seat: string | null; late: boolean; state: CheckUpState }

serve(body, async ({ userId, body }) => {
  const context = await admin.rpc('checkup_context', { p_match_id: body.match_id, p_user_id: userId })
  if (context.error) throw context.error
  const game = context.data as Context | null

  if (!game || !game.seat) return refuse('NOT_A_PLAYER')
  if (game.status !== 'active') return refuse('GAME_OVER')
  const state = game.state
  if (!isSound(state)) {
    console.error('[checkup] stored game is not a sound position', body.match_id)
    return refuse('CORRUPT_GAME')
  }
  // A cheap early answer; the database checks again under a lock.
  if (state.moveNo !== body.move_no) return refuse('OUT_OF_SYNC')

  let played: Played
  if (body.action === 'claim') {
    // Anyone at the table may point out that the clock has run out; the database's clock decides.
    if (!game.late) return refuse('NOT_YET')
    played = timeout(state)
  } else if (body.action === 'leave') {
    played = leave(state, game.seat)
  } else if (body.action === 'draw') {
    played = act(state, game.seat, { type: 'draw' })
  } else {
    if (!body.card) return refuse('BAD_REQUEST')
    played = act(state, game.seat, { type: 'play', card: body.card, call: body.call })
  }
  if (!played.ok) return refuse(played.code)

  const stored = await admin.rpc('checkup_store', {
    p_match_id: body.match_id,
    p_expected_move: state.moveNo,
    p_state: played.state,
    p_event: played.event,
  })
  if (stored.error) throw stored.error
  const result = stored.data as { ok: boolean; code?: string }
  return result.ok ? json({ ok: true }) : refuse(result.code ?? 'SERVER_ERROR')
})
