import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { flagEmoji } from '@/core/countries/useCountries'
import { useGameTypes } from '@/core/games/useGameTypes'
import { AfterMatchActions, needsAnswer, useAfterMatch } from '@/core/matchmaking/afterMatch'
import { LeaveGuard } from '@/core/matchmaking/LeaveGuard'
import { MatchChat } from '@/core/social/MatchChat'
import { Button, buttonClass } from '@/core/ui/Button'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { useOnline } from '@/core/ui/OfflineBanner'
import type { GameOptions } from '@/games/types'
import type { Side } from '../../../supabase/functions/_shared/oware'
import { parseTimeControls, timeControlLabel } from './lobby'
import { OwareTable, type TablePlayer } from './OwareTable'
import { feedback } from './sound'
import { useOwareGame } from './useOwareGame'

/** Counts down to a moment on this device's clock, in whole seconds. */
function SecondsLeft({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  return <span className="tabular-nums">{Math.max(0, Math.ceil((until - now) / 1000))}</span>
}

function Message({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-(--app-h) flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold text-accent">{title}</h1>
      {children}
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('oware.backToLobby')}
      </Link>
    </div>
  )
}

/** One online game of Oware: live for its two players (and anyone watching a tournament game), a replay once it is over. */
export default function OwareMatchPage({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const online = useOnline()
  const games = useGameTypes()
  const game = useOwareGame(matchId)
  const { controller, mySide, players, firstMove } = game
  const [chatClosed, setChatClosed] = useState(false)
  const [chatHeard, setChatHeard] = useState(0)
  const [chatSent, setChatSent] = useState(0)

  // The start chime, once, when a player arrives at a game that has not begun.
  const fresh = game.status === 'ready' && mySide !== null && controller.played.length === 0 && !controller.outcome
  useEffect(() => {
    if (fresh) feedback('gameStart')
  }, [fresh])

  // Once it is over, the two players can go straight on: someone new, or each other again.
  const after = useAfterMatch({
    matchId,
    gameId: 'oware',
    stake: game.stake,
    options: (game.options as GameOptions | null) ?? null,
    enabled: game.status === 'ready' && mySide !== null && controller.outcome !== null && players.length === 2,
  })

  if (game.status === 'loading') return <LoadingScreen />
  if (game.status === 'not_found') return <Message title={t('oware.notFound')} />
  if (game.status === 'error') {
    return (
      <Message title={t('oware.loadFailed')}>
        <Button onClick={() => void game.reload()}>{t('common.retry')}</Button>
      </Message>
    )
  }

  const seat = (side: Side): TablePlayer => {
    const player = players.find((p) => p.side === side)
    return {
      name: player?.name ?? t(side === 's' ? 'oware.south' : 'oware.north'),
      flag: player?.countryCode ? flagEmoji(player.countryCode) : undefined,
      rating: player?.rating ?? undefined,
      avatarUrl: player?.avatarUrl ?? undefined,
      ratingChange: player && player.ratingAfter !== null && player.rating !== null ? player.ratingAfter - player.rating : undefined,
    }
  }

  const schema = games.data?.find((g) => g.id === 'oware')?.optionsSchema
  const controlId = (game.options as { time_control?: unknown } | null)?.time_control
  const control = parseTimeControls(schema).find((c) => c.id === controlId)
  const pace = control ? timeControlLabel(control) : typeof controlId === 'string' ? controlId.replace('+', ' | ') : ''
  const title = [t('games.oware'), pace, game.stake > 0 ? t('oware.stake', { stake: game.stake }) : ''].filter(Boolean).join(' · ')

  const mine = players.find((p) => p.side === mySide)
  const opponent = players.find((p) => p.side !== mySide)
  const ratingChange = mine && mine.ratingAfter !== null && mine.rating !== null ? mine.ratingAfter - mine.rating : undefined
  // Tokens only move in staked games.
  const tokensChange = mine && game.stake > 0 && mine.tokensChange !== null ? mine.tokensChange : undefined

  const over = controller.outcome !== null
  const status = over ? undefined : firstMove ? (
    <>
      {firstMove.side === mySide ? t('oware.online.yourFirstMove') : t('oware.online.theirFirstMove', { name: seat(firstMove.side).name })} <SecondsLeft until={firstMove.deadline} />
    </>
  ) : controller.drawOfferBy && controller.drawOfferBy === mySide ? (
    t('oware.online.drawSent')
  ) : undefined

  return (
    <>
      <LeaveGuard active={mySide !== null && !over} />
      <OwareTable
        title={title}
        game={controller}
        players={{ s: seat('s'), n: seat('n') }}
        movable={mySide ?? 'none'}
        perspective={mySide}
        timed
        onlineDraws={mySide !== null}
        canAbort={mySide !== null && controller.played.length < 2}
        notice={!over && (!online || !game.connected) ? t('app.reconnecting') : undefined}
        status={status}
        tokensChange={tokensChange}
        rating={mine?.ratingAfter ?? undefined}
        ratingChange={ratingChange}
        chat={
          mySide ? (
            <MatchChat matchId={matchId} gameId="oware" names={Object.fromEntries(players.map((p) => [p.userId, p.name]))} ended={over} onClosed={setChatClosed} onHeard={() => setChatHeard((n) => n + 1)} onQuickSent={() => setChatSent((n) => n + 1)} />
          ) : undefined
        }
        chatClosed={chatClosed}
        chatHeard={chatHeard}
        chatSent={chatSent}
        overActionsPinned={needsAnswer(after)}
        overActions={
          mySide ? (
            <AfterMatchActions state={after} opponent={opponent?.name ?? ''} newGameLabel={t('afterMatch.newGame', { pace })} />
          ) : (
            <Link to="/lobby" className={buttonClass('ghost', 'w-full')}>
              {t('oware.backToLobby')}
            </Link>
          )
        }
      />
    </>
  )
}
