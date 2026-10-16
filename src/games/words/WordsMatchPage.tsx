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
import { useWordsGame } from './useWordsGame'
import { FinalScores, Sheet, WordsTable } from './WordsTable'

function Message({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-(--app-h) flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl font-extrabold text-accent">{title}</h1>
      {children}
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('words.backToLobby')}
      </Link>
    </div>
  )
}

/** One online game of Word Battle: live for its players, the final board for anyone else once it is over. */
export default function WordsMatchPage({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const online = useOnline()
  const game = useWordsGame(matchId)
  const { view, match, players, mySeat, rack } = game
  const decided = match !== null && match.status !== 'active' && match.status !== 'waiting'

  // Once it is over, two players can go straight on: someone new, or each other again.
  const after = useAfterMatch({
    matchId,
    gameId: 'words',
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
  if (game.status === 'not_found') return <Message title={t('words.notFound')} />
  if (game.status === 'error' || !view || !match) {
    return (
      <Message title={t('words.loadFailed')}>
        <Button onClick={() => void game.reload()}>{t('common.retry')}</Button>
      </Message>
    )
  }

  const me = players.find((p) => p.seat === mySeat)
  const opponent = players.find((p) => p.seat !== mySeat)
  const winner = players.find((p) => p.userId === match.winner_id)
  const iWon = winner !== undefined && winner.seat === mySeat
  const stillIn = mySeat !== null && !view.out.includes(mySeat)
  const title = [t('games.words'), players.length > 2 ? t('words.playersCount', { count: players.length }) : '', match.stake_amount > 0 ? t('words.stake', { stake: match.stake_amount }) : ''].filter(Boolean).join(' · ')

  const tokensChange = me && match.stake_amount > 0 && me.tokensChange !== null ? me.tokensChange : undefined
  const resultTitle =
    match.result === 'draw'
      ? t('words.over.draw')
      : match.result !== 'win'
        ? t('words.over.calledOff')
        : mySeat === null || (!iWon && players.length > 2)
          ? t('words.over.winner', { name: winner?.name ?? '' })
          : t(iWon ? 'words.over.youWon' : 'words.over.youLost')
  const resultTone: ResultTone = match.result === 'draw' ? 'draw' : match.result !== 'win' ? 'neutral' : mySeat === null || iWon ? 'win' : 'loss'

  const actions = mySeat ? (
    <AfterMatchActions state={after} opponent={opponent?.name ?? ''} newGameLabel={t('words.newGame')} />
  ) : (
    <Link to="/lobby" className={buttonClass('ghost', 'w-full')}>
      {t('words.backToLobby')}
    </Link>
  )

  return (
    <>
      <LeaveGuard active={stillIn && !decided} />
      <WordsTable
        title={title}
        backTo="/play/words"
        view={view}
        rack={rack}
        players={players}
        mySeat={mySeat}
        deadline={game.deadline}
        busy={game.busy}
        notice={!decided && (!online || !game.connected) ? t('app.reconnecting') : undefined}
        onPlace={game.place}
        onSwap={game.swap}
        onPass={game.pass}
        chat={
          mySeat ? (
            <MatchChat matchId={matchId} gameId="words" names={Object.fromEntries(players.map((p) => [p.userId, p.name]))} ended={decided} onClosed={setChatClosed} onHeard={() => setChatHeard((n) => n + 1)} onQuickSent={() => setChatSent((n) => n + 1)} />
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
                {t('words.over.showResult')}
              </Button>
            )}
            {decided && actions}
            {!decided && stillIn && (
              <Button variant="ghost" className="w-full" onClick={() => setConfirmLeave(true)}>
                {t('words.leave.button')}
              </Button>
            )}
          </div>
        }
      >
        {confirmLeave && !decided && (
          <Sheet title={t('words.leave.title')} onClose={() => setConfirmLeave(false)}>
            <p className="mt-1 text-muted">
              {players.length > 2 ? t(match.stake_amount > 0 ? 'words.leave.bodyTableStaked' : 'words.leave.bodyTable') : t('words.leave.body', { opponent: opponent?.name ?? '' })}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
                {t('words.leave.cancel')}
              </Button>
              <Button
                className="bg-hibiscus text-white active:bg-hibiscus"
                onClick={() => {
                  setConfirmLeave(false)
                  game.leave()
                }}
              >
                {t('words.leave.confirm')}
              </Button>
            </div>
          </Sheet>
        )}

        {decided && !resultClosed && (
          <ResultDialog
            title={resultTitle}
            tone={resultTone}
            reason={t(`words.reason.${match.end_reason}`, { defaultValue: t('words.reason.other') })}
            onClose={() => setResultClosed(true)}
            closeLabel={t('words.over.close')}
          >
            {tokensChange !== undefined && (
              <ResultStats>
                <ResultStat testId="game-over-tokens" label={t('words.over.tokens')} change={tokensChange} />
              </ResultStats>
            )}
            {/* The final scores, and the tiles everyone was left with. */}
            <FinalScores view={view} players={players} mySeat={mySeat} />
            <div>{actions}</div>
          </ResultDialog>
        )}
      </WordsTable>
    </>
  )
}
