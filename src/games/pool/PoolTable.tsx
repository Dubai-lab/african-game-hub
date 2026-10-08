import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { playRecorded, preloadRecorded } from '@/core/audio/recorded'
import { flagEmoji } from '@/core/countries/useCountries'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Button } from '@/core/ui/Button'
import { type Ball, canPlaceCue, groupFor, groupOf, HEAD_SPOT, type PoolState, type Seat, type Shot, type ShotResult, type SimEvent, simulate, targets as targetsOf } from '../../../supabase/functions/_shared/pool'
import { type Aim, PoolCanvas } from './PoolCanvas'
import { PowerCue } from './PowerCue'
import { clack, cushion, drop, strike } from './sound'

// The pool table as a player sees it: the two players' cards, the table, and the controls for a
// shot. It is the same for a game against a person (where the server decides every shot) and
// for practice against the computer; whoever uses it supplies the game and is told the shots.

/** Simulated time between two recorded pictures of a shot: four steps of 2 ms. */
const FRAME_MS = 8
const BALL_HEX: Record<number, string> = { 1: '#f6c400', 2: '#1c4ed8', 3: '#de1c2c', 4: '#682ea0', 5: '#f57c00', 6: '#109454', 7: '#861e16', 8: '#16161a' }

/** The last thing that happened at the table, for playing it back. */
export type LastShot = {
  no: number
  seat: Seat
  /** Null when the clock took the turn. */
  shot: Shot | null
  /** The position the shot was played from. */
  from: Ball[] | null
  result: Partial<ShotResult> & { foul?: ShotResult['foul'] | 'time' | null }
}
export type TableGame = PoolState & { shotNo: number; lastShot: LastShot | null }
export type TablePlayer = { seat: Seat; name: string; countryCode?: string | null; wins?: number | null }

