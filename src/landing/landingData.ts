import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/core/lib/supabase'

// The landing page is saved as ready-made HTML at build time, so it needs something to show
// before the database answers. These snapshots match the seed data; the live values replace
// them as soon as the page loads, so a new game or a changed bonus appears without a rebuild.

export type LandingGame = {
  id: string
  name: string
  status: string
  stakeLevels: number[]
  /** Shortest and longest game on offer, in minutes, when the game has time controls. */
  minutes: [number, number] | null
}

const FALLBACK_GAMES: LandingGame[] = [
  { id: 'chess', name: 'Chess', status: 'live', stakeLevels: [0, 50, 100, 250, 500, 1000], minutes: [1, 10] },
  { id: 'ludo', name: 'Ludo', status: 'coming_soon', stakeLevels: [], minutes: null },
  { id: 'draughts', name: 'Draughts', status: 'coming_soon', stakeLevels: [], minutes: null },
  { id: 'pool', name: 'Pool', status: 'coming_soon', stakeLevels: [], minutes: null },
  { id: 'penalty', name: 'Penalty Shootout', status: 'coming_soon', stakeLevels: [], minutes: null },
]

export const FALLBACK_COUNTRY_CODES =
  'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW'.split(
    ' ',
  )

function minutesRange(optionsSchema: unknown): [number, number] | null {
  const controls = (optionsSchema as { time_controls?: unknown } | null)?.time_controls
  if (!Array.isArray(controls)) return null
  const minutes = controls
    .map((c) => Number((c as { base_ms?: unknown } | null)?.base_ms) / 60_000)
    .filter((m) => Number.isFinite(m) && m > 0)
  return minutes.length ? [Math.min(...minutes), Math.max(...minutes)] : null
}

export function useLandingGames() {
  return useQuery({
    queryKey: ['landing', 'games'],
    initialData: FALLBACK_GAMES,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LandingGame[]> => {
      const { data, error } = await supabase
        .from('game_types')
        .select('id, name, status, stake_levels, options_schema')
        .order('sort_order')
      if (error) throw error
      return data.map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        stakeLevels: g.stake_levels,
        minutes: minutesRange(g.options_schema),
      }))
    },
  }).data
}

export function useLandingTerms() {
  return useQuery({
    queryKey: ['landing', 'terms'],
    initialData: { signupBonus: 1000, rakePercent: 10 },
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('platform_settings').select('signup_bonus_amount, rake_bps').single()
      if (error) throw error
      return { signupBonus: data.signup_bonus_amount, rakePercent: data.rake_bps / 100 }
    },
  }).data
}

export type LandingStats = { matchesToday: number; countries: number; playersOnline: number | null }

/** Real figures only. Undefined until the database has answered; the page shows nothing until then. */
export function useLandingStats(): LandingStats | undefined {
  return useQuery({
    queryKey: ['landing', 'stats'],
    staleTime: 60_000,
    // A failed count is not worth a toast on a marketing page; the section simply stays hidden.
    retry: 1,
    meta: { silent: true },
    queryFn: async (): Promise<LandingStats> => {
      const { data, error } = await supabase.rpc('landing_stats').single()
      if (error) throw error
      return {
        matchesToday: Number(data.matches_today ?? 0),
        countries: Number(data.countries_represented ?? 0),
        playersOnline: data.players_online === null ? null : Number(data.players_online),
      }
    },
  }).data
}
