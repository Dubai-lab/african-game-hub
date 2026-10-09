import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AfterMatchActions, useAfterMatch } from '@/core/matchmaking/afterMatch'
import { LeaveGuard } from '@/core/matchmaking/LeaveGuard'
import { MatchChat } from '@/core/social/MatchChat'
import { Button, buttonClass } from '@/core/ui/Button'
import { ResultDialog, ResultStat, ResultStats, type ResultTone } from '@/core/ui/ResultDialog'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { useOnline } from '@/core/ui/OfflineBanner'
import type { GameOptions } from '@/games/types'
import { PoolTable, Sheet } from './PoolTable'
import { usePoolGame } from './usePoolGame'

function Message({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold text-primary">{title}</h1>
      {children}
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('pool.backToLobby')}
      </Link>
    </div>
  )
}

/** One online pool match: live for its two players, the final table for anyone else once it is over. */
export default function PoolMatchPage({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const online = useOnline()
  const pool = usePoolGame(matchId)
  const { game, match, players, mySeat } = pool
  const [playing, setPlaying] = useState(false)
  const decided = match !== null && match.status !== 'active' && match.status !== 'waiting'

  const after = useAfterMatch({
    matchId,
    gameId: 'pool',
    stake: match?.stake_amount ?? 0,
    options: (match?.options as GameOptions | null) ?? null,
    enabled: pool.status === 'ready' && mySeat !== null && decided && players.length === 2,
  })
  const [confirmResign, setConfirmResign] = useState(false)
  const [resultClosed, setResultClosed] = useState(false)

  if (pool.status === 'loading') return <LoadingScreen />
  if (pool.status === 'not_found') return <Message title={t('pool.notFound')} />
  if (pool.status === 'error' || !game || !match) {
    return (
      <Message title={t('pool.loadFailed')}>
        <Button onClick={() => void pool.reload()}>{t('common.retry')}</Button>
      </Message>
    )
  }

  const me = players.find((p) => p.seat === mySeat)
  const opponent = players.find((p) => p.seat === (mySeat === 1 ? 2 : 1))
  const winner = players.find((p) => p.userId === match.winner_id)
  const iWon = winner !== undefined && winner.seat === mySeat

  const title = [t('games.pool'), t(`pool.variant.${game.variant}`), match.stake_amount > 0 ? t('pool.stake', { stake: match.stake_amount }) : ''].filter(Boolean).join(' · ')
  // Shown once the result has been settled (the count then includes this game).
  const winsNow = me && match.result === 'win' && me.ratingAfter !== null ? me.wins : undefined
  const tokensChange = me && match.stake_amount > 0 && me.tokensChange !== null ? me.tokensChange : undefined
  const resultTone: ResultTone = match.result !== 'win' ? 'neutral' : mySeat === null || iWon ? 'win' : 'loss'
  const resultTitle = match.result !== 'win' ? t('pool.over.calledOff') : mySeat === null ? t('pool.over.winner', { name: winner?.name ?? '' }) : t(iWon ? 'pool.over.youWon' : 'pool.over.youLost')
  const actions = mySeat ? (
    <AfterMatchActions state={after} opponent={opponent?.name ?? ''} newGameLabel={t('pool.newGame')} />
  ) : (
    <Link to="/lobby" className={buttonClass('ghost', 'w-full')}>
      {t('pool.backToLobby')}
    </Link>
  )

  return (
    <>
      <LeaveGuard active={mySeat !== null && !decided && !game.over} />
      <PoolTable
        title={title}
        game={game}
        players={players}
        mySeat={mySeat}
        decided={decided || game.over}
        busy={pool.busy}
        connected={online && pool.connected}
        deadline={pool.deadline}
        onShoot={pool.shoot}
        onPlaying={setPlaying}
        footer={
          decided ? (
            <div className="flex flex-col gap-2">
              {resultClosed && (
                <Button variant="ghost" className="w-full" onClick={() => setResultClosed(false)} data-testid="show-result">
                  {t('pool.over.showResult')}
                </Button>
              )}
              {actions}
            </div>
          ) : mySeat ? (
            <Button variant="ghost" className="w-full" onClick={() => setConfirmResign(true)}>
              {t('pool.resign.button')}
            </Button>
          ) : null
        }
      >
        {mySeat && <MatchChat matchId={matchId} names={Object.fromEntries(players.map((p) => [p.userId, p.name]))} />}
      </PoolTable>

      {confirmResign && !decided && (
        <Sheet title={t('pool.resign.title')} onClose={() => setConfirmResign(false)}>
          <p className="mt-1 text-muted">{t('pool.resign.body', { opponent: opponent?.name ?? '' })}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setConfirmResign(false)}>
              {t('pool.resign.cancel')}
            </Button>
            <Button
              className="bg-hibiscus text-white active:bg-hibiscus"
              onClick={() => {
                setConfirmResign(false)
                pool.resign()
              }}
            >
              {t('pool.resign.confirm')}
            </Button>
          </div>
        </Sheet>
      )}

      {decided && !playing && !resultClosed && (
        <ResultDialog
          title={resultTitle}
          tone={resultTone}
          reason={t(`pool.reason.${match.end_reason}`, { defaultValue: t('pool.reason.other') })}
          onClose={() => setResultClosed(true)}
          closeLabel={t('pool.over.close')}
        >
          {(tokensChange !== undefined || winsNow !== undefined) && (
            <ResultStats>
              {winsNow !== undefined && <ResultStat testId="game-over-wins" label={t('pool.over.wins', { game: t(`pool.variant.${game.variant}`) })} value={winsNow} />}
              {tokensChange !== undefined && <ResultStat testId="game-over-tokens" label={t('pool.over.tokens')} change={tokensChange} />}
            </ResultStats>
          )}
          <div>{actions}</div>
        </ResultDialog>
      )}
    </>
  )
}
