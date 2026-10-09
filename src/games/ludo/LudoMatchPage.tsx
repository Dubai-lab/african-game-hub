import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { flagEmoji } from '@/core/countries/useCountries'
import { AfterMatchActions, useAfterMatch } from '@/core/matchmaking/afterMatch'
import { LeaveGuard } from '@/core/matchmaking/LeaveGuard'
import { MatchChat } from '@/core/social/MatchChat'
import { Button, buttonClass } from '@/core/ui/Button'
import { ResultDialog, ResultStat, ResultStats, type ResultTone } from '@/core/ui/ResultDialog'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { useOnline } from '@/core/ui/OfflineBanner'
import type { GameOptions } from '@/games/types'
import type { Seat } from './board'
import { LudoTable, Sheet, type TablePlayer } from './LudoTable'
import { useLudoGame } from './useLudoGame'

function Message({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold text-primary">{title}</h1>
      {children}
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('ludo.backToLobby')}
      </Link>
    </div>
  )
}

/** One online Ludo match: live for its players, the final position for anyone else once it is over. */
export default function LudoMatchPage({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const online = useOnline()
  const ludo = useLudoGame(matchId)
  const { game, match, players, mySeat } = ludo

  // The match is decided when it has a winner (or is called off). In a free game with three or
  // four players the table can stay open after that, for those playing on for the places.
  const decided = match !== null && match.status !== 'active' && match.status !== 'waiting'
  const tableOpen = game !== null && game.phase !== 'over'
  const stillIn = mySeat !== null && game !== null && !game.places.includes(mySeat) && !game.gone.includes(mySeat)

  const after = useAfterMatch({
    matchId,
    gameId: 'ludo',
    stake: match?.stake_amount ?? 0,
    options: (match?.options as GameOptions | null) ?? null,
    // A rematch is between two players; a bigger table simply finds a new game.
    enabled: ludo.status === 'ready' && mySeat !== null && decided && players.length === 2,
  })

  const [confirmResign, setConfirmResign] = useState(false)
  const [resultClosed, setResultClosed] = useState(false)

  if (ludo.status === 'loading') return <LoadingScreen />
  if (ludo.status === 'not_found') return <Message title={t('ludo.notFound')} />
  if (ludo.status === 'error' || !game || !match) {
    return (
      <Message title={t('ludo.loadFailed')}>
        <Button onClick={() => void ludo.reload()}>{t('common.retry')}</Button>
      </Message>
    )
  }

  const seats: Partial<Record<Seat, TablePlayer>> = Object.fromEntries(
    players.map((p) => [p.seat, { name: p.name, flag: p.countryCode ? flagEmoji(p.countryCode) : undefined, wins: p.wins }]),
  )
  const me = players.find((p) => p.seat === mySeat)
  const opponent = players.find((p) => p.seat !== mySeat)
  const winner = players.find((p) => p.userId === match.winner_id)
  const iWon = winner !== undefined && winner.seat === mySeat

  const options = match.options as { mode?: string } | null
  const title = [
    t('games.ludo'),
    t(`ludo.mode.${options?.mode}`, { defaultValue: options?.mode ?? '' }),
    players.length > 2 ? t('ludo.playersCount', { count: players.length }) : '',
    match.stake_amount > 0 ? t('ludo.stake', { stake: match.stake_amount }) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const ratingChange = me && me.ratingAfter !== null && me.rating !== null ? me.ratingAfter - me.rating : undefined
  const tokensChange = me && match.stake_amount > 0 && me.tokensChange !== null ? me.tokensChange : undefined
  const resultTitle =
    match.result !== 'win' ? t('ludo.over.calledOff') : mySeat === null || (!iWon && players.length > 2) ? t('ludo.over.winner', { name: winner?.name ?? '' }) : t(iWon ? 'ludo.over.youWon' : 'ludo.over.youLost')

  const actions = mySeat ? (
    <AfterMatchActions state={after} opponent={opponent?.name ?? ''} newGameLabel={t('ludo.newGame')} />
  ) : (
    <Link to="/lobby" className={buttonClass('ghost', 'w-full')}>
      {t('ludo.backToLobby')}
    </Link>
  )
  const playingOn = decided && tableOpen && stillIn
  const resultTone: ResultTone = match.result !== 'win' ? 'neutral' : mySeat === null || iWon ? 'win' : 'loss'

  return (
    <>
      <LeaveGuard active={mySeat !== null && !decided && tableOpen && stillIn} />
      <LudoTable
      title={title}
      state={game}
      players={seats}
      mySeat={mySeat}
      deadline={ludo.deadline}
      busy={ludo.busy}
      notice={tableOpen && (!online || !ludo.connected) ? t('app.reconnecting') : undefined}
      onRoll={ludo.roll}
      onMove={ludo.move}
      chat={mySeat ? <MatchChat matchId={matchId} names={Object.fromEntries(players.map((p) => [p.userId, p.name]))} /> : undefined}
      footer={
        <div className="flex flex-col gap-2">
          {decided && resultClosed && (
            <Button variant="ghost" className="w-full" onClick={() => setResultClosed(false)} data-testid="show-result">
              {t('ludo.over.showResult')}
            </Button>
          )}
          {decided && actions}
          {tableOpen && stillIn && (
            <Button variant="ghost" className="w-full" onClick={() => (playingOn ? ludo.resign() : setConfirmResign(true))}>
              {t(playingOn ? 'ludo.stopPlaying' : 'ludo.resign.button')}
            </Button>
          )}
        </div>
      }
    >
      {confirmResign && !decided && (
        <Sheet title={t('ludo.resign.title')} onClose={() => setConfirmResign(false)}>
          <p className="mt-1 text-muted">
            {players.length > 2
              ? t(match.stake_amount > 0 ? 'ludo.resign.bodyTableStaked' : 'ludo.resign.bodyTable')
              : t('ludo.resign.body', { opponent: opponent?.name ?? '' })}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setConfirmResign(false)}>
              {t('ludo.resign.cancel')}
            </Button>
            <Button
              className="bg-hibiscus text-white active:bg-hibiscus"
              onClick={() => {
                setConfirmResign(false)
                ludo.resign()
              }}
            >
              {t('ludo.resign.confirm')}
            </Button>
          </div>
        </Sheet>
      )}

      {decided && !resultClosed && (
        <ResultDialog
          title={resultTitle}
          tone={resultTone}
          reason={t(`ludo.reason.${match.end_reason}`, { defaultValue: t('ludo.reason.other') })}
          onClose={() => setResultClosed(true)}
          closeLabel={t(playingOn ? 'ludo.over.keepPlaying' : 'ludo.over.close')}
        >
          {(tokensChange !== undefined || ratingChange !== undefined) && (
            <ResultStats>
              {ratingChange !== undefined && <ResultStat testId="game-over-rating" label={t('ludo.over.rating')} value={me?.ratingAfter ?? ''} change={ratingChange} />}
              {tokensChange !== undefined && <ResultStat testId="game-over-tokens" label={t('ludo.over.tokens')} change={tokensChange} />}
            </ResultStats>
          )}
          {playingOn && <p className="text-center text-sm font-semibold">{t('ludo.over.playOn')}</p>}
          <div>{actions}</div>
        </ResultDialog>
      )}
    </LudoTable>
    </>
  )
}
