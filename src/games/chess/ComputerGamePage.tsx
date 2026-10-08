import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { flagEmoji } from '@/core/countries/useCountries'
import { useMyProfile } from '@/core/profile/useMyProfile'
import { Button } from '@/core/ui/Button'
import { Toggle } from '@/core/ui/Toggle'
import type { Color, Promotion, Square } from './engine/chessLogic'
import { remainingMs } from './engine/clock'
import { DEFAULT_LEVEL, type Level, levelById, type LevelId, LEVELS, parseUciMove } from './engine/levels'
import { ChessEngine } from './engine/stockfish'
import { chessModule } from './lobby'
import { feedback } from './sound/sounds'
import { parseTimeControls, type TimeControl, timeControlLabel } from './timeControls'
import { GameTable } from './ui/GameTable'
import { useLocalChessGame } from './useLocalChessGame'
import { useTimeControlSchema } from './useTimeControlSchema'

type ColorChoice = 'w' | 'b' | 'random'
type Choices = { level: LevelId; color: ColorChoice; clock: boolean; timeControl: string | null }

const STORAGE_KEY = 'agh.chess.computer'
// A reply that lands the instant you let go of a piece feels wrong; give it a beat.
const MIN_THINK_MS = 550

function loadChoices(): Choices {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Choices>
    return {
      level: levelById(saved.level).id,
      color: saved.color === 'b' || saved.color === 'random' ? saved.color : 'w',
      // A clock by default, as in a real game; it can be switched off for relaxed practice.
      clock: saved.clock !== false,
      timeControl: typeof saved.timeControl === 'string' ? saved.timeControl : null,
    }
  } catch {
    return { level: DEFAULT_LEVEL, color: 'w', clock: true, timeControl: null }
  }
}

