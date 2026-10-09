import { getGameModule } from '@/games/registry'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { flagEmoji, useCountries } from '@/core/countries/useCountries'
import { useGameTypes } from '@/core/games/useGameTypes'
import { supabase } from '@/core/lib/supabase'
import { useMyProfile } from '@/core/profile/useMyProfile'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'

const TOP = 50

type Row = {
  userId: string
  username: string
  name: string
  countryCode: string | null
  rating: number
  games: number
}

/** The best-rated players in one game and rating pool, across Africa or within one country. */
function useLeaderboard(gameId: string | undefined, pool: string | undefined, country: string, by: 'rating' | 'wins' = 'rating') {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['leaderboard', gameId, pool, country, by, user?.id],
    enabled: Boolean(gameId && pool),
    staleTime: 30_000,
    meta: { errorKey: 'leaderboards.loadFailed' },
    queryFn: async () => {
      const base = () => {
        let query = supabase
          .from('player_ratings')
          .select('user_id, rating, wins, games_played, profiles!inner (username, display_name, country_code)', { count: 'exact' })
          .eq('game_type', gameId!)
          .eq('pool', pool!)
          // A rating only counts once a game has been played with it.
          .gt('games_played', 0)
        if (country) query = query.eq('profiles.country_code', country)
        return query
      }

      const top = await base().order(by, { ascending: false }).order('updated_at', { ascending: true }).limit(TOP)
      if (top.error) throw top.error
      const rows: Row[] = top.data.map((r) => ({
        userId: r.user_id,
        username: r.profiles.username,
        name: r.profiles.display_name ?? r.profiles.username,
        countryCode: r.profiles.country_code,
        rating: r[by],
        games: r.games_played,
      }))

      // Where the player stands when they are not in the list shown.
      let mine: (Row & { rank: number }) | null = null
      if (user && !rows.some((r) => r.userId === user.id)) {
        const me = await base().eq('user_id', user.id).maybeSingle()
        if (!me.error && me.data) {
          const above = await base().gt(by, me.data[by]).limit(1)
          if (!above.error) {
            mine = {
              userId: me.data.user_id,
              username: me.data.profiles.username,
              name: me.data.profiles.display_name ?? me.data.profiles.username,
              countryCode: me.data.profiles.country_code,
              rating: me.data[by],
              games: me.data.games_played,
              rank: (above.count ?? 0) + 1,
            }
          }
        }
      }
      return { rows, total: top.count ?? rows.length, mine }
    },
  })
}

function PlayerRow({ rank, row, me }: { rank: number; row: Row; me: boolean }) {
  return (
    <li className={`flex items-center gap-3 px-2 py-2.5 ${me ? 'bg-brand text-brand-ink' : ''}`} data-testid="leaderboard-row">
      <span className="w-8 shrink-0 text-end font-display text-lg font-extrabold tabular-nums">{rank}</span>
      <Link to={`/players/${row.username}`} className="min-w-0 flex-1 truncate font-semibold underline-offset-4 hover:underline">
        {row.countryCode && <span aria-hidden="true">{flagEmoji(row.countryCode)} </span>}
        {row.name}
      </Link>
      <span className="shrink-0 text-lg font-bold tabular-nums">{row.rating}</span>
    </li>
  )
}

export default function LeaderboardsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const games = useGameTypes()
  const profile = useMyProfile()
  const { countries } = useCountries()
  const liveGames = games.data?.filter((g) => g.status === 'live') ?? []

  const [gameChoice, setGameChoice] = useState<string | null>(null)
  const [poolChoice, setPoolChoice] = useState<string | null>(null)
  // '' means all of Africa.
  const [country, setCountry] = useState('')

  const game = liveGames.find((g) => g.id === gameChoice) ?? liveGames[0]
  const pools = game?.ratingPools ?? []
  const pool = pools.includes(poolChoice ?? '') ? poolChoice! : pools.includes('blitz') ? 'blitz' : pools[0]
  // Some games rank by games won instead of a rating number (the game module says which).
  const by = (game && getGameModule(game.id)?.standing) || 'rating'
  const board = useLeaderboard(game?.id, pool, country, by)
  const myCountry = profile.data?.country?.code

  const select = 'min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-base font-semibold'

  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <h1 className="font-display text-3xl font-extrabold text-primary lg:text-4xl">{t('leaderboards.title')}</h1>

      {/* Which game, and which of its rankings (for chess: bullet, blitz or rapid). */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="min-w-0">
          <span className="sr-only">{t('lobby.chooseGame')}</span>
          <select value={game?.id ?? ''} onChange={(event) => setGameChoice(event.target.value)} className={select}>
            {liveGames.map((g) => (
              <option key={g.id} value={g.id}>
                {t(`games.${g.id}`, { defaultValue: g.name })}
              </option>
            ))}
          </select>
        </label>
        {pools.length > 1 && (
          <label className="min-w-0">
            <span className="sr-only">{t('leaderboards.pool')}</span>
            <select value={pool ?? ''} onChange={(event) => setPoolChoice(event.target.value)} className={select}>
              {pools.map((p) => (
                <option key={p} value={p}>
                  {t(`ratingPools.${p}`, { defaultValue: p })}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('leaderboards.region')}</span>
          <select
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className={select}
          >
            <option value="">{t('leaderboards.africa')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
        </label>
        {myCountry && country !== myCountry && (
          <Button variant="ghost" className="min-h-11 bg-panel px-3 text-sm" onClick={() => setCountry(myCountry)}>
            {t('leaderboards.myCountry')}
          </Button>
        )}
      </div>

      {games.isPending || board.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : board.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('leaderboards.loadFailed')}</p>
          <Button variant="ghost" onClick={() => void board.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : board.data.rows.length === 0 ? (
        <p className="text-muted">{t('leaderboards.empty')}</p>
      ) : (
        <>
          <ol className="divide-y divide-line border-y border-line" aria-label={t('leaderboards.title')}>
            {board.data.rows.map((row, index) => (
              <PlayerRow key={row.userId} rank={index + 1} row={row} me={row.userId === user?.id} />
            ))}
          </ol>
          {board.data.mine && (
            <div>
              <p className="text-sm font-semibold text-muted">{t('leaderboards.yourPlace')}</p>
              <ol className="mt-1 border-y border-line">
                <PlayerRow rank={board.data.mine.rank} row={board.data.mine} me />
              </ol>
            </div>
          )}
          <p className="text-sm text-muted">{t('leaderboards.count', { count: board.data.total })}</p>
        </>
      )}
    </div>
  )
}
