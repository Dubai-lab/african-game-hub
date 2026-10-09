import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { flagEmoji, useCountries } from '@/core/countries/useCountries'
import { type GameType, useGameTypes } from '@/core/games/useGameTypes'
import { supabase } from '@/core/lib/supabase'
import { useActiveMatch } from '@/core/matchmaking/useMatchmaking'
import { myProfileKey, useMyProfile } from '@/core/profile/useMyProfile'
import { Button, buttonClass } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { WalletSummary } from '@/core/wallet/WalletSummary'
import { GameArt } from './GameArt'

const sectionTitle = 'font-display text-xl font-semibold'

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

/** One game on the hub: its picture, its name, and whether it can be played yet. */
function GameCard({ game }: { game: GameType }) {
  const { t } = useTranslation()
  const name = t(`games.${game.id}`, { defaultValue: game.name })
  const live = game.status === 'live'
  const inside = (
    <>
      <GameArt gameId={game.id} className={`block aspect-[6/5] w-full ${live ? '' : 'opacity-45 grayscale'}`} />
      <span className="flex flex-col items-start gap-1.5 p-3">
        <span className="font-display text-2xl font-extrabold leading-none">{name}</span>
        {live ? (
          <span className="flex items-center gap-2 bg-hibiscus px-2 py-0.5 text-xs font-bold text-white">
            <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
            {t('landing.games.live')}
          </span>
        ) : (
          <span className="bg-ink px-2 py-0.5 text-xs font-bold text-surface">{t('landing.games.soon')}</span>
        )}
      </span>
    </>
  )
  // A game that is not open yet is shown, but leads nowhere.
  return live ? (
    <Link to={`/play/${game.id}`} data-testid={`game-${game.id}`} className="flex flex-col overflow-hidden border-2 border-ink bg-panel text-ink outline-offset-2 hover:bg-brand focus-visible:outline-2 focus-visible:outline-primary active:bg-brand">
      {inside}
    </Link>
  ) : (
    <div aria-disabled="true" data-testid={`game-${game.id}`} className="flex flex-col overflow-hidden border-2 border-line bg-panel text-muted">
      {inside}
    </div>
  )
}

/** The games on the hub. Choosing one opens that game's own page, where a match is set up. */
export default function LobbyPage() {
  const { t } = useTranslation()
  const games = useGameTypes()
  const profile = useMyProfile()
  const activeMatch = useActiveMatch()
  const listed = (games.data ?? []).filter((game) => game.status === 'live' || game.status === 'coming_soon')
  // Games that can be played come first.
  const ordered = [...listed.filter((game) => game.status === 'live'), ...listed.filter((game) => game.status !== 'live')]

  return (
    // Phone: one column. Computer: the player and wallet on the left, the games on the right.
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:items-start lg:gap-x-10">
      <h1 className="sr-only">{t('lobby.title')}</h1>
      <div className="flex flex-col gap-6">
        {profile.data ? (
          <p className="text-lg font-bold">
            {profile.data.country && <span aria-hidden="true">{flagEmoji(profile.data.country.code)} </span>}
            {profile.data.displayName ?? profile.data.username}
          </p>
        ) : (
          <Skeleton className="h-7 w-48" />
        )}
        <WalletSummary profile={profile.data} />
        {profile.data && !profile.data.country && <CountryPrompt />}
        {activeMatch.data && (
          <section className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-brand p-4 text-brand-ink">
            <p className="font-bold">{t('lobby.gameInProgress')}</p>
            <Link to={`/play/${activeMatch.data.gameId}/match/${activeMatch.data.matchId}`} className={buttonClass('ghost', 'border-ink bg-panel')}>
              {t('lobby.returnToGame')}
            </Link>
          </section>
        )}
      </div>

      <section aria-labelledby="lobby-games">
        <h2 id="lobby-games" className={sectionTitle}>
          {t('lobby.games')}
        </h2>
        {games.isPending ? (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : games.isError ? (
          <div role="alert" className="mt-3 flex flex-col items-start gap-3">
            <p>{t('lobby.gamesLoadFailed')}</p>
            <Button variant="ghost" onClick={() => void games.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : ordered.length === 0 ? (
          <p className="mt-3">{t('lobby.noGames')}</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {ordered.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
