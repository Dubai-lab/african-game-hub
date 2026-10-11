import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/core/ui/Button'
import { ResultDialog } from '@/core/ui/ResultDialog'
import { toast } from '@/core/ui/toast'
import { feedback } from '@/games/checkup/sound'
import { act, deal, evaluate, isSound, type Judge, type Laid, leave, type Played, type Seat, type TableEvent, type Tile, type WordsState } from '../../../supabase/functions/_shared/words'
import type { ComputerAction } from './computer'
import type { TableView } from './useWordsGame'
import { FinalScores, type TablePlayer, WordsTable } from './WordsTable'

// Word Battle against the computer: practice, with no tokens and no standing. Everything happens
// on this device, with the very rule book the server judges by and the same word list. The list
// is fetched the first time practice is opened and then kept on the phone, so later games work
// without a connection. The player goes first; the computer plays everyone else.

type Setup = { opponents: number }
type Saved = { setup: Setup; state: WordsState; event: TableEvent | null }
const SETUP_KEY = 'agh.words.computer'
/** The practice game in progress, kept on this device so a refresh (or a closed tab) does not lose it. */
const GAME_KEY = 'agh.words.practice'
const HUMAN: Seat = '1'
/** Long enough to see what was played before the next thing happens. */
const COMPUTER_PAUSE_MS = 900
/** The words were checked against the list before the rule book is asked: it need not ask again. */
const TRUSTING: Judge = { isWord: () => true, random: Math.random }

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

/** What the table shows of the whole game: everything but the other players' tiles. */
function toView(state: WordsState, event: TableEvent | null): TableView {
  return {
    seats: state.seats,
    out: state.out,
    board: state.board,
    scores: state.over?.scores ?? state.scores,
    counts: Object.fromEntries(state.seats.map((seat) => [seat, state.racks[seat]!.length])),
    bagCount: state.bag.length,
    turn: state.turn,
    moveNo: state.moveNo,
    lastEvent: event,
    over: state.over && { ...state.over, racks: state.racks },
  }
}

type Reply = { id: number; ok: boolean; wrong?: string[]; action?: ComputerAction }
type Ask = { type: 'load' } | { type: 'check'; words: string[] } | { type: 'think'; board: string; rack: Tile[]; bagCount: number }

/** The word list and the computer's thinking, in the background. `ready` is null while the list is being fetched. */
function useWordBrain() {
  const worker = useRef<Worker | null>(null)
  const waiting = useRef(new Map<number, (reply: Reply) => void>())
  const seq = useRef(0)
  const [ready, setReady] = useState<boolean | null>(null)

  const ask = useCallback((request: Ask): Promise<Reply> => {
    const id = ++seq.current
    return new Promise((resolve) => {
      if (!worker.current) return resolve({ id, ok: false })
      waiting.current.set(id, resolve)
      worker.current.postMessage({ id, ...request })
    })
  }, [])
  const load = useCallback(() => {
    setReady(null)
    void ask({ type: 'load' }).then((reply) => setReady(reply.ok))
  }, [ask])

  useEffect(() => {
    const pending = waiting.current
    try {
      worker.current = new Worker(new URL('./computer.worker.ts', import.meta.url), { type: 'module' })
      worker.current.onmessage = (event: MessageEvent<Reply>) => {
        pending.get(event.data.id)?.(event.data)
        pending.delete(event.data.id)
      }
    } catch {
      worker.current = null
    }
    load()
    return () => {
      worker.current?.terminate()
      worker.current = null
      pending.clear()
    }
  }, [load])

  return { ready, ask, retry: load }
}

