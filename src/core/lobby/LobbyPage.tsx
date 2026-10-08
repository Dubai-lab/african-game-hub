import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { flagEmoji, useCountries } from '@/core/countries/useCountries'
import { type GameType, DEFAULT_RATING, useGameTypes, useMyRating, useRakeBps } from '@/core/games/useGameTypes'
import { supabase } from '@/core/lib/supabase'
import { type MyProfile, myProfileKey, useMyProfile } from '@/core/profile/useMyProfile'
import { Button, buttonClass } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'
import { winnerPayout } from '@/core/wallet/payout'
import { Skeleton } from '@/core/ui/Skeleton'
import { useFormat } from '@/core/ui/useFormat'
import { useWallet } from '@/core/wallet/useWallet'
import { WalletSummary } from '@/core/wallet/WalletSummary'
import { getGameModule } from '@/games/registry'
import { useActiveMatch, useMatchmaking } from '@/core/matchmaking/useMatchmaking'
import { useLobbyStore } from './lobbyStore'

const sectionTitle = 'font-display text-xl font-semibold'
const SOON_COLORS = ['bg-hibiscus text-white', 'bg-palm text-white', 'bg-primary-soft text-white', 'bg-ink text-surface']

function PlayerLine({ profile, game, pool }: { profile: MyProfile | undefined; game: GameType | undefined; pool: string }) {
  const { t } = useTranslation()
  const rating = useMyRating(game?.id, pool)
  if (!profile) return <Skeleton className="h-7 w-48" />
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-lg font-bold">
        {profile.country && <span aria-hidden="true">{flagEmoji(profile.country.code)} </span>}
        {profile.displayName ?? profile.username}
      </span>
      {game && (
        <span className="text-sm font-semibold tabular-nums text-muted">
          {getGameModule(game.id)?.standing === 'wins'
            ? t('lobby.wins', {
                game: pool === 'default' ? t(`games.${game.id}`, { defaultValue: game.name }) : t(`ratingPools.${pool}`, { defaultValue: pool }),
                count: rating.data?.wins ?? 0,
              })
            : t('lobby.rating', {
                // Games with several rating pools name the pool ("Blitz"); others name the game.
                game: pool === 'default' ? t(`games.${game.id}`, { defaultValue: game.name }) : t(`ratingPools.${pool}`, { defaultValue: pool }),
                rating: rating.data?.rating ?? DEFAULT_RATING,
              })}
        </span>
      )}
    </p>
  )
}

/** Shown only to accounts that have no country yet. It can be set once (enforced by the server). */
function CountryPrompt() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { countries } = useCountries()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!code || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('set_my_country', { p_country_code: code })
      if (error) return toast.error(t('errors.generic'))
      await queryClient.invalidateQueries({ queryKey: myProfileKey(user?.id) })
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="lobby-country" className="border-2 border-ink bg-panel p-4">
      <h2 id="lobby-country" className={sectionTitle}>
        {t('lobby.countryPrompt.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('auth.countryHint')}</p>
      <div className="mt-3 flex flex-col gap-3">
        <select
          aria-labelledby="lobby-country"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="min-h-12 w-full rounded-lg border border-line bg-panel px-3 text-base"
        >
          <option value="">{t('auth.countryPlaceholder')}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.name}
            </option>
          ))}
        </select>
        <Button onClick={() => void save()} disabled={!code || busy}>
          {busy ? t('auth.working') : t('lobby.countryPrompt.save')}
        </Button>
      </div>
    </section>
  )
}

