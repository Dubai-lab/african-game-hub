import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Button } from '@/core/ui/Button'
import { HOME, type Seat, SEATS } from './board'
import { BOARDS, type DieView, LudoBoard, useWalkingPieces } from './LudoBoard'
import { fullCountPieces, type LudoEvent, type LudoState, plays } from './rules'
import { ludoFeedback, preloadLudoSounds } from './sound'

const ROLL_MS = 550

export type TablePlayer = { name: string; flag?: string; wins?: number | null }
export type TableMove = { color: Seat; piece: number; die: number | null; full: boolean }

/** A small in-page dialog (confirm resign, the result). No browser pop-ups. */
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

/** Seconds left on the turn clock, counted down on this device from the deadline it is given. */
function TurnClock({ until }: { until: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return (
    <span
      role="timer"
      aria-label={t('ludo.clockLabel')}
      className={`min-w-10 px-2 py-1 text-center text-lg font-bold tabular-nums ${left <= 5 ? 'bg-hibiscus text-white' : 'bg-brand text-brand-ink'}`}
    >
      {left}
    </span>
  )
}

type CardProps = {
  player: TablePlayer | undefined
  seat: Seat
  colors: Seat[]
  shades: Record<Seat, string>
  home: number
  total: number
  toMove: boolean
  clock: number | null
  place: number
  left: boolean
  compact: boolean
}

function PlayerCard({ player, seat, colors, shades, home, total, toMove, clock, place, left, compact }: CardProps) {
  const { t } = useTranslation()
  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${toMove ? 'bg-panel outline-2 outline-ink' : ''} ${compact ? 'p-1' : 'p-1.5'} ${left ? 'opacity-55' : ''}`}
      data-testid={`ludo-player-${seat}`}
      data-to-move={toMove}
    >
      {/* One disc for each house the player holds. */}
      <span className="flex shrink-0 -space-x-2" aria-hidden="true">
        {colors.map((color) => (
          <span key={color} className={`${compact ? 'size-6' : 'size-9'} rounded-full border-2 border-ink`} style={{ backgroundColor: shades[color] }} />
        ))}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`flex items-baseline gap-1.5 truncate font-bold ${compact ? 'text-sm' : ''}`}>
          {player?.flag && !compact && <span aria-hidden="true">{player.flag}</span>}
          <span className="truncate">{player?.name ?? t(`ludo.color.${seat}`)}</span>
          {player?.wins != null && !compact && <span className="text-sm font-semibold tabular-nums text-muted">{t('ludo.wins', { count: player.wins })}</span>}
        </p>
        <p className={`truncate text-muted ${compact ? 'text-xs' : 'text-sm'}`} data-testid={`ludo-home-${seat}`}>
          {left ? t('ludo.leftTable') : place > 0 ? t(`ludo.place.${place}`) : t('ludo.piecesHome', { home, total })}
        </p>
      </div>
      {toMove && clock !== null && <TurnClock until={clock} />}
    </div>
  )
}

type Props = {
  title: string
  /** The table as it stands: from the server in an online game, from the practice rules otherwise. */
  state: LudoState
  players: Partial<Record<Seat, TablePlayer>>
  /** The seat of the person holding the device; null when only watching. */
  mySeat: Seat | null
  /** When the player to act must act, on this device's clock; null when there is no clock. */
  deadline: number | null
  busy: boolean
  /** Shown above the board, for example "Reconnecting". */
  notice?: ReactNode
  onRoll: () => void
  onMove: (move: TableMove) => void
  /** Chat with the other players (online games). */
  chat?: ReactNode
  /** Under everything: Resign while playing, what to do next afterwards. */
  footer?: ReactNode
  /** Dialogs. */
  children?: ReactNode
}

/** The whole Ludo screen for two to four players: cards, board, dice. Shows a table; decides nothing. */
export function LudoTable({ title, state, players, mySeat, deadline, busy, notice, onRoll, onMove, chat, footer, children }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const theme = BOARDS[settings.ludoBoard]
  const shades = Object.fromEntries(SEATS.map((seat) => [seat, theme.seat[seat].base])) as Record<Seat, string>

  // What is on screen runs a beat behind while a throw is being shown, so the dice are seen to
  // roll before the piece they move sets off.
  const [shown, setShown] = useState<LudoState>(state)
  const [rolling, setRolling] = useState(false)
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => {
    const before = shownRef.current
    const thrown = state.turnNo > before.turnNo && before.phase === 'roll' && state.lastEvent?.dice !== undefined
    if (!thrown || settings.dataSaver) {
      setRolling(false)
      return setShown(state)
    }
    setRolling(true)
    ludoFeedback('roll')
    const id = setTimeout(() => {
      setRolling(false)
      setShown(state)
    }, ROLL_MS)
    return () => clearTimeout(id)
  }, [state, settings.dataSaver])

  useEffect(preloadLudoSounds, [])

  const target = useMemo(() => shown.positions, [shown])
  const positions = useWalkingPieces(target, !settings.dataSaver, () => ludoFeedback('step'))

  const open = shown.phase !== 'over'
  const stillIn = (seat: Seat) => !shown.places.includes(seat) && !shown.gone.includes(seat)
  const myTurn = open && mySeat !== null && shown.turn === mySeat && stillIn(mySeat) && !rolling && shown.turnNo === state.turnNo
  const name = (seat: Seat) => players[seat]?.name ?? t(`ludo.color.${seat}`)
  const thrownText = (values: number[] | undefined, fallback?: number) => (values && values.length > 0 ? values : fallback ? [fallback] : []).join(' + ')

  const describe = (event: LudoEvent): string => {
    const who = name(event.seat)
    const die = thrownText(event.dice, event.die)
    if (event.left) return t('ludo.event.left', { name: who })
    if (event.forfeit) return t(shown.diceCount === 2 ? 'ludo.event.threeDoubles' : 'ludo.event.threeSixes', { name: who })
    if (event.piece === undefined && event.dice?.every((die) => die === 6)) return t('ludo.event.again', { name: who, die })
    if (event.piece === undefined) return t('ludo.event.rolled', { name: who, die })
    if (event.finished) return t('ludo.event.finished', { name: who, die })
    if (event.lay) return t('ludo.event.lay', { name: who, die })
    if (event.captured) return t('ludo.event.capture', { name: who, die })
    if (event.to === HOME) return t('ludo.event.home', { name: who, die })
    if (event.full) return t('ludo.event.full', { name: who, die, total: event.die })
    return t('ludo.event.moved', { name: who, die })
  }

  // Sounds for what just happened, and a running record of the game for the side panel.
  const heard = useRef<{ turnNo: number; winner: Seat | null; mine: boolean } | null>(null)
  const [log, setLog] = useState<{ id: number; text: string; throwOf: string }[]>([])
  const winner = shown.places[0] ?? null
  useEffect(() => {
    const last = heard.current
    heard.current = { turnNo: shown.turnNo, winner, mine: myTurn }
    if (!last) return
    if (shown.turnNo < last.turnNo) setLog([])
    if (shown.turnNo > last.turnNo && shown.lastEvent) {
      const event = shown.lastEvent
      const text = describe(event)
      // One line for each throw: what was thrown, then (in the same line) what was done with
      // it. Otherwise one turn reads like three, as if the player had gone three times.
      const throwOf = `${event.seat}:${(event.dice ?? []).join('+')}`
      setLog((lines) =>
        event.piece !== undefined && lines[0]?.throwOf === throwOf
          ? [{ ...lines[0], text }, ...lines.slice(1)]
          : [{ id: shown.turnNo, text, throwOf: event.piece === undefined ? throwOf : `${throwOf}:played` }, ...lines].slice(0, 40),
      )
      if (shown.lastEvent.captured) ludoFeedback('capture')
      else if (shown.lastEvent.to === HOME) ludoFeedback('home')
    }
    if (winner && !last.winner) return ludoFeedback(mySeat === null || winner === mySeat ? 'win' : 'lose')
    if (myTurn && !last.mine) ludoFeedback('turn')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, winner, myTurn, mySeat])

  const seated = SEATS.filter((seat) => shown.teams[seat])
  const mine = (mySeat && shown.teams[mySeat]) || []
  const bottomSeat: Seat = mySeat ?? seated[0] ?? 'red'
  // The other players, clockwise from the player's own seat.
  const others = [...SEATS, ...SEATS].slice(SEATS.indexOf(bottomSeat) + 1, SEATS.indexOf(bottomSeat) + 4).filter((seat) => shown.teams[seat])

  const card = (seat: Seat, compact: boolean) => {
    const colors = shown.teams[seat] ?? [seat]
    const all = colors.flatMap((color) => positions[color] ?? [])
    return (
      <PlayerCard
        key={seat}
        player={players[seat]}
        seat={seat}
        colors={colors}
        shades={shades}
        home={all.filter((p) => p === HOME).length}
        total={all.length}
        toMove={open && shown.turn === seat}
        clock={deadline}
        place={shown.places.indexOf(seat) + 1}
        left={shown.gone.includes(seat)}
        compact={compact}
      />
    )
  }

  // What the player can do with the dice lying there: play one of them, or (with both still
  // unplayed) take the full count on one piece. Their choice decides which pieces light up.
  const canRoll = myTurn && shown.phase === 'roll'
  const choosing = myTurn && shown.phase === 'move'
  const open_ = choosing && mySeat ? plays(shown, mySeat) : []
  const playable = [...new Set(open_.map((play) => play.die))]
  const fullPieces = choosing && mySeat ? fullCountPieces(shown, mySeat) : []
  const [picked, setPicked] = useState<number | 'full' | null>(null)
  const choice: number | 'full' | null = picked === 'full' ? (fullPieces.length > 0 ? 'full' : (playable[0] ?? null)) : picked !== null && playable.includes(picked) ? picked : (playable[0] ?? (fullPieces.length > 0 ? 'full' : null))
  const movable = choice === 'full' ? fullPieces : open_.filter((play) => play.die === choice)
  const total = shown.dice.reduce((sum, value) => sum + value, 0)
  const hasChoice = playable.length + (fullPieces.length > 0 ? 1 : 0) > 1

  // The dice as they lie in the tray: the last throw, with the ones already played marked.
  const left = [...shown.dice]
  let lifted = false
  const dice: DieView[] = Array.from({ length: Math.max(shown.diceCount, shown.rolled.length, 1) }, (_, index) => {
    const value = shown.rolled[index] ?? null
    const at = value === null ? -1 : left.indexOf(value)
    if (at >= 0) left.splice(at, 1)
    const spent = value !== null && at < 0
    const live = !spent && value !== null && choosing
    const chosen = live && hasChoice && (choice === 'full' || (value === choice && !lifted))
    if (chosen && choice !== 'full') lifted = true
    return { value, spent, chosen, pickable: live && hasChoice && playable.includes(value) }
  })

  const note = !open
    ? t('ludo.status.over')
    : rolling
      ? t('ludo.status.rolling')
      : myTurn
        ? shown.phase === 'roll'
          ? t('ludo.status.yourRoll')
          : t(hasChoice ? 'ludo.status.yourChoice' : choice === 'full' ? 'ludo.status.mustCountAll' : 'ludo.status.yourMove', { die: thrownText(shown.rolled), total })
        : mySeat && stillIn(mySeat)
          ? t('ludo.status.waiting', { name: name(shown.turn) })
          : t('ludo.status.turnOf', { name: name(shown.turn) })

  // The throw as three round buttons under the board: each die on its own, and between them
  // the two counted together. Touching one says what the next piece touched will be moved by.
  const thrownTotal = shown.rolled.reduce((sum, value) => sum + value, 0)
  const showThrow = shown.phase === 'move' && shown.rolled.length > 0 && !rolling
  const round = (size: string, color: string, on: boolean, usable: boolean, dim: boolean) =>
    `flex ${size} shrink-0 items-center justify-center rounded-full border-4 font-display font-extrabold tabular-nums text-white shadow-[inset_0_-6px_10px_rgba(0,0,0,0.28),inset_0_5px_8px_rgba(255,255,255,0.35),0_3px_6px_rgba(0,0,0,0.35)] transition-transform ${color} ${on ? 'scale-110 border-ink' : 'border-[#3a2a1c]'} ${dim ? 'opacity-35' : usable ? '' : 'opacity-70'}`
  const dieButton = (index: number, color: string) => {
    const die = dice[index]
    if (!die || die.value === null) return null
    const value = die.value
    const usable = choosing && !busy && !die.spent && playable.includes(value)
    return (
      <button
        key={index}
        type="button"
        aria-label={t('ludo.playDie', { value })}
        aria-pressed={usable && die.chosen && choice !== 'full'}
        disabled={!usable}
        data-testid="ludo-play-die"
        data-value={value}
        className={round('size-14 text-2xl', color, usable && die.chosen && choice !== 'full', usable, die.spent)}
        onClick={() => setPicked(value)}
      >
        {value}
      </button>
    )
  }

  return (
    // Phone: one column. Computer: the board takes the height of the window, with the record
    // of the game, the chat and the buttons in a panel beside it.
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-2 px-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 lg:grid lg:h-dvh lg:max-w-none lg:grid-cols-[min(calc(100dvh-13rem),calc(100vw-30rem))_24rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:justify-center lg:gap-x-8 lg:gap-y-3 lg:px-8 lg:py-4">
      <header className="flex items-center justify-between gap-2 lg:col-start-2 lg:row-start-1">
        <Link to="/lobby" className="flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
          {t('ludo.back')}
        </Link>
        <p className="truncate font-display text-lg font-extrabold text-primary">{title}</p>
        <button
          type="button"
          className="flex min-h-11 items-center border-2 border-line bg-panel px-3 text-sm font-semibold"
          aria-pressed={settings.soundOn}
          onClick={() => settings.set({ soundOn: !settings.soundOn })}
        >
          {t(settings.soundOn ? 'ludo.soundOn' : 'ludo.soundOff')}
        </button>
      </header>

      <div className="flex flex-col lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:justify-center">
        <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-19rem))] flex-col gap-1.5 lg:max-w-full">
          {notice && (
            <div role="status" className="bg-ink px-3 py-1.5 text-center text-sm font-semibold text-surface">
              {notice}
            </div>
          )}
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(others.length, 1)}, minmax(0, 1fr))` }}>
            {others.map((seat) => card(seat, others.length > 1))}
          </div>
          <LudoBoard
            positions={positions}
            bottom={mine[0] ?? shown.teams[bottomSeat]?.[0] ?? 'red'}
            mine={mine}
            movable={busy ? [] : movable}
            onMove={(color, piece) => {
              if (choice === null) return
              setPicked(null)
              onMove({ color, piece, die: choice === 'full' ? null : choice, full: choice === 'full' })
            }}
            glow={open ? (shown.teams[shown.turn] ?? []) : []}
            dice={dice}
            rolling={rolling || (busy && canRoll)}
            canRoll={canRoll && !busy}
            onRoll={onRoll}
            onPickDie={(index) => setPicked(dice[index]?.value ?? null)}
            board={settings.ludoBoard}
            flat={!settings.ludoBoard3d}
          />

          {/* What happens next, right under the board: whose turn, and the player's own choices. */}
          <div className="flex min-h-16 items-center justify-center gap-4" data-testid="ludo-turn" data-turn={shown.turn} data-phase={shown.phase} data-turn-no={shown.turnNo}>
            {showThrow ? (
              <div className="flex items-center gap-4" role="group" aria-label={t('ludo.playWith')}>
                {dieButton(0, 'bg-[#1e88c8]')}
                {dice.length > 1 && (
                  <button
                    type="button"
                    aria-label={t('ludo.fullCount', { total: thrownTotal })}
                    aria-pressed={choice === 'full'}
                    disabled={!choosing || busy || fullPieces.length === 0}
                    data-testid="ludo-full-count"
                    className={round('size-16 text-3xl', 'bg-[#d6283b]', choosing && choice === 'full', choosing && !busy && fullPieces.length > 0, false)}
                    onClick={() => setPicked('full')}
                  >
                    {thrownTotal}
                  </button>
                )}
                {dieButton(1, 'bg-[#2f9e44]')}
              </div>
            ) : (
              canRoll && (
                <Button onClick={onRoll} disabled={busy}>
                  {t('ludo.roll')}
                </Button>
              )
            )}
          </div>
          <p className="text-center font-display text-base font-extrabold text-primary lg:text-lg" role="status">
            {note}
          </p>

          {seated.includes(bottomSeat) && card(bottomSeat, false)}
        </div>
      </div>

      <aside className="flex flex-col gap-3 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:border-2 lg:border-line lg:bg-panel lg:p-4">
        {/* The game so far, newest first: every throw and what it did. */}
        <section aria-label={t('ludo.logTitle')} className="flex min-h-0 flex-col lg:flex-1">
          <h2 className="text-sm font-semibold text-muted">{t('ludo.logTitle')}</h2>
          <ol className="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto border border-line bg-surface p-2 text-sm lg:max-h-none lg:flex-1" role="log" data-testid="ludo-last">
            {log.length === 0 ? <li className="text-muted">{t('ludo.logEmpty')}</li> : log.map((line, index) => <li key={line.id} className={index === 0 ? 'font-semibold' : 'text-muted'}>{line.text}</li>)}
          </ol>
          <p className="mt-1 text-xs text-muted">
            {t('ludo.rulesLine', { dice: t('ludo.diceCount', { count: shown.diceCount }), capture: t(shown.lay ? 'ludo.rule.lay' : 'ludo.rule.stay') })}
          </p>
        </section>

        {chat}

        <div className="mt-auto">{footer}</div>
      </aside>

      {children}
    </div>
  )
}
