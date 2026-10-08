import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Button, buttonClass } from '@/core/ui/Button'
import { Toggle } from '@/core/ui/Toggle'
import { type Seat, SEATS } from './board'
import { LudoTable, Sheet, type TablePlayer } from './LudoTable'
import { applyMove, applyRoll, chooseMove, type LocalGame, newLocalGame, throwDice } from './rules'
import { ludoFeedback } from './sound'

// Ludo against the computer: practice, with no tokens and no rating. Everything happens on
// this device (it works offline), using the practice copy of the rules. The player is red and
// throws first; the computer plays everyone else. How the game is played (dice, both sides,
// lay) is the player's Ludo settings, which can be changed here as well.

type Setup = { opponents: number; pieces: number }
const STORAGE_KEY = 'agh.ludo.computer'
const HUMAN: Seat = 'red'
/** Long enough to see the dice roll and the piece walk before the next thing happens. */
const COMPUTER_PAUSE_MS = 1500

function loadSetup(): Setup {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Setup>
    return { opponents: [1, 2, 3].includes(saved.opponents ?? 0) ? saved.opponents! : 1, pieces: saved.pieces === 2 ? 2 : 4 }
  } catch {
    return { opponents: 1, pieces: 4 }
  }
}

function Choice<T extends number>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold">{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-12 min-w-28 flex-1 cursor-pointer items-center justify-center border-2 px-4 text-center font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${option.value === value ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`}
          >
            <input type="radio" name={name} className="sr-only" checked={option.value === value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Game({ setup, onSetup }: { setup: Setup; onSetup: () => void }) {
  const { t } = useTranslation()
  const start = () => {
    const { ludoDice, ludoSides, ludoLay } = useSettingsStore.getState()
    return newLocalGame({ players: setup.opponents + 1, pieces: setup.pieces, dice: ludoDice, sides: setup.opponents === 1 ? ludoSides : 1, lay: ludoLay })
  }
  const [game, setGame] = useState<LocalGame>(start)
  const [resultClosed, setResultClosed] = useState(false)

  const players = useMemo(() => {
    const names: Partial<Record<Seat, TablePlayer>> = { [HUMAN]: { name: t('ludo.computer.you') } }
    const others = SEATS.filter((seat) => game.teams[seat] && seat !== HUMAN)
    others.forEach((seat, index) => {
      names[seat] = { name: others.length === 1 ? t('ludo.computer.name') : t('ludo.computer.numbered', { number: index + 1 }) }
    })
    return names
  }, [game.teams, t])

  // The computer's turns, one step at a time so each can be followed.
  useEffect(() => {
    if (game.phase === 'over' || game.turn === HUMAN) return
    const id = setTimeout(() => {
      setGame((current) => (current.phase === 'roll' ? applyRoll(current, throwDice(current.diceCount)) : applyMove(current, chooseMove(current))))
    }, COMPUTER_PAUSE_MS)
    return () => clearTimeout(id)
  }, [game])

  const restart = () => {
    setGame(start())
    setResultClosed(false)
    ludoFeedback('turn')
  }
  const over = game.phase === 'over'
  const winner = game.places[0]
  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="ghost" onClick={restart}>
        {t('ludo.computer.again')}
      </Button>
      <Button variant="ghost" onClick={onSetup}>
        {t('ludo.computer.change')}
      </Button>
    </div>
  )

  return (
    <LudoTable
      title={`${t('games.ludo')} · ${t('ludo.computer.title')}`}
      state={game}
      players={players}
      mySeat={HUMAN}
      deadline={null}
      busy={false}
      onRoll={() => setGame((current) => (current.turn === HUMAN && current.phase === 'roll' ? applyRoll(current, throwDice(current.diceCount)) : current))}
      onMove={(move) => setGame((current) => (current.turn === HUMAN && current.phase === 'move' ? applyMove(current, move) : current))}
      footer={
        over ? (
          actions
        ) : (
          <Button variant="ghost" className="w-full" onClick={onSetup}>
            {t('ludo.computer.leave')}
          </Button>
        )
      }
    >
      {over && !resultClosed && (
        <Sheet title={winner === HUMAN ? t('ludo.over.youWon') : t('ludo.over.winner', { name: players[winner!]?.name ?? '' })} onClose={() => setResultClosed(true)}>
          <p className="mt-1 text-muted" data-testid="game-over-reason">
            {t('ludo.reason.all_home')}
          </p>
          <div className="mt-4">{actions}</div>
          <button type="button" onClick={() => setResultClosed(true)} className="mt-2 min-h-11 w-full font-semibold text-primary underline underline-offset-4">
            {t('ludo.over.close')}
          </button>
        </Sheet>
      )}
    </LudoTable>
  )
}

export default function LudoComputerPage() {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const [setup, setSetup] = useState<Setup>(loadSetup)
  const [playing, setPlaying] = useState(false)
  const [round, setRound] = useState(0)

  const change = (next: Setup) => {
    setSetup(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Private browsing: the choice simply is not remembered.
    }
  }

  if (playing) return <Game key={round} setup={setup} onSetup={() => setPlaying(false)} />

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-6">
      <Link to="/lobby" className="flex min-h-11 items-center self-start font-semibold text-primary underline underline-offset-4">
        {t('ludo.back')}
      </Link>
      <div>
        <h1 className="font-display text-3xl font-extrabold text-primary">{t('ludo.computer.heading')}</h1>
        <p className="mt-2 text-muted">{t('ludo.computer.intro')}</p>
      </div>
      <Choice
        legend={t('ludo.computer.opponents')}
        name="ludo-opponents"
        value={setup.opponents}
        options={[1, 2, 3].map((count) => ({ value: count, label: t('ludo.computer.opponentsCount', { count }) }))}
        onChange={(opponents) => change({ ...setup, opponents })}
      />
      {setup.opponents === 1 && (
        <Choice
          legend={t('ludo.lobby.sides')}
          name="ludo-sides"
          value={settings.ludoSides}
          options={[2, 1].map((count) => ({ value: count, label: t(`ludo.sides.${count}`) }))}
          onChange={(count) => settings.set({ ludoSides: count as 1 | 2 })}
        />
      )}
      <Choice
        legend={t('ludo.lobby.length')}
        name="ludo-pieces"
        value={setup.pieces}
        options={[
          { value: 4, label: t('ludo.mode.classic') },
          { value: 2, label: t('ludo.mode.quick') },
        ]}
        onChange={(pieces) => change({ ...setup, pieces })}
      />
      <Choice
        legend={t('ludo.lobby.dice')}
        name="ludo-dice"
        value={settings.ludoDice}
        options={[2, 1].map((count) => ({ value: count, label: t('ludo.diceCount', { count }) }))}
        onChange={(count) => settings.set({ ludoDice: count as 1 | 2 })}
      />
      <Toggle label={t('ludo.settings.lay')} hint={t('ludo.settings.layHint')} on={settings.ludoLay} onChange={(ludoLay) => settings.set({ ludoLay })} />
      <Button
        onClick={() => {
          setRound((r) => r + 1)
          setPlaying(true)
          ludoFeedback('turn')
        }}
      >
        {t('ludo.computer.start')}
      </Button>
      <Link to="/lobby" className={buttonClass('ghost')}>
        {t('ludo.backToLobby')}
      </Link>
    </main>
  )
}
