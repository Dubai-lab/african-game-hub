import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { flagEmoji } from '@/core/countries/useCountries'
import { useGameTypes } from '@/core/games/useGameTypes'
import { useMyProfile } from '@/core/profile/useMyProfile'
import { Button } from '@/core/ui/Button'
import { Toggle } from '@/core/ui/Toggle'
import { remainingMs } from '@/games/chess/engine/clock'
import type { Color } from '../../../supabase/functions/_shared/draughts'
import { chooseMove, DEFAULT_LEVEL, type Level, levelById, type LevelId, LEVELS } from './computer'
import { DraughtsTable } from './DraughtsTable'
import { draughtsModule, parseTimeControls, type TimeControl, timeControlLabel } from './lobby'
import { feedback } from './sound'
import { useLocalDraughtsGame } from './useLocalDraughtsGame'

type ColorChoice = 'w' | 'b' | 'random'
type Choices = { level: LevelId; color: ColorChoice; clock: boolean; timeControl: string | null }

const STORAGE_KEY = 'agh.draughts.computer'
// A reply that lands the instant you let go of a piece feels wrong; give it a beat.
const MIN_THINK_MS = 650

// Used when the games registry cannot be reached: practice must work offline.
const OFFLINE_SCHEMA = {
  time_controls: [
    { id: '3+2', base_ms: 180_000, increment_ms: 2000 },
    { id: '5+3', base_ms: 300_000, increment_ms: 3000 },
    { id: '10+5', base_ms: 600_000, increment_ms: 5000 },
  ],
}

function useTimeControlSchema(): unknown {
  const games = useGameTypes()
  return useMemo(() => {
    const fromRegistry = games.data?.find((g) => g.id === 'draughts')?.optionsSchema
    return parseTimeControls(fromRegistry).length > 0 ? fromRegistry : OFFLINE_SCHEMA
  }, [games.data])
}

function loadChoices(): Choices {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Choices>
    return {
      level: levelById(saved.level).id,
      color: saved.color === 'b' || saved.color === 'random' ? saved.color : 'w',
      // Relaxed by default: draughts rewards looking before you move.
      clock: saved.clock === true,
      timeControl: typeof saved.timeControl === 'string' ? saved.timeControl : null,
    }
  } catch {
    return { level: DEFAULT_LEVEL, color: 'w', clock: false, timeControl: null }
  }
}

