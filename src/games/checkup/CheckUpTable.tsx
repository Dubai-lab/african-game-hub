import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { flagEmoji } from '@/core/countries/useCountries'
import { Avatar } from '@/core/ui/Avatar'
import { type Gender, PlayerFigure } from '@/core/ui/PlayerFigure'
import { Button } from '@/core/ui/Button'
import { ChatFold, GameBar, GameHeader, GameMenu, useChatFold, useLockedScreen } from '@/core/ui/gameScreen'
import { canPlay, type Card, handTotal, isWhot, numberOf, SHAPES, type Seat, type Shape, shapeOf } from '../../../supabase/functions/_shared/checkup'
import { CardBack, CardFace, SHAPE_COLOR, ShapeMark } from './cards'
import { centreOf, Flight, FLIGHT_SECONDS, type FlightPlan, wantsLessMotion } from './Flight'
import { feedback, preloadSounds } from './sound'
import type { TableView } from './useCheckUpGame'

// The Check Up screen: the other players across the top, the market and the card to play on in
// the middle, the player's own hand under them. Shows a table; decides nothing. The same
// screen serves an online game (the server's table) and practice against the computer.

export type TablePlayer = { seat: Seat; name: string; countryCode?: string | null; avatarUrl?: string | null; wins?: number | null; gender?: Gender | null; computer?: boolean }

/** A small in-page dialog (confirm leaving, call a shape, the rules). No browser pop-ups. */
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
    <span role="timer" aria-label={t('checkup.clockLabel')} className={`min-w-8 px-1.5 py-0.5 text-center text-sm font-bold tabular-nums ${left <= 5 ? 'bg-hibiscus text-white' : 'bg-brand text-brand-ink'}`} data-testid="checkup-clock">
      {left}
    </span>
  )
}

