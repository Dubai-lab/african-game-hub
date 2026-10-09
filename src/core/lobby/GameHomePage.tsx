import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { flagEmoji } from '@/core/countries/useCountries'
import { DEFAULT_RATING } from '@/core/games/useGameTypes'
import { supabase } from '@/core/lib/supabase'
import { useActiveMatch } from '@/core/matchmaking/useMatchmaking'
import { useContacts } from '@/core/social/social'
import { buttonClass } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { useFormat } from '@/core/ui/useFormat'
import { GameHeader, GameNotOpen, useMatchSetup } from './setup'

// A game's home: how the player is doing at it, their friends to challenge, their recent games,
// and one big button to play. Setting up a match is on the next page (Play).

const sectionTitle = 'font-display text-xl font-semibold'
const outcomeStyle = { win: 'bg-palm text-white', loss: 'bg-hibiscus text-white', draw: 'bg-line text-ink' } as const

type Recent = { matchId: string; outcome: 'win' | 'loss' | 'draw'; pool: string; finishedAt: string; opponent: { name: string; countryCode: string | null } | null; change: number | null }

function useGameRatings(gameId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['ratings', user?.id, gameId],
    enabled: Boolean(user?.id && gameId),
    staleTime: 0,
    meta: { silent: true },
    queryFn: async () => {
      const { data, error } = await supabase.from('player_ratings').select('pool, rating, games_played, wins, losses, draws').eq('user_id', user!.id).eq('game_type', gameId!)
      if (error) throw error
      return data
    },
  })
}

/** The player's latest finished games of this one game. */
function useRecentGames(gameId: string | undefined) {
  const { user } = useAuth()
  const me = user?.id
  return useQuery({
    queryKey: ['recent-games', me, gameId],
    enabled: Boolean(me && gameId),
    staleTime: 0,
    meta: { silent: true },
    queryFn: async (): Promise<Recent[]> => {
      const { data, error } = await supabase
        .from('matches')
        .select(
          `id, rating_pool, result, winner_id, finished_at,
           mine:match_players!inner (user_id, rating_before, rating_after),
           seats:match_players (user_id, profiles (username, display_name, country_code))`,
        )
        .eq('status', 'finished')
        .eq('game_type', gameId!)
        .eq('mine.user_id', me!)
        .order('finished_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data.map((match) => {
        const mine = match.mine[0]
        const other = match.seats.find((seat) => seat.user_id !== me)?.profiles
        return {
          matchId: match.id,
          outcome: match.result === 'draw' ? 'draw' : match.winner_id === me ? 'win' : 'loss',
          pool: match.rating_pool,
          finishedAt: match.finished_at ?? '',
          opponent: other ? { name: other.display_name ?? other.username, countryCode: other.country_code } : null,
          change: mine && mine.rating_after !== null && mine.rating_before !== null ? mine.rating_after - mine.rating_before : null,
        }
      })
    },
  })
}