function Setup({ onStart }: { onStart: (choices: Choices, control: TimeControl | null) => void }) {
  const { t } = useTranslation()
  const schema = useTimeControlSchema()
  const [choices, setChoices] = useState<Choices>(loadChoices)
  const tile = (chosen: boolean) =>
    `flex cursor-pointer border-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`

  const saved = choices.timeControl ? { time_control: choices.timeControl } : null
  const timeOptions = draughtsModule.isValidOptions(schema, saved) ? saved : draughtsModule.defaultOptions(schema)
  const control = parseTimeControls(schema).find((c) => c.id === timeOptions?.time_control) ?? null

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-8 pt-4 lg:max-w-3xl lg:justify-center lg:py-12">
      <header>
        <Link to="/play/draughts" className="flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
          {t('draughts.back')}
        </Link>
      </header>
      <div>
        <h1 className="font-display text-3xl font-extrabold text-primary lg:text-4xl">{t('draughts.computer.title')}</h1>
        <p className="mt-2 text-muted">{t('draughts.computer.intro')}</p>
      </div>

      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('draughts.computer.level')}</legend>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {LEVELS.map((level) => {
            const chosen = level.id === choices.level
            return (
              <label key={level.id} className={`${tile(chosen)} min-h-14 flex-col justify-center px-4 py-2`}>
                <input type="radio" name="computer-level" className="sr-only" checked={chosen} onChange={() => setChoices((c) => ({ ...c, level: level.id }))} />
                <span className="font-bold">{t(`draughts.computer.levels.${level.id}.name`)}</span>
                <span className={`text-sm ${chosen ? '' : 'text-muted'}`}>{t(`draughts.computer.levels.${level.id}.hint`)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('draughts.computer.color')}</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(['w', 'random', 'b'] as const).map((color) => {
            const chosen = color === choices.color
            return (
              <label key={color} className={`${tile(chosen)} min-h-12 items-center justify-center px-2 text-center font-bold`}>
                <input type="radio" name="computer-color" className="sr-only" checked={chosen} onChange={() => setChoices((c) => ({ ...c, color }))} />
                {t(color === 'w' ? 'draughts.white' : color === 'b' ? 'draughts.black' : 'draughts.computer.random')}
              </label>
            )
          })}
        </div>
        <p className="mt-2 text-sm text-muted">{t('draughts.computer.whiteFirst')}</p>
      </fieldset>

      <div>
        <div className="border-y border-line">
          <Toggle label={t('draughts.computer.clock')} hint={t('draughts.computer.clockHint')} on={choices.clock} onChange={(clock) => setChoices((c) => ({ ...c, clock }))} />
        </div>
        {choices.clock && (
          <div className="mt-4">
            <draughtsModule.OptionsPicker schema={schema} value={timeOptions} onChange={(value) => setChoices((c) => ({ ...c, timeControl: String(value.time_control) }))} />
          </div>
        )}
      </div>

      <Button
        className="sticky bottom-4 mt-auto min-h-14 text-lg lg:static lg:mt-2"
        disabled={choices.clock && !control}
        onClick={() => {
          const final = { ...choices, timeControl: control?.id ?? choices.timeControl }
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(final))
          } catch {
            // Not saved; the game still starts.
          }
          onStart(final, choices.clock ? control : null)
        }}
      >
        {t('draughts.computer.start')}
      </Button>
    </div>
  )
}

/** The game in progress and how it was set up, kept on this device across a refresh. */
const GAME_KEY = 'agh.draughts.computer.game'
const SETUP_KEY = 'agh.draughts.computer.setup'
type GameSetup = { level: Level; human: Color; control: TimeControl | null; game: number }

function savedSetup(): GameSetup | null {
  try {
    // Only when there is a game to go back to.
    if (!localStorage.getItem(GAME_KEY)) return null
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null') as { level?: string; human?: Color; control?: TimeControl | null } | null
    if (!saved?.level || (saved.human !== 'w' && saved.human !== 'b')) return null
    return { level: levelById(saved.level), human: saved.human, control: saved.control ?? null, game: 1 }
  } catch {
    return null
  }
}
function forget() {
  try {
    localStorage.removeItem(GAME_KEY)
    localStorage.removeItem(SETUP_KEY)
  } catch {
    // Nothing was saved.
  }
}

/** Asks the computer for its move, off the main thread where the phone allows it. */
function useThinker() {
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    try {
      worker.current = new Worker(new URL('./computer.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      worker.current = null
    }
    return () => {
      worker.current?.terminate()
      worker.current = null
    }
  }, [])
  return (board: string, turn: Color, level: Level): Promise<number[] | null> => {
    const id = ++seq.current
    const direct = () => chooseMove(board, turn, { ...level, timeMs: Math.min(level.timeMs, 400) })
    const instance = worker.current
    if (!instance) return Promise.resolve(direct())
    return new Promise((resolve) => {
      const done = (path: number[] | null) => {
        instance.removeEventListener('message', onMessage)
        instance.removeEventListener('error', onError)
        resolve(path)
      }
      const onMessage = (event: MessageEvent<{ id: number; path: number[] | null }>) => {
        if (event.data.id === id) done(event.data.path)
      }
      // A worker that cannot start (an old browser): think here instead, briefly.
      const onError = () => {
        worker.current = null
        done(direct())
      }
      instance.addEventListener('message', onMessage)
      instance.addEventListener('error', onError)
      instance.postMessage({ id, board, turn, level })
    })
  }
}

