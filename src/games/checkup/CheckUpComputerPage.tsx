import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useMyProfile } from '@/core/profile/useMyProfile'
import { Button } from '@/core/ui/Button'
import { ResultDialog } from '@/core/ui/ResultDialog'
import { act, type Card, type CheckUpState, chooseAction, deal, isSound, leave, type Played, type Seat, type Shape, type TableEvent } from '../../../supabase/functions/_shared/checkup'
import { CheckUpTable, FinalHands, type TablePlayer } from './CheckUpTable'
import { feedback } from './sound'
import type { TableView } from './useCheckUpGame'

// Check Up against the computer: practice, with no tokens and no standing. Everything happens
// on this device (it works offline), with the very rule book the server judges by. The player
// goes first; the computer plays everyone else.

type Setup = { opponents: number }
type Saved = { setup: Setup; state: CheckUpState; event: TableEvent | null }
const SETUP_KEY = 'agh.checkup.computer'
/** The practice game in progress, kept on this device so a refresh (or a closed tab) does not lose it. */
const GAME_KEY = 'agh.checkup.practice'
const HUMAN: Seat = '1'
/** Long enough to see what was played before the next thing happens. */
const COMPUTER_PAUSE_MS = 1300

function loadSetup(): Setup {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as Partial<Setup>
    return { opponents: [1, 2, 3].includes(saved.opponents ?? 0) ? saved.opponents! : 1 }
  } catch {
    return { opponents: 1 }
  }
}
function loadGame(): Saved | null {
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as Partial<Saved> | null
    // Only a game that is really under way, and whole enough to carry on from.
    if (!saved?.setup || !saved.state || saved.state.over || !isSound(saved.state)) return null
    return { setup: saved.setup, state: saved.state, event: saved.event ?? null }
  } catch {
    return null
  }
}
function forgetGame() {
  try {
    localStorage.removeItem(GAME_KEY)
  } catch {
    // Nothing was saved.
  }
}

/** What the table shows of the whole game: everything but the other players' cards. */
function toView(state: CheckUpState, event: TableEvent | null): TableView {
  return {
    seats: state.seats,
    out: state.out,
    counts: Object.fromEntries(state.seats.map((seat) => [seat, state.hands[seat]!.length])),
    marketCount: state.market.length,
    top: state.top,
    called: state.called,
    turn: state.turn,
    pending: state.pending,
    moveNo: state.moveNo,
    lastEvent: event,
    over: state.over && { ...state.over, hands: state.hands },
  }
}