export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:border-4"
      >
        <h2 className="font-display text-2xl font-extrabold text-primary">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function ShotClock({ until }: { until: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return (
    <span role="timer" aria-label={t('pool.clockLabel')} className={`min-w-10 px-2 py-1 text-center text-lg font-bold tabular-nums ${left <= 5 ? 'bg-hibiscus text-white' : 'bg-brand text-brand-ink'}`}>
      {left}
    </span>
  )
}

/** A small flat picture of a ball, for the cards: its colour, a stripe if it has one, its number. */
function Chip({ n }: { n: number }) {
  const color = BALL_HEX[n > 8 ? n - 8 : n]!
  return (
    <span
      className="flex size-5 items-center justify-center rounded-full border border-ink text-[0.6rem] font-extrabold leading-none"
      style={{ background: n > 8 ? `linear-gradient(#f7f5ec 0 22%, ${color} 22% 78%, #f7f5ec 78%)` : color, color: n === 1 || n === 9 ? '#16161a' : '#ffffff' }}
    >
      {n}
    </span>
  )
}

function PlayerCard({ player, seat, toShoot, clock, label, left }: { player: TablePlayer | undefined; seat: Seat; toShoot: boolean; clock: number | null; label: string; left: number[] }) {
  const { t } = useTranslation()
  return (
    <div className={`flex items-center gap-2 p-1.5 ${toShoot ? 'bg-panel outline-2 outline-ink' : ''}`} data-testid={`pool-player-${seat}`} data-to-shoot={toShoot}>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 truncate font-bold">
          {player?.countryCode && <span aria-hidden="true">{flagEmoji(player.countryCode)}</span>}
          <span className="truncate">{player?.name ?? ''}</span>
          {player?.wins != null && <span className="shrink-0 text-sm font-semibold tabular-nums text-muted">{t('pool.wins', { count: player.wins })}</span>}
        </p>
        <p className="flex min-h-5 flex-wrap items-center gap-1 text-sm text-muted">
          <span>{label}</span>
          {left.map((n) => (
            <Chip key={n} n={n} />
          ))}
        </p>
      </div>
      {toShoot && clock !== null && <ShotClock until={clock} />}
    </div>
  )
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

type Props = {
  title: string
  /** The game as it now stands. */
  game: TableGame
  players: TablePlayer[]
  /** The seat played on this device; null for someone only watching. */
  mySeat: Seat | null
  /** The game is over. */
  decided: boolean
  /** A request is on its way: no new shot yet. */
  busy?: boolean
  connected?: boolean
  /** When the player to shoot runs out of time, on this device's clock; null for no clock. */
  deadline?: number | null
  /** Plays a shot. Resolves false when it was refused, and the table is put back. */
  onShoot: (shot: Shot) => Promise<boolean>
  /** Told whenever balls start or stop moving on screen. */
  onPlaying?: (playing: boolean) => void
  /** Shown in the status line while the other player is to shoot, in place of "Waiting for…". */
  waitingText?: string
  /** Below the controls (the chat). */
  children?: ReactNode
  /** At the foot of the panel (resign, or what to do next). */
  footer?: ReactNode
}

export function PoolTable({ title, game, players, mySeat, decided, busy = false, connected = true, deadline = null, onShoot, onPlaying, waitingText, children, footer }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const wide = useWide()

  // What is drawn. While a shot is being played back it runs ahead of (or behind) the game; when
  // the balls stop it is the game again. `seen` is the game as the cards and the status line
  // tell it: it changes only once the balls have stopped, so nothing gives the result away early.
  const [shown, setShown] = useState<Ball[] | null>(null)
  const [seen, setSeen] = useState<TableGame>(game)
  const [playing, setPlaying] = useState(false)
  const [playingPocket, setPlayingPocket] = useState<number | null>(null)
  const playingNow = useRef(false)
  const played = useRef(new Set<number>())
  const latest = useRef(game)
  latest.current = game
  const stop = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (settings.soundOn && !settings.dataSaver) preloadRecorded(['chime-2'])
  }, [settings.soundOn, settings.dataSaver])
  useEffect(() => onPlaying?.(playing), [playing, onPlaying])

  /** Shot number `no` has finished on screen: take up the game that came of it, if it is here yet. */
  const settle = useCallback((no: number) => {
    playingNow.current = false
    setPlaying(false)
    setPlayingPocket(null)
    stop.current = null
    if (latest.current.shotNo > no) {
      setShown(latest.current.balls)
      setSeen(latest.current)
    }
  }, [])

  /** Plays shot number `no` out on screen with the same physics the server uses. */
  const playBack = useCallback(
    (from: Ball[], shot: Shot, no: number) => {
      stop.current?.()
      const frames: Ball[][] = []
      const knocks: (SimEvent & { at: number })[] = []
      simulate(
        from,
        shot,
        (balls) => frames.push(balls.map((b) => ({ ...b }))),
        (event) => knocks.push({ ...event, at: (event.step / 4) * FRAME_MS }),
      )
      const { soundOn, dataSaver } = useSettingsStore.getState()
      // In data-saver mode the balls are simply shown where they came to rest.
      if (dataSaver || frames.length < 2) {
        setShown(frames.at(-1) ?? from)
        settle(no)
        return
      }
      playingNow.current = true
      setPlaying(true)
      setPlayingPocket(shot.pocket ?? null)
      if (soundOn) strike(shot.power / 1000)
      const started = performance.now()
      let heard = 0
      let lastSound = -100
      let frame = 0
      const tick = () => {
        const elapsed = performance.now() - started
        const index = Math.min(frames.length - 1, Math.floor(elapsed / FRAME_MS))
        setShown(frames[index]!)
        while (heard < knocks.length && knocks[heard]!.at <= elapsed) {
          const knock = knocks[heard++]!
          if (!soundOn || knock.at - lastSound < 28) continue
          lastSound = knock.at
          const loud = Math.min(1, knock.speed / 3500)
          if (knock.kind === 'ball') clack(loud)
          else if (knock.kind === 'rail') cushion(loud)
          else drop()
        }
        if (index >= frames.length - 1) return settle(no)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      stop.current = () => {
        cancelAnimationFrame(frame)
        settle(no)
      }
    },
    [settle],
  )
  useEffect(() => () => stop.current?.(), [])

  // A new state of the game: play back the shot that led to it, unless it was just played here.
  useEffect(() => {
    const last = game.lastShot
    if (last && last.no === game.shotNo - 1 && last.shot && last.from && !played.current.has(last.no) && shown !== null) {
      played.current.add(last.no)
      playBack(last.from, last.shot, last.no)
    } else {
      if (last) played.current.add(last.no)
      // While a shot is still rolling, the end of it takes up this state.
      if (!playingNow.current) {
        setShown(game.balls)
        setSeen(game)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])

  // Aiming. The direction is kept as an angle; the shot sends it as whole numbers.
  const [angle, setAngle] = useState(0)
  const [power, setPower] = useState(0)
  const [spin, setSpin] = useState({ x: 0, y: 0 })
  const [placed, setPlaced] = useState<{ x: number; y: number } | null>(null)
  const [called, setCalled] = useState<number | null>(null)

  const myShot = !decided && mySeat !== null && game.turn === mySeat && !playing && !busy
  const shotNo = game.shotNo
  useEffect(() => {
    setPlaced(null)
    setCalled(null)
    setSpin({ x: 0, y: 0 })
  }, [shotNo])

  // With ball in hand the cue ball is wherever the player has put it (a sensible place to begin with).
  const table = useMemo(() => {
    const balls = shown ?? game.balls
    if (!myShot || !game.ballInHand) return balls
    const cue = balls.find((b) => b.n === 0)
    const start = placed ?? (game.breakShot ? HEAD_SPOT : cue ? { x: cue.x, y: cue.y } : HEAD_SPOT)
    return balls.map((b) => (b.n === 0 ? { ...b, x: start.x, y: start.y, in: false } : b))
  }, [shown, game, myShot, placed])

  // The end of the game, heard once the last ball has stopped.
  const ended = useRef(false)
  useEffect(() => {
    if (decided && !playing && !ended.current) {
      ended.current = true
      if (settings.soundOn) playRecorded([{ file: 'chime-2', volume: 0.8 }])
    }
  }, [decided, playing, settings.soundOn])

  const player = (seat: Seat) => players.find((p) => p.seat === seat)
  const bottomSeat: Seat = mySeat ?? 1
  const topSeat: Seat = bottomSeat === 1 ? 2 : 1
  const aim: Aim | null = myShot ? { dx: Math.cos(angle), dy: Math.sin(angle) } : null
  const must = targetsOf({ ...game, balls: table })
  // The 8 is a called shot.
  const needCall = myShot && game.variant === '8ball' && must.length === 1 && must[0] === 8

  const cardFor = (seat: Seat) => {
    const onTable = seen.balls.filter((b) => !b.in && b.n !== 0).map((b) => b.n).sort((a, b) => a - b)
    let label = ''
    let left: number[] = []
    if (seen.variant === '9ball') {
      const next = targetsOf(seen)
      label = seat === seen.turn && next[0] ? t('pool.nextBall') : ''
      left = seat === seen.turn ? next : []
    } else {
      const group = groupFor(seen, seat)
      label = group ? t(`pool.group.${group}`) : t('pool.openTable')
      const mine = group ? onTable.filter((n) => groupOf(n) === group) : []
      left = group ? (mine.length > 0 ? mine : onTable.includes(8) ? [8] : []) : []
    }
    return <PlayerCard player={player(seat)} seat={seat} toShoot={!(decided && !playing) && seen.turn === seat} clock={playing ? null : deadline} label={label} left={left} />
  }

  /** Shoots, with the power the cue was pulled back to (1 to 1000). */
  function shoot(power: number) {
    if (!myShot || (needCall && called === null)) return
    const cue = table.find((b) => b.n === 0)!
    if (game.ballInHand && !canPlaceCue(table, cue.x, cue.y, game.breakShot)) return
    const shot: Shot = {
      dx: Math.round(Math.cos(angle) * 1_000_000),
      dy: Math.round(Math.sin(angle) * 1_000_000),
      power: Math.round(power),
      spinX: Math.round(spin.x * 100),
      spinY: Math.round(spin.y * 100),
      ...(game.ballInHand ? { cue: { x: cue.x, y: cue.y } } : {}),
      ...(needCall && called !== null ? { pocket: called } : {}),
    }
    if (shot.dx === 0 && shot.dy === 0) return
    // Shown at once, from the same position and with the same physics the server will use.
    const no = game.shotNo
    played.current.add(no)
    playBack(table.map((b) => ({ ...b })), shot, no)
    void onShoot(shot).then((accepted) => {
      if (accepted) return
      // Refused: put the table back as the game has it.
      played.current.delete(no)
      stop.current?.()
      setShown(latest.current.balls)
      setSeen(latest.current)
    })
  }

  const foul = seen.lastShot?.result.foul
  const lastBy = seen.lastShot ? player(seen.lastShot.seat)?.name : ''
  const status = decided
    ? playing
      ? ' '
      : t('pool.status.over')
    : playing
      ? ' '
      : myShot
        ? needCall && called === null
          ? t('pool.status.callPocket')
          : game.ballInHand
            ? t(game.breakShot ? 'pool.status.breakPlace' : 'pool.status.ballInHand')
            : t('pool.status.yourShot')
        : mySeat
          ? (waitingText ?? t('pool.status.waiting', { name: player(seen.turn)?.name ?? '' }))
          : t('pool.status.turnOf', { name: player(seen.turn)?.name ?? '' })
  const nudge = (degrees: number) => setAngle((a) => a + (degrees * Math.PI) / 180)

  return (
    // Phone: the table stands upright and fills the width. Computer: it lies on its side, with
    // the controls, chat and buttons in a panel beside it.
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 lg:grid lg:h-dvh lg:max-w-none lg:grid-cols-[minmax(0,1fr)_23rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-6 lg:gap-y-3 lg:px-6 lg:py-4">
      <header className="flex items-center justify-between gap-2 lg:col-start-2 lg:row-start-1">
        <Link to="/lobby" className="flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
          {t('pool.back')}
        </Link>
        <p className="truncate font-display text-lg font-extrabold text-primary">{title}</p>
        <button type="button" className="flex min-h-11 items-center border-2 border-line bg-panel px-3 text-sm font-semibold" aria-pressed={settings.soundOn} onClick={() => settings.set({ soundOn: !settings.soundOn })}>
          {t(settings.soundOn ? 'pool.soundOn' : 'pool.soundOff')}
        </button>
      </header>

      <div className="flex flex-col gap-1.5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:justify-center">
        {!decided && !connected && (
          <div role="status" className="bg-ink px-3 py-1.5 text-center text-sm font-semibold text-surface">
            {t('app.reconnecting')}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 lg:mx-auto lg:w-full lg:max-w-[calc((100dvh-9rem)*1.78)]">
          {cardFor(bottomSeat)}
          {cardFor(topSeat)}
        </div>
        {/* The cue to pull stands beside the table: under the right thumb on a phone, on the left on a computer. */}
        <div className="flex items-stretch justify-center gap-2">
        <PowerCue
          ready={myShot}
          blocked={needCall && called === null}
          label={t('pool.power')}
          onPull={(pulled) => setPower(pulled * 1000)}
          onShoot={(pulled) => shoot(Math.max(1, Math.round(pulled * 1000)))}
          className="order-last lg:order-first"
        />
        <div
          className="min-w-0 flex-1 max-w-[calc((100dvh-20rem)*0.553)] lg:max-w-[calc((100dvh-9rem)*1.78)]"
          data-testid="pool-state"
          data-turn={game.turn}
          data-shot-no={game.shotNo}
          data-playing={playing}
          data-ball-in-hand={game.ballInHand}
          data-need-call={needCall}
          data-called={called ?? ''}
        >
          <PoolCanvas
            balls={table}
            vertical={!wide}
            aim={aim}
            power={power / 1000}
            ballInHand={myShot && game.ballInHand}
            behindHeadString={game.breakShot}
            // On an open table every ball is on; ringing all of them says nothing.
            targets={game.variant === '9ball' || game.solidsSeat !== null ? must : []}
            onAim={(next) => setAngle(Math.atan2(next.dy, next.dx))}
            onPlace={(x, y) => setPlaced({ x, y })}
            label={t('pool.tableLabel')}
            cloth={settings.poolCloth}
            guide={settings.poolGuide}
            called={myShot ? (needCall ? called : null) : playingPocket}
            canCall={needCall}
            onCall={setCalled}
          />
        </div>
        </div>
      </div>

      <aside className="flex flex-col gap-3 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:border-2 lg:border-line lg:bg-panel lg:p-4">
        <div>
          <p className="min-h-7 font-display text-base font-extrabold text-primary lg:text-lg" role="status">
            {status}
          </p>
          <p className="min-h-5 text-sm text-muted" data-testid="pool-last">
            {!playing && foul ? t(`pool.foul.${foul}`, { name: lastBy }) : ' '}
          </p>
        </div>

        {myShot && (
          <div className="flex flex-col gap-2 lg:gap-3" data-testid="pool-controls">
            <div className="flex items-center gap-3">
              {/* Where the cue strikes the ball: up for follow, down for draw, sideways for side. */}
              <button
                type="button"
                aria-label={t('pool.spin')}
                className="relative size-16 shrink-0 rounded-full border-2 border-ink bg-[#f7f5ec]"
                onPointerDown={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  const x = ((event.clientX - box.left) / box.width) * 2 - 1
                  const y = ((event.clientY - box.top) / box.height) * 2 - 1
                  const reach = Math.hypot(x, y)
                  const k = reach > 0.8 ? 0.8 / reach : 1
                  setSpin({ x: x * k, y: -y * k })
                }}
              >
                <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hibiscus" style={{ left: `${50 + spin.x * 50}%`, top: `${50 - spin.y * 50}%` }} />
              </button>
              <div className="grid flex-1 grid-cols-4 gap-1.5 *:min-h-11 *:px-0 *:text-sm">
                <Button variant="ghost" onClick={() => nudge(-2)} aria-label={t('pool.aimLeftMore')}>
                  «
                </Button>
                <Button variant="ghost" onClick={() => nudge(-0.25)} aria-label={t('pool.aimLeft')}>
                  ‹
                </Button>
                <Button variant="ghost" onClick={() => nudge(0.25)} aria-label={t('pool.aimRight')}>
                  ›
                </Button>
                <Button variant="ghost" onClick={() => nudge(2)} aria-label={t('pool.aimRightMore')}>
                  »
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted">{t('pool.howTo')}</p>
          </div>
        )}

        {children}
        <div className="mt-auto">{footer}</div>
      </aside>
    </div>
  )
}
