import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { flagEmoji } from '@/core/countries/useCountries'
import { Button } from '@/core/ui/Button'
import { ChatFold, GameBar, GameHeader, GameMenu, useChatFold, useLockedScreen } from '@/core/ui/gameScreen'
import { type Gender, PlayerFigure } from '@/core/ui/PlayerFigure'
import { feedback, preloadSounds } from '@/games/checkup/sound'
import { type Bonus, bonusAt, cell, EMPTY_BOARD, evaluate, type Laid, RACK_SIZE, type Seat, SIZE, type Tile, TILE_VALUES } from '../../../supabase/functions/_shared/words'
import { Flight, FLIGHT_SECONDS, type FlightPlan, placeOf, wantsLessMotion } from './Flight'
import { Bag, TileBack, TileFace } from './tiles'
import type { TableView } from './useWordsGame'

// The Word Battle screen: the board in the middle and the players around it, the person
// holding the phone at the bottom with their own tiles face up, everyone else at the top and
// the sides with their tiles face down. Shows a table; decides nothing. The same screen serves
// an online game (the server's table) and practice against the computer.
//
// Laying a word: touch a tile on the rack, then the square it goes on. Touch a tile just laid to
// take it back. What the turn would score is shown before it is played; whether its words are
// real words is for the judge (the server, or the word list on the phone in practice).
//
// Tiles are seen to travel: out of the bag to each rack when they are shared out and whenever
// a player draws, from a player's rack onto the board when they lay a word, and into the bag
// and out again when they swap.

export { TileFace } from './tiles'

export type TablePlayer = { seat: Seat; name: string; countryCode?: string | null; avatarUrl?: string | null; wins?: number | null; gender?: Gender | null; computer?: boolean }

