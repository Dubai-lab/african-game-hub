// Street basketball practice: one against one, against the computer, on this device. The game
// is the shared simulation (supabase/functions/_shared/basketball.ts), stepped sixty times a
// second with the player's buttons and the computer's; online games will run the same
// simulation on the game server.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useLockedScreen } from '@/core/ui/gameScreen'
import { Button, buttonClass } from '@/core/ui/Button'
import { ResultDialog, ResultStat, ResultStats } from '@/core/ui/ResultDialog'
import { DUNK_RANGE, fromRim, type Game, type GameEvent, type Input, newGame, PERFECT_RELEASE, step, TICK, TO_WIN } from '../../../supabase/functions/_shared/basketball'
import { isNativeApp, setLandscape } from '@/core/lib/nativeApp'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { musicVolume, startMusic, stopMusic } from './music'
import { type Level, levelById, type LevelId, LEVELS, type Mind, newMind, think } from './ai'
import { Controls, type Pad } from './Controls'
import { ENDING_MS, newView, PITCH, screenToCourt } from './camera'
import { controlled, MY_TEAM } from './control'
import { Court3D, type World } from './Court3D'
import { boardSound, bounceSound, hornSound, rimSound, slapSound, swishSound } from './sound'

const STORAGE_KEY = 'agh.basketball.practice'
const SIZE_KEY = 'agh.basketball.practice.size'
const HUMAN = 0


type Hud = {
  score: [number, number]
  shotClock: number
  phase: Game['phase']
  attacking: boolean
  /** 2v2: the teammate has the ball (Pass then calls for it). */
  mateHas: boolean
  twoOnTwo: boolean
  /** With the ball, close enough to the basket to dunk. */
  canDunk: boolean
  mustClear: boolean
  shootT: number | null
  winner: Game['winner']
}
type Callout = { id: number; text: string; tone: 'good' | 'bad' | 'plain' }

const hudOf = (game: Game, you: number): Hud => {
  const me = game.players[you]!
  return {
    score: [game.score[0], game.score[1]],
    shotClock: game.shotClock,
    phase: game.phase,
    attacking: game.ball.holder === you,
    mateHas: game.ball.holder !== null && game.ball.holder !== you && game.players.find((p) => p.id === game.ball.holder)?.team === me.team,
    twoOnTwo: game.players.length > 2,
    canDunk: game.ball.holder === you && !game.mustClear && me.shootT === null && fromRim(me.x, me.z) < DUNK_RANGE,
    mustClear: game.mustClear && game.offense === me.team,
    shootT: me.shootT,
    winner: game.winner,
  }
}

