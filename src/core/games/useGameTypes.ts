import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'

export type GameType = {
  id: string
  name: string
  status: 'live' | 'coming_soon'
  stakeLevels: number[]
  minPlayers: number
  /** For chess: bullet, blitz, rapid. Games with one rating use ["default"]. */
  ratingPools: string[]
  optionsSchema: unknown
}

/** The games registry: what the lobby offers is whatever this table says. */
export function useGameTypes() {
  return useQuery({
    queryKey: ['game_types'],
    staleTime: 5 * 60_000,
    meta: { errorKey: 'lobby.gamesLoadFailed' },
    queryFn: async (): Promise<GameType[]> => {
      const { data, error } = await supabase
        .from('game_types')
        .select('id, name, status, stake_levels, min_players, rating_pools, options_schema')
        .in('status', ['live', 'coming_soon'])
        .order('sort_order')
      if (error) throw error
      return data.map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status === 'live' ? 'live' : 'coming_soon',
        stakeLevels: [...g.stake_levels].sort((a, b) => a - b),
        minPlayers: g.min_players,
        ratingPools: g.rating_pools,
        optionsSchema: g.options_schema,
      }))
    },
  })
}

export const DEFAULT_RATING = 1200

/**
 * The player's rating in one pool of one game (chess keeps separate Bullet, Blitz and Rapid
 * ratings). Everyone starts at 1200; the row appears after a first rated match in that pool.
 */
export function useMyRating(gameId: string | undefined, pool: string) {
  const { user } = useAuth()
  const userId = user?.id
  return useQuery({
    queryKey: ['rating', userId, gameId, pool],
    enabled: Boolean(userId && gameId),
    // Always re-read on arrival: a rating changes the moment a game ends.
    staleTime: 0,
    meta: { silent: true },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_ratings')
        .select('rating, games_played, wins')
        .eq('user_id', userId!)
        .eq('game_type', gameId!)
        .eq('pool', pool)
        .maybeSingle()
      if (error) throw error
      return { rating: data?.rating ?? DEFAULT_RATING, gamesPlayed: data?.games_played ?? 0, wins: data?.wins ?? 0 }
    },
  })
}

/** Platform terms the lobby quotes before a match: the fee taken from the pot. */
export function useRakeBps() {
  return useQuery({
    queryKey: ['platform_settings', 'rake_bps'],
    staleTime: 5 * 60_000,
    meta: { silent: true },
    queryFn: async () => {
      const { data, error } = await supabase.from('platform_settings').select('rake_bps').single()
      if (error) throw error
      return data.rake_bps
    },
  })
}