function Game({ setup, onSetup, resume }: { setup: Setup; onSetup: () => void; resume: Saved | null }) {
  const { t } = useTranslation()
  const fresh = (): { state: CheckUpState; event: TableEvent | null } => ({ state: deal(Array.from({ length: setup.opponents + 1 }, (_, i) => String(i + 1)), Math.random), event: null })
  const [game, setGame] = useState(() => (resume ? { state: resume.state, event: resume.event } : fresh()))
  const [resultClosed, setResultClosed] = useState(false)
  const { state } = game
  const take = (played: Played) => {
    if (played.ok) setGame({ state: played.state, event: played.event })
    else feedback('refused')
  }

  // Every change is written down at once: the page can be refreshed at any moment.
  useEffect(() => {
    try {
      if (state.over) localStorage.removeItem(GAME_KEY)
      else localStorage.setItem(GAME_KEY, JSON.stringify({ setup, state, event: game.event } satisfies Saved))
    } catch {
      // Private browsing: the game simply is not kept.
    }
  }, [state, game.event, setup])

  const gender = useMyProfile().data?.gender ?? null
  const players = useMemo<TablePlayer[]>(
    () =>
      state.seats.map((seat, index) =>
        seat === HUMAN ? { seat, name: t('checkup.you'), gender } : { seat, name: state.seats.length === 2 ? t('checkup.computer.name') : t('checkup.computer.numbered', { number: index }), computer: true },
      ),
    [state.seats, t, gender],
  )

  // The computer's turns, one at a time so each can be followed.
  useEffect(() => {
    if (state.over || state.turn === HUMAN) return
    const id = setTimeout(() => {
      setGame((current) => {
        const played = act(current.state, current.state.turn, chooseAction(current.state, current.state.turn))
        return played.ok ? { state: played.state, event: played.event } : current
      })
    }, COMPUTER_PAUSE_MS)
    return () => clearTimeout(id)
  }, [state])

  const restart = () => {
    setGame(fresh())
    setResultClosed(false)
    feedback('gameStart')
  }
  const over = state.over
  const won = over?.winner === HUMAN
  const title = [t('games.checkup'), t('checkup.computer.practice')].join(' · ')
  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <Button onClick={restart}>{t('checkup.computer.again')}</Button>
      <Button variant="ghost" onClick={onSetup}>
        {t('checkup.computer.change')}
      </Button>
    </div>
  )
  const view = toView(state, game.event)

  return (
    <CheckUpTable
      title={title}
      backTo="/play/checkup"
      view={view}
      hand={state.hands[HUMAN] ?? []}
      players={players}
      mySeat={HUMAN}
      deadline={null}
      waitingText={t('checkup.computer.thinking', { name: players.find((p) => p.seat === state.turn)?.name ?? '' })}
      onPlay={(card: Card, call?: Shape) => take(act(state, HUMAN, { type: 'play', card, call }))}
      onDraw={() => take(act(state, HUMAN, { type: 'draw' }))}
      menu={
        over ? (
          <div className="flex flex-col gap-2">
            {resultClosed && (
              <Button variant="ghost" className="w-full" onClick={() => setResultClosed(false)} data-testid="show-result">
                {t('checkup.over.showResult')}
              </Button>
            )}
            {actions}
          </div>
        ) : (
          // The way out of a practice game is to end it: back to where it was set up.
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              take(leave(state, HUMAN))
              forgetGame()
              onSetup()
            }}
          >
            {t('checkup.computer.leave')}
          </Button>
        )
      }
    >
      {over && !resultClosed && (
        <ResultDialog
          title={over.winner === null ? t('checkup.over.draw') : won ? t('checkup.over.youWon') : t('checkup.over.winner', { name: players.find((p) => p.seat === over.winner)?.name ?? '' })}
          tone={over.winner === null ? 'draw' : won ? 'win' : 'loss'}
          reason={t(`checkup.reason.${over.reason}`)}
          onClose={() => setResultClosed(true)}
          closeLabel={t('checkup.over.close')}
        >
          <FinalHands view={view} players={players} mySeat={HUMAN} />
          <div>{actions}</div>
        </ResultDialog>
      )}
    </CheckUpTable>
  )
}

export default function CheckUpComputerPage() {
  const { t } = useTranslation()
  const [resume] = useState(loadGame)
  const [setup, setSetup] = useState<Setup>(() => resume?.setup ?? loadSetup())
  const [playing, setPlaying] = useState(resume !== null)
  const [round, setRound] = useState(0)
  const change = (next: Setup) => {
    setSetup(next)
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(next))
    } catch {
      // Private browsing: the choice is simply not remembered.
    }
  }

  if (playing) {
    return (
      <Game
        key={round}
        setup={setup}
        resume={round === 0 ? resume : null}
        onSetup={() => {
          forgetGame()
          setPlaying(false)
        }}
      />
    )
  }

  return (
    <main className="mx-auto flex min-h-(--app-h) w-full max-w-md flex-col gap-6 px-5 py-6">
      <Link to="/play/checkup" className="flex min-h-11 items-center self-start font-semibold text-accent underline underline-offset-4">
        {t('checkup.back')}
      </Link>
      <div>
        <h1 className="font-display text-3xl font-extrabold text-accent">{t('checkup.computer.heading')}</h1>
        <p className="mt-2 text-muted">{t('checkup.computer.intro')}</p>
      </div>
      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('checkup.computer.opponents')}</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[1, 2, 3].map((count) => (
            <label
              key={count}
              className={`flex min-h-12 cursor-pointer items-center justify-center border px-2 text-center font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${count === setup.opponents ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel'}`}
            >
              <input type="radio" name="checkup-opponents" className="sr-only" checked={count === setup.opponents} onChange={() => change({ opponents: count })} />
              {t('checkup.computer.opponentsCount', { count })}
            </label>
          ))}
        </div>
      </fieldset>
      <Button
        className="mt-auto min-h-14 shrink-0 text-lg"
        onClick={() => {
          setRound((r) => r + 1)
          setPlaying(true)
          feedback('gameStart')
        }}
      >
        {t('checkup.computer.start')}
      </Button>
    </main>
  )
}
