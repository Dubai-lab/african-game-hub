// Everything a pool player can ask for: play a shot, resign, or point out that the shot clock
// has run out.
//
// A shot is played out HERE, on the server, from the position stored in the database: the
// physics and the rules are in ../_shared/pool.ts. The app sends only what the player asked
// for (direction, power, spin, where to place the cue ball). It cannot send a result, and a
// request made on an out-of-date position is refused.
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'
import { applyShot, type Ball, type PoolState, rack, type Seat, type Variant } from '../_shared/pool.ts'

const body = z.object({
  match_id: z.uuid(),
  action: z.enum(['shoot', 'resign', 'claim']),
  shot_no: z.optional(z.int().min(0)),
  shot: z.optional(
    z.object({
      dx: z.int(),
      dy: z.int(),
      power: z.int(),
      spinX: z.int(),
      spinY: z.int(),
      cue: z.optional(z.object({ x: z.number(), y: z.number() })),
      pocket: z.optional(z.int()),
    }),
  ),
})

serve(body, async ({ userId, body }) => {
  if (body.action !== 'shoot') {
    const done = await admin.rpc('pool_game_action', { p_match_id: body.match_id, p_user_id: userId, p_action: body.action })
    if (done.error) throw done.error
    const outcome = done.data as { ok: boolean; code?: string }
    return outcome.ok ? json({ ok: true }) : refuse(outcome.code ?? 'SERVER_ERROR')
  }
  if (!body.shot || body.shot_no === undefined) return refuse('BAD_REQUEST')

  const [game, seat] = await Promise.all([
    admin.from('pool_games').select('variant, balls, turn, break_shot, ball_in_hand, solids_seat, fouls, shot_no, phase').eq('match_id', body.match_id).maybeSingle(),
    admin.from('match_players').select('seat').eq('match_id', body.match_id).eq('user_id', userId).maybeSingle(),
  ])
  if (game.error) throw game.error
  if (seat.error) throw seat.error
  if (!game.data) return refuse('GAME_NOT_FOUND')
  if (!seat.data) return refuse('NOT_A_PLAYER')
  if (game.data.phase === 'over') return refuse('GAME_OVER')
  // Cheap early answers; the database function checks both again under a lock.
  if (game.data.turn !== seat.data.seat) return refuse('NOT_YOUR_TURN')
  if (game.data.shot_no !== body.shot_no) return refuse('OUT_OF_SYNC')

  const variant = game.data.variant as Variant
  const stored = game.data.balls as Ball[]
  const fouls = game.data.fouls as Record<string, number>
  const state: PoolState = {
    variant,
    // Until the break, the table is the rack.
    balls: stored.length > 0 ? stored : rack(variant),
    turn: Number(game.data.turn) as Seat,
    breakShot: game.data.break_shot,
    ballInHand: game.data.ball_in_hand,
    solidsSeat: game.data.solids_seat ? (Number(game.data.solids_seat) as Seat) : null,
    fouls: [fouls['1'] ?? 0, fouls['2'] ?? 0],
  }

  const played = applyShot(state, body.shot)
  if (!played) return refuse('ILLEGAL_SHOT')

  // Positions are stored to a thousandth of a millimetre: far finer than anything visible, and
  // it keeps the stored game small. The next shot is played from exactly what is stored.
  const tidy = (balls: Ball[]) => balls.map((b) => ({ n: b.n, x: Math.round(b.x * 1000) / 1000, y: Math.round(b.y * 1000) / 1000, in: b.in }))
  // Where the cue ball stood when the shot was struck (after any placement), for playing it back.
  const from = tidy(state.balls).map((b) => (b.n === 0 && state.ballInHand && body.shot!.cue ? { ...b, x: body.shot!.cue.x, y: body.shot!.cue.y, in: false } : b))

  const recorded = await admin.rpc('pool_apply_shot', {
    p_match_id: body.match_id,
    p_user_id: userId,
    p_shot_no: body.shot_no,
    p_state: {
      balls: tidy(played.state.balls),
      turn: String(played.state.turn),
      breakShot: played.state.breakShot,
      ballInHand: played.state.ballInHand,
      solidsSeat: played.state.solidsSeat === null ? null : String(played.state.solidsSeat),
      fouls: played.state.fouls,
      from,
    },
    p_shot: body.shot,
    p_result: { ...played.result, winner: played.result.winner === null ? null : String(played.result.winner) },
  })
  if (recorded.error) throw recorded.error
  const outcome = recorded.data as { ok: boolean; code?: string }
  return outcome.ok ? json({ ok: true }) : refuse(outcome.code ?? 'SERVER_ERROR')
})
