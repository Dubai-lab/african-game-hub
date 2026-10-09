import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { type GameType, useRakeBps } from '@/core/games/useGameTypes'
import { Button, buttonClass } from '@/core/ui/Button'
import { winnerPayout } from '@/core/wallet/payout'
import { Skeleton } from '@/core/ui/Skeleton'
import { useFormat } from '@/core/ui/useFormat'
import { useWallet } from '@/core/wallet/useWallet'
import { termsText } from './challenges'
import { GameHeader, useMatchSetup } from './setup'
import { useActiveMatch, useMatchmaking } from '@/core/matchmaking/useMatchmaking'

const sectionTitle = 'font-display text-xl font-semibold'

export function StakePicker({
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

/** A row that opens to show a choice: what is chosen now on the row itself, the choices underneath. */
function Dropdown({ id, label, value, open, onToggle, children }: { id: string; label: string; value: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-2 border-line bg-panel">
      <button type="button" aria-expanded={open} aria-controls={`${id}-panel`} data-testid={`${id}-toggle`} onClick={onToggle} className="flex min-h-14 w-full items-center gap-3 px-4 text-start">
        <span className="text-sm font-semibold text-muted">{label}</span>
        <span className="min-w-0 flex-1 truncate text-center text-lg font-bold" data-testid={`${id}-value`}>
          {value}
        </span>
        <span className={`text-xl leading-none transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div id={`${id}-panel`} className="border-t-2 border-line p-4">
          {children}
        </div>
      )}
    </div>
  )
}

const row = 'flex min-h-14 w-full items-center justify-center border-2 border-line bg-panel px-4 text-center text-lg font-bold hover:bg-brand active:bg-brand'

/**
 * Play: one column of choices. How to play and the stake each open from their own row; then
 * Find match, and the other ways into a game: tournaments, a friend, the computer.
 */
export default function GamePage() {
  const { t } = useTranslation()
  const format = useFormat()
  const { gameId } = useParams()
  const rake = useRakeBps()
  const wallet = useWallet()
  const { games, game, module, balance, stake, options, pool, players, setStake, setOptions } = useMatchSetup(gameId)
  const navigate = useNavigate()
  const matchmaking = useMatchmaking((gameId, matchId) => navigate(`/play/${gameId}/match/${matchId}`))
  const activeMatch = useActiveMatch()
  const [open, setOpen] = useState<{ options: boolean; stake: boolean }>({ options: false, stake: false })

  const gameName = game ? t(`games.${game.id}`, { defaultValue: game.name }) : ''
  const toggle = (which: 'options' | 'stake') => setOpen((now) => ({ ...now, [which]: !now[which] }))

  // What the player has to stake with, always in view (also while an opponent is being found).
  const tokensLine = (
    <p className="text-center text-sm text-muted">
      {t('play.new.tokens')}{' '}
      <span className="font-bold tabular-nums text-ink" data-testid="balance-bonus">
        {wallet.data ? format.tokens(wallet.data.bonus) : '…'}
      </span>{' '}
      {t('lobby.bonus').toLowerCase()} ·{' '}
      <span className="font-bold tabular-nums text-ink" data-testid="balance-cash">
        {wallet.data ? format.tokens(wallet.data.cash) : '…'}
      </span>{' '}
      {t('lobby.cash').toLowerCase()}
    </p>
  )

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 lg:mx-0">
      <GameHeader
        gameId={game?.id}
        title={t('play.new.title')}
        back={game ? { to: `/play/${game.id}`, label: t('play.new.backTo', { game: gameName }) } : { to: '/lobby', label: t('lobby.allGames') }}
      />

      {activeMatch.data && !matchmaking.search && (
        <section className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-brand p-4 text-brand-ink">
          <p className="font-bold">{t('lobby.gameInProgress')}</p>
          <Link to={`/play/${activeMatch.data.gameId}/match/${activeMatch.data.matchId}`} className={buttonClass('ghost', 'border-ink bg-panel')}>
            {t('lobby.returnToGame')}
          </Link>
        </section>
      )}

      {matchmaking.search ? (
        <>
        <Searching
          gameName={t(`games.${matchmaking.search.gameId}`, { defaultValue: matchmaking.search.gameId })}
          stake={matchmaking.search.stake}
          startedAt={matchmaking.search.startedAt}
          onCancel={matchmaking.cancel}
        />
        {tokensLine}
        </>
      ) : games.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : games.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('lobby.gamesLoadFailed')}</p>
          <Button variant="ghost" onClick={() => void games.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !game ? (
        <div className="flex flex-col items-start gap-3">
          <p>{t('lobby.gameNotOpen')}</p>
          <Link to="/lobby" className={buttonClass('ghost')}>
            {t('lobby.allGames')}
          </Link>
        </div>
      ) : (
        <>
          {module && (
            <Dropdown id="play-options" label={t('play.new.how')} value={termsText(game, pool, options) || t('play.new.options')} open={open.options} onToggle={() => toggle('options')}>
              <module.OptionsPicker schema={game.optionsSchema} value={options} onChange={setOptions} />
            </Dropdown>
          )}
          <Dropdown id="play-stake" label={t('lobby.stake')} value={stake === 0 ? t('lobby.free') : t('play.new.stakeValue', { stake: format.tokens(stake) })} open={open.stake} onToggle={() => toggle('stake')}>
            <StakePicker game={game} players={players} stake={stake} balance={balance} rakeBps={rake.data} onSelect={setStake} />
          </Dropdown>
          {tokensLine}

          <Button className="min-h-14 w-full text-lg" disabled={!module || !options || matchmaking.starting} onClick={() => options && void matchmaking.start({ gameId: game.id, stake, options })}>
            {matchmaking.starting ? t('auth.working') : t('lobby.findMatch')}
          </Button>

          <nav aria-label={t('play.new.more')} className="flex flex-col gap-3">
            <Link to={`/play/${game.id}/tournaments`} className={row}>
              {t('play.new.tournaments')}
            </Link>
            <Link to={`/play/${game.id}/friend`} className={row}>
              {t('play.new.friend')}
            </Link>
            {(module?.practice ?? []).map((way) => (
              <Link key={way.to} to={way.to} className={row}>
                {t(way.labelKey)}
              </Link>
            ))}
          </nav>
        </>
      )}
    </div>
  )
}
