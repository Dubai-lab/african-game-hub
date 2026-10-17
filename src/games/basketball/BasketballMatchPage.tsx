// Street basketball online: one against one or two against two, against real players.
//
// The game server runs the match (server/src/basketball.ts). This screen sends it the buttons
// the player presses and draws the court it sends back, about fifteen times a second, smoothed
// between pictures. It decides nothing: not where anyone is, not whether a shot went in.
//
// When the game server cannot be reached the match cannot be played anywhere else (a real-time
// game, CLAUDE.md section 2): the screen says so, and the match is called off without a result.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { gameServerConfigured, type GameLink, openGameLink } from '@/core/lib/gameServer'
import { setLandscape } from '@/core/lib/nativeApp'
import { supabase } from '@/core/lib/supabase'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Button, buttonClass } from '@/core/ui/Button'
import { useLockedScreen } from '@/core/ui/gameScreen'
import { ResultDialog, ResultStat, ResultStats } from '@/core/ui/ResultDialog'
import {
  applySnapshot,
  DUNK_RANGE,
  encodeInput,
  fromRim,
  type Game,
  type GameEvent,
  type Input,
  newGame,
  PERFECT_RELEASE,
  type Snapshot,
  type Team,
} from '../../../supabase/functions/_shared/basketball'
import { ENDING_MS, newView, PITCH, screenToCourt } from './camera'
import { Controls, type Pad } from './Controls'
import { Court3D, type World } from './Court3D'
import { musicVolume, startMusic, stopMusic } from './music'
import { boardSound, bounceSound, hornSound, rimSound, slapSound, swishSound } from './sound'

type Stage = 'connecting' | 'waiting' | 'playing' | 'over' | 'unavailable' | 'ended'
type Who = { id: number; username: string; country_code: string | null }
type Callout = { id: number; text: string; tone: 'good' | 'bad' | 'plain' }
type Ending = { winner: Team | null; reason: string; score: [number, number] }

/**
 * How long without a connection before the screen says online basketball is unavailable. It
 * keeps trying meanwhile: the court answering later takes the player straight to the match.
 */
const UNAVAILABLE_AFTER_MS = 20_000

/** Moves the drawn game a step toward the latest picture from the server. */
function follow(shown: Game, latest: Game, dt: number) {
  const k = 1 - Math.exp(-dt * 18)
  const near = (a: number, b: number) => a + (b - a) * k
  latest.players.forEach((to, i) => {
    const p = shown.players[i]!
    // A jump of metres is a new possession being set up: no sliding across the court.
    if (Math.hypot(to.x - p.x, to.z - p.z) > 3) {
      p.x = to.x
      p.z = to.z
    } else {
      p.x = near(p.x, to.x)
      p.z = near(p.z, to.z)
    }
    p.y = near(p.y, to.y)
    let turn = to.face - p.face
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    p.face += turn * k
    p.vx = to.vx
    p.vz = to.vz
    p.shootT = to.shootT
    p.dunk = to.dunk
    p.hang = to.hang
    p.stumble = to.stumble
    p.burst = to.burst
  })
  const b = shown.ball
  const t = latest.ball
  if (t.holder !== null || Math.hypot(t.x - b.x, t.z - b.z, t.y - b.y) > 4) {
    b.x = t.x
    b.y = t.y
    b.z = t.z
  } else {
    b.x = near(b.x, t.x)
    b.y = near(b.y, t.y)
    b.z = near(b.z, t.z)
  }
  b.vx = t.vx
  b.vy = t.vy
  b.vz = t.vz
  b.holder = t.holder
  b.dribble = t.dribble
  b.pass = t.pass
  b.shot = t.shot
  shown.tick = latest.tick
  shown.phase = latest.phase
  shown.phaseT = latest.phaseT
  shown.score = [latest.score[0], latest.score[1]]
  shown.offense = latest.offense
  shown.mustClear = latest.mustClear
  shown.shotClock = latest.shotClock
  shown.winner = latest.winner
}

