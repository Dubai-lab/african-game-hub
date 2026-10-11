import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AfterMatchActions, needsAnswer, useAfterMatch } from '@/core/matchmaking/afterMatch'
import { LeaveGuard } from '@/core/matchmaking/LeaveGuard'
import { MatchChat } from '@/core/social/MatchChat'
import { Button, buttonClass } from '@/core/ui/Button'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { useOnline } from '@/core/ui/OfflineBanner'
import { ResultDialog, ResultStat, ResultStats, type ResultTone } from '@/core/ui/ResultDialog'
import type { GameOptions } from '@/games/types'
import { CheckUpTable, FinalHands, Sheet } from './CheckUpTable'
import { useCheckUpGame } from './useCheckUpGame'

function Message({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-(--app-h) flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold text-primary">{title}</h1>
      {children}
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('checkup.backToLobby')}
      </Link>
    </div>
  )
}

/** One online game of Check Up: live for its players, the final table for anyone else once it is over. */
export default function CheckUpMatchPage({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const online = useOnline()
  const game = useCheckUpGame(matchId)
  const { view, match, players, mySeat, hand } = game
  const decided = match !== null && match.status !== 'active' && match.status !== 'waiting'

  // Once it is over, two players can go straight on: someone new, or each other again.
  const after = useAfterMatch({
    matchId,
    gameId: 'checkup',
    stake: match?.stake_amount ?? 0,
    options: (match?.options as GameOptions | null) ?? null,
    // A rematch is between two players; a bigger table simply finds a new game.
    enabled: game.status === 'ready' && mySeat !== null && decided && players.length === 2,
  })
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [resultClosed, setResultClosed] = useState(false)
  // The chat: whether the others have left the finished game, how often they have spoken, and
  // how often this player has sent a quick message.
  const [chatClosed, setChatClosed] = useState(false)
  const [chatHeard, setChatHeard] = useState(0)
  const [chatSent, setChatSent] = useState(0)

  if (game.status === 'loading') return <LoadingScreen />
  if (game.status === 'not_found') return <Message title={t('checkup.notFound')} />
  if (game.status === 'error' || !view || !match) {
    return (
      <Message title={t('checkup.loadFailed')}>
        <Button onClick={() => void game.reload()}>{t('common.retry')}</Button>
      </Message>
    )
  }

  const me = players.find((p) => p.seat === mySeat)
  const opponent = players.find((p) => p.seat !== mySeat)
  const winner = players.find((p) => p.userId === match.winner_id)
  const iWon = winner !== undefined && winner.seat === mySeat
  const stillIn = mySeat !== null && !view.out.includes(mySeat)
  const title = [t('games.checkup'), players.length > 2 ? t('checkup.playersCount', { count: players.length }) : '', match.stake_amount > 0 ? t('checkup.stake', { stake: match.stake_amount }) : ''].filter(Boolean).join(' · ')

  const tokensChange = me && match.stake_amount > 0 && me.tokensChange !== null ? me.tokensChange : undefined
  const resultTitle =
    match.result === 'draw'
      ? t('checkup.over.draw')
      : match.result !== 'win'
        ? t('checkup.over.calledOff')
        : mySeat === null || (!iWon && players.length > 2)
          ? t('checkup.over.winner', { name: winner?.name ?? '' })
          : t(iWon ? 'checkup.over.youWon' : 'checkup.over.youLost')
  const resultTone: ResultTone = match.result === 'draw' ? 'draw' : match.result !== 'win' ? 'neutral' : mySeat === null || iWon ? 'win' : 'loss'

  const actions = mySeat ? (
    <AfterMatchActions state={after} opponent={opponent?.name ?? ''} newGameLabel={t('checkup.newGame')} />
  ) : (
    <Link to="/lobby" className={buttonClass('ghost', 'w-full')}>
      {t('checkup.backToLobby')}
    </Link>
  )

  return (
    <>
      <LeaveGuard active={stillIn && !decided} />
      <CheckUpTable
        title={title}
        backTo="/play/checkup"
        view={view}
        hand={hand}
        players={players}
        mySeat={mySeat}
        deadline={game.deadline}
        busy={game.busy}
        notice={!decided && (!online || !game.connected) ? t('app.reconnecting') : undefined}
        onPlay={game.play}
        onDraw={game.draw}
        chat={
          mySeat ? (
            <MatchChat matchId={matchId} gameId="checkup" names={Object.fromEntries(players.map((p) => [p.userId, p.name]))} ended={decided} onClosed={setChatClosed} onHeard={() => setChatHeard((n) => n + 1)} onQuickSent={() => setChatSent((n) => n + 1)} />
          ) : undefined
        }
        chatClosed={chatClosed}
        chatHeard={chatHeard}
        chatSent={chatSent}
        menuPinned={decided && needsAnswer(after)}
        menu={
          <div className="flex flex-col gap-2">
            {decided && resultClosed && (
              <Button variant="ghost" className="w-full" onClick={() => setResultClosed(false)} data-testid="show-result">
                {t('checkup.over.showResult')}
              </Button>
            )}
            {decided && actions}
            {!decided && stillIn && (
              <Button variant="ghost" className="w-full" onClick={() => setConfirmLeave(true)}>
                {t('checkup.leave.button')}
              </Button>
            )}
          </div>
        }
      >
        {confirmLeave && !decided && (
          <Sheet title={t('checkup.leave.title')} onClose={() => setConfirmLeave(false)}>
            <p className="mt-1 text-muted">
              {players.length > 2 ? t(match.stake_amount > 0 ? 'checkup.leave.bodyTableStaked' : 'checkup.leave.bodyTable') : t('checkup.leave.body', { opponent: opponent?.name ?? '' })}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
                {t('checkup.leave.cancel')}
              </Button>
              <Button
                className="bg-hibiscus text-white active:bg-hibiscus"
                onClick={() => {
                  setConfirmLeave(false)
                  game.leave()
                }}
              >
                {t('checkup.leave.confirm')}
              </Button>
            </div>
          </Sheet>
        )}

        {decided && !resultClosed && (
          <ResultDialog
            title={resultTitle}
            tone={resultTone}
            reason={t(`checkup.reason.${match.end_reason}`, { defaultValue: t('checkup.reason.other') })}
            onClose={() => setResultClosed(true)}
            closeLabel={t('checkup.over.close')}
          >
            {tokensChange !== undefined && (
              <ResultStats>
                <ResultStat testId="game-over-tokens" label={t('checkup.over.tokens')} change={tokensChange} />
              </ResultStats>
            )}
            {/* The cards are laid down: what everyone held, and what it came to. */}
            <FinalHands view={view} players={players} mySeat={mySeat} />
            <div>{actions}</div>
          </ResultDialog>
        )}
      </CheckUpTable>
    </>
  )
}
