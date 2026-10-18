// One Africa Life: starting a life. The player has made their character in the creator; this
// checks every choice against the rules (../_shared/oal.ts) and the database records the life
// once, with what a new life starts with (see public.oal_start_life).
import { z } from 'npm:zod@4'
import { admin, json, refuse, serve } from '../_shared/http.ts'
import { AGE, checkAppearance, checkGameName, HOME_TOWNS } from '../_shared/oal.ts'

const body = z.object({
  game_name: z.string().max(80),
  age: z.int().min(AGE.min).max(AGE.max),
  home_country: z.enum(['LR', 'GH']),
  home_town: z.string().max(40),
  appearance: z.record(z.string(), z.unknown()),
})

serve(body, async ({ userId, body }) => {
  const name = checkGameName(body.game_name)
  const appearance = checkAppearance(body.appearance)
  const towns: readonly string[] = HOME_TOWNS[body.home_country]
  if (!name || !appearance || !towns.includes(body.home_town)) return refuse('BAD_REQUEST')

  const result = await admin.rpc('oal_start_life', {
    p_user_id: userId,
    p_game_name: name,
    p_sex: appearance.sex,
    p_age: body.age,
    p_home_country: body.home_country,
    p_home_town: body.home_town,
    p_appearance: appearance,
  })
  if (result.error) throw result.error
  const outcome = result.data as { ok: boolean; code?: string }
  return outcome.ok ? json({ ok: true }) : refuse(outcome.code ?? 'SERVER_ERROR')
})
