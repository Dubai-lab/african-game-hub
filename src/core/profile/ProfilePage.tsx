import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { getGameModule } from '@/games/registry'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { flagEmoji } from '@/core/countries/useCountries'
import { DEFAULT_RATING, useGameTypes } from '@/core/games/useGameTypes'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { useFormat } from '@/core/ui/useFormat'
import { SafetyActions } from '@/core/social/SafetyActions'
import { useBlocking, useContacts, useFriendActions } from '@/core/social/social'
import { buttonClass } from '@/core/ui/Button'
import { myProfileKey } from './useMyProfile'

const PAGE_SIZE = 15
const sectionTitle = 'font-display text-xl font-semibold'

type PublicProfile = { id: string; username: string; displayName: string | null; countryCode: string | null; createdAt: string }

/** Public profile fields of the signed-in player, or of the player with this username. */
function usePublicProfile(username: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['profile', 'public', username ?? user?.id],
    enabled: Boolean(username ?? user?.id),
    meta: { errorKey: 'profile.loadFailed' },
    queryFn: async (): Promise<PublicProfile | null> => {
      const query = supabase.from('profiles').select('id, username, display_name, country_code, created_at')
      const { data, error } = await (username ? query.eq('username', username) : query.eq('id', user!.id)).maybeSingle()
      if (error) throw error
      return data && {
        id: data.id,
        username: data.username,
        displayName: data.display_name,
        countryCode: data.country_code,
        createdAt: data.created_at,
      }
    },
  })
}

function useRatings(userId: string | undefined) {
  return useQuery({
    queryKey: ['ratings', userId],
    enabled: Boolean(userId),
    staleTime: 0,
    meta: { silent: true },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_ratings')
        .select('game_type, pool, rating, games_played, wins, losses, draws')
        .eq('user_id', userId!)
      if (error) throw error
      return data
    },
  })
}

type HistoryItem = {
  matchId: string
  gameId: string
  pool: string
  stake: number
  finishedAt: string
  outcome: 'win' | 'loss' | 'draw'
  endReason: string | null
  opponent: { name: string; username: string; countryCode: string | null } | null
  tokensChange: number | null
  ratingChange: number | null
}

/** Finished matches, newest first. Aborted games never started, so they are left out. */
function useMatchHistory(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['match-history', userId],
    enabled: Boolean(userId),
    staleTime: 0,
    meta: { errorKey: 'profile.historyFailed' },
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<HistoryItem[]> => {
      // The same table is joined twice: once to pick this player's matches, once for everyone in them.
      let query = supabase
        .from('matches')
        .select(
          `id, game_type, rating_pool, stake_amount, result, winner_id, end_reason, finished_at,
           mine:match_players!inner (user_id, tokens_change, rating_before, rating_after),
           seats:match_players (user_id, profiles (username, display_name, country_code))`,
        )
        .eq('status', 'finished')
        .eq('mine.user_id', userId!)
        .order('finished_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (pageParam) query = query.lt('finished_at', pageParam)
      const { data, error } = await query
      if (error) throw error

      return data.map((match) => {
        const mine = match.mine[0]
        const other = match.seats.find((seat) => seat.user_id !== userId)?.profiles
        return {
          matchId: match.id,
          gameId: match.game_type,
          pool: match.rating_pool,
          stake: match.stake_amount,
          finishedAt: match.finished_at ?? '',
          outcome: match.result === 'draw' ? 'draw' : match.winner_id === userId ? 'win' : 'loss',
          endReason: match.end_reason,
          opponent: other ? { name: other.display_name ?? other.username, username: other.username, countryCode: other.country_code } : null,
          tokensChange: mine?.tokens_change ?? null,
          ratingChange: mine && mine.rating_after !== null && mine.rating_before !== null ? mine.rating_after - mine.rating_before : null,
        }
      })
    },
    getNextPageParam: (page) => (page.length === PAGE_SIZE ? page[page.length - 1]!.finishedAt : undefined),
  })
}