export default function BasketballMatchPage({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  useLockedScreen()
  const world = useRef<World>({ game: newGame(0, 1), human: 0, marks: {}, hands: {}, view: newView(), dribble: {}, crosses: {}, overAt: null })
  const latest = useRef<Game | null>(null)
  const link = useRef<GameLink | null>(null)
  const pad = useRef<Pad>({ mx: 0, mz: 0, main: false, second: false, pass: false })
  const swish = useRef(0)
  const [stage, setStage] = useState<Stage>(gameServerConfigured ? 'connecting' : 'unavailable')
  const stageRef = useRef(stage)
  stageRef.current = stage
  const [players, setPlayers] = useState<Who[]>([])
  const [ready, setReady] = useState(false)
  const [ending, setEnding] = useState<Ending | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [callouts, setCallouts] = useState<Callout[]>([])
  const [hud, setHud] = useState({ score: [0, 0] as [number, number], shotClock: 12, phase: 'check' as Game['phase'], attacking: false, mateHas: false, canDunk: false, mustClear: false, shootT: null as number | null, size: 1 })
  const [screenSize, setScreenSize] = useState(() => ({ turned: window.innerHeight > window.innerWidth, width: window.innerWidth, height: window.innerHeight }))

  const call = useCallback((text: string, tone: Callout['tone'] = 'plain') => {
    const id = Math.random()
    setCallouts((list) => [...list.slice(-2), { id, text, tone }])
    setTimeout(() => setCallouts((list) => list.filter((c) => c.id !== id)), 1600)
  }, [])

  // What the player hears and reads about what just happened (the same as practice).
  const hear = useCallback(
    (events: GameEvent[]) => {
      const me = world.current.human
      const myTeam = world.current.game.players[me]?.team ?? 0
      for (const e of events) {
        if (e.type === 'bounce' && !(e.dribble && Object.keys(world.current.dribble).length)) bounceSound(e.speed)
        else if (e.type === 'rim') rimSound(e.speed)
        else if (e.type === 'board') boardSound()
        else if (e.type === 'score') {
          swishSound()
          swish.current = performance.now()
          call(e.dunk ? t('basketball.call.dunk') : e.swish ? t('basketball.call.swish', { points: e.points }) : t('basketball.call.score', { points: e.points }), e.team === myTeam ? 'good' : 'bad')
        } else if (e.type === 'block') {
          slapSound()
          call(t('basketball.call.block'), world.current.game.players[e.by]?.team === myTeam ? 'good' : 'bad')
        } else if (e.type === 'steal') {
          slapSound()
          world.current.marks[e.by] = performance.now()
          call(t('basketball.call.steal'), world.current.game.players[e.by]?.team === myTeam ? 'good' : 'bad')
        } else if (e.type === 'reach' || e.type === 'pass') {
          slapSound()
          world.current.marks[e.by] = performance.now()
        } else if (e.type === 'call' && e.by !== me && world.current.game.players[e.by]?.team === myTeam) call(t('basketball.call.calling'))
        else if (e.type === 'crossover') {
          world.current.crosses[e.by] = performance.now()
          if (e.broke) call(t('basketball.call.ankles'), world.current.game.players[e.by]?.team === myTeam ? 'good' : 'bad')
        } else if (e.type === 'turnover') call(t(e.reason === 'out' ? 'basketball.call.out' : 'basketball.call.shotClock'))
        else if (e.type === 'shot' && e.by === me && !e.dunk) {
          const q = e.quality
          call(q > 0.85 ? t('basketball.call.perfect') : q > 0.55 ? t('basketball.call.good') : t(q > 0.25 ? 'basketball.call.early' : 'basketball.call.off'), q > 0.55 ? 'good' : 'plain')
        }
      }
    },
    [call, t],
  )

  const end = useCallback((result: Ending) => {
    setEnding(result)
    setStage('over')
    hornSound()
    world.current.overAt = performance.now()
    musicVolume(0.45)
    // A match called off has no one to celebrate: straight to what happened.
    if (result.winner === null) setShowResult(true)
    else setTimeout(() => setShowResult(true), ENDING_MS)
  }, [])

  // The line to the game server, for as long as the screen is open.
  useEffect(() => {
    const opened = openGameLink('basketball', matchId, {
      onReady: () => setReady(true),
      onMessage: (message) => {
        if (message.t === 'court') {
          const size = message.size === 2 ? 2 : 1
          const shown = newGame(0, size)
          const snap = message.s as Snapshot
          applySnapshot(shown, snap)
          const copy = newGame(0, size)
          applySnapshot(copy, snap)
          world.current.game = shown
          world.current.human = typeof message.you === 'number' ? message.you : 0
          latest.current = copy
          setPlayers(Array.isArray(message.players) ? (message.players as Who[]) : [])
          if (stageRef.current === 'connecting' || stageRef.current === 'unavailable') setStage(message.started ? 'playing' : 'waiting')
        } else if (message.t === 'start') {
          setStage('playing')
          startMusic()
        } else if (message.t === 'state' && latest.current) {
          applySnapshot(latest.current, message.s as Snapshot)
          if (stageRef.current === 'waiting' || stageRef.current === 'connecting' || stageRef.current === 'unavailable') setStage('playing')
          if (Array.isArray(message.e)) hear(message.e as GameEvent[])
        } else if (message.t === 'over' && stageRef.current !== 'over') {
          const score = Array.isArray(message.score) ? (message.score as [number, number]) : (latest.current?.score ?? [0, 0])
          end({ winner: message.winner === 0 || message.winner === 1 ? message.winner : null, reason: String(message.reason ?? ''), score: [score[0], score[1]] })
        }
      },
    })
    link.current = opened
    return () => {
      opened?.close()
      link.current = null
      stopMusic()
    }
  }, [matchId, hear, end])

  // Not reachable for a while: the match cannot be played. If it is already over (opened again
  // after the end), the database says how it ended.
  useEffect(() => {
    if (stage !== 'connecting') return
    const timer = setTimeout(async () => {
      if (stageRef.current !== 'connecting') return
      try {
        const [{ data: match }, { data: game }] = await Promise.all([
          supabase.from('matches').select('status').eq('id', matchId).maybeSingle(),
          supabase.from('basketball_games').select('score_a, score_b, winning_side').eq('match_id', matchId).maybeSingle(),
        ])
        if (match && match.status !== 'active' && game) {
          setEnding({ winner: game.winning_side === 'a' ? 0 : game.winning_side === 'b' ? 1 : null, reason: match.status === 'aborted' ? 'called_off' : 'played', score: [game.score_a, game.score_b] })
          setShowResult(true)
          return setStage('ended')
        }
      } catch {
        // Unknown: it is said to be unavailable.
      }
      setStage('unavailable')
    }, UNAVAILABLE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [stage, matchId])

  // Every frame: the drawn court toward the latest picture, and the buttons to the server.
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let sent = ''
    let sentAt = 0
    let hudAt = 0
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const shown = world.current.game
      if (latest.current && shown.players.length === latest.current.players.length) follow(shown, latest.current, dt)
      const me = world.current.human
      const holding = shown.ball.holder === me
      if (stageRef.current === 'playing' && link.current) {
        const p = pad.current
        const toward = screenToCourt(p.mx, p.mz, world.current.view.yaw)
        const input: Input = { mx: toward.x, mz: toward.z, shoot: holding && p.main, jump: !holding && p.main, action: p.second, pass: p.pass }
        const row = encodeInput(input)
        const key = JSON.stringify(row)
        const buttonsChanged = sent && row[2] !== (JSON.parse(sent) as number[])[2]
        // Buttons at once; the stick at most twenty times a second; and every quarter second anyway.
        if ((key !== sent && (buttonsChanged || now - sentAt > 50)) || now - sentAt > 250) {
          if (link.current.send({ t: 'in', i: row })) {
            sent = key
            sentAt = now
          }
        }
      }
      if (now - hudAt > 66) {
        hudAt = now
        const mine = shown.players[me]
        const holder = shown.ball.holder !== null ? shown.players[shown.ball.holder] : undefined
        setHud({
          score: [shown.score[0], shown.score[1]],
          shotClock: shown.shotClock,
          phase: shown.phase,
          attacking: holding,
          mateHas: Boolean(holder && mine && holder.id !== me && holder.team === mine.team),
          canDunk: holding && !shown.mustClear && mine?.shootT === null && fromRim(mine.x, mine.z) < DUNK_RANGE,
          mustClear: Boolean(mine && shown.mustClear && shown.offense === mine.team),
          shootT: mine?.shootT ?? null,
          size: shown.players.length / 2,
        })
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    const turn = () => setScreenSize({ turned: window.innerHeight > window.innerWidth, width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', turn)
    // The music may only start on a touch: the first one on the screen starts it.
    const touched = () => stageRef.current === 'playing' && startMusic()
    window.addEventListener('pointerdown', touched)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', turn)
      window.removeEventListener('pointerdown', touched)
    }
  }, [])

  useEffect(() => {
    setLandscape(true)
    return () => setLandscape(false)
  }, [])

  const myTeam = (world.current.game.players[world.current.human]?.team ?? 0) as Team
  const [scoreA, scoreB] = ending?.score ?? hud.score
  const mine = myTeam === 0 ? scoreA : scoreB
  const theirs = myTeam === 0 ? scoreB : scoreA
  const names = (team: Team) =>
    players
      .filter((p) => (team === 0 ? p.id < hud.size : p.id >= hud.size))
      .map((p) => p.username)
      .join(' & ')
  const meter = hud.shootT !== null ? Math.min(1, hud.shootT / 1.2) : null
  const sweet = PERFECT_RELEASE / 1.2
  const won = ending?.winner === myTeam
  const musicOn = useSettingsStore((state) => state.basketballMusic)

  if (stage === 'unavailable') {
    return (
      <div className="flex min-h-(--app-h) flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display text-2xl font-extrabold text-accent">{t('basketball.online.unavailable')}</h1>
        <p className="max-w-sm text-muted">{t('basketball.online.unavailableHint')}</p>
        <Link to="/play/basketball/practice" className={buttonClass('primary')}>
          {t('basketball.practice.link')}
        </Link>
        <Link to="/lobby" className={buttonClass('ghost')}>
          {t('basketball.pause.leave')}
        </Link>
      </div>
    )
  }

  return (
    <div
      className={`overflow-hidden bg-[#141b45] ${screenSize.turned ? 'fixed left-0 top-0 origin-top-left' : 'relative h-(--app-h) w-full'}`}
      style={screenSize.turned ? { width: screenSize.height, height: screenSize.width, transform: `translateX(${screenSize.width}px) rotate(90deg)` } : undefined}
      data-testid="basketball-online"
      data-stage={stage}
    >
      <Court3D world={world} swish={swish} />

      {/* The scoreboard: this side first. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-3 pt-[max(0.5rem,var(--safe-top))]">
        <button
          type="button"
          className="glass pointer-events-auto flex min-h-11 items-center justify-center rounded-full border border-line px-3 text-sm font-semibold"
          onClick={() => {
            const on = !useSettingsStore.getState().basketballMusic
            useSettingsStore.getState().set({ basketballMusic: on })
            if (on) startMusic()
            else stopMusic()
          }}
        >
          {musicOn ? t('basketball.pause.musicOff') : t('basketball.pause.musicOn')}
        </button>
        <div className="glass flex items-center gap-3 rounded-2xl border border-line px-4 py-1.5" role="status" aria-label={t('basketball.scoreLabel', { mine, theirs })}>
          <span className="max-w-28 truncate text-sm font-bold text-[#c5cbf2]">{names(myTeam) || t('basketball.you')}</span>
          <span className="font-display text-2xl font-extrabold tabular-nums">{mine}</span>
          <span className="text-muted">–</span>
          <span className="font-display text-2xl font-extrabold tabular-nums">{theirs}</span>
          <span className="max-w-28 truncate text-sm font-bold text-[#ff9db3]">{names(myTeam === 0 ? 1 : 0)}</span>
        </div>
        <div className={`glass flex size-11 items-center justify-center rounded-full border border-line font-display text-lg font-extrabold tabular-nums ${hud.shotClock < 4 ? 'text-alert' : ''}`} aria-label={t('basketball.shotClock')}>
          {Math.ceil(Math.max(0, hud.shotClock))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-24 flex flex-col-reverse items-center gap-1.5">
        {stage === 'playing' && hud.phase === 'check' && <p className="glass rounded-full border border-line px-4 py-1 font-display font-extrabold">{t('basketball.call.check')}</p>}
        {stage === 'playing' && hud.mustClear && hud.phase === 'live' && <p className="rounded-full bg-hibiscus px-4 py-1 font-display font-extrabold text-white">{t('basketball.call.takeItBack')}</p>}
        {callouts.map((c) => (
          <p key={c.id} className={`result-in rounded-full px-4 py-1 font-display text-lg font-extrabold ${c.tone === 'good' ? 'bg-palm text-white' : c.tone === 'bad' ? 'bg-hibiscus text-white' : 'glass border border-line'}`}>
            {c.text}
          </p>
        ))}
      </div>

      {meter !== null && (
        <div className="pointer-events-none absolute bottom-36 right-8 h-40 w-4 overflow-hidden rounded-full border border-edge bg-ink/70" aria-hidden="true">
          <div className="absolute inset-x-0 h-3 bg-brand" style={{ bottom: `calc(${sweet * 100}% - 0.375rem)` }} />
          <div className="absolute inset-x-0 bottom-0 bg-white/80" style={{ height: `${meter * 100}%` }} />
        </div>
      )}

      {stage === 'playing' && (
        <Controls
          pad={pad}
          passing={hud.size > 1 ? (hud.attacking ? 'pass' : hud.mateHas ? 'call' : null) : null}
          attacking={hud.attacking}
          canDunk={hud.canDunk}
          turned={screenSize.turned}
          onLook={(dx, dy) => {
            const view = world.current.view
            view.yaw -= dx * 0.0062
            view.pitch = Math.min(PITCH.max, Math.max(PITCH.min, view.pitch + dy * 0.004))
          }}
        />
      )}

      {/* Before play, and when the line drops in the middle of it. */}
      {(stage === 'connecting' || stage === 'waiting' || (stage === 'playing' && !ready && !link.current?.ready)) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="glass rounded-full border border-line px-5 py-2 font-display text-lg font-extrabold" data-testid="basketball-waiting">
            {stage === 'waiting' ? t('basketball.online.waiting') : stage === 'connecting' ? t('basketball.online.connecting') : t('basketball.online.reconnecting')}
          </p>
        </div>
      )}

      {stage === 'over' && !showResult && ending && (
        <button type="button" className="absolute inset-0 flex items-end justify-center pb-10" onClick={() => setShowResult(true)}>
          <span className={`result-in rounded-full px-6 py-2 font-display text-3xl font-extrabold text-white ${won ? 'bg-palm' : 'bg-hibiscus'}`}>
            {won ? t('basketball.over.won') : t('basketball.over.lost')} {mine} – {theirs}
          </span>
        </button>
      )}

      {showResult && ending && (
        <ResultDialog
          title={ending.winner === null ? t('basketball.online.calledOff') : won ? t('basketball.over.won') : t('basketball.over.lost')}
          tone={ending.winner === null ? 'draw' : won ? 'win' : 'loss'}
          reason={t(`basketball.online.reason.${['played', 'abandoned', 'no_show', 'server_lost'].includes(ending.reason) ? ending.reason : 'called_off'}`)}
          onClose={() => navigate('/play/basketball/new')}
          closeLabel={t('basketball.online.again')}
        >
          <ResultStats>
            <ResultStat testId="basketball-final" label={t('basketball.over.score')} value={`${mine} – ${theirs}`} />
          </ResultStats>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => navigate('/play/basketball/new')}>
              {t('basketball.online.again')}
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
