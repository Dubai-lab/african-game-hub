import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { flagEmoji } from '@/core/countries/useCountries'
import { useGameTypes } from '@/core/games/useGameTypes'
import { AfterMatchActions, useAfterMatch } from '@/core/matchmaking/afterMatch'
import { LeaveGuard } from '@/core/matchmaking/LeaveGuard'
import { MatchChat } from '@/core/social/MatchChat'
import { Button, buttonClass } from '@/core/ui/Button'
import type { GameOptions } from '@/games/types'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { useOnline } from '@/core/ui/OfflineBanner'
import type { Color } from '../engine/chessLogic'
import { feedback } from '../sound/sounds'
import { parseTimeControls, timeControlLabel } from '../timeControls'
import { GameTable, type TablePlayer } from '../ui/GameTable'
import { useOnlineChessGame } from './useOnlineChessGame'

/** Counts down to a moment on this device's clock, in whole seconds. */
function SecondsLeft({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  return <span className="tabular-nums">{Math.max(0, Math.ceil((until - now) / 1000))}</span>
}

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold text-primary">{title}</h1>
      {children}
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('chess.online.backToLobby')}
      </Link>
    </div>
  )
}

/** One online chess match: live for its two players, a replay for anyone else once it is over. */
export default function OnlineGamePage({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const online = useOnline()
  const games = useGameTypes()
  const game = useOnlineChessGame(matchId)
  const { controller, myColor, players, firstMove } = game

  // The start chime, once, when a player arrives at a game that has not begun.
  const fresh = game.status === 'ready' && myColor !== null && controller.played.length === 0 && !controller.outcome
  useEffect(() => {
    if (fresh) feedback('gameStart')
  }, [fresh])

  // Once it is over, the two players can go straight on: someone new, or each other again.
  const after = useAfterMatch({
    matchId,
    gameId: 'chess',
    stake: game.stake,
    options: (game.options as GameOptions | null) ?? null,
    enabled: game.status === 'ready' && myColor !== null && controller.outcome !== null && players.length === 2,
  })

  if (game.status === 'loading') return <LoadingScreen />
  if (game.status === 'not_found') return <Message title={t('chess.online.notFound')} />
  if (game.status === 'error') {
    return (
      <Message title={t('chess.online.loadFailed')}>
        <Button onClick={() => void game.reload()}>{t('common.retry')}</Button>
      </Message>
    )
  }

  const seat = (color: Color): TablePlayer => {
    const player = players.find((p) => p.color === color)
    return {
      name: player?.name ?? t(color === 'w' ? 'chess.white' : 'chess.black'),
      flag: player?.countryCode ? flagEmoji(player.countryCode) : undefined,
      rating: player?.rating ?? undefined,
      ratingChange: player && player.ratingAfter !== null && player.rating !== null ? player.ratingAfter - player.rating : undefined,
    }
  }

  const schema = games.data?.find((g) => g.id === 'chess')?.optionsSchema
  const controlId = (game.options as { time_control?: unknown } | null)?.time_control
  const control = parseTimeControls(schema).find((c) => c.id === controlId)
  const pace = control ? timeControlLabel(control) : typeof controlId === 'string' ? controlId.replace('+', ' | ') : ''
  const title = `${t('games.chess')} · ${pace}${game.stake > 0 ? ` · ${t('chess.online.stake', { stake: game.stake })}` : ''}`

  const mine = players.find((p) => p.color === myColor)
  const opponent = players.find((p) => p.color !== myColor)
  const ratingChange = mine && mine.ratingAfter !== null && mine.rating !== null ? mine.ratingAfter - mine.rating : undefined
  // Tokens only move in staked games.
  const tokensChange = mine && game.stake > 0 && mine.tokensChange !== null ? mine.tokensChange : undefined

  const over = controller.outcome !== null
  const status = over ? null : firstMove ? (
    <>
      {firstMove.color === myColor
        ? t('chess.online.yourFirstMove')
        : t('chess.online.theirFirstMove', { name: seat(firstMove.color).name })}{' '}
      <SecondsLeft until={firstMove.deadline} />
    </>
  ) : controller.drawOfferBy && controller.drawOfferBy === myColor ? (
    t('chess.online.drawSent')
  ) : (
    <span aria-hidden="true">&nbsp;</span>
  )

  return (
    <>
      <LeaveGuard active={myColor !== null && !over} />
      <GameTable
      title={title}
      game={controller}
      players={{ w: seat('w'), b: seat('b') }}
      movable={myColor ?? 'none'}
      perspective={myColor}
      timed
      passAndPlay={false}
      onlineDraws={myColor !== null}
      canAbort={myColor !== null && controller.played.length < 2}
      notice={!over && (!online || !game.connected) ? t('app.reconnecting') : undefined}
      status={status}
      tokensChange={tokensChange}
      rating={mine?.ratingAfter ?? undefined}
      ratingChange={ratingChange}
      chat={myColor ? <MatchChat matchId={matchId} names={Object.fromEntries(players.map((p) => [p.userId, p.name]))} /> : undefined}
      overActions={
        myColor ? (
          <AfterMatchActions state={after} opponent={opponent?.name ?? ''} newGameLabel={t('afterMatch.newGame', { pace })} />
        ) : (
          <Link to="/lobby" className={buttonClass('ghost', 'w-full')}>
            {t('chess.online.backToLobby')}
          </Link>
        )
      }
      onRematch={() => undefined}
    />
    </>
  )
}