export default function GameHomePage() {
  const { t } = useTranslation()
  const format = useFormat()
  const { gameId } = useParams()
  const { games, game, module } = useMatchSetup(gameId)
  const ratings = useGameRatings(game?.id)
  const contacts = useContacts()
  const recent = useRecentGames(game?.id)
  const activeMatch = useActiveMatch()

  if (games.isPending) return <Skeleton className="h-64" />
  if (!game) return <GameNotOpen />

  const name = t(`games.${game.id}`, { defaultValue: game.name })
  const byWins = module?.standing === 'wins'
  const friends = (contacts.data ?? []).filter((contact) => contact.relation === 'friend')
  const play = (
    <Link to={`/play/${game.id}/new`} data-testid="game-play" className={buttonClass('primary', 'min-h-14 w-full text-lg')}>
      {t('play.home.play')}
    </Link>
  )

  return (
    // The same on every screen, top to bottom: stats, friends, game history, and Play.
    <div className="flex w-full flex-col gap-6 lg:max-w-4xl">
      <GameHeader gameId={game.id} title={name} back={{ to: '/lobby', label: t('lobby.allGames') }}>
        {module?.SettingsSection && (
          <Link to={`/play/${game.id}/settings`} className="flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary underline underline-offset-4">
            {t('play.home.settings')}
          </Link>
        )}
      </GameHeader>

      <div className="flex flex-col gap-6">
        {activeMatch.data && (
          <section className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-brand p-4 text-brand-ink">
            <p className="font-bold">{t('lobby.gameInProgress')}</p>
            <Link to={`/play/${activeMatch.data.gameId}/match/${activeMatch.data.matchId}`} className={buttonClass('ghost', 'border-ink bg-panel')}>
              {t('lobby.returnToGame')}
            </Link>
          </section>
        )}

        <section aria-labelledby="game-stats">
          <h2 id="game-stats" className={sectionTitle}>
            {t('play.home.stats')}
          </h2>
          <dl className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, game.ratingPools.length)}, minmax(0, 1fr))` }}>
            {game.ratingPools.map((pool) => {
              const row = ratings.data?.find((r) => r.pool === pool)
              return (
                <div key={pool} className="border-2 border-line bg-panel p-3" data-testid={`stat-${pool}`}>
                  <dt className="text-sm font-semibold text-muted">{pool === 'default' ? t(byWins ? 'profile.wins' : 'profile.rating') : t(`ratingPools.${pool}`, { defaultValue: pool })}</dt>
                  <dd className="font-display text-3xl font-extrabold tabular-nums text-primary">{byWins ? (row?.wins ?? 0) : (row?.rating ?? DEFAULT_RATING)}</dd>
                  <dd className="text-xs tabular-nums text-muted">{row ? t('profile.record', { wins: row.wins, losses: row.losses, draws: row.draws }) : t('profile.noGames')}</dd>
                </div>
              )
            })}
          </dl>
        </section>

        <section aria-labelledby="game-friends">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="game-friends" className={sectionTitle}>
              {t('play.home.friends')}
            </h2>
            <Link to="/friends" className="text-sm font-semibold text-primary underline underline-offset-4">
              {t('play.home.findFriends')}
            </Link>
          </div>
          {friends.length === 0 ? (
            <p className="mt-3 text-muted">{t('play.home.friendsEmpty')}</p>
          ) : (
            // A row to swipe through on a phone.
            <ul className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0" data-testid="game-friends">
              {friends.map((friend) => (
                <li key={friend.userId} className="flex w-36 shrink-0 flex-col items-center gap-2 border-2 border-line bg-panel p-3 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-primary font-display text-xl font-extrabold text-surface" aria-hidden="true">
                    {friend.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="w-full truncate font-bold">
                    {friend.countryCode && <span aria-hidden="true">{flagEmoji(friend.countryCode)} </span>}
                    {friend.name}
                  </span>
                  <Link to={`/play/${game.id}/friend?to=${encodeURIComponent(friend.username)}`} className={buttonClass('ghost', 'min-h-10 w-full px-2 text-sm')}>
                    {t('play.home.challenge')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>

      <div className="flex flex-col gap-6">
        <section aria-labelledby="game-history">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="game-history" className={sectionTitle}>
              {t('play.home.history')}
            </h2>
            <Link to="/profile" className="text-sm font-semibold text-primary underline underline-offset-4">
              {t('play.home.viewAll')}
            </Link>
          </div>
          {recent.isPending ? (
            <Skeleton className="mt-3 h-32" />
          ) : (recent.data ?? []).length === 0 ? (
            <p className="mt-3 text-muted">{t('play.home.historyEmpty')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line border-y border-line" data-testid="game-history">
              {recent.data!.map((match) => (
                <li key={match.matchId}>
                  {/* Tapping a past game opens it for replay. */}
                  <Link to={`/play/${game.id}/match/${match.matchId}`} className="flex items-center gap-3 py-2.5">
                    <span className={`flex w-14 shrink-0 justify-center py-1 text-sm font-bold ${outcomeStyle[match.outcome]}`}>{t(`profile.outcome.${match.outcome}`)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {match.opponent ? (
                          <>
                            {match.opponent.countryCode && <span aria-hidden="true">{flagEmoji(match.opponent.countryCode)} </span>}
                            {match.opponent.name}
                          </>
                        ) : (
                          t('profile.unknownOpponent')
                        )}
                      </span>
                      <span className="block text-sm text-muted">
                        {match.pool !== 'default' && `${t(`ratingPools.${match.pool}`, { defaultValue: match.pool })} · `}
                        {match.finishedAt && format.dateTime(match.finishedAt)}
                      </span>
                    </span>
                    {!byWins && match.change !== null && <span className="shrink-0 font-bold tabular-nums">{format.signedTokens(match.change)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Stays within thumb reach at the bottom of a phone screen. */}
      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-5 bg-surface/95 px-5 pb-3 pt-3 backdrop-blur-sm lg:bottom-0 lg:mx-0 lg:px-0">{play}</div>
    </div>
  )
}
