import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { type GameType, useGameTypes } from '@/core/games/useGameTypes'
import { useWallet } from '@/core/wallet/useWallet'
import { getGameModule } from '@/games/registry'
import type { GameOptions } from '@/games/types'
import { GameArt } from './GameArt'
import { useLobbyStore } from './lobbyStore'

// What every page of a game shares: finding the game, the player's remembered choices for it,
// and the strip across the top.

/**
 * The game named in the address, if it is open, with the player's last stake and options for
 * it. Saved choices are only kept while they are still on offer and affordable.
 */
export function useMatchSetup(gameId: string | undefined) {
  const games = useGameTypes()
  const wallet = useWallet()
  const store = useLobbyStore()

  const game: GameType | undefined = games.data?.find((g) => g.id === gameId && g.status === 'live')
  const module = game ? getGameModule(game.id) : undefined
  const balance = wallet.data ? wallet.data.bonus + wallet.data.cash : null

  const savedStake = game ? store.stakeByGame[game.id] : undefined
  const stake =
    game && savedStake !== undefined && game.stakeLevels.includes(savedStake) && (balance === null || savedStake <= balance)
      ? savedStake
      : (game?.stakeLevels[0] ?? 0)

  const savedOptions = game ? (store.optionsByGame[game.id] ?? null) : null
  const options: GameOptions | null =
    game && module ? (module.isValidOptions(game.optionsSchema, savedOptions) ? savedOptions : module.defaultOptions(game.optionsSchema)) : null

  return {
    games,
    game,
    module,
    balance,
    stake,
    options,
    /** Which rating (or count of wins) a game with these options goes toward. */
    pool: game && module ? module.ratingPool(game.optionsSchema, options) : 'default',
    /** How many players a game with these options has. */
    players: game ? (module?.players?.(game.optionsSchema, options) ?? game.minPlayers) : 2,
    setStake: (level: number) => game && store.chooseStake(game.id, level),
    setOptions: (value: GameOptions) => game && store.chooseOptions(game.id, value),
  }
}

/** The top of every page of a game: the way back, the game's picture and the page's name. */
export function GameHeader({ gameId, title, back, children }: { gameId: string | undefined; title: string; back: { to: string; label: string }; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link to={back.to} className="flex min-h-11 shrink-0 items-center font-semibold text-primary underline underline-offset-4">
        {back.label}
      </Link>
      <span className="ms-auto flex min-w-0 items-center gap-3">
        {children}
        {gameId && <GameArt gameId={gameId} className="h-11 w-14 shrink-0 border-2 border-ink" />}
        <h1 className="truncate font-display text-3xl font-extrabold text-primary">{title}</h1>
      </span>
    </header>
  )
}

/** Shown on a game's page when the address names a game that is not open. */
export function GameNotOpen() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-start gap-3">
      <p>{t('lobby.gameNotOpen')}</p>
      <Link to="/lobby" className="font-semibold text-primary underline underline-offset-4">
        {t('lobby.allGames')}
      </Link>
    </div>
  )
}

/** "17 min", "1 h 27 min", "40 s": how long until (or since) something, for a list or a countdown. */
export function spanText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d`
}