/** The player's own display name, editable in place. The username itself never changes. */
function DisplayNameEditor({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(profile.displayName ?? '')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = value.trim()
    if (busy || name.length > 40) return
    setBusy(true)
    try {
      const { error } = await supabase.from('profiles').update({ display_name: name || null }).eq('id', profile.id)
      if (error) return toast.error(t('errors.generic'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile', 'public'] }),
        queryClient.invalidateQueries({ queryKey: myProfileKey(profile.id) }),
      ])
      setEditing(false)
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="min-h-10 text-sm font-semibold text-primary underline underline-offset-4">
        {t('profile.editName')}
      </button>
    )
  }
  return (
    <form onSubmit={save} className="mt-2 flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="display-name">
        {t('profile.displayName')}
      </label>
      <input
        id="display-name"
        value={value}
        maxLength={40}
        onChange={(event) => setValue(event.target.value)}
        className="min-h-12 rounded-lg border border-line bg-panel px-3 text-base"
      />
      <p className="text-sm text-muted">{t('profile.displayNameHint', { username: profile.username })}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          {t('profile.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? t('auth.working') : t('profile.save')}
        </Button>
      </div>
    </form>
  )
}

/** On another player's profile: ask to be friends, answer their request, or open the conversation. */
function FriendActions({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation()
  const contacts = useContacts()
  const actions = useFriendActions()
  const blocking = useBlocking()
  if (contacts.isPending) return null
  // Someone the player has blocked cannot be befriended until the block is lifted.
  if (blocking.isBlocked(profile.id)) return null
  const relation = contacts.data?.find((c) => c.userId === profile.id)?.relation
  const small = 'min-h-10 px-3 text-sm'

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="friend-actions">
      {relation === 'friend' ? (
        <>
          <Link to={`/friends/${profile.username}`} className={buttonClass('primary', small)}>
            {t('friends.message')}
          </Link>
          <Button variant="ghost" className={`${small} bg-panel`} onClick={() => void actions.remove(profile.id)}>
            {t('friends.remove')}
          </Button>
        </>
      ) : relation === 'incoming' ? (
        <>
          <Button className={small} onClick={() => void actions.respond(profile.id, true)}>
            {t('friends.accept')}
          </Button>
          <Button variant="ghost" className={`${small} bg-panel`} onClick={() => void actions.respond(profile.id, false)}>
            {t('friends.decline')}
          </Button>
        </>
      ) : relation === 'outgoing' ? (
        <>
          <span className="text-sm font-semibold text-muted">{t('friends.requestSent')}</span>
          <Button variant="ghost" className={`${small} bg-panel`} onClick={() => void actions.remove(profile.id)}>
            {t('friends.cancel')}
          </Button>
        </>
      ) : (
        <Button className={small} onClick={() => void actions.request(profile.username)}>
          {t('friends.addFriend')}
        </Button>
      )}
    </div>
  )
}

const outcomeStyle: Record<HistoryItem['outcome'], string> = {
  win: 'bg-palm text-white',
  loss: 'bg-hibiscus text-white',
  draw: 'bg-line text-ink',
}

export default function ProfilePage() {
  const { t } = useTranslation()
  const format = useFormat()
  const { username } = useParams()
  const { user } = useAuth()
  const profile = usePublicProfile(username)
  const games = useGameTypes()
  const target = profile.data
  const ratings = useRatings(target?.id)
  const history = useMatchHistory(target?.id)
  const isMe = target?.id === user?.id
  const matches = history.data?.pages.flat() ?? []

  if (profile.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  if (profile.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p>{t('profile.loadFailed')}</p>
        <Button variant="ghost" onClick={() => void profile.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  if (!target) return <p>{t('profile.notFound')}</p>

  const liveGames = games.data?.filter((g) => g.status === 'live') ?? []

  return (
    <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-10">
      <div className="flex flex-col gap-7">
      <header className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center border-2 border-ink bg-primary font-display text-3xl font-extrabold text-surface"
        >
          {(target.displayName ?? target.username).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-3xl font-extrabold text-primary">{target.displayName ?? target.username}</h1>
          <p className="text-muted">
            @{target.username}
            {target.countryCode && (
              <>
                {' · '}
                <span aria-hidden="true">{flagEmoji(target.countryCode)}</span> {format.country(target.countryCode)}
              </>
            )}
          </p>
          <p className="text-sm text-muted">{t('profile.joined', { date: format.date(target.createdAt) })}</p>
          {isMe ? (
            <DisplayNameEditor profile={target} />
          ) : (
            <>
              <FriendActions profile={target} />
              <SafetyActions target={{ userId: target.id, name: target.displayName ?? target.username }} />
            </>
          )}
        </div>
      </header>

      {liveGames.map((game) => (
        <section key={game.id} aria-labelledby={`ratings-${game.id}`}>
          <h2 id={`ratings-${game.id}`} className={sectionTitle}>
            {t(getGameModule(game.id)?.standing === 'wins' ? 'profile.winsFor' : 'profile.ratingsFor', { game: t(`games.${game.id}`, { defaultValue: game.name }) })}
          </h2>
          <dl className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, game.ratingPools.length)}, minmax(0, 1fr))` }}>
            {game.ratingPools.map((pool) => {
              const row = ratings.data?.find((r) => r.game_type === game.id && r.pool === pool)
              // Some games are known by games won, not by a rating number (the game module says which).
              const byWins = getGameModule(game.id)?.standing === 'wins'
              return (
                <div key={pool} className="border-2 border-line bg-panel p-3" data-testid={`rating-${pool}`}>
                  <dt className="text-sm font-semibold text-muted">
                    {pool === 'default' ? t(byWins ? 'profile.wins' : 'profile.rating') : t(`ratingPools.${pool}`, { defaultValue: pool })}
                                      </dt>
                  <dd className="font-display text-3xl font-extrabold tabular-nums text-primary">{byWins ? (row?.wins ?? 0) : (row?.rating ?? DEFAULT_RATING)}</dd>
                  <dd className="text-xs tabular-nums text-muted">
                    {row
                      ? t('profile.record', { wins: row.wins, losses: row.losses, draws: row.draws })
                      : t('profile.noGames')}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
      ))}
      </div>

      <section aria-labelledby="profile-history">
        <h2 id="profile-history" className={sectionTitle}>
          {t('profile.history')}
        </h2>
        {history.isPending ? (
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : history.isError && matches.length === 0 ? (
          <div role="alert" className="mt-3 flex flex-col items-start gap-3">
            <p>{t('profile.historyFailed')}</p>
            <Button variant="ghost" onClick={() => void history.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : matches.length === 0 ? (
          <p className="mt-3 text-muted">{t('profile.historyEmpty')}</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-line border-y border-line" data-testid="match-history">
              {matches.map((match) => (
                <li key={match.matchId}>
                  {/* Tapping a past game opens it for replay. */}
                  <Link to={`/play/${match.gameId}/match/${match.matchId}`} className="flex items-center gap-3 py-3">
                    <span className={`flex w-14 shrink-0 justify-center py-1 text-sm font-bold ${outcomeStyle[match.outcome]}`}>
                      {t(`profile.outcome.${match.outcome}`)}
                    </span>
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
                        {t(`games.${match.gameId}`, { defaultValue: match.gameId })}
                        {match.pool !== 'default' && ` · ${t(`ratingPools.${match.pool}`, { defaultValue: match.pool })}`}
                        {' · '}
                        {match.finishedAt && format.dateTime(match.finishedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-end tabular-nums">
                      {match.ratingChange !== null && (
                        <span className="block font-bold">{format.signedTokens(match.ratingChange)}</span>
                      )}
                      {/* A player's token results are their own business. */}
                      {isMe && match.stake > 0 && match.tokensChange !== null && (
                        <span className={`block text-xs font-semibold ${match.tokensChange >= 0 ? 'text-palm' : 'text-hibiscus'}`}>
                          {t('profile.tokens', { amount: format.signedTokens(match.tokensChange) })}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {history.hasNextPage && (
              <Button variant="ghost" className="mt-4 w-full" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                {history.isFetchingNextPage ? t('app.loading') : t('wallet.older')}
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