/** A small in-page dialog (choose a letter, swap tiles, the rules). No browser pop-ups. */
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="max-h-[92dvh] w-full max-w-md overflow-y-auto glass rounded-t-3xl border-t border-line px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-5 sm:rounded-3xl sm:border">
        <h2 className="font-display text-2xl font-extrabold text-accent">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function TurnClock({ until }: { until: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return (
    <span role="timer" aria-label={t('words.clockLabel')} className={`px-1 text-xs font-bold tabular-nums ${left <= 10 ? 'bg-hibiscus text-white' : 'bg-brand text-brand-ink'}`} data-testid="words-clock">
      {left}
    </span>
  )
}

/** The colours of the bonus squares: the hub's own, each with its mark so colour is never the only sign. */
const BONUS_STYLE: Record<NonNullable<Bonus>, { className: string; mark: string }> = {
  DL: { className: 'bg-[#bcd0f5] text-[#1f2a7a]', mark: '2L' },
  TL: { className: 'bg-[#3d55c4] text-white', mark: '3L' },
  DW: { className: 'bg-[#f7d77a] text-[#5c4300]', mark: '2W' },
  TW: { className: 'bg-[#d1264f] text-white', mark: '3W' },
}

/** A tile the player has laid this turn and not yet played: where, and which tile of the rack. */
type Pending = { row: number; col: number; index: number; letter: string; blank: boolean }

/** Seconds between one tile setting off and the next. */
const DEAL_STEP = 0.08
const DRAW_STEP = 0.12

type Props = {
  title: string
  /** Where the arrow back leads once the game is over. */
  backTo: string
  view: TableView
  /** The tiles of the person holding the device; empty for someone only watching. */
  rack: Tile[]
  players: TablePlayer[]
  mySeat: Seat | null
  /** When the player to move must have moved, on this device's clock; null when there is no clock. */
  deadline: number | null
  /** A request is on its way: nothing more may be asked for yet. */
  busy?: boolean
  /** Shown above the table, for example "Reconnecting". */
  notice?: ReactNode
  /** A line said instead of "Waiting for…" (practice: "The computer is thinking"). */
  waitingText?: string
  /** Each resolves true when the turn was taken, false when it was refused (the tiles then stay where they were laid). */
  onPlace: (tiles: Laid[]) => Promise<boolean> | boolean
  onSwap: (tiles: Tile[]) => Promise<boolean> | boolean
  onPass: () => Promise<boolean> | boolean
  chat?: ReactNode
  chatClosed?: boolean
  chatHeard?: number
  chatSent?: number
  /** The game's own choices in the menu: leave while it is on, what to do next once it is over. */
  menu?: ReactNode
  /** Shown under the table as well as in the menu: something in it is waiting for an answer. */
  menuPinned?: boolean
  /** Dialogs. */
  children?: ReactNode
}

export function WordsTable({ title, backTo, view, rack, players, mySeat, deadline, busy = false, notice, waitingText, onPlace, onSwap, onPass, chat, chatClosed = false, chatHeard = 0, chatSent = 0, menu, menuPinned = false, children }: Props) {
  const { t } = useTranslation()
  const [dialog, setDialog] = useState<'menu' | 'rules' | 'swap' | 'blank' | null>(null)
  const chatFold = useChatFold(chatHeard, chatSent)
  useLockedScreen()
  useEffect(() => preloadSounds(), [])

  const over = view.over !== null
  const player = (seat: Seat) => players.find((p) => p.seat === seat)
  const nameOf = (seat: Seat) => (seat === mySeat ? t('words.you') : (player(seat)?.name ?? ''))
  const myTurn = !over && mySeat !== null && view.turn === mySeat && !view.out.includes(mySeat)

  // Who sits where. The person holding the phone is at the bottom; the others follow round the
  // board in the order of play: one opponent sits opposite, two sit at the sides, three sit
  // left, opposite and right.
  const bottom = mySeat ?? view.seats[0]!
  const others = view.seats.map((_, i) => view.seats[(view.seats.indexOf(bottom) + 1 + i) % view.seats.length]!).slice(0, view.seats.length - 1)
  const [leftSeat, topSeat, rightSeat] = others.length === 1 ? [undefined, others[0], undefined] : others.length === 2 ? [others[0], undefined, others[1]] : [others[0], others[1], others[2]]

  // The rack as the player has arranged it: the order of the tiles is theirs to shuffle. It
  // starts again from the server's order whenever the tiles themselves change.
  const rackKey = [...rack].sort().join('')
  const [order, setOrder] = useState<number[]>(() => rack.map((_, i) => i))
  const [pending, setPending] = useState<Pending[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  /** The square a blank is waiting to be laid on, while its letter is chosen. */
  const [blankFor, setBlankFor] = useState<{ row: number; col: number; index: number } | null>(null)
  const [swapping, setSwapping] = useState<number[]>([])
  const shownFor = useRef(`${rackKey}:${view.moveNo}`)
  // (Before the screen is drawn, so new tiles are never seen in an old arrangement.)
  useLayoutEffect(() => {
    const key = `${rackKey}:${view.moveNo}`
    if (key === shownFor.current) return
    shownFor.current = key
    setOrder(rack.map((_, i) => i))
    setPending([])
    setSelected(null)
    setSwapping([])
    // The rack is named by its tiles (rackKey): a new array holding the same tiles changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackKey, view.moveNo])

  // ---- Tiles on their way -----------------------------------------------------------------
  const root = useRef<HTMLDivElement>(null)
  const boardBox = useRef<HTMLDivElement>(null)
  const [flights, setFlights] = useState<FlightPlan[]>([])
  /** Tiles each player holds that are still in the air: not yet shown on their rack. */
  const [incoming, setIncoming] = useState<Record<Seat, number>>({})
  /** Squares whose tile is still in the air: shown empty until it lands. */
  const [arriving, setArriving] = useState<ReadonlySet<number>>(new Set())
  /** The tiles are being shared out: the bag is shown in the middle of the board. */
  const [dealing, setDealing] = useState(false)
  const inAir = useRef(new Map<number, FlightPlan>())
  const flightSeq = useRef(0)
  const land = useCallback((id: number) => {
    const plan = inAir.current.get(id)
    if (!plan) return
    inAir.current.delete(id)
    setFlights((list) => list.filter((flight) => flight.id !== id))
    if (plan.joins !== undefined) {
      const seat = plan.joins
      setIncoming((now) => ({ ...now, [seat]: Math.max(0, (now[seat] ?? 0) - 1) }))
    }
    if (plan.square !== undefined) {
      const square = plan.square
      setArriving((now) => new Set([...now].filter((at) => at !== square)))
    }
    if (inAir.current.size === 0) setDealing(false)
  }, [])

  const seen = useRef<{ moveNo: number; counts: Record<Seat, number>; rackKey: string } | null>(null)
  /** Tiles this player has drawn that their phone has not been sent yet (online, the rack follows the board). */
  const owed = useRef<{ drawn: number; wait: number } | null>(null)
  useLayoutEffect(() => {
    const find = (selector: string) => placeOf(root.current?.querySelector(selector))
    const slot = (seat: Seat, index: number) => find(`[data-slot="${seat}-${index}"]`) ?? find(`[data-seat-place="${seat}"]`)
    const bag = () => find('[data-bag-origin]')
    const launch = (plans: Omit<FlightPlan, 'id'>[]) => {
      const made = plans.map((plan) => ({ ...plan, id: ++flightSeq.current }))
      for (const plan of made) inAir.current.set(plan.id, plan)
      if (made.length > 0) setFlights((list) => [...list, ...made])
    }
    /** `count` tiles out of the bag onto the end of a rack that now holds `holds`. */
    const draw = (seat: Seat, count: number, holds: number, wait: number, from = bag(), step = DRAW_STEP) => {
      if (count <= 0 || !from) return
      const plans: Omit<FlightPlan, 'id'>[] = []
      for (let i = 0; i < count; i++) {
        const to = slot(seat, holds - count + i)
        if (!to) continue
        plans.push({ face: null, from, to, size: to.width, delay: wait + i * step, joins: seat })
        // Each tile is heard as it is set down.
        if (seat === mySeat || step === DRAW_STEP) feedback('card', wait + i * step + FLIGHT_SECONDS)
      }
      setIncoming((now) => ({ ...now, [seat]: plans.length }))
      launch(plans)
    }

    const before = seen.current
    if (before && before.moveNo === view.moveNo) {
      // The board has not moved, but this player's own new tiles have just arrived.
      if (owed.current && mySeat !== null && rackKey !== before.rackKey) {
        seen.current = { ...before, rackKey }
        draw(mySeat, Math.min(owed.current.drawn, rack.length), rack.length, 0)
        owed.current = null
      }
      return
    }

    // Something has happened. Whatever was still in the air is put down at once.
    seen.current = { moveNo: view.moveNo, counts: view.counts, rackKey }
    owed.current = null
    inAir.current.clear()
    setFlights([])
    setIncoming({})
    setArriving(new Set())
    setDealing(false)
    if (wantsLessMotion() || view.over) return

    if (!before) {
      // A game opened at its very start: the tiles are shared out, one each in turn, from the
      // bag in the middle of the board.
      if (view.moveNo !== 0 || view.board !== EMPTY_BOARD) return
      const from = placeOf(boardBox.current)
      if (!from) return
      const plans: Omit<FlightPlan, 'id'>[] = []
      const dealt: Record<Seat, number> = {}
      let nth = 0
      for (let round = 0; round < RACK_SIZE; round++) {
        for (const seat of view.seats) {
          if (round >= (view.counts[seat] ?? 0)) continue
          const to = slot(seat, round)
          if (!to) continue
          plans.push({ face: null, from, to, size: to.width, delay: 0.35 + nth * DEAL_STEP, joins: seat })
          if (seat === mySeat) feedback('card', 0.35 + nth * DEAL_STEP + FLIGHT_SECONDS)
          dealt[seat] = (dealt[seat] ?? 0) + 1
          nth++
        }
      }
      if (plans.length === 0) return
      feedback('shuffle')
      setIncoming(dealt)
      setDealing(true)
      launch(plans)
      return
    }

    const event = view.lastEvent
    if (view.moveNo !== before.moveNo + 1 || !event || (event.kind !== 'place' && event.kind !== 'swap')) return
    const seat = event.seat
    const held = before.counts[seat] ?? 0
    const holds = view.counts[seat] ?? 0
    const used = event.kind === 'place' ? (event.squares?.length ?? 0) : (event.swapped ?? 0)
    const drawn = Math.max(0, Math.min(holds, holds - (held - used)))
    let wait = 0

    if (event.kind === 'place' && seat !== mySeat) {
      // Another player's word: each tile from their rack to its square, face up.
      const squares = event.squares ?? []
      const plans: Omit<FlightPlan, 'id'>[] = []
      squares.forEach((at, i) => {
        const to = find(`[data-square="${Math.floor(at / SIZE)}-${at % SIZE}"]`)
        const from = find(`[data-seat-place="${seat}"]`)
        const letter = view.board[at]
        if (!to || !from || !letter || letter === '.') return
        plans.push({ face: { letter: letter.toLowerCase(), blank: letter !== letter.toLowerCase() }, from, to, size: to.width, delay: i * DRAW_STEP, square: at })
        feedback('card', i * DRAW_STEP + FLIGHT_SECONDS)
      })
      if (plans.length > 0) {
        setArriving(new Set(plans.map((plan) => plan.square!)))
        launch(plans)
        wait = FLIGHT_SECONDS + (plans.length - 1) * DRAW_STEP
      }
    } else if (event.kind === 'swap') {
      // Tiles put back: from the rack into the bag, face down.
      const to = bag()
      const from = find(`[data-seat-place="${seat}"]`)
      if (to && from) {
        launch(Array.from({ length: used }, (_, i) => ({ face: null, from, to, size: Math.min(28, from.width), delay: i * DRAW_STEP })))
        wait = FLIGHT_SECONDS + Math.max(0, used - 1) * DRAW_STEP
      }
    }

    // Then the tiles drawn. This player's own are flown once their phone has been sent them.
    if (seat === mySeat && (rack.length !== holds || rackKey === before.rackKey)) owed.current = { drawn, wait }
    else draw(seat, drawn, holds, wait)
    // The table is named by its move number, and the rack by its tiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.moveNo, rackKey])

  // What is heard as the game goes on: each thing that happens, once. (Tiles in the air are
  // heard as they land; these are the rest.)
  const heard = useRef(view.moveNo)
  useEffect(() => {
    if (view.moveNo === heard.current) return
    heard.current = view.moveNo
    const kind = view.lastEvent?.kind
    if (view.over) feedback('gameEnd')
    else if (kind === 'place' || kind === 'swap') {
      if (view.lastEvent?.seat === mySeat || wantsLessMotion()) feedback(kind === 'place' ? 'card' : 'market')
    } else if (kind) feedback('market')
  }, [view.moveNo, view.over, view.lastEvent, mySeat])

  const laid: Laid[] = useMemo(() => pending.map((p) => ({ row: p.row, col: p.col, letter: p.letter, ...(p.blank ? { blank: true } : {}) })), [pending])
  const preview = useMemo(() => (laid.length > 0 ? evaluate(view.board, laid) : null), [view.board, laid])
  const pendingAt = (row: number, col: number) => pending.find((p) => p.row === row && p.col === col)
  // (For the one moment between new tiles arriving and the arrangement starting again, the old
  // arrangement may name tiles that are no longer there: the plain order is shown instead.)
  const arranged = order.length === rack.length ? order : rack.map((_, i) => i)
  const onRack = arranged.filter((index) => !pending.some((p) => p.index === index))
  const lastSquares = new Set(view.lastEvent?.kind === 'place' ? (view.lastEvent.squares ?? []) : [])
  /** How many of a player's tiles are on their rack to be seen (the rest are on their way). */
  const landed = (seat: Seat, holds: number) => Math.max(0, holds - (incoming[seat] ?? 0))

  const touchSquare = (row: number, col: number) => {
    if (!myTurn || busy) return
    const there = pendingAt(row, col)
    if (there) {
      // A tile just laid: back to the rack.
      setPending((list) => list.filter((p) => p !== there))
      feedback('market')
      return
    }
    if (selected === null || rack[selected] === undefined || cell(view.board, row, col) !== '.') return
    if (rack[selected] === '?') {
      setBlankFor({ row, col, index: selected })
      setDialog('blank')
      return
    }
    setPending((list) => [...list, { row, col, index: selected, letter: rack[selected]!, blank: false }])
    setSelected(null)
    feedback('card')
  }
  const recall = () => {
    setPending([])
    setSelected(null)
  }
  const shuffle = () => setOrder((current) => [...current].sort(() => Math.random() - 0.5))
  const play = async () => {
    if (!preview?.ok || busy) return
    // The tiles stay where they are until the judge has spoken: a refused word can be changed.
    await onPlace(laid)
  }

  // What just happened, in words.
  const event = view.lastEvent
  const said = !event
    ? ''
    : event.kind === 'place'
      ? t('words.event.place', { name: nameOf(event.seat), words: (event.words ?? []).map((w) => w.word.toUpperCase()).join(', '), count: event.score ?? 0 })
      : event.kind === 'swap'
        ? t('words.event.swap', { name: nameOf(event.seat), count: event.swapped ?? 0 })
        : t(`words.event.${event.kind}`, { name: nameOf(event.seat) })

  const status = over
    ? t('words.status.over')
    : myTurn
      ? t('words.status.yourTurn')
      : mySeat !== null
        ? (waitingText ?? t('words.status.waiting', { name: nameOf(view.turn) }))
        : t('words.status.turnOf', { name: nameOf(view.turn) })
  // Under the status: what the tiles laid would score, or why they cannot be played as they lie.
  const hint = !preview ? said : preview.ok ? t('words.preview', { words: preview.words.map((w) => w.word.toUpperCase()).join(', '), count: preview.score }) : t(`words.refusal.${preview.code}`)

  /** What every place at the table says about its player, for the tests and for anything that reads the page. */
  const seatFacts = (seat: Seat) => ({
    'data-testid': `words-player-${seat}`,
    'data-to-move': !over && view.turn === seat,
    'data-score': view.scores[seat] ?? 0,
    'data-tiles': view.counts[seat] ?? 0,
  })
  const figure = (seat: Seat, className: string) => {
    const who = player(seat)
    return <PlayerFigure kind={who?.computer ? 'computer' : who?.gender} seatIndex={view.seats.indexOf(seat)} className={className} />
  }
  /** Another player's tiles, face down. Those still on their way are kept a place, unseen. */
  const backs = (seat: Seat, className: string) => {
    const holds = view.counts[seat] ?? 0
    const shown = landed(seat, holds)
    return Array.from({ length: holds }, (_, index) => (
      <span key={index} data-slot={`${seat}-${index}`} className={`block ${className} ${index < shown ? '' : 'invisible'}`}>
        <TileBack className="w-full" />
      </span>
    ))
  }

  /** The player opposite: across the top of the board. */
  const across = (seat: Seat) => {
    const who = player(seat)
    const gone = view.out.includes(seat)
    const toMove = !over && view.turn === seat
    return (
      <div className={`flex shrink-0 items-center gap-2 border px-1.5 py-1 ${toMove ? 'border-edge bg-panel' : 'border-transparent'} ${gone ? 'opacity-50' : ''}`} {...seatFacts(seat)}>
        {figure(seat, 'size-9')}
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs font-bold leading-tight">
            {who?.countryCode && <span aria-hidden="true">{flagEmoji(who.countryCode)}</span>}
            <span className="truncate">{who?.name ?? ''}</span>
            {toMove && deadline !== null && <TurnClock until={deadline} />}
          </p>
          <p className="flex items-baseline gap-1.5">
            <span className="font-display text-xl font-extrabold tabular-nums leading-none text-accent">{view.scores[seat] ?? 0}</span>
            <span className="truncate text-[0.65rem] text-muted">{gone ? t('words.out') : t('words.tiles', { count: view.counts[seat] ?? 0 })}</span>
          </p>
        </div>
        <div className="ms-auto flex shrink-0 gap-0.5" data-seat-place={seat} aria-hidden="true">
          {backs(seat, 'w-4')}
        </div>
      </div>
    )
  }
  /** A player at the side of the board: a narrow column, their tiles stacked down it. */
  const beside = (seat: Seat) => {
    const who = player(seat)
    const gone = view.out.includes(seat)
    const toMove = !over && view.turn === seat
    return (
      <div className={`flex w-9 shrink-0 flex-col items-center justify-center gap-0.5 border py-1 ${toMove ? 'border-edge bg-panel' : 'border-transparent'} ${gone ? 'opacity-50' : ''}`} {...seatFacts(seat)}>
        {figure(seat, 'size-7')}
        <p className="w-full truncate text-center text-[0.55rem] font-bold leading-tight">
          {who?.countryCode && <span aria-hidden="true">{flagEmoji(who.countryCode)} </span>}
          {who?.name ?? ''}
        </p>
        <span className="font-display text-sm font-extrabold tabular-nums leading-none text-accent">{view.scores[seat] ?? 0}</span>
        {toMove && deadline !== null && <TurnClock until={deadline} />}
        <div className="mt-0.5 flex flex-col gap-0.5" data-seat-place={seat} aria-hidden="true">
          {backs(seat, 'w-4')}
        </div>
        <span className="sr-only">{gone ? t('words.out') : t('words.tiles', { count: view.counts[seat] ?? 0 })}</span>
      </div>
    )
  }

  const bottomTurn = !over && view.turn === bottom
  const myHolds = onRack.length
  const myShown = mySeat === null ? 0 : Math.max(0, myHolds - (incoming[mySeat] ?? 0))

  return (
    // The screen is fixed: exactly as high as the phone, and it never scrolls. The board is as
    // wide as the glass allows unless the phone is too short to show it whole with the rack under it.
    <div ref={root} className="mx-auto flex h-(--app-h) w-full max-w-xl flex-col gap-1.5 overflow-hidden px-2 pb-[max(0.5rem,var(--safe-bottom))] pt-1 lg:max-w-2xl" data-testid="words-screen">
      <GameHeader title={title} over={over} backTo={backTo} />
      {notice && (
        <div role="status" className="shrink-0 bg-ink px-3 py-1.5 text-center text-sm font-semibold text-fg">
          {notice}
        </div>
      )}

      {topSeat !== undefined && across(topSeat)}

      <div className="flex min-h-0 shrink-0 items-stretch justify-center gap-1">
        {leftSeat !== undefined && beside(leftSeat)}
        <div className="flex min-w-0 flex-1 justify-center">
          <div ref={boardBox} className="relative aspect-square w-full max-w-[min(100%,calc(var(--app-h)_-_20.5rem))] self-center">
            <div
              className="grid size-full gap-px border border-edge bg-ink"
              style={{ gridTemplateColumns: `repeat(${SIZE}, minmax(0, 1fr))` }}
              role="grid"
              aria-label={t('words.boardLabel')}
              data-testid="words-board"
              data-move-no={view.moveNo}
              data-turn={view.turn}
              data-bag={view.bagCount}
              data-over={over}
            >
              {Array.from({ length: SIZE * SIZE }, (_, at) => {
                const row = Math.floor(at / SIZE)
                const col = at % SIZE
                const square = cell(view.board, row, col)
                // A tile still on its way to this square is not on it yet.
                const down = square !== '.' && !arriving.has(at)
                const mine = pendingAt(row, col)
                const bonus = bonusAt(row, col)
                const label = square !== '.' ? t('words.squareTile', { row: row + 1, col: col + 1, letter: square.toUpperCase() }) : t('words.square', { row: row + 1, col: col + 1 })
                return (
                  <button
                    key={at}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    onClick={() => touchSquare(row, col)}
                    data-square={`${row}-${col}`}
                    data-letter={square !== '.' ? square : (mine?.letter ?? '')}
                    className={`relative flex aspect-square items-center justify-center text-[clamp(0.45rem,2.6vw,0.95rem)] ${!down && !mine && bonus ? BONUS_STYLE[bonus].className : 'bg-[#e9ecf7]'}`}
                  >
                    {down ? (
                      <TileFace letter={square.toLowerCase()} blank={square !== square.toLowerCase()} className={`size-full ${lastSquares.has(at) ? 'ring-2 ring-inset ring-palm' : ''}`} small />
                    ) : mine ? (
                      <TileFace letter={mine.letter} blank={mine.blank} className="size-full ring-2 ring-inset ring-brand" small />
                    ) : bonus ? (
                      <span className="text-[58%] font-bold leading-none" aria-hidden="true">
                        {row === 7 && col === 7 ? '★' : BONUS_STYLE[bonus].mark}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {/* While the tiles are shared out, the bag stands in the middle of the board. */}
            {dealing && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true" data-testid="words-dealing">
                <Bag className="size-24 drop-shadow-[0_8px_8px_rgba(11,15,36,0.4)]" />
              </div>
            )}
          </div>
        </div>
        {rightSeat !== undefined && beside(rightSeat)}
      </div>

      {/* The bottom of the table: the player holding the phone, what is happening, and the bag. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1">
        <div className={`flex items-center gap-2 border px-1.5 py-1 ${bottomTurn ? 'border-edge bg-panel' : 'border-transparent'} ${view.out.includes(bottom) ? 'opacity-50' : ''}`} {...seatFacts(bottom)}>
          {figure(bottom, 'size-9')}
          <div className="min-w-0 shrink-0">
            <p className="flex items-center gap-1 text-xs font-bold leading-tight">
              {player(bottom)?.countryCode && <span aria-hidden="true">{flagEmoji(player(bottom)!.countryCode!)}</span>}
              <span className="max-w-24 truncate">{bottom === mySeat ? t('words.you') : (player(bottom)?.name ?? '')}</span>
              {bottomTurn && deadline !== null && <TurnClock until={deadline} />}
            </p>
            <p className="font-display text-xl font-extrabold tabular-nums leading-none text-accent">{view.scores[bottom] ?? 0}</p>
          </div>
          <p className="min-w-0 flex-1 text-center font-display text-base font-extrabold leading-tight text-accent" role="status" data-testid="words-status">
            {status}
          </p>
          <span data-bag-origin data-testid="words-bag" role="img" aria-label={t('words.bag', { count: view.bagCount })}>
            <Bag count={view.bagCount} />
          </span>
        </div>
        <p className={`min-h-5 text-center text-sm leading-tight ${preview && !preview.ok ? 'font-semibold text-alert' : 'text-muted'}`} data-testid="words-hint">
          {hint}
        </p>
      </div>

      {/* The player's own rack, and what to do with it. */}
      {mySeat !== null && !over && (
        <>
          <div className="mx-auto grid w-full max-w-sm shrink-0 grid-cols-7 gap-1" role="group" aria-label={t('words.rackLabel')} data-testid="words-rack" data-seat-place={mySeat}>
            {Array.from({ length: RACK_SIZE }, (_, place) => {
              const index = onRack[place]
              if (index === undefined) return <span key={`empty-${place}`} className="aspect-square rounded-[14%] border border-dashed border-line" aria-hidden="true" />
              const tile = rack[index]!
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => myTurn && !busy && setSelected(selected === index ? null : index)}
                  aria-pressed={selected === index}
                  aria-label={tile === '?' ? t('words.blankTile') : t('words.tile', { letter: tile.toUpperCase(), count: TILE_VALUES[tile] ?? 0 })}
                  data-tile={tile}
                  data-slot={`${mySeat}-${place}`}
                  // A tile still on its way from the bag keeps its place, unseen, until it lands.
                  className={`text-2xl transition-transform ${selected === index ? '-translate-y-2' : ''} ${myTurn ? '' : 'opacity-70'} ${place < myShown ? '' : 'invisible'}`}
                >
                  <TileFace letter={tile} className={`w-full ${selected === index ? 'ring-4 ring-brand' : ''}`} />
                </button>
              )
            })}
          </div>
          <div className="grid shrink-0 grid-cols-[1fr_1fr_1fr_1.6fr] gap-1.5 *:min-h-11 *:px-1 *:text-sm">
            <Button variant="ghost" onClick={shuffle} disabled={onRack.length < 2}>
              {t('words.shuffle')}
            </Button>
            <Button variant="ghost" onClick={() => setDialog('swap')} disabled={!myTurn || busy || view.bagCount < RACK_SIZE}>
              {t('words.swap')}
            </Button>
            {pending.length > 0 ? (
              <Button variant="ghost" onClick={recall} disabled={busy}>
                {t('words.recall')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => void onPass()} disabled={!myTurn || busy} data-testid="words-pass">
                {t('words.pass')}
              </Button>
            )}
            <Button onClick={() => void play()} disabled={!myTurn || busy || !preview?.ok} data-testid="words-play">
              {preview?.ok ? t('words.playFor', { count: preview.score }) : t('words.play')}
            </Button>
          </div>
        </>
      )}

      {chat && (
        <ChatFold open={chatFold.open} onClose={chatFold.hide}>
          {chat}
        </ChatFold>
      )}
      {menuPinned && <div className="shrink-0">{menu}</div>}

      <GameBar onMenu={() => setDialog('menu')} chat={chat ? { closed: chatClosed, news: chatFold.news, onOpen: chatFold.show } : null} />

      {flights.map((plan) => (
        <Flight key={plan.id} plan={plan} onDone={land} />
      ))}

      {dialog === 'menu' && (
        <GameMenu onClose={() => setDialog(null)}>
          {menu && <div onClick={() => setDialog(null)}>{menu}</div>}
          <Button variant="ghost" onClick={() => setDialog('rules')}>
            {t('gameMenu.rules')}
          </Button>
        </GameMenu>
      )}

      {dialog === 'blank' && blankFor && (
        <Sheet title={t('words.blankTitle')} onClose={() => setDialog(null)}>
          <p className="mt-1 text-muted">{t('words.blankBody')}</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5" role="group" aria-label={t('words.blankTitle')}>
            {[...'abcdefghijklmnopqrstuvwxyz'].map((letter) => (
              <button
                key={letter}
                type="button"
                aria-label={letter.toUpperCase()}
                data-letter={letter}
                onClick={() => {
                  setPending((list) => [...list, { ...blankFor, letter, blank: true }])
                  setSelected(null)
                  setBlankFor(null)
                  setDialog(null)
                  feedback('card')
                }}
                className="text-xl"
              >
                <TileFace letter={letter} blank className="w-full" />
              </button>
            ))}
          </div>
          <Button variant="ghost" className="mt-4 w-full" onClick={() => setDialog(null)}>
            {t('gameMenu.cancel')}
          </Button>
        </Sheet>
      )}

      {dialog === 'swap' && (
        <Sheet title={t('words.swapTitle')} onClose={() => setDialog(null)}>
          <p className="mt-1 text-muted">{t('words.swapBody')}</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5" role="group" aria-label={t('words.swapTitle')}>
            {rack.map((tile, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={swapping.includes(index)}
                aria-label={tile === '?' ? t('words.blankTile') : tile.toUpperCase()}
                onClick={() => setSwapping((list) => (list.includes(index) ? list.filter((i) => i !== index) : [...list, index]))}
                className={`text-2xl transition-transform ${swapping.includes(index) ? '-translate-y-1.5' : ''}`}
              >
                <TileFace letter={tile} className={`w-full ${swapping.includes(index) ? 'ring-4 ring-brand' : ''}`} />
              </button>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('gameMenu.cancel')}
            </Button>
            <Button
              disabled={swapping.length === 0 || busy}
              data-testid="words-swap-confirm"
              onClick={() => {
                const tiles = swapping.map((index) => rack[index]!)
                setDialog(null)
                setPending([])
                void onSwap(tiles)
              }}
            >
              {t('words.swapConfirm', { count: swapping.length })}
            </Button>
          </div>
        </Sheet>
      )}

      {dialog === 'rules' && (
        <Sheet title={t('words.rules.title')} onClose={() => setDialog(null)}>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {(t('words.rules.lines', { returnObjects: true }) as string[]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Button className="mt-4 w-full" onClick={() => setDialog(null)}>
            {t('common.close')}
          </Button>
        </Sheet>
      )}

      {children}
    </div>
  )
}

/** Once it is over: each player's final score, and the tiles they were left with. */
export function FinalScores({ view, players, mySeat }: { view: TableView; players: TablePlayer[]; mySeat: Seat | null }) {
  const { t } = useTranslation()
  if (!view.over) return null
  const scores = view.over.scores
  const order = [...view.seats].filter((seat) => !view.out.includes(seat)).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
  return (
    <ul className="flex flex-col gap-2" data-testid="words-final">
      {order.map((seat) => (
        <li key={seat} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-sm font-bold">{seat === mySeat ? t('words.you') : (players.find((p) => p.seat === seat)?.name ?? '')}</span>
          <span className="flex min-w-0 flex-1 gap-0.5 text-xs">
            {(view.over?.racks?.[seat] ?? []).map((tile, index) => (
              <TileFace key={`${tile}-${index}`} letter={tile} className="w-5 shrink-0" small />
            ))}
          </span>
          <span className="w-10 shrink-0 text-end font-display text-xl font-extrabold tabular-nums" data-testid={`words-final-${seat}`}>
            {scores[seat] ?? 0}
          </span>
        </li>
      ))}
    </ul>
  )
}
