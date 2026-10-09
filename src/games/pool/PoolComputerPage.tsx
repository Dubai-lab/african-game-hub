import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button, buttonClass } from '@/core/ui/Button'
import { ResultDialog } from '@/core/ui/ResultDialog'
import { toast } from '@/core/ui/toast'
import { applyShot, type PoolState, rack, type Seat, type Shot, type ShotResult, type Variant } from '../../../supabase/functions/_shared/pool'
import { chooseShot, type Level } from './computer'
import { PoolTable, type TableGame } from './PoolTable'

// Practice against the computer: no tokens, no rating, nothing sent anywhere. The same rules
// and physics as a real match, run on this device. The player is seat 1 and breaks.

const LEVELS: Level[] = ['easy', 'medium', 'hard']
const VARIANTS: Variant[] = ['8ball', '9ball']
const THINKING_MS = 900
/** The practice game in progress, kept on this device so a refresh (or a closed tab) does not lose it. */
const GAME_KEY = 'agh.pool.practice'
type Saved = { variant: Variant; level: Level; game: TableGame }

function loadGame(): Saved | null {
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null') as Partial<Saved> | null
    if (!saved?.game || !Array.isArray(saved.game.balls) || !VARIANTS.includes(saved.variant!) || !LEVELS.includes(saved.level!)) return null
    // Nothing is played back on return: the balls are simply where they came to rest.
    return { variant: saved.variant!, level: saved.level!, game: { ...saved.game, lastShot: null } }
  } catch {
    return null
  }
}

const newGame = (variant: Variant): TableGame => ({ variant, balls: rack(variant), turn: 1, breakShot: true, ballInHand: true, solidsSeat: null, fouls: [0, 0], shotNo: 0, lastShot: null })

/** Plays a shot on a game and returns the game that comes of it, or null when the shot is not allowed. */
function play(game: TableGame, shot: Shot): { game: TableGame; result: ShotResult } | null {
  const state: PoolState = game
  const played = applyShot(state, shot)
  if (!played) return null
  // Where the balls stood when the cue struck (the cue ball placed, if it was in hand).
  const from = game.balls.map((b) => (b.n === 0 && game.ballInHand && shot.cue ? { ...b, x: shot.cue.x, y: shot.cue.y, in: false } : { ...b }))
  return { game: { ...played.state, shotNo: game.shotNo + 1, lastShot: { no: game.shotNo, seat: game.turn, shot, from, result: played.result } }, result: played.result }
}

export default function PoolComputerPage() {
  const { t } = useTranslation()
  // A game left unfinished (the page was refreshed, or the tab closed) is carried on from where it stood.
  const [saved] = useState(loadGame)
  const [variant, setVariant] = useState<Variant>(saved?.variant ?? '8ball')
  const [level, setLevel] = useState<Level>(saved?.level ?? 'medium')
  const [game, setGame] = useState<TableGame | null>(saved?.game ?? null)
  const [over, setOver] = useState<{ winner: Seat; reason: string } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [closed, setClosed] = useState(false)
  /** Counts the games played, so each new one gets a fresh table. */
  const [round, setRound] = useState(0)
  const live = useRef(game)
  live.current = game

  // Every change is written down at once: the page can be refreshed at any moment.
  useEffect(() => {
    try {
      if (!game || over) localStorage.removeItem(GAME_KEY)
      else localStorage.setItem(GAME_KEY, JSON.stringify({ variant: game.variant, level, game }))
    } catch {
      // Private browsing: the game simply is not kept.
    }
  }, [game, over, level])

  function start() {
    setGame(newGame(variant))
    setOver(null)
    setClosed(false)
    setRound((n) => n + 1)
  }

  const take = useCallback((shot: Shot): boolean => {
    const current = live.current
    if (!current) return false
    const played = play(current, shot)
    if (!played) return false
    setGame(played.game)
    if (played.result.winner !== null) setOver({ winner: played.result.winner, reason: played.result.reason ?? 'other' })
    return true
  }, [])

  // The computer shoots once the balls have stopped, after a moment's thought.
  const computerToShoot = game !== null && over === null && game.turn === 2 && !playing
  const shotNo = game?.shotNo
  useEffect(() => {
    if (!computerToShoot) return
    const timer = setTimeout(() => {
      const current = live.current
      if (!current || current.turn !== 2) return
      // Its chosen shot is always one the rules allow; the plain shot is only a safeguard.
      if (!take(chooseShot(current, level))) take({ dx: 1_000_000, dy: 0, power: 400, spinX: 0, spinY: 0 })
    }, THINKING_MS)
    return () => clearTimeout(timer)
  }, [computerToShoot, shotNo, level, take])

  const pick = (chosen: boolean) => `min-h-12 border-2 px-3 font-bold ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`

  if (!game) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-6">
        <Link to="/lobby" className="font-semibold text-primary underline underline-offset-4">
          {t('pool.back')}
        </Link>
        <div>
          <h1 className="font-display text-3xl font-extrabold text-primary">{t('pool.computer.title')}</h1>
          <p className="mt-1 text-muted">{t('pool.computer.intro')}</p>
        </div>
        <fieldset>
          <legend className="font-display text-xl font-semibold">{t('pool.computer.game')}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
            {VARIANTS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={variant === id} onClick={() => setVariant(id)} className={pick(variant === id)}>
                {t(`pool.variant.${id}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-display text-xl font-semibold">{t('pool.computer.level')}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
            {LEVELS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={level === id} onClick={() => setLevel(id)} className={pick(level === id)}>
                {t(`pool.computer.levels.${id}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <Button onClick={start}>{t('pool.computer.start')}</Button>
      </div>
    )
  }

  const computer = t('pool.computer.name')
  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <Button onClick={start}>{t('pool.computer.again')}</Button>
      <Button variant="ghost" onClick={() => setGame(null)}>
        {t('pool.computer.change')}
      </Button>
    </div>
  )

  return (
    <>
      <PoolTable
        key={round}
        title={[t(`pool.variant.${game.variant}`), t(`pool.computer.levels.${level}`)].join(' · ')}
        game={game}
        players={[
          { seat: 1, name: t('pool.computer.you') },
          { seat: 2, name: computer },
        ]}
        mySeat={1}
        decided={over !== null}
        onShoot={async (shot) => {
          const accepted = take(shot)
          if (!accepted) toast.error(t('errors.codes.ILLEGAL_SHOT'))
          return accepted
        }}
        onPlaying={setPlaying}
        waitingText={t('pool.status.thinking', { name: computer })}
        footer={
          over ? (
            actions
          ) : (
            <Link to="/lobby" className={buttonClass('ghost', 'w-full')}>
              {t('pool.backToLobby')}
            </Link>
          )
        }
      />
      {over && !playing && !closed && (
        <ResultDialog
          title={t(over.winner === 1 ? 'pool.computer.youWon' : 'pool.computer.youLost')}
          tone={over.winner === 1 ? 'win' : 'loss'}
          reason={t(`pool.reason.${over.reason}`, { defaultValue: t('pool.reason.other') })}
          onClose={() => setClosed(true)}
          closeLabel={t('pool.over.close')}
        >
          <div>{actions}</div>
        </ResultDialog>
      )}
    </>
  )
}