function GamePicker({ games, selected, onSelect }: { games: GameType[]; selected: GameType | undefined; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const live = games.filter((g) => g.status === 'live')
  const soon = games.filter((g) => g.status === 'coming_soon')
  const name = (game: GameType) => t(`games.${game.id}`, { defaultValue: game.name })

  return (
    <fieldset>
      <legend className={sectionTitle}>{t('lobby.chooseGame')}</legend>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {/* Live games sit two to a row; an odd one out takes the full width. */}
        {live.map((game, index) => {
          const chosen = game.id === selected?.id
          return (
            <label
              key={game.id}
              className={`flex min-h-16 cursor-pointer border-2 px-4 py-2 ${live.length % 2 === 1 && index === live.length - 1 ? 'col-span-2 items-center justify-between' : 'flex-col items-start justify-center gap-1'} has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`}
            >
              <input type="radio" name="lobby-game" className="sr-only" checked={chosen} onChange={() => onSelect(game.id)} />
              <span className="font-display text-2xl font-extrabold">{name(game)}</span>
              <span className="flex items-center gap-2 bg-hibiscus px-2 py-0.5 text-xs font-bold text-white">
                <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
                {t('landing.games.live')}
              </span>
            </label>
          )
        })}
        {soon.map((game, index) => (
          <div
            key={game.id}
            aria-disabled="true"
            className={`flex min-h-14 flex-col justify-center px-3 py-2 opacity-90 ${SOON_COLORS[index % SOON_COLORS.length]}`}
          >
            <span className="font-display text-lg font-extrabold leading-tight">{name(game)}</span>
            <span className="text-xs font-semibold">{t('landing.games.soon')}</span>
          </div>
        ))}
      </div>
    </fieldset>
  )
}

function StakePicker({
  game,
  players,
  stake,
  balance,
  rakeBps,
  onSelect,
}: {
  game: GameType
  /** How many players will share the pot: the quoted winnings depend on it. */
  players: number
  stake: number
  balance: number | null
  rakeBps: number | undefined
  onSelect: (stake: number) => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const terms = rakeBps === undefined ? null : winnerPayout(stake, rakeBps, players)

  return (
    <fieldset>
      <legend className={sectionTitle}>{t('lobby.stake')}</legend>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {game.stakeLevels.map((level) => {
          const chosen = level === stake
          const tooMuch = balance !== null && level > balance
          return (
            <label
              key={level}
              className={`flex min-h-14 flex-col items-center justify-center border-2 px-1 text-center has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${
                tooMuch
                  ? 'cursor-not-allowed border-line bg-surface text-muted'
                  : chosen
                    ? 'cursor-pointer border-ink bg-brand text-brand-ink'
                    : 'cursor-pointer border-line bg-panel'
              }`}
            >
              <input
                type="radio"
                name="lobby-stake"
                className="sr-only"
                checked={chosen}
                disabled={tooMuch}
                onChange={() => onSelect(level)}
              />
              <span className="text-lg font-bold tabular-nums">{level === 0 ? t('lobby.free') : format.tokens(level)}</span>
              {tooMuch && <span className="text-[0.7rem] font-semibold leading-tight">{t('lobby.notEnough')}</span>}
            </label>
          )
        })}
      </div>
      <p className="mt-2 min-h-10 text-sm text-muted" aria-live="polite">
        {stake === 0
          ? t('lobby.stakeFreeNote')
          : terms &&
            t('lobby.stakeNote', {
              stake: format.tokens(stake),
              payout: format.tokens(terms.payout),
              rake: format.tokens((rakeBps ?? 0) / 100),
            })}
      </p>
    </fieldset>
  )
}

/** Shown in place of the pickers while the server looks for an opponent. */
function Searching({ gameName, stake, startedAt, onCancel }: { gameName: string; stake: number; startedAt: number; onCancel: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return (
    <section aria-live="polite" className="flex flex-col items-center gap-4 border-2 border-ink bg-panel px-5 py-8 text-center">
      <span className="size-10 animate-spin rounded-full border-4 border-line border-t-primary motion-reduce:animate-none" aria-hidden="true" />
      <h2 className="font-display text-2xl font-extrabold text-primary">{t('lobby.searching.title')}</h2>
      <p className="font-semibold">
        {gameName} · {stake === 0 ? t('lobby.free') : t('lobby.searching.stake', { stake: format.tokens(stake) })}
      </p>
      <p className="text-3xl font-bold tabular-nums" role="timer">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </p>
      <p className="max-w-xs text-sm text-muted">{t('lobby.searching.hint')}</p>
      <Button variant="ghost" className="w-full" onClick={onCancel}>
        {t('lobby.searching.cancel')}
      </Button>
    </section>
  )
}

export default function LobbyPage() {
  const { t } = useTranslation()
  const games = useGameTypes()
  const wallet = useWallet()
  const profile = useMyProfile()
  const rake = useRakeBps()
  const store = useLobbyStore()
  const navigate = useNavigate()
  const matchmaking = useMatchmaking((gameId, matchId) => navigate(`/play/${gameId}/match/${matchId}`))
  const activeMatch = useActiveMatch()

  const liveGames = games.data?.filter((g) => g.status === 'live') ?? []
  const game = liveGames.find((g) => g.id === store.gameId) ?? liveGames[0]
  const module = game ? getGameModule(game.id) : undefined
  const balance = wallet.data ? wallet.data.bonus + wallet.data.cash : null

  // Saved choices are only kept while they are still on offer and affordable.
  const savedStake = game ? store.stakeByGame[game.id] : undefined
  const stake =
    game && savedStake !== undefined && game.stakeLevels.includes(savedStake) && (balance === null || savedStake <= balance)
      ? savedStake
      : (game?.stakeLevels[0] ?? 0)

  const savedOptions = game ? (store.optionsByGame[game.id] ?? null) : null
  const options =
    game && module
      ? module.isValidOptions(game.optionsSchema, savedOptions)
        ? savedOptions
        : module.defaultOptions(game.optionsSchema)
      : null

  return (
    // Phone: one column. Computer: the player and wallet on the left, the match setup on the right.
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-10">
      <h1 className="sr-only">{t('lobby.title')}</h1>
      {/* On a phone this wrapper dissolves, so Practice can sit below the match setup;
          on a computer it is the left column. */}
      <div className="contents lg:col-start-1 lg:flex lg:flex-col lg:gap-6">
      <div className="order-1 flex flex-col gap-6">
      <PlayerLine
        profile={profile.data}
        game={game}
        pool={game && module ? module.ratingPool(game.optionsSchema, options) : 'default'}
      />
      <WalletSummary profile={profile.data} />
      {profile.data && !profile.data.country && <CountryPrompt />}

      {activeMatch.data && !matchmaking.search && (
        <section className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-brand p-4 text-brand-ink">
          <p className="font-bold">{t('lobby.gameInProgress')}</p>
          <Link
            to={`/play/${activeMatch.data.gameId}/match/${activeMatch.data.matchId}`}
            className={buttonClass('ghost', 'border-ink bg-panel')}
          >
            {t('lobby.returnToGame')}
          </Link>
        </section>
      )}
      </div>
      {module?.practice && (
      <section aria-labelledby="lobby-practice" className="order-3">
        <h2 id="lobby-practice" className={sectionTitle}>
          {t('lobby.practice')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('lobby.practiceHint')}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {module.practice.map((way) => (
            <Link key={way.to} to={way.to} className={buttonClass('ghost', 'bg-panel px-2 text-center text-sm')}>
              {t(way.labelKey)}
            </Link>
          ))}
        </div>
      </section>
      )}
      </div>

      <div className="order-2 flex flex-col gap-6 lg:col-start-2 lg:row-start-1 lg:border-2 lg:border-line lg:bg-panel lg:p-6">
      {matchmaking.search ? (
        <Searching
          gameName={t(`games.${matchmaking.search.gameId}`, { defaultValue: matchmaking.search.gameId })}
          stake={matchmaking.search.stake}
          startedAt={matchmaking.search.startedAt}
          onCancel={matchmaking.cancel}
        />
      ) : games.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : games.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('lobby.gamesLoadFailed')}</p>
          <Button variant="ghost" onClick={() => void games.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !game ? (
        <p>{t('lobby.noGames')}</p>
      ) : (
        <>
          <GamePicker games={games.data} selected={game} onSelect={store.chooseGame} />
          <StakePicker
            game={game}
            players={module?.players?.(game.optionsSchema, options) ?? game.minPlayers}
            stake={stake}
            balance={balance}
            rakeBps={rake.data}
            onSelect={(level) => store.chooseStake(game.id, level)}
          />
          {module && (
            <module.OptionsPicker
              schema={game.optionsSchema}
              value={options}
              onChange={(value) => store.chooseOptions(game.id, value)}
            />
          )}
          {/* Stays within thumb reach at the bottom of the screen. */}
          <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-5 bg-surface/95 px-5 pb-3 pt-3 backdrop-blur-sm lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <Button
              className="min-h-14 w-full text-lg"
              disabled={!module || !options || matchmaking.starting}
              onClick={() => options && void matchmaking.start({ gameId: game.id, stake, options })}
            >
              {matchmaking.starting ? t('auth.working') : t('lobby.findMatch')}
            </Button>
          </div>
        </>
      )}
      </div>

    </div>
  )
}