type TableProps = { level: Level; human: Color; control: TimeControl | null; onNewGame: () => void }

function Table({ level, human, control, onNewGame }: TableProps) {
  const { t } = useTranslation()
  const profile = useMyProfile()
  const game = useLocalDraughtsGame({ baseMs: control?.base_ms ?? 0, incrementMs: control?.increment_ms ?? 0, timed: control !== null, saveKey: GAME_KEY })
  const computer: Color = human === 'w' ? 'b' : 'w'
  const think = useThinker()
  const thinker = useRef(think)
  thinker.current = think

  const { state, turn, outcome, tryMove, clock } = game
  const computerToMove = !outcome && turn === computer
  // Read when the computer starts thinking, without restarting its thinking every time the clock ticks.
  const clockNow = useRef(clock)
  clockNow.current = clock

  useEffect(() => {
    if (!computerToMove) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const askedAt = Date.now()
    // With a clock the computer budgets its time like a player would.
    const left = control ? remainingMs(clockNow.current, computer, askedAt) : Infinity
    const budget = Math.min(level.timeMs, Math.max(80, left / 30))
    const pause = Math.min(MIN_THINK_MS, Math.max(0, left / 60))

    void thinker.current(state.board, state.turn, { ...level, timeMs: budget }).then((path) => {
      if (cancelled || !path) return
      // The move is checked like any other: an illegal reply would simply be refused.
      timer = setTimeout(() => !cancelled && tryMove(path), Math.max(0, pause - (Date.now() - askedAt)))
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [computerToMove, state, level, tryMove, control, computer])

  const plies = game.played.length
  // On your turn, take back the computer's reply and your move; while it thinks, just your move.
  const undoCount = turn === human ? 2 : 1
  const canUndo = !outcome && plies >= undoCount

  const me = profile.data
  const levelName = t(`draughts.computer.levels.${level.id}.name`)
  const title = [t('draughts.computer.tableTitle', { level: levelName }), control ? timeControlLabel(control) : ''].filter(Boolean).join(' · ')
  return (
    <DraughtsTable
      title={title}
      game={game}
      players={
        {
          [human]: { name: me?.displayName ?? me?.username ?? t('draughts.computer.you'), flag: me?.country ? flagEmoji(me.country.code) : undefined },
          [computer]: { name: t('draughts.computer.name') },
        } as Record<Color, { name: string; flag?: string }>
      }
      movable={human}
      perspective={human}
      timed={control !== null}
      onUndo={() => game.undo(undoCount)}
      canUndo={canUndo}
      status={computerToMove ? t('draughts.computer.thinking') : undefined}
      overActions={
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              game.restart()
              feedback('gameStart')
            }}
          >
            {t('draughts.computer.again')}
          </Button>
          <Button variant="ghost" onClick={onNewGame}>
            {t('draughts.computer.change')}
          </Button>
        </div>
      }
    />
  )
}

/** Practice against the computer. No tokens and no rating; moves can be taken back. */
export default function DraughtsComputerPage() {
  // A game left unfinished (the page was refreshed, or the tab closed) is carried on from where it stood.
  const [setup, setSetup] = useState<GameSetup | null>(savedSetup)

  if (!setup) {
    return (
      <Setup
        onStart={(choices, control) => {
          const human: Color = choices.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : choices.color
          forget()
          try {
            localStorage.setItem(SETUP_KEY, JSON.stringify({ level: choices.level, human, control }))
          } catch {
            // Private browsing: the game simply is not kept.
          }
          setSetup((previous) => ({ level: levelById(choices.level), human, control, game: (previous?.game ?? 0) + 1 }))
          feedback('gameStart')
        }}
      />
    )
  }
  return (
    <Table
      key={setup.game}
      level={setup.level}
      human={setup.human}
      control={setup.control}
      onNewGame={() => {
        forget()
        setSetup(null)
      }}
    />
  )
}