function Setup({ onStart }: { onStart: (level: LevelId, size: 1 | 2) => void }) {
  const { t } = useTranslation()
  const [size, setSize] = useState<1 | 2>(() => {
    try {
      return localStorage.getItem(SIZE_KEY) === '2' ? 2 : 1
    } catch {
      return 1
    }
  })
  const [level, setLevel] = useState<LevelId>(() => {
    try {
      return levelById(localStorage.getItem(STORAGE_KEY)).id
    } catch {
      return 'medium'
    }
  })
  return (
    <div className="mx-auto flex min-h-(--app-h) w-full max-w-md flex-col gap-6 px-5 pb-8 pt-4 lg:max-w-3xl lg:justify-center lg:py-12">
      <header>
        <Link to="/lobby" className="flex min-h-11 items-center font-semibold text-accent underline underline-offset-4">
          {t('basketball.back')}
        </Link>
      </header>
      <div>
        <h1 className="font-display text-3xl font-extrabold text-accent lg:text-4xl">{t('basketball.practice.title')}</h1>
        <p className="mt-2 text-muted">{t('basketball.practice.intro')}</p>
      </div>
      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('basketball.practice.mode')}</legend>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([1, 2] as const).map((option) => {
            const chosen = option === size
            return (
              <label key={option} className={`flex min-h-14 cursor-pointer flex-col justify-center border px-4 py-2 has-focus-visible:outline-2 has-focus-visible:outline-accent ${chosen ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel'}`}>
                <input type="radio" name="basketball-size" className="sr-only" checked={chosen} onChange={() => setSize(option)} />
                <span className="font-bold">{t(`basketball.practice.modes.${option}.name`)}</span>
                <span className={`text-sm ${chosen ? '' : 'text-muted'}`}>{t(`basketball.practice.modes.${option}.hint`)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('basketball.practice.level')}</legend>
        <div className="mt-3 grid gap-2">
          {LEVELS.map((option) => {
            const chosen = option.id === level
            return (
              <label key={option.id} className={`flex min-h-14 cursor-pointer flex-col justify-center border px-4 py-2 has-focus-visible:outline-2 has-focus-visible:outline-accent ${chosen ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel'}`}>
                <input type="radio" name="basketball-level" className="sr-only" checked={chosen} onChange={() => setLevel(option.id)} />
                <span className="font-bold">{t(`basketball.practice.levels.${option.id}.name`)}</span>
                <span className={`text-sm ${chosen ? '' : 'text-muted'}`}>{t(`basketball.practice.levels.${option.id}.hint`)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-muted">
        {(['score', 'check', 'clear', 'clock', 'shoot'] as const).map((rule) => (
          <li key={rule}>{t(`basketball.rules.${rule}`, { toWin: TO_WIN })}</li>
        ))}
      </ul>
      <Button
        className="mt-auto min-h-14 text-lg"
        onClick={() => {
          try {
            localStorage.setItem(STORAGE_KEY, level)
            localStorage.setItem(SIZE_KEY, String(size))
          } catch {
            // Not kept; the game still starts.
          }
          // Android, in a browser or added to the home screen: the tap that starts the game also
          // turns it to landscape and puts the phone's bars away. (The app does this itself; an
          // iPhone browser cannot without a banner, so it keeps the game drawn turned.)
          void playSideways()
          startMusic()
          onStart(level, size)
        }}
      >
        {t('basketball.practice.start')}
      </Button>
    </div>
  )
}

/** The game in progress: the court, the scoreboard over it, and the controls. */
function Match({ level, size, onChange }: { level: Level; size: 1 | 2; onChange: () => void }) {
  const { t } = useTranslation()
  useLockedScreen()
  const seed = useRef((Math.random() * 2 ** 31) | 0)
  const world = useRef<World>({ game: newGame(seed.current, size), human: HUMAN, marks: {}, hands: {}, view: newView(), dribble: {}, crosses: {}, overAt: null })
  // One mind for each computer player (its timing, what it decided).
  const minds = useRef<Mind[]>(world.current.game.players.map((p) => newMind(seed.current + 1 + p.id)))
  const pad = useRef<Pad>({ mx: 0, mz: 0, main: false, second: false, pass: false })
  const swish = useRef(0)
  const [hud, setHud] = useState<Hud>(() => hudOf(world.current.game, world.current.human))
  const [callouts, setCallouts] = useState<Callout[]>([])
  const [paused, setPaused] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const pausedRef = useRef(false)
  pausedRef.current = paused
  // The game is played sideways. A phone held upright (or locked upright) has the game drawn
  // turned a quarter, to fill the screen: the player only turns the phone.
  const measure = () => ({ turned: window.innerHeight > window.innerWidth, width: window.innerWidth, height: window.innerHeight })
  const [screenSize, setScreenSize] = useState(measure)

  const call = useCallback((text: string, tone: Callout['tone'] = 'plain') => {
    const id = Math.random()
    setCallouts((list) => [...list.slice(-2), { id, text, tone }])
    setTimeout(() => setCallouts((list) => list.filter((c) => c.id !== id)), 1600)
  }, [])

  // What the player hears and reads about what just happened.
  const hear = useCallback(
    (events: GameEvent[]) => {
      for (const e of events) {
        // A dribble the character draws makes its own sound, on the floor as drawn (Court3D).
        if (e.type === 'bounce' && !(e.dribble && Object.keys(world.current.dribble).length)) bounceSound(e.speed)
        else if (e.type === 'rim') rimSound(e.speed)
        else if (e.type === 'board') boardSound()
        else if (e.type === 'score') {
          swishSound()
          swish.current = performance.now()
          const mine = e.team === MY_TEAM
          call(e.dunk ? t('basketball.call.dunk') : e.swish ? t('basketball.call.swish', { points: e.points }) : t('basketball.call.score', { points: e.points }), mine ? 'good' : 'bad')
        } else if (e.type === 'block') {
          slapSound()
          call(t('basketball.call.block'), world.current.game.players[e.by]?.team === MY_TEAM ? 'good' : 'bad')
        } else if (e.type === 'steal') {
          slapSound()
          world.current.marks[e.by] = performance.now()
          call(t('basketball.call.steal'), world.current.game.players[e.by]?.team === MY_TEAM ? 'good' : 'bad')
        } else if (e.type === 'reach') {
          slapSound()
          world.current.marks[e.by] = performance.now()
        }
        else if (e.type === 'pass') {
          slapSound()
          world.current.marks[e.by] = performance.now()
        } else if (e.type === 'call' && e.by !== world.current.human) call(t('basketball.call.calling'))
        else if (e.type === 'crossover') {
          world.current.crosses[e.by] = performance.now()
          if (e.broke) call(t('basketball.call.ankles'), world.current.game.players[e.by]?.team === MY_TEAM ? 'good' : 'bad')
        }
        else if (e.type === 'turnover') call(t(e.reason === 'out' ? 'basketball.call.out' : 'basketball.call.shotClock'))
        else if (e.type === 'shot' && e.by === world.current.human && !e.dunk) {
          const q = e.quality
          call(q > 0.85 ? t('basketball.call.perfect') : q > 0.55 ? t('basketball.call.good') : t(q > 0.25 ? 'basketball.call.early' : 'basketball.call.off'), q > 0.55 ? 'good' : 'plain')
        } else if (e.type === 'over') {
          hornSound()
          // The end: the camera goes to the winners celebrating, then the losers; then the result.
          world.current.overAt = performance.now()
          musicVolume(0.45)
          setTimeout(() => setShowResult(true), ENDING_MS)
        }
      }
    },
    [call, t],
  )

  // The game loop: fixed steps of 1/60 s, however fast the screen draws.
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let carry = 0
    let lastHolder: number | null = null
    let stale = { main: false, second: false, pass: false }
    let sinceHud = 0
    const loop = (now: number) => {
      const elapsed = Math.min(0.1, (now - last) / 1000)
      last = now
      if (!pausedRef.current) {
        carry += elapsed
        sinceHud += elapsed
        const game = world.current.game
        while (carry >= TICK) {
          carry -= TICK
          // The controls go to whoever should have them (2v2), before this tick's buttons.
          const was = world.current.human
          world.current.human = controlled(game, was, lastHolder)
          lastHolder = game.ball.holder
          const you = world.current.human
          const holding = game.ball.holder === you
          const p = pad.current
          // A button still held from the player before is not pressed again for this one: it
          // counts once it has been let go (the stick carries straight on).
          if (you !== was) stale = { main: p.main, second: p.second, pass: p.pass }
          stale = { main: stale.main && p.main, second: stale.second && p.second, pass: stale.pass && p.pass }
          const press = { main: p.main && !stale.main, second: p.second && !stale.second, pass: p.pass && !stale.pass }
          // The stick and the arrows push the way the camera looks: up is straight ahead.
          const toward = screenToCourt(p.mx, p.mz, world.current.view.yaw)
          const mine: Input = { mx: toward.x, mz: toward.z, shoot: holding && press.main, jump: !holding && press.main, action: press.second, pass: press.pass }
          const inputs = game.players.map((player) => (player.id === you ? mine : think(game, player.id, level, minds.current[player.id]!)))
          step(game, inputs)
          if (game.events.length) hear(game.events)
        }
        // The scoreboard, about fifteen times a second; the court itself is drawn every frame.
        if (sinceHud > 1 / 15) {
          sinceHud = 0
          setHud(hudOf(game, world.current.human))
        }
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    // Away from the app: pause.
    const away = () => document.visibilityState === 'hidden' && setPaused(true)
    document.addEventListener('visibilitychange', away)
    const turn = () => setScreenSize(measure())
    window.addEventListener('resize', turn)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', away)
      window.removeEventListener('resize', turn)
    }
  }, [level, hear])

  const restart = () => {
    seed.current = (Math.random() * 2 ** 31) | 0
    world.current.game = newGame(seed.current, size)
    world.current.human = HUMAN
    world.current.overAt = null
    minds.current = world.current.game.players.map((p) => newMind(seed.current + 1 + p.id))
    setShowResult(false)
    musicVolume(1)
    setHud(hudOf(world.current.game, world.current.human))
    setPaused(false)
  }

  // The music, for as long as the game is open (started by the tap on Start or Play again).
  useEffect(() => () => stopMusic(), [])

  // In the app (shell 1.2 and later): turned to landscape, the phone's bars put away, for as
  // long as the game is open. The app then needs no turning of its own and no full screen.
  useEffect(() => {
    setLandscape(true)
    return () => setLandscape(false)
  }, [])
  // Leaving the game gives the phone its bars back.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    },
    [],
  )

  const musicOn = useSettingsStore((state) => state.basketballMusic)
  const [mine, theirs] = hud.score
  const meter = hud.shootT !== null ? Math.min(1, hud.shootT / 1.2) : null
  const sweet = PERFECT_RELEASE / 1.2

  return (
    <div
      className={`overflow-hidden bg-[#141b45] ${screenSize.turned ? 'fixed left-0 top-0 origin-top-left' : 'relative h-(--app-h) w-full'}`}
      style={screenSize.turned ? { width: screenSize.height, height: screenSize.width, transform: `translateX(${screenSize.width}px) rotate(90deg)` } : undefined}
      data-testid="basketball-practice"
      data-turned={screenSize.turned}
    >
      <Court3D world={world} swish={swish} />

      {/* The scoreboard. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-3 pt-[max(0.5rem,var(--safe-top))]">
        <button type="button" className="glass pointer-events-auto flex size-11 items-center justify-center rounded-full border border-line text-xl" aria-label={t('basketball.pause.open')} onClick={() => setPaused(true)} data-testid="basketball-pause">
          ❚❚
        </button>
        <div className="glass flex items-center gap-3 rounded-2xl border border-line px-4 py-1.5" role="status" aria-label={t('basketball.scoreLabel', { mine, theirs })}>
          <span className="text-sm font-bold text-[#c5cbf2]">{t('basketball.you')}</span>
          <span className="font-display text-2xl font-extrabold tabular-nums" data-testid="score-mine">
            {mine}
          </span>
          <span className="text-muted">–</span>
          <span className="font-display text-2xl font-extrabold tabular-nums" data-testid="score-theirs">
            {theirs}
          </span>
          <span className="text-sm font-bold text-[#ff9db3]">{t('basketball.computer')}</span>
        </div>
        <div className={`glass flex size-11 items-center justify-center rounded-full border border-line font-display text-lg font-extrabold tabular-nums ${hud.shotClock < 4 ? 'text-alert' : ''}`} aria-label={t('basketball.shotClock')}>
          {Math.ceil(Math.max(0, hud.shotClock))}
        </div>
      </div>

      {/* What is happening, in a word. */}
      {/* Low in the middle of the screen, so they never cover the basket. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-24 flex flex-col-reverse items-center gap-1.5">
        {hud.phase === 'check' && <p className="glass rounded-full border border-line px-4 py-1 font-display font-extrabold">{t('basketball.call.check')}</p>}
        {hud.mustClear && hud.phase === 'live' && <p className="rounded-full bg-hibiscus px-4 py-1 font-display font-extrabold text-white">{t('basketball.call.takeItBack')}</p>}
        {callouts.map((c) => (
          <p key={c.id} className={`result-in rounded-full px-4 py-1 font-display text-lg font-extrabold ${c.tone === 'good' ? 'bg-palm text-white' : c.tone === 'bad' ? 'bg-hibiscus text-white' : 'glass border border-line'}`}>
            {c.text}
          </p>
        ))}
      </div>

      {/* The shot meter: let go when it reaches the gold mark. */}
      {meter !== null && (
        <div className="pointer-events-none absolute bottom-36 right-8 h-40 w-4 overflow-hidden rounded-full border border-edge bg-ink/70" aria-hidden="true">
          <div className="absolute inset-x-0 h-3 bg-brand" style={{ bottom: `calc(${sweet * 100}% - 0.375rem)` }} />
          <div className="absolute inset-x-0 bottom-0 bg-white/80" style={{ height: `${meter * 100}%` }} />
        </div>
      )}

      {hud.phase !== 'over' && (
        <Controls
          pad={pad}
          passing={hud.twoOnTwo ? (hud.attacking ? 'pass' : hud.mateHas ? 'call' : null) : null}
          attacking={hud.attacking}
          canDunk={hud.canDunk}
          turned={screenSize.turned}
          onLook={(dx, dy) => {
            // A finger dragged across the right of the screen turns the camera round the player.
            const view = world.current.view
            view.yaw -= dx * 0.0062
            view.pitch = Math.min(PITCH.max, Math.max(PITCH.min, view.pitch + dy * 0.004))
          }}
        />
      )}

      {paused && hud.phase !== 'over' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-label={t('basketball.pause.title')} className="glass flex w-full max-w-sm flex-col gap-2 rounded-3xl border border-line p-5">
            <h2 className="font-display text-2xl font-extrabold text-accent">{t('basketball.pause.title')}</h2>
            <Button onClick={() => setPaused(false)}>{t('basketball.pause.resume')}</Button>
            <Button variant="ghost" onClick={restart}>
              {t('basketball.pause.restart')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const on = !useSettingsStore.getState().basketballMusic
                useSettingsStore.getState().set({ basketballMusic: on })
                if (on) startMusic()
                else stopMusic()
              }}
            >
              {musicOn ? t('basketball.pause.musicOff') : t('basketball.pause.musicOn')}
            </Button>
            <Button variant="ghost" onClick={onChange}>
              {t('basketball.pause.change')}
            </Button>
            <Link to="/lobby" className={buttonClass('ghost')}>
              {t('basketball.pause.leave')}
            </Link>
          </div>
        </div>
      )}

      {/* The end, while the camera shows the winners and the losers: a tap goes straight to the result. */}
      {hud.phase === 'over' && !showResult && (
        <button type="button" className="absolute inset-0 flex items-end justify-center pb-10" onClick={() => setShowResult(true)} data-testid="basketball-ending">
          <span className={`result-in rounded-full px-6 py-2 font-display text-3xl font-extrabold text-white ${hud.winner === 0 ? 'bg-palm' : 'bg-hibiscus'}`}>
            {hud.winner === 0 ? t('basketball.over.won') : t('basketball.over.lost')} {mine} – {theirs}
          </span>
        </button>
      )}

      {hud.phase === 'over' && showResult && (
        <ResultDialog title={hud.winner === 0 ? t('basketball.over.won') : t('basketball.over.lost')} tone={hud.winner === 0 ? 'win' : 'loss'} reason={t('basketball.over.reason', { toWin: TO_WIN })} onClose={onChange} closeLabel={t('basketball.pause.change')}>
          <ResultStats>
            <ResultStat testId="basketball-final" label={t('basketball.over.score')} value={`${mine} – ${theirs}`} />
          </ResultStats>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                startMusic()
                restart()
              }}
            >
              {t('basketball.over.again')}
            </Button>
            <Link to="/lobby" className={buttonClass('ghost')}>
              {t('basketball.pause.leave')}
            </Link>
          </div>
        </ResultDialog>
      )}
    </div>
  )
}

/** Street basketball against the computer. No tokens, no rating. */
/** Full screen and landscape, where a browser allows it quietly (Android). */
async function playSideways() {
  if (isNativeApp() || /iPhone|iPad|iPod/.test(navigator.userAgent) || !document.fullscreenEnabled) return
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')
  } catch {
    // Not every phone allows it; the game plays either way.
  }
}

export default function BasketballPracticePage() {
  const [level, setLevel] = useState<Level | null>(null)
  const [size, setSize] = useState<1 | 2>(1)
  const [round, setRound] = useState(0)
  if (!level) {
    return (
      <Setup
        onStart={(id, players) => {
          setLevel(levelById(id))
          setSize(players)
          setRound((n) => n + 1)
        }}
      />
    )
  }
  return <Match key={round} level={level} size={size} onChange={() => setLevel(null)} />
}