function Setup({ onStart }: { onStart: (choices: Choices, control: TimeControl | null) => void }) {
  const { t } = useTranslation()
  const schema = useTimeControlSchema()
  const [choices, setChoices] = useState<Choices>(loadChoices)
  const tile = (chosen: boolean) =>
    `flex cursor-pointer border-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`

  const saved = choices.timeControl ? { time_control: choices.timeControl } : null
  const timeOptions = chessModule.isValidOptions(schema, saved) ? saved : chessModule.defaultOptions(schema)
  const control = parseTimeControls(schema).find((c) => c.id === timeOptions?.time_control) ?? null

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-8 pt-4 lg:max-w-3xl lg:justify-center lg:py-12">
      <header>
        <Link to="/lobby" className="flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
          {t('chess.local.back')}
        </Link>
      </header>
      <div>
        <h1 className="font-display text-3xl font-extrabold text-primary lg:text-4xl">{t('chess.computer.title')}</h1>
        <p className="mt-2 text-muted">{t('chess.computer.intro')}</p>
      </div>

      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('chess.computer.level')}</legend>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {LEVELS.map((level) => {
            const chosen = level.id === choices.level
            return (
              <label key={level.id} className={`${tile(chosen)} min-h-14 flex-col justify-center px-4 py-2`}>
                <input
                  type="radio"
                  name="computer-level"
                  className="sr-only"
                  checked={chosen}
                  onChange={() => setChoices((c) => ({ ...c, level: level.id }))}
                />
                <span className="font-bold">{t(`chess.computer.levels.${level.id}.name`)}</span>
                <span className={`text-sm ${chosen ? '' : 'text-muted'}`}>{t(`chess.computer.levels.${level.id}.hint`)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('chess.computer.color')}</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(['w', 'random', 'b'] as const).map((color) => {
            const chosen = color === choices.color
            return (
              <label key={color} className={`${tile(chosen)} min-h-12 items-center justify-center px-2 text-center font-bold`}>
                <input
                  type="radio"
                  name="computer-color"
                  className="sr-only"
                  checked={chosen}
                  onChange={() => setChoices((c) => ({ ...c, color }))}
                />
                {t(color === 'w' ? 'chess.white' : color === 'b' ? 'chess.black' : 'chess.computer.random')}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <div className="border-y border-line">
          <Toggle
            label={t('chess.computer.clock')}
            hint={t('chess.computer.clockHint')}
            on={choices.clock}
            onChange={(clock) => setChoices((c) => ({ ...c, clock }))}
          />
        </div>
        {choices.clock && (
          <div className="mt-4">
            <chessModule.OptionsPicker
              schema={schema}
              value={timeOptions}
              onChange={(value) => setChoices((c) => ({ ...c, timeControl: String(value.time_control) }))}
            />
          </div>
        )}
      </div>

      <p className="text-xs text-muted">{t('chess.computer.engineCredit')}</p>

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
        {t('chess.computer.start')}
      </Button>
    </div>
  )
}

type TableProps = { level: Level; human: Color; control: TimeControl | null; onNewGame: () => void }

function Table({ level, human, control, onNewGame }: TableProps) {
  const { t } = useTranslation()
  const profile = useMyProfile()
  const game = useLocalChessGame({
    baseMs: control?.base_ms ?? 0,
    incrementMs: control?.increment_ms ?? 0,
    timed: control !== null,
  })
  const computer: Color = human === 'w' ? 'b' : 'w'

  const engine = useRef<ChessEngine | null>(null)
  const [engineState, setEngineState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)

  // The engine is downloaded and started when the game opens, and shut down when it closes.
  useEffect(() => {
    const instance = new ChessEngine()
    engine.current = instance
    let active = true
    setEngineState('loading')
    instance.start().then(
      () => active && setEngineState('ready'),
      () => active && setEngineState('failed'),
    )
    return () => {
      active = false
      instance.dispose()
      engine.current = null
    }
  }, [attempt])

  const { chess, turn, outcome, tryMove, clock } = game
  const fen = chess.fen()
  const computerToMove = !outcome && turn === computer
  // Read when the computer starts thinking, without restarting its thinking every time the clock ticks.
  const clockNow = useRef(clock)
  clockNow.current = clock

  useEffect(() => {
    if (engineState !== 'ready' || !computerToMove) return
    const instance = engine.current
    if (!instance) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const askedAt = Date.now()

    // With a clock the computer budgets its time like a player would: never more than a
    // fortieth of what it has left on one move.
    const left = control ? remainingMs(clockNow.current, computer, askedAt) : Infinity
    const budget = Math.min(level.moveTimeMs, Math.max(120, left / 40))
    const pause = Math.min(MIN_THINK_MS, Math.max(0, left / 60))

    const choose = async (): Promise<string> => {
      if (Math.random() < level.randomMoveChance) {
        const moves = chess.moves({ verbose: true })
        const pick = moves[Math.floor(Math.random() * moves.length)]
        if (pick) return pick.from + pick.to + (pick.promotion ?? '')
      }
      return instance.bestMove(fen, { ...level, moveTimeMs: budget })
    }

    choose()
      .then((uci) => {
        if (cancelled) return
        const move = parseUciMove(uci)
        if (!move) throw new Error(`Unreadable engine move: ${uci}`)
        timer = setTimeout(
          () => {
            // The move is checked like any other: an illegal reply would simply be refused.
            if (!cancelled) tryMove(move.from as Square, move.to as Square, move.promotion as Promotion | undefined)
          },
          Math.max(0, pause - (Date.now() - askedAt)),
        )
      })
      .catch(() => {
        if (!cancelled) setEngineState('failed')
      })

    return () => {
      cancelled = true
      clearTimeout(timer)
      instance.cancel()
    }
  }, [engineState, computerToMove, fen, chess, level, tryMove, control, computer])

  const plies = game.played.length
  // On your turn, take back the computer's reply and your move; while it thinks, just your move.
  const undoCount = turn === human ? 2 : 1
  const canUndo = !outcome && plies >= undoCount

  const me = profile.data
  const status =
    engineState === 'failed' ? (
      <span className="flex flex-wrap items-center justify-center gap-x-3 text-hibiscus">
        {t('chess.computer.failed')}
        <button type="button" className="min-h-10 font-bold underline" onClick={() => setAttempt((n) => n + 1)}>
          {t('common.retry')}
        </button>
      </span>
    ) : engineState === 'loading' ? (
      t('chess.computer.loading')
    ) : computerToMove ? (
      t('chess.computer.thinking')
    ) : (
      // Keeps the line's height so the board does not jump when the text comes and goes.
      <span aria-hidden="true">&nbsp;</span>
    )

  const levelName = t(`chess.computer.levels.${level.id}.name`)
  return (
    <GameTable
      title={control ? `${t('chess.computer.tableTitle', { level: levelName })} · ${timeControlLabel(control)}` : t('chess.computer.tableTitle', { level: levelName })}
      game={game}
      players={{
        [human]: {
          name: me?.displayName ?? me?.username ?? t('chess.computer.you'),
          flag: me?.country ? flagEmoji(me.country.code) : undefined,
        },
        [computer]: { name: t('chess.computer.name') },
      } as Record<Color, { name: string; flag?: string }>}
      movable={human}
      perspective={human}
      timed={control !== null}
      passAndPlay={false}
      onUndo={() => game.undo(undoCount)}
      canUndo={canUndo}
      status={status}
      onRematch={() => {
        game.restart()
        feedback('gameStart')
      }}
      onNewGame={onNewGame}
    />
  )
}

/** Practice against Stockfish. No tokens and no rating; moves can be taken back. */
export default function ComputerGamePage() {
  const [setup, setSetup] = useState<{ level: Level; human: Color; control: TimeControl | null; game: number } | null>(null)

  if (!setup) {
    return (
      <Setup
        onStart={(choices, control) => {
          const human: Color = choices.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : choices.color
          setSetup((previous) => ({ level: levelById(choices.level), human, control, game: (previous?.game ?? 0) + 1 }))
          feedback('gameStart')
        }}
      />
    )
  }
  return <Table key={setup.game} level={setup.level} human={setup.human} control={setup.control} onNewGame={() => setSetup(null)} />
}
