import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/core/ui/Button'
import type { GameOptions } from '@/games/types'
import { chessModule } from './lobby'
import { feedback } from './sound/sounds'
import { parseTimeControls, type TimeControl, timeControlLabel } from './timeControls'
import { GameTable } from './ui/GameTable'
import { type Referee, useLocalChessGame } from './useLocalChessGame'
import { useTimeControlSchema } from './useTimeControlSchema'

// Development builds only: /play/chess/local?referee=reject makes a stand-in referee refuse every
// move after a short delay, so the "move taken back" behaviour can be seen and tested before
// online play exists. It is compiled out of the production build.
const testReferee: Referee | undefined =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('referee') === 'reject'
    ? () => new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 1500))
    : undefined

function Setup({ onStart }: { onStart: (control: TimeControl) => void }) {
  const { t } = useTranslation()
  const schema = useTimeControlSchema()
  const [options, setOptions] = useState<GameOptions | null>(null)
  const chosen = chessModule.isValidOptions(schema, options) ? options : chessModule.defaultOptions(schema)
  const control = parseTimeControls(schema).find((c) => c.id === chosen?.time_control)

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-8 pt-4 lg:max-w-2xl lg:justify-center lg:py-12">
      <header className="flex items-center justify-between">
        <Link to="/lobby" className="flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
          {t('chess.local.back')}
        </Link>
      </header>
      <div>
        <h1 className="font-display text-3xl font-extrabold text-primary">{t('chess.local.title')}</h1>
        <p className="mt-2 text-muted">{t('chess.local.intro')}</p>
      </div>
      <chessModule.OptionsPicker schema={schema} value={chosen} onChange={setOptions} />
      <Button className="mt-auto min-h-14 text-lg lg:mt-4" disabled={!control} onClick={() => control && onStart(control)}>
        {t('chess.local.start')}
      </Button>
    </div>
  )
}

/** The game in progress and its time control, kept on this device across a refresh. */
const GAME_KEY = 'agh.chess.local.game'
const SETUP_KEY = 'agh.chess.local.setup'

function savedControl(): TimeControl | null {
  try {
    // Only when there is a game to go back to.
    if (!localStorage.getItem(GAME_KEY)) return null
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null') as Partial<TimeControl> | null
    return saved && typeof saved.base_ms === 'number' && typeof saved.increment_ms === 'number' ? (saved as TimeControl) : null
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

function Table({ control, onNewGame }: { control: TimeControl; onNewGame: () => void }) {
  const { t } = useTranslation()
  const game = useLocalChessGame({ baseMs: control.base_ms, incrementMs: control.increment_ms, referee: testReferee, saveKey: GAME_KEY })
  return (
    <GameTable
      title={`${t('games.chess')} · ${timeControlLabel(control)}`}
      game={game}
      players={{ w: { name: t('chess.white') }, b: { name: t('chess.black') } }}
      movable="both"
      perspective={null}
      timed
      passAndPlay
      onRematch={() => {
        game.restart()
        feedback('gameStart')
      }}
      onNewGame={onNewGame}
    />
  )
}

/** Chess for two players sharing one phone. No account data, no tokens, works offline. */
export default function LocalGamePage() {
  // A game left unfinished (the page was refreshed, or the tab closed) is carried on from where it stood.
  const [control, setControl] = useState<TimeControl | null>(savedControl)
  // A new key gives a completely fresh table (game, clocks, view) for each new game.
  const [gameNumber, setGameNumber] = useState(0)

  if (!control) {
    return (
      <Setup
        onStart={(chosen) => {
          forget()
          try {
            localStorage.setItem(SETUP_KEY, JSON.stringify(chosen))
          } catch {
            // Private browsing: the game simply is not kept.
          }
          setControl(chosen)
          setGameNumber((n) => n + 1)
          // Started by a tap, which is also what lets the browser play sound from here on.
          feedback('gameStart')
        }}
      />
    )
  }
  return (
    <Table
      key={gameNumber}
      control={control}
      onNewGame={() => {
        forget()
        setControl(null)
      }}
    />
  )
}
