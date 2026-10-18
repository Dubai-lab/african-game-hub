// One Africa Life: journeys. On the life's page: the passport, tickets to buy and to board, a
// hotel to book, and, once on the way, the flight in the air, the arrivals hall (in 3D at
// Roberts International; the officer's desk on its own at Kotoka, until that hall is built),
// and being held for the flight back after a refusal.
//
// Every step is the server's (the oal-travel Edge Function): the app sends what the player
// chooses and shows what the server says. The officer's questions are asked here; the answers go
// to the server, which checks them and decides (supabase/functions/_shared/oalBorder.ts).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { type Appearance, gameTime } from '../../../supabase/functions/_shared/oal'
import { addDays, type Answers, OCCUPATIONS, type Occupation, PURPOSES, type Purpose, type Reason } from '../../../supabase/functions/_shared/oalBorder'
import type { Stick } from './ArrivalsScene'

const ArrivalsScene = lazy(() => import('./ArrivalsScene'))

type Country = 'LR' | 'GH'
type Trip = { id: number; kind: 'ticket' | 'removal'; flight: string; from: string; to: string; departs_at: string; arrives_at: string }
export type TravelState = { state: 'settled' | 'in_flight' | 'arrivals' | 'cleared' | 'held'; place: string; country: Country; game_now: string; trip: Trip | null }
type Airport = { code: string; name: string; country: Country; town: string }
type Flight = { code: string; airline: string; from_airport: string; to_airport: string; departs: string; minutes: number; fare: number }
type Hotel = { id: string; country: Country; town: string; name: string; area: string; nightly: number }
type Ticket = { id: number; flight_code: string; flies_on: string; status: 'booked' | 'boarded' | 'missed' }
type Booking = { id: number; hotel_id: string; reference: string; from_date: string; nights: number }
type Passport = { country: Country; number: string; issued_on: string; expires_on: string }

const usd = (cents: number, language: string) => `US$${(cents / 100).toLocaleString(language, { maximumFractionDigits: 0 })}`
/** The game's dates and times (stored without a zone, in GMT) as moments. */
const at = (stamp: string) => new Date(`${stamp.replace(' ', 'T').slice(0, 19)}Z`)
const departure = (flight: Flight, on: string) => at(`${on}T${flight.departs}`)

/**
 * The game's clock as the server keeps it: the app's own reckoning (gameTime) corrected by how far
 * it was from the server's when the server last answered.
 */
export function useGameNow(): () => Date {
  const travel = useTravel()
  const offset = travel.data ? at(travel.data.game_now).getTime() - gameTime(travel.dataUpdatedAt).getTime() : 0
  return () => new Date(gameTime(Date.now()).getTime() + offset)
}

/** Where the life is, after the server has applied time's changes. Checked often while travelling. */
export function useTravel() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-travel', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const reply = await callFunction<TravelState>('oal-travel', { action: 'state' })
      if (!reply.ok) throw new Error(reply.code)
      return reply as TravelState
    },
    refetchInterval: (query) => {
      const s = query.state.data?.state
      return s === 'in_flight' || s === 'held' ? 5000 : 30000
    },
    refetchOnWindowFocus: true,
  })
}

function useCatalogue() {
  return useQuery({
    queryKey: ['oal-catalogue'],
    staleTime: Infinity,
    queryFn: async () => {
      const [airports, flights, hotels] = await Promise.all([
        supabase.from('oal_airports').select('*'),
        supabase.from('oal_flights').select('*').order('departs'),
        supabase.from('oal_hotels').select('*').order('nightly'),
      ])
      for (const r of [airports, flights, hotels]) if (r.error) throw r.error
      return { airports: airports.data as Airport[], flights: flights.data as Flight[], hotels: hotels.data as Hotel[] }
    },
  })
}

function useMine() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-papers', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const [passport, tickets, bookings] = await Promise.all([
        supabase.from('oal_passports').select('country, number, issued_on, expires_on').eq('user_id', user!.id).maybeSingle(),
        supabase.from('oal_tickets').select('id, flight_code, flies_on, status').eq('user_id', user!.id).order('flies_on'),
        supabase.from('oal_bookings').select('id, hotel_id, reference, from_date, nights').eq('user_id', user!.id).order('from_date'),
      ])
      for (const r of [passport, tickets, bookings]) if (r.error) throw r.error
      return { passport: passport.data as Passport | null, tickets: tickets.data as Ticket[], bookings: bookings.data as Booking[] }
    },
  })
}

