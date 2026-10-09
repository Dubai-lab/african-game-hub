// "Play a friend": invite a friend by name, or anyone who is given the link, to a game with
// chosen options and an optional stake; and accept, decline or withdraw such an invitation.
// Game-agnostic. The database functions do the work atomically (see *_challenges_and_tournaments.sql);
// an accepted invitation starts a normal match with both stakes in escrow.
import { z } from 'npm:zod@4'
import { games } from '../_shared/games.ts'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    game_type: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
    stake: z.number().int().min(0).max(1_000_000_000),
    options: z.record(z.string(), z.unknown()),
    // Left out: anyone holding the link may accept.
    to_username: z.optional(z.string().min(1).max(40)),
  }),
  z.object({ action: z.enum(['accept', 'decline', 'cancel']), challenge_id: z.uuid() }),
])

type Outcome = { status: string; id?: string; match_id?: string; code?: string }

serve(body, async ({ userId, body }) => {
  if (body.action !== 'create') {
    const result = await admin.rpc('challenge_respond', { p_user_id: userId, p_challenge_id: body.challenge_id, p_action: body.action })
    if (result.error) throw result.error
    const outcome = result.data as Outcome
    if (outcome.status === 'error') return refuse(outcome.code ?? 'SERVER_ERROR')
    return json({ ok: true, status: outcome.status, match_id: outcome.match_id ?? null })
  }

  const adapter = games[body.game_type]
  if (!adapter) return refuse('GAME_NOT_AVAILABLE')
  const game = await admin.from('game_types').select('status, options_schema').eq('id', body.game_type).maybeSingle()
  if (game.error) throw game.error
  if (!game.data || game.data.status !== 'live') return refuse('GAME_NOT_AVAILABLE')
  const choice = adapter.queueChoice(game.data.options_schema, body.options)
  if (!choice) return refuse('OPTIONS_NOT_ALLOWED')

  const result = await admin.rpc('challenge_create', {
    p_user_id: userId,
    p_game_type: body.game_type,
    p_to_username: body.to_username ?? null,
    p_stake: body.stake,
    p_options: choice.options,
    p_rating_pool: choice.ratingPool,
    p_players: choice.players ?? 2,
  })
  if (result.error) throw result.error
  const outcome = result.data as Outcome
  if (outcome.status === 'error') return refuse(outcome.code ?? 'SERVER_ERROR')
  return json({ ok: true, status: outcome.status, id: outcome.id ?? null })
})