function Game({ setup, onSetup, resume }: { setup: Setup; onSetup: () => void; resume: Saved | null }) {
  const { t } = useTranslation()
  const brain = useWordBrain()
  const fresh = (): { state: WordsState; event: TableEvent | null } => ({ state: deal(Array.from({ length: setup.opponents + 1 }, (_, i) => String(i + 1)), Math.random), event: null })
  const [game, setGame] = useState(() => (resume ? { state: resume.state, event: resume.event } : fresh()))
  const [resultClosed, setResultClosed] = useState(false)
  const [busy, setBusy] = useState(false)
  const { state } = game
  const take = (played: Played): boolean => {
    if (played.ok) setGame({ state: played.state, event: played.event })
    else feedback('refused')
    return played.ok
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

  const players = useMemo<TablePlayer[]>(
    () => state.seats.map((seat, index) => ({ seat, name: seat === HUMAN ? t('words.you') : state.seats.length === 2 ? t('words.computer.name') : t('words.computer.numbered', { number: index }) })),
    [state.seats, t],
  )

  // The computer's turns, one at a time so each can be followed.
  const { ask, ready } = brain
  useEffect(() => {
    if (state.over || state.turn === HUMAN || !ready) return
    let stale = false
    const started = Date.now()
    void ask({ type: 'think', board: state.board, rack: state.racks[state.turn]!, bagCount: state.bag.length }).then((reply) => {
      const action: ComputerAction = reply.ok && reply.action ? reply.action : { type: 'pass' }
      setTimeout(
        () => {
          if (stale) return
          setGame((current) => {
            if (current.state !== state) return current
            const played = act(state, state.turn, action, TRUSTING)
            const done = played.ok ? played : act(state, state.turn, { type: 'pass' }, TRUSTING)
            return done.ok ? { state: done.state, event: done.event } : current
          })
        },
        Math.max(0, COMPUTER_PAUSE_MS - (Date.now() - started)),
      )
    })
    return () => {
      stale = true
    }
  }, [state, ready, ask])

  /** The player's own word: the list says whether it is one, then the rule book does the rest. */
  const place = async (tiles: Laid[]): Promise<boolean> => {
    const made = evaluate(state.board, tiles)
    if (!made.ok) return take(made)
    setBusy(true)
    try {
      const reply = await ask({ type: 'check', words: made.words.map((word) => word.word) })
      if (!reply.ok) {
        toast.error(t('words.computer.listFailed'))
        return false
      }
      if (reply.wrong?.length) {
        toast.error(t('words.notAWord', { count: reply.wrong.length, words: reply.wrong.map((word) => word.toUpperCase()).join(', ') }))
        feedback('refused')
        return false
      }
      return take(act(state, HUMAN, { type: 'place', tiles }, TRUSTING))
    } finally {
      setBusy(false)
    }
  }

  const restart = () => {
    setGame(fresh())
    setResultClosed(false)
    feedback('gameStart')
  }
  const over = state.over
  const won = over?.winner === HUMAN
  const title = [t('games.words'), t('words.computer.practice')].join(' · ')
  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <Button onClick={restart}>{t('words.computer.again')}</Button>
      <Button variant="ghost" onClick={onSetup}>
        {t('words.computer.change')}
      </Button>
    </div>
  )
  const view = toView(state, game.event)

  return (
    <WordsTable
      title={title}
      backTo="/play/words"
      view={view}
      rack={state.racks[HUMAN] ?? []}
      players={players}
      mySeat={HUMAN}
      deadline={null}
      busy={busy || ready !== true}
      notice={
        ready === null ? (
          t('words.computer.loading')
        ) : ready === false ? (
          <button type="button" className="underline underline-offset-4" onClick={brain.retry}>
            {t('words.computer.listFailed')}
          </button>
        ) : undefined
      }
      waitingText={t('words.computer.thinking', { name: players.find((p) => p.seat === state.turn)?.name ?? '' })}
      onPlace={place}
      onSwap={(tiles) => take(act(state, HUMAN, { type: 'swap', tiles }, TRUSTING))}
      onPass={() => take(act(state, HUMAN, { type: 'pass' }, TRUSTING))}
      menu={
        over ? (
          <div className="flex flex-col gap-2">
            {resultClosed && (
              <Button variant="ghost" className="w-full" onClick={() => setResultClosed(false)} data-testid="show-result">
                {t('words.over.showResult')}
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
            {t('words.computer.leave')}
          </Button>
        )
      }
    >
      {over && !resultClosed && (
        <ResultDialog
          title={over.winner === null ? t('words.over.draw') : won ? t('words.over.youWon') : t('words.over.winner', { name: players.find((p) => p.seat === over.winner)?.name ?? '' })}
          tone={over.winner === null ? 'draw' : won ? 'win' : 'loss'}
          reason={t(`words.reason.${over.reason}`)}
          onClose={() => setResultClosed(true)}
          closeLabel={t('words.over.close')}
        >
          <FinalScores view={view} players={players} mySeat={HUMAN} />
          <div>{actions}</div>
        </ResultDialog>
      )}
    </WordsTable>
  )
}

export default function WordsComputerPage() {
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
      <Link to="/play/words" className="flex min-h-11 items-center self-start font-semibold text-primary underline underline-offset-4">
        {t('words.back')}
      </Link>
      <div>
        <h1 className="font-display text-3xl font-extrabold text-primary">{t('words.computer.heading')}</h1>
        <p className="mt-2 text-muted">{t('words.computer.intro')}</p>
      </div>
      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('words.computer.opponents')}</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[1, 2, 3].map((count) => (
            <label
              key={count}
              className={`flex min-h-12 cursor-pointer items-center justify-center border-2 px-2 text-center font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${count === setup.opponents ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`}
            >
              <input type="radio" name="words-opponents" className="sr-only" checked={count === setup.opponents} onChange={() => change({ opponents: count })} />
              {t('words.computer.opponentsCount', { count })}
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
        {t('words.computer.start')}
      </Button>
    </main>
  )
}