/** Runs a journey step on the server and refreshes what it changes. */
function useStep() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const run = async <T,>(body: Record<string, unknown>): Promise<(T & { ok: true }) | null> => {
    setBusy(true)
    try {
      const reply = await callFunction<T>('oal-travel', body)
      if (!reply.ok) {
        toast.error(refusalMessage(reply.code))
        return null
      }
      return reply as T & { ok: true }
    } catch {
      toast.error(t('errors.offline'))
      return null
    } finally {
      setBusy(false)
      // The answer is shown at once; what it changed is fetched again behind it.
      for (const key of ['oal-travel', 'oal-papers', 'oal-money']) void queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
  return { run, busy }
}

// ---- Settled: papers, tickets, hotels ------------------------------------------------------

export function Travel({ travel }: { travel: TravelState }) {
  const { t, i18n } = useTranslation()
  const catalogue = useCatalogue()
  const mine = useMine()
  const { run, busy } = useStep()
  const [day, setDay] = useState(0)
  const [hotelFrom, setHotelFrom] = useState(0)
  const [nights, setNights] = useState(3)
  if (catalogue.isPending || mine.isPending) return <Skeleton className="h-48" />
  if (catalogue.isError || mine.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>

  const { airports, flights, hotels } = catalogue.data
  const { passport, tickets, bookings } = mine.data
  const now = at(travel.game_now)
  const today = travel.game_now.slice(0, 10)
  const airportOf = (code: string) => airports.find((a) => a.code === code)
  const here = airports.find((a) => a.country === travel.country)
  // Every route, the ones from here first: a ticket home is bought before leaving.
  const fromHere = [...flights].sort((a, b) => Number(b.from_airport === here?.code) - Number(a.from_airport === here?.code))
  const date = addDays(today, day)
  const dateLabel = (d: string) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at(`${d}T12:00`))
  const time = (d: Date) => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
  const abroad = hotels.filter((h) => h.country !== travel.country)
  const open = tickets.filter((x) => x.status === 'booked')

  return (
    <div className="flex flex-col gap-4" data-testid="oal-travel">
      <section className="border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-muted">{t('oal.travel.passport')}</h2>
        {passport ? (
          <p>
            <span className="font-display text-xl font-extrabold">{t(`oal.countries.${passport.country}`)}</span> · <span className="tabular-nums">{passport.number}</span>
            <br />
            <span className="text-sm text-muted">{t('oal.travel.expires', { date: new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(at(`${passport.expires_on}T12:00`)) })}</span>
          </p>
        ) : (
          <p className="text-muted">{t('oal.travel.noPassport')}</p>
        )}
      </section>

      <section className="border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-muted">{t('oal.travel.flights', { airport: here?.name ?? '' })}</h2>
        {here && travel.place !== here.town && <p className="mt-1 text-sm text-warn">{t('oal.travel.farFromAirport', { town: here.town })}</p>}
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
          {Array.from({ length: 10 }, (_, i) => (
            <button key={i} type="button" onClick={() => setDay(i)} aria-pressed={day === i} className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-bold ${day === i ? 'bg-brand text-brand-ink' : 'border border-line'}`}>
              {dateLabel(addDays(today, i))}
            </button>
          ))}
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {fromHere.map((f) => {
            const leaves = departure(f, date)
            const gone = leaves.getTime() - now.getTime() < 3600_000
            const to = airportOf(f.to_airport)
            const from = airportOf(f.from_airport)
            return (
              <li key={f.code} className="flex items-center justify-between gap-2 border-t border-line pt-2">
                <span>
                  <span className="font-bold">
                    {time(leaves)} {from?.town} → {to?.town}
                  </span>
                  <br />
                  <span className="text-sm text-muted">
                    {f.airline} {f.code} · {t('oal.travel.duration', { h: Math.floor(f.minutes / 60), m: f.minutes % 60 })} · {usd(f.fare, i18n.language)}
                  </span>
                </span>
                <Button disabled={busy || gone} onClick={() => void run({ action: 'book_flight', flight: f.code, date }).then((r) => r && toast.success(t('oal.travel.booked')))} data-testid={`oal-book-${f.code}`}>
                  {t('oal.travel.buy')}
                </Button>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">{t('oal.travel.fareHint')}</p>
      </section>

      {open.length > 0 && (
        <section className="border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold text-muted">{t('oal.travel.tickets')}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {open.map((ticket) => {
              const f = flights.find((x) => x.code === ticket.flight_code)!
              const leaves = departure(f, ticket.flies_on)
              const opens = leaves.getTime() - 3 * 3600_000
              const closes = leaves.getTime() - 30 * 60_000
              const window = now.getTime() >= opens && now.getTime() <= closes
              return (
                <li key={ticket.id} className="flex items-center justify-between gap-2 border-t border-line pt-2">
                  <span>
                    <span className="font-bold">
                      {airportOf(f.from_airport)?.town} → {airportOf(f.to_airport)?.town}
                    </span>
                    <br />
                    <span className="text-sm text-muted">
                      {dateLabel(ticket.flies_on)} {time(leaves)} · {f.code} · {t('oal.travel.boarding', { from: time(new Date(opens)), to: time(new Date(closes)) })}
                    </span>
                  </span>
                  <Button disabled={busy || !window} onClick={() => void run({ action: 'board', ticket_id: ticket.id })} data-testid={`oal-board-${ticket.id}`}>
                    {t('oal.travel.board')}
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-muted">{t('oal.travel.hotels')}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            {t('oal.travel.from')}
            <select value={hotelFrom} onChange={(e) => setHotelFrom(Number(e.target.value))} className="min-h-11 rounded-xl border border-line bg-panel px-2">
              {Array.from({ length: 14 }, (_, i) => (
                <option key={i} value={i}>
                  {dateLabel(addDays(today, i))}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            {t('oal.travel.nights')}
            <select value={nights} aria-label={t('oal.travel.nights')} onChange={(e) => setNights(Number(e.target.value))} className="min-h-11 rounded-xl border border-line bg-panel px-2">
              {[1, 2, 3, 5, 7, 10, 14, 21, 30].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {abroad.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 border-t border-line pt-2">
              <span>
                <span className="font-bold">{h.name}</span>
                <br />
                <span className="text-sm text-muted">
                  {h.area}, {h.town} · {usd(h.nightly, i18n.language)} {t('oal.travel.perNight')}
                </span>
              </span>
              <Button disabled={busy} data-testid={`oal-hotel-${h.id}`} onClick={() => void run<{ reference: string }>({ action: 'book_hotel', hotel: h.id, from: addDays(today, hotelFrom), nights }).then((r) => r && toast.success(t('oal.travel.hotelBooked', { reference: r.reference })))}>
                {t('oal.travel.book', { price: usd(h.nightly * nights, i18n.language) })}
              </Button>
            </li>
          ))}
        </ul>
        {bookings.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <h3 className="text-sm font-semibold text-muted">{t('oal.travel.myBookings')}</h3>
            {bookings.map((b) => (
              <p key={b.id} className="text-sm">
                <span className="font-bold tabular-nums">{b.reference}</span> · {hotels.find((h) => h.id === b.hotel_id)?.name} · {dateLabel(b.from_date)}, {t('oal.travel.nightsCount', { count: b.nights })}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ---- On the way ------------------------------------------------------------------------------

export function OnTheWay({ travel, appearance, homeCountry }: { travel: TravelState; appearance: Appearance; homeCountry: Country }) {
  const { t, i18n } = useTranslation()
  const catalogue = useCatalogue()
  const { run, busy } = useStep()
  const [arrivalsOpen, setArrivalsOpen] = useState(false)
  const trip = travel.trip
  const now = useGameNow()()
  const time = (d: Date) => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
  const airport = catalogue.data?.airports.find((a) => a.code === travel.place)
  const nameOf = (code?: string) => catalogue.data?.airports.find((a) => a.code === code)?.name ?? code

  if (travel.state === 'in_flight' && trip) {
    const leaves = at(trip.departs_at)
    const lands = at(trip.arrives_at)
    const progress = Math.max(0, Math.min(1, (now.getTime() - leaves.getTime()) / (lands.getTime() - leaves.getTime())))
    const waiting = now < leaves
    return (
      <section className="border border-line bg-panel p-4" data-testid="oal-in-flight">
        <h2 className="font-display text-xl font-extrabold">{waiting ? t('oal.trip.atGate', { flight: trip.flight }) : t('oal.trip.flying', { flight: trip.flight })}</h2>
        <p className="text-muted">
          {nameOf(trip.from)} → {nameOf(trip.to)}
        </p>
        <div className="mt-3 h-2 rounded-full bg-line">
          <div className="h-2 rounded-full bg-brand" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="mt-2 text-sm">{waiting ? t('oal.trip.departs', { time: time(leaves) }) : t('oal.trip.lands', { time: time(lands) })}</p>
        {trip.kind === 'removal' && <p className="mt-1 text-sm text-warn">{t('oal.trip.removal')}</p>}
      </section>
    )
  }

  if (travel.state === 'held' && trip) {
    return (
      <section className="border border-alert bg-panel p-4" data-testid="oal-held">
        <h2 className="font-display text-xl font-extrabold">{t('oal.trip.held')}</h2>
        <p>{t('oal.trip.heldBody', { flight: trip.flight, time: time(at(trip.departs_at)) })}</p>
      </section>
    )
  }

  if (travel.state === 'arrivals' || travel.state === 'cleared') {
    const citizen = travel.country === homeCountry
    const hall = travel.place === 'ROB'
    const leave = async () => {
      const reply = await run<{ place: string }>({ action: 'leave_airport' })
      if (reply) {
        setArrivalsOpen(false)
        toast.success(t('oal.trip.welcomeTo', { town: reply.place }))
      }
    }
    return (
      <section className="border border-line bg-panel p-4" data-testid="oal-arrivals">
        <h2 className="font-display text-xl font-extrabold">{t('oal.trip.landed', { airport: airport?.name ?? travel.place })}</h2>
        <p className="text-muted">{travel.state === 'arrivals' ? t('oal.trip.toImmigration') : t('oal.trip.cleared')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {hall ? (
            <Button onClick={() => setArrivalsOpen(true)} data-testid="oal-enter-hall">
              {t('oal.trip.enterHall')}
            </Button>
          ) : travel.state === 'arrivals' ? (
            <Desk country={travel.country} citizen={citizen} onDone={() => undefined} />
          ) : null}
          {travel.state === 'cleared' && !hall && (
            <Button disabled={busy} onClick={() => void leave()} data-testid="oal-leave-airport">
              {t('oal.trip.leave', { town: airport?.town ?? '' })}
            </Button>
          )}
        </div>
        {hall && arrivalsOpen && <Hall appearance={appearance} citizen={citizen} country={travel.country} cleared={travel.state === 'cleared'} onLeave={() => void leave()} onClose={() => setArrivalsOpen(false)} />}
      </section>
    )
  }
  return null
}

// ---- The arrivals hall in 3D ----------------------------------------------------------------

function Hall({ appearance, citizen, country, cleared, onLeave, onClose }: { appearance: Appearance; citizen: boolean; country: Country; cleared: boolean; onLeave: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const stick = useRef<Stick>({ x: 0, y: 0 })
  const look = useRef(0)
  const [near, setNear] = useState<number | null>(null)
  const [speaking, setSpeaking] = useState(false)
  // The gate opened by the officer who admitted the traveller (any, once cleared).
  const [opened, setOpened] = useState<string | null>(cleared ? 'gate2' : null)
  const drag = useRef<{ x: number; look: number } | null>(null)
  const base = useRef<{ x: number; y: number } | null>(null)
  const hall = useRef<HTMLDivElement>(null)

  return (
    <div ref={hall} className="fixed inset-0 z-50 bg-bg" data-testid="oal-hall">
      <div
        className="absolute inset-0"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, [data-stick]')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, look: look.current }
        }}
        onPointerMove={(e) => {
          if (drag.current) look.current = drag.current.look - (e.clientX - drag.current.x) * 0.008
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
          <ArrivalsScene
            appearance={appearance}
            stick={stick}
            look={look}
            paused={speaking}
            open={opened}
            onNear={setNear}
            onExit={onLeave}
            onPosition={(u, v) => {
              // Where the traveller stands, on the page (read by the end-to-end test).
              hall.current?.setAttribute('data-u', u.toFixed(2))
              hall.current?.setAttribute('data-v', v.toFixed(2))
            }}
          />
        </Suspense>
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <Button variant="ghost" onClick={onClose}>
          {t('oal.back')}
        </Button>
        <p className="glass rounded-full border border-line px-4 py-2 text-sm font-semibold">{opened ? t('oal.hall.toExit') : near ? t('oal.hall.atBooth', { n: near }) : t('oal.hall.findBooth')}</p>
      </div>
      {/* The thumb stick, bottom left. */}
      <div
        data-stick
        className="glass absolute bottom-6 left-6 h-32 w-32 touch-none rounded-full border border-line"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const r = e.currentTarget.getBoundingClientRect()
          base.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }}
        onPointerMove={(e) => {
          if (!base.current) return
          const dx = (e.clientX - base.current.x) / 56
          const dy = (e.clientY - base.current.y) / 56
          const n = Math.max(1, Math.hypot(dx, dy))
          stick.current = { x: dx / n, y: -dy / n }
        }}
        onPointerUp={() => {
          base.current = null
          stick.current = { x: 0, y: 0 }
        }}
        onPointerCancel={() => {
          base.current = null
          stick.current = { x: 0, y: 0 }
        }}
      />
      {near && !opened && !speaking && (
        <div className="absolute bottom-6 right-6">
          <Button className="min-h-14 px-6 text-lg" onClick={() => setSpeaking(true)} data-testid="oal-speak">
            {t('oal.hall.speak')}
          </Button>
        </div>
      )}
      {speaking && near !== null && (
        <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto p-3">
          <Desk
            country={country}
            citizen={citizen}
            onDone={(admitted) => {
              if (admitted) setOpened(`gate${near}`)
              setSpeaking(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

// ---- The officer's desk ----------------------------------------------------------------------

type Step = 'passport' | 'purpose' | 'days' | 'stay' | 'occupation' | 'ticket' | 'funds' | 'waiting' | 'decided'

/** The interview: the officer asks, the traveller answers, the server decides. */
export function Desk({ country, citizen, onDone }: { country: Country; citizen: boolean; onDone: (admitted: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const mine = useMine()
  const { run } = useStep()
  const [step, setStep] = useState<Step>('passport')
  const [answers, setAnswers] = useState<Partial<Answers>>({})
  const [days, setDays] = useState('7')
  const [reference, setReference] = useState('')
  const [funds, setFunds] = useState('')
  const [result, setResult] = useState<{ admitted: boolean; lines: string[] } | null>(null)

  const say = (key: string, vars?: Record<string, unknown>) => t(`oal.desk.${key}`, { country: t(`oal.countries.${country}`), ...vars })
  const date = (d: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(at(`${d}T12:00`))
  const time = (d: string) => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(at(d))

  const submit = async (all: Answers | null) => {
    setStep('waiting')
    const reply = await run<{ decision: 'admitted' | 'refused'; permitted_until?: string; reasons?: Reason[]; flight_back?: string; departs_at?: string }>({ action: 'immigration', ...(all ? { answers: all } : {}) })
    if (!reply) return setStep(citizen ? 'passport' : 'funds')
    const admitted = reply.decision === 'admitted'
    const lines = admitted
      ? [citizen ? say('welcomeHome') : say('admitted', { date: date(reply.permitted_until!) })]
      : [...(reply.reasons ?? []).map((r) => say(`reasons.${r}`)), say('refused', { flight: reply.flight_back, time: time(reply.departs_at!) })]
    setResult({ admitted, lines })
    setStep('decided')
  }
  const next = (patch: Partial<Answers>, to: Step) => {
    setAnswers((a) => ({ ...a, ...patch }))
    setStep(to)
  }
  const options = <T extends string>(list: readonly T[], label: (x: T) => string, pick: (x: T) => void) => (
    <div className="flex flex-wrap gap-2">
      {list.map((x) => (
        <button key={x} type="button" onClick={() => pick(x)} className="min-h-11 rounded-full border border-line bg-panel px-4 text-sm font-bold">
          {label(x)}
        </button>
      ))}
    </div>
  )
  const bookings = mine.data?.bookings ?? []

  return (
    <div className="glass flex flex-col gap-3 border border-line p-4" data-testid="oal-desk">
      <p className="text-xs font-semibold uppercase text-muted">{say('officer')}</p>
      {step === 'passport' && (
        <>
          <p className="text-lg">{say('greeting')}</p>
          <Button onClick={() => (citizen ? void submit(null) : setStep('purpose'))} data-testid="oal-hand-passport">
            {say('handPassport')}
          </Button>
        </>
      )}
      {step === 'purpose' && (
        <>
          <p className="text-lg">{say('askPurpose')}</p>
          {options(PURPOSES, (p) => say(`purposes.${p}`), (p: Purpose) => next({ purpose: p }, 'days'))}
        </>
      )}
      {step === 'days' && (
        <>
          <p className="text-lg">{say('askDays')}</p>
          <div className="flex gap-2">
            <input value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="min-h-12 w-28 rounded-xl border border-line bg-panel px-3" aria-label={say('days')} data-testid="oal-days" />
            <Button disabled={!Number(days)} onClick={() => next({ days: Number(days) }, 'stay')}>
              {say('answer')}
            </Button>
          </div>
        </>
      )}
      {step === 'stay' && (
        <>
          <p className="text-lg">{say('askStay')}</p>
          {bookings.map((b) => (
            <button key={b.id} type="button" onClick={() => setReference(b.reference)} className="text-left text-sm underline underline-offset-4">
              {say('showBooking', { reference: b.reference })}
            </button>
          ))}
          <div className="flex flex-wrap gap-2">
            <input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="HB-XXXXXX" className="min-h-12 w-40 rounded-xl border border-line bg-panel px-3 tabular-nums" aria-label={say('reference')} data-testid="oal-reference" />
            <Button disabled={reference.length < 4} onClick={() => next({ stay: { kind: 'hotel', reference } }, 'occupation')}>
              {say('hotel')}
            </Button>
          </div>
          <Button variant="ghost" disabled title={say('hostLater')}>
            {say('host')}
          </Button>
          <p className="text-xs text-muted">{say('hostLater')}</p>
        </>
      )}
      {step === 'occupation' && (
        <>
          <p className="text-lg">{say('askOccupation')}</p>
          {options(OCCUPATIONS, (o) => say(`occupations.${o}`), (o: Occupation) => next({ occupation: o }, 'ticket'))}
        </>
      )}
      {step === 'ticket' && (
        <>
          <p className="text-lg">{say('askTicket')}</p>
          <div className="flex gap-2">
            <Button onClick={() => next({ returnTicket: true }, 'funds')}>{say('yes')}</Button>
            <Button variant="ghost" onClick={() => next({ returnTicket: false }, 'funds')}>
              {say('no')}
            </Button>
          </div>
        </>
      )}
      {step === 'funds' && (
        <>
          <p className="text-lg">{say('askFunds')}</p>
          <div className="flex gap-2">
            <span className="self-center font-bold">US$</span>
            <input value={funds} onChange={(e) => setFunds(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="min-h-12 w-32 rounded-xl border border-line bg-panel px-3" aria-label={say('funds')} data-testid="oal-funds" />
            <Button disabled={funds === ''} onClick={() => void submit({ ...(answers as Answers), fundsUsd: Number(funds) })} data-testid="oal-submit">
              {say('answer')}
            </Button>
          </div>
          <p className="text-xs text-muted">{say('fundsHint')}</p>
        </>
      )}
      {step === 'waiting' && <p className="text-lg">{say('checking')}</p>}
      {step === 'decided' && result && (
        <>
          {result.lines.map((line, i) => (
            <p key={i} className={`text-lg ${result.admitted ? '' : 'text-alert'}`}>
              {line}
            </p>
          ))}
          <Button onClick={() => onDone(result.admitted)} data-testid="oal-desk-done">
            {result.admitted ? say('thankYou') : say('understood')}
          </Button>
        </>
      )}
    </div>
  )
}