type Props = {
  title: string
  /** Where the arrow back leads once the game is over. */
  backTo: string
  view: TableView
  /** The cards of the person holding the device; empty for someone only watching. */
  hand: Card[]
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
  onPlay: (card: Card, call?: Shape) => void
  onDraw: () => void
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

export function CheckUpTable({ title, backTo, view, hand, players, mySeat, deadline, busy = false, notice, waitingText, onPlay, onDraw, chat, chatClosed = false, chatHeard = 0, chatSent = 0, menu, menuPinned = false, children }: Props) {
  const { t } = useTranslation()
  const [dialog, setDialog] = useState<'menu' | 'rules' | 'call' | null>(null)
  const chatFold = useChatFold(chatHeard, chatSent)
  useLockedScreen()
  useEffect(() => preloadSounds(), [])

  const over = view.over !== null
  const player = (seat: Seat) => players.find((p) => p.seat === seat)
  const nameOf = (seat: Seat) => (seat === mySeat ? t('checkup.you') : (player(seat)?.name ?? ''))
  const myTurn = !over && mySeat !== null && view.turn === mySeat && !view.out.includes(mySeat)
  const others = view.seats.filter((seat) => seat !== mySeat)
  // Someone watching has no hand of their own: every player is shown across the top.
  const shapeName = (shape: Shape) => t(`checkup.shape.${shape}`)
  const cardName = (card: Card) => (isWhot(card) ? t('checkup.card.wild') : t('checkup.card.plain', { shape: shapeName(shapeOf(card)!), number: numberOf(card) }))

  // What is seen and heard as the game goes on, each thing once: a hand carries the card from
  // the player to the pile, or from the market to the player, and the card is heard landing.
  const tableRef = useRef<HTMLDivElement>(null)
  const [flights, setFlights] = useState<FlightPlan[]>([])
  const flightSeq = useRef(0)
  const landed = useCallback((id: number) => setFlights((list) => list.filter((flight) => flight.id !== id)), [])
  /** While a played card is still in the air, the pile shows the card it will land on. */
  const [pileShows, setPileShows] = useState<{ card: Card; called: Shape | null } | null>(null)
  const seen = useRef({ moveNo: view.moveNo, top: view.top, called: view.called })
  /** This player's own card, flown the moment it was pressed: not flown again when the server confirms it. */
  const flownEarly = useRef<string | null>(null)
  useLayoutEffect(() => {
    const before = seen.current
    if (view.moveNo === before.moveNo) return
    seen.current = { moveNo: view.moveNo, top: view.top, called: view.called }
    const happened = view.lastEvent
    // Going back (the server refused the card this player pressed) shows nothing new.
    if (!happened || view.moveNo < before.moveNo) {
      flownEarly.current = null
      return
    }
    const early = !Number.isInteger(view.moveNo)
    const key = `${happened.seat}:${happened.card ?? ''}`
    const repeat = happened.kind === 'play' && !early && flownEarly.current === key
    flownEarly.current = early ? key : null

    const root = tableRef.current
    const still = wantsLessMotion() || !root
    const place = (seat: Seat) => centreOf(seat === mySeat ? root?.querySelector('[data-testid="checkup-hand"]') : root?.querySelector(`[data-testid="checkup-player-${seat}"]`))
    const market = centreOf(root?.querySelector('[data-testid="checkup-market"]'))
    const pile = centreOf(root?.querySelector('[data-testid="checkup-pile"]'))
    const plans: FlightPlan[] = []
    const fly = (seat: Seat, card: Card | null, from: ReturnType<typeof centreOf>, to: ReturnType<typeof centreOf>, delay: number) => {
      if (!still && from && to) plans.push({ id: ++flightSeq.current, card, from, to, delay, seatIndex: Math.max(0, view.seats.indexOf(seat)), fromTop: seat !== mySeat })
    }

    let after = 0
    if (happened.kind === 'play' && happened.card && !repeat) {
      fly(happened.seat, happened.card, place(happened.seat), pile, 0)
      feedback('card', still ? 0 : FLIGHT_SECONDS * 0.85)
      if (!still && pile) {
        setPileShows({ card: before.top, called: before.called })
        setTimeout(() => setPileShows(null), FLIGHT_SECONDS * 900)
      }
      after = FLIGHT_SECONDS * 0.7
    }
    // General market: everyone else draws one, one after the other.
    for (const seat of happened.market ?? []) {
      fly(seat, null, market, place(seat), after)
      feedback('market', after + 0.05)
      after += 0.16
    }
    if (happened.kind === 'draw' || happened.kind === 'timeout') {
      // Up to three cards are shown going, however many were picked: the count is in words.
      for (let i = 0; i < Math.min(happened.drew ?? 0, 3); i++) {
        fly(happened.seat, null, market, place(happened.seat), i * 0.14)
        feedback('market', i * 0.14 + 0.05)
      }
    }
    if (view.over) feedback('gameEnd', after + (still ? 0 : FLIGHT_SECONDS))
    if (plans.length > 0) setFlights((list) => [...list, ...plans])
  }, [view, mySeat])
  // The pack is heard being shuffled as a game begins.
  useEffect(() => {
    if (view.moveNo === 0 && !view.over) feedback('shuffle')
    // Once, when the table is first shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const warned = useRef(false)
  useEffect(() => {
    if (!myTurn || deadline === null) return
    warned.current = false
    const id = setInterval(() => {
      if (!warned.current && deadline - Date.now() < 6000) {
        warned.current = true
        feedback('lowTime')
      }
    }, 500)
    return () => clearInterval(id)
  }, [myTurn, deadline, view.moveNo])

  const tap = (card: Card) => {
    if (!myTurn || busy) return
    if (!canPlay(view, card)) return feedback('refused')
    if (isWhot(card)) return setDialog('call')
    onPlay(card)
  }

  // What just happened, in words.
  const event = view.lastEvent
  const said = !event
    ? ''
    : event.kind === 'play'
      ? [
          t('checkup.event.play', { name: nameOf(event.seat), card: cardName(event.card!) }),
          event.call ? t('checkup.event.call', { shape: shapeName(event.call) }) : '',
          event.skipped ? t('checkup.event.skipped', { name: nameOf(event.skipped) }) : '',
          event.market ? t('checkup.event.generalMarket') : '',
        ]
          .filter(Boolean)
          .join(' ')
      : event.kind === 'out'
        ? t('checkup.event.out', { name: nameOf(event.seat) })
        : t(event.kind === 'timeout' ? 'checkup.event.timeout' : 'checkup.event.draw', { name: nameOf(event.seat), count: event.drew ?? 0 })

  const status = over
    ? t('checkup.status.over')
    : myTurn
      ? view.pending
        ? t('checkup.status.pick', { count: view.pending.count, number: view.pending.number })
        : t('checkup.status.yourTurn')
      : mySeat !== null
        ? (waitingText ?? t('checkup.status.waiting', { name: nameOf(view.turn) }))
        : t('checkup.status.turnOf', { name: nameOf(view.turn) })

  const seatCard = (seat: Seat) => {
    const who = player(seat)
    const count = view.counts[seat] ?? 0
    const gone = view.out.includes(seat)
    const toMove = !over && view.turn === seat
    return (
      <div key={seat} className={`flex min-w-0 flex-1 items-center gap-2 border px-2 py-1.5 ${toMove ? 'border-edge bg-panel' : 'border-transparent'} ${gone ? 'opacity-50' : ''}`} data-testid={`checkup-player-${seat}`} data-to-move={toMove} data-cards={count}>
        {/* Their photo when they have one; otherwise their figure, wearing the colour of their seat. */}
        <Avatar url={who?.avatarUrl ?? null} name={who?.name ?? '?'} className="size-9" fallback={<PlayerFigure kind={who?.computer ? 'computer' : who?.gender} seatIndex={Math.max(0, view.seats.indexOf(seat))} className="size-9" />} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">
            {who?.countryCode && <span aria-hidden="true">{flagEmoji(who.countryCode)} </span>}
            {who?.name ?? ''}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            {gone ? t('checkup.out') : t('checkup.cards', { count })}
            {!gone && !over && count === 1 && <span className="bg-hibiscus px-1 font-bold text-white">{t('checkup.lastCard')}</span>}
          </p>
        </div>
        {toMove && deadline !== null && <TurnClock until={deadline} />}
      </div>
    )
  }

  // The hand is sorted so that cards of a shape sit together; the cards that may be played now
  // stand a little higher than the rest.
  const sorted = [...hand].sort((a, b) => (isWhot(a) ? 1 : 0) - (isWhot(b) ? 1 : 0) || SHAPES.indexOf(shapeOf(a) ?? 'c') - SHAPES.indexOf(shapeOf(b) ?? 'c') || numberOf(a) - numberOf(b))
  const leading = view.called ?? shapeOf(view.top)
  // The card shown on the pile: the one a card in the air is about to land on, until it lands.
  const pile = pileShows ?? { card: view.top, called: view.called }

  return (
    // The screen is fixed: exactly as high as the phone, and it never scrolls. If the hand grows
    // too long for its row, the row scrolls sideways and nothing else moves.
    <div ref={tableRef} className="mx-auto flex h-(--app-h) w-full max-w-xl flex-col gap-2 overflow-hidden px-3 pb-[max(0.5rem,var(--safe-bottom))] pt-1 lg:max-w-3xl" data-testid="checkup-screen">
      {flights.map((plan) => (
        <Flight key={plan.id} plan={plan} onDone={landed} />
      ))}
      <GameHeader title={title} over={over} backTo={backTo} />
      {notice && (
        <div role="status" className="shrink-0 bg-ink px-3 py-1.5 text-center text-sm font-semibold text-fg">
          {notice}
        </div>
      )}

      {/* The other players. */}
      <div className="flex shrink-0 gap-1.5">{others.map(seatCard)}</div>

      {/* The middle of the table: the market to draw from, and the card to play on. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-[#0b7a55]/10 px-2 py-2" data-testid="checkup-table" data-turn={view.turn} data-move-no={view.moveNo} data-top={view.top} data-called={view.called ?? ''} data-pending={view.pending?.count ?? 0} data-market={view.marketCount} data-over={over}>
        <div className="flex items-end justify-center gap-5">
          <button
            type="button"
            onClick={onDraw}
            disabled={!myTurn || busy}
            aria-label={view.pending ? t('checkup.pickLabel', { count: view.pending.count }) : t('checkup.marketLabel', { count: view.marketCount })}
            className="relative flex flex-col items-center gap-1 disabled:opacity-60"
            data-testid="checkup-market"
          >
            <span className="relative block w-[4.25rem]">
              <CardBack className="block w-full translate-x-1 translate-y-1 opacity-70" />
              <CardBack className={`absolute inset-0 block w-full rounded-md ${myTurn && !busy ? 'shadow-[0_0_0_3px_var(--color-brand)]' : ''}`} />
            </span>
            <span className="text-xs font-bold">{t('checkup.market', { count: view.marketCount })}</span>
          </button>
          <div className="flex flex-col items-center gap-1">
            <span data-testid="checkup-pile">
              <CardFace card={pile.card} className="block w-[5.5rem] drop-shadow-md" />
            </span>
            <span className="flex min-h-5 items-center gap-1 text-xs font-bold" data-testid="checkup-leading">
              {pile.called ? (
                <>
                  {t('checkup.called')}
                  <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
                    <ShapeMark shape={pile.called} cx={10} cy={10} size={15} />
                  </svg>
                  <span style={{ color: SHAPE_COLOR[pile.called] }}>{shapeName(pile.called)}</span>
                </>
              ) : (
                <span className="sr-only">{cardName(view.top)}</span>
              )}
            </span>
          </div>
        </div>
        <p className="min-h-6 text-center font-display text-base font-extrabold text-accent" role="status" data-testid="checkup-status">
          {status}
        </p>
        <p className="min-h-5 text-center text-sm text-muted" data-testid="checkup-last">
          {said}
        </p>
        {myTurn && (
          <Button variant="ghost" onClick={onDraw} disabled={busy} className="min-h-10 px-4 text-sm" data-testid="checkup-draw">
            {view.pending ? t('checkup.pick', { count: view.pending.count }) : t('checkup.goToMarket')}
          </Button>
        )}
      </div>

      {/* The player's own seat and hand. */}
      {mySeat !== null && <div className="flex shrink-0">{seatCard(mySeat)}</div>}
      {mySeat !== null && (
        // Every card is on show, whatever their number: with a few they stand side by side, and
        // as the hand grows they close up and overlap, each still showing its number and shape.
        <div className="flex shrink-0 items-end pb-1 pe-[4rem] pt-3" role="group" aria-label={t('checkup.handLabel')} data-testid="checkup-hand">
          {sorted.length === 0 && <p className="min-h-20 py-6 text-sm text-muted">{over ? '' : t('checkup.noCards')}</p>}
          {sorted.map((card, index) => {
            const allowed = myTurn && canPlay(view, card)
            return (
              <button
                key={`${card}-${index}`}
                type="button"
                onClick={() => tap(card)}
                aria-label={cardName(card)}
                aria-disabled={!allowed}
                data-card={card}
                data-playable={allowed}
                // The slot a card stands in may be narrower than the card: the next card then
                // covers its right-hand side. (The last card has the room kept for it above.)
                className={`min-w-0 max-w-[4.25rem] flex-1 basis-0 text-start transition-transform ${allowed ? '-translate-y-2.5' : myTurn ? 'brightness-75 saturate-50' : ''}`}
              >
                <CardFace card={card} className="block w-[4rem] max-w-none" />
              </button>
            )
          })}
        </div>
      )}

      {chat && (
        <ChatFold open={chatFold.open} onClose={chatFold.hide}>
          {chat}
        </ChatFold>
      )}
      {menuPinned && <div className="shrink-0">{menu}</div>}

      <GameBar onMenu={() => setDialog('menu')} chat={chat ? { closed: chatClosed, news: chatFold.news, onOpen: chatFold.show } : null} />

      {dialog === 'menu' && (
        <GameMenu onClose={() => setDialog(null)}>
          {menu && <div onClick={() => setDialog(null)}>{menu}</div>}
          <Button variant="ghost" onClick={() => setDialog('rules')}>
            {t('gameMenu.rules')}
          </Button>
        </GameMenu>
      )}

      {dialog === 'call' && (
        <Sheet title={t('checkup.callTitle')} onClose={() => setDialog(null)}>
          <p className="mt-1 text-muted">{t('checkup.callBody')}</p>
          <div className="mt-4 grid grid-cols-5 gap-2" role="group" aria-label={t('checkup.callTitle')}>
            {SHAPES.map((shape) => (
              <button
                key={shape}
                type="button"
                onClick={() => {
                  setDialog(null)
                  onPlay(hand.find(isWhot)!, shape)
                }}
                aria-label={shapeName(shape)}
                data-shape={shape}
                className={`flex aspect-square flex-col items-center justify-center gap-1 border bg-surface ${shape === leading ? 'border-line' : 'border-edge'}`}
              >
                <svg viewBox="0 0 30 30" className="size-9" aria-hidden="true">
                  <ShapeMark shape={shape} cx={15} cy={15} size={22} />
                </svg>
                <span className="text-[0.65rem] font-bold">{hand.filter((card) => shapeOf(card) === shape).length}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{t('checkup.callHint')}</p>
          <Button variant="ghost" className="mt-4 w-full" onClick={() => setDialog(null)}>
            {t('gameMenu.cancel')}
          </Button>
        </Sheet>
      )}

      {dialog === 'rules' && (
        <Sheet title={t('checkup.rules.title')} onClose={() => setDialog(null)}>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {(t('checkup.rules.lines', { returnObjects: true }) as string[]).map((line) => (
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

/** Once the cards are counted: what each player held, and what it came to. */
export function FinalHands({ view, players, mySeat }: { view: TableView; players: TablePlayer[]; mySeat: Seat | null }) {
  const { t } = useTranslation()
  const hands = view.over?.hands
  if (!hands) return null
  return (
    <ul className="flex flex-col gap-2" data-testid="checkup-final">
      {view.seats
        .filter((seat) => !view.out.includes(seat))
        .map((seat) => (
          <li key={seat} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-sm font-bold">{seat === mySeat ? t('checkup.you') : (players.find((p) => p.seat === seat)?.name ?? '')}</span>
            <span className="no-scrollbar flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
              {(hands[seat] ?? []).map((card, index) => (
                <CardFace key={`${card}-${index}`} card={card} className="block w-7 shrink-0" />
              ))}
            </span>
            <span className="w-9 shrink-0 text-end font-display text-lg font-extrabold tabular-nums" data-testid={`checkup-total-${seat}`}>
              {handTotal(hands[seat] ?? [])}
            </span>
          </li>
        ))}
    </ul>
  )
}
