// Tournaments: create one (the prize, if any, is taken from the creator and held), cancel it
// before it starts, join, and say "I am here and free to play", which is also when waiting
// players are paired. Game-agnostic. The database functions do the work atomically
// (see *_challenges_and_tournaments.sql); the app never reports a score or a result.
import { z } from 'npm:zod@4'
import { games } from '../_shared/games.ts'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    game_type: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
    name: z.string().min(1).max(200),
    options: z.record(z.string(), z.unknown()),
    // When it starts, as an ISO time; left out for "now".
    starts_at: z.optional(z.iso.datetime({ offset: true })),
    // By time (an arena lasting so many minutes) or by rounds (so many of them).
    format: z.enum(['arena', 'rounds']),
    minutes: z.optional(z.number().int().min(1).max(600)),
    rounds: z.optional(z.number().int().min(1).max(20)),
    prize: z.number().int().min(0).max(1_000_000_000),
  }),
  z.object({ action: z.enum(['join', 'cancel']), tournament_id: z.uuid() }),
  z.object({ action: z.literal('ready'), tournament_id: z.uuid(), ready: z.boolean() }),
])

type Outcome = { status: string; id?: string; match_id?: string; code?: string }
const answer = (outcome: Outcome) =>
  outcome.status === 'error' ? refuse(outcome.code ?? 'SERVER_ERROR') : json({ ok: true, status: outcome.status, id: outcome.id ?? null, match_id: outcome.match_id ?? null })

serve(body, async ({ userId, body }) => {
  if (body.action === 'ready') {
    const result = await admin.rpc('tournament_ready', { p_user_id: userId, p_tournament_id: body.tournament_id, p_ready: body.ready })
    if (result.error) throw result.error
    return answer(result.data as Outcome)
  }
  if (body.action === 'join' || body.action === 'cancel') {
    const result = await admin.rpc(body.action === 'join' ? 'tournament_join' : 'tournament_cancel', { p_user_id: userId, p_tournament_id: body.tournament_id })
    if (result.error) throw result.error
    return answer(result.data as Outcome)
  }

  const adapter = games[body.game_type]
  if (!adapter) return refuse('GAME_NOT_AVAILABLE')
  const game = await admin.from('game_types').select('status, options_schema').eq('id', body.game_type).maybeSingle()
  if (game.error) throw game.error
  if (!game.data || game.data.status !== 'live') return refuse('GAME_NOT_AVAILABLE')
  const choice = adapter.queueChoice(game.data.options_schema, body.options)
  if (!choice) return refuse('OPTIONS_NOT_ALLOWED')

  const result = await admin.rpc('tournament_create', {
    p_user_id: userId,
    p_game_type: body.game_type,
    p_name: body.name,
    p_options: choice.options,
    p_rating_pool: choice.ratingPool,
    p_players: choice.players ?? 2,
    p_starts_at: body.starts_at ?? null,
    p_format: body.format,
    p_minutes: body.minutes ?? null,
    p_rounds: body.rounds ?? null,
    p_prize: body.prize,
  })
  if (result.error) throw result.error
  return answer(result.data as Outcome)
})
