// Find a match: pairs the player with someone waiting on the same game, stake and options, or
// puts them in the queue. The app calls this again every few seconds while searching, which is
// also how the server knows the player is still there.
import { z } from 'npm:zod@4'
import { games } from '../_shared/games.ts'
import { admin, json, refuse, serve } from '../_shared/http.ts'

const body = z.object({
  game_type: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  stake: z.number().int().min(0).max(1_000_000_000),
  options: z.record(z.string(), z.unknown()),
})

serve(body, async ({ userId, body }) => {
  const adapter = games[body.game_type]
  if (!adapter) return refuse('GAME_NOT_AVAILABLE')

  const game = await admin.from('game_types').select('status, options_schema').eq('id', body.game_type).maybeSingle()
  if (game.error) throw game.error
  if (!game.data || game.data.status !== 'live') return refuse('GAME_NOT_AVAILABLE')

  const choice = adapter.queueChoice(game.data.options_schema, body.options)
  if (!choice) return refuse('OPTIONS_NOT_ALLOWED')

  // One atomic database function does the rest; see supabase/migrations/*_online_play.sql.
  const result = await admin.rpc('join_match_queue', {
    p_user_id: userId,
    p_game_type: body.game_type,
    p_stake: body.stake,
    p_options: choice.options,
    p_rating_pool: choice.ratingPool,
    p_players: choice.players ?? 2,
  })
  if (result.error) throw result.error

  const outcome = result.data as { status: string; match_id?: string; code?: string }
  if (outcome.status === 'error') return refuse(outcome.code ?? 'SERVER_ERROR')
  return json({ ok: true, status: outcome.status, match_id: outcome.match_id ?? null })
})
