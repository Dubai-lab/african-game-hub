// One Africa Life: home, as the world screen shows it. In the home town, the family's house; in
// another town, the room rented there; else none. The home in 3D (./HomeScene.tsx), walked with
// the thumb stick, its places (the bed: sleep; the kitchen and the table: cook, eat with family;
// the door: out, by the map) and, always to hand, what can be done at home. Asleep, the
// character lies in bed until morning, the time it wakes over it. The shops on Tubman Boulevard
// are walked the same way: in the phone shop, at a stand, the phone there is looked at and
// picked up, carried to the counter and paid for; at a network's customer care, a SIM is bought
// and registered at the desk.
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import type { Stick } from './ArrivalsScene'
import { BodyPanel, Resting } from './Body'
import { toast } from '@/core/ui/toast'
import { PhoneCard, RoomSection, ShopCounter, useHome, useHomeStep } from './Home'
import { useGameNow } from './Journey'
import { BusinessPanel } from './Business'
import { BUSINESS_KINDS, type BusinessKind } from './city/business'
import type { Gesture, Hold, HomeKind, HomePlace, Laid, ShownPhone } from './HomeScene'
import { Loading } from './Loading'
import { type BirthForm, MinistryOfHealth, NetworkDesk, type Ticket } from './Offices'
import type { TravelState } from './Journey'

const HomeScene = lazy(() => import('./HomeScene'))

/** Which home a life has where it is: the family's house at home, a room it rents here, or none. */
export function useHomeKind(travel: TravelState, homeTown: string, homeCountry: 'LR' | 'GH'): HomeKind | null | undefined {
  const home = useHome()
  if (travel.place === homeTown && travel.country === homeCountry) return 'house'
  if (!home.data) return undefined
  const today = travel.game_now.slice(0, 10)
  const here = home.data.leases.find((l) => l.ends_on >= today && home.data!.rooms.find((r) => r.id === l.room_id)?.town === travel.place)
  return here ? 'room' : null
}

export function HomeView({
  kind,
  travel,
  appearance,
  homeTown,
  homeCountry,
  hud,
  onDoor,
  title: ownTitle,
  cat,
  fromTown,
  panel,
}: {
  kind: HomeKind
  travel: TravelState
  appearance: Appearance
  homeTown: string
  homeCountry: 'LR' | 'GH'
  hud: ReactNode
  onDoor: () => void
  /** One of the town's businesses: its own name, what it is. */
  title?: string
  cat?: string
  /** Come in from the town (Monrovia): in at the front door, and out of it into the town again
   * (at the Ministry, past its guards already, at the gate out in the town). */
  fromTown?: boolean
  /** What is done here (the visa office's, the job centre's), in place of the kind's own. */
  panel?: ReactNode
}) {
  const { t } = useTranslation()
  const stick = useRef<Stick>({ x: 0, y: 0 })
  const base = useRef<{ x: number; y: number } | null>(null)
  const [place, setPlace] = useState<HomePlace | null>(null)
  const [open, setOpen] = useState<'menu' | 'display' | null>(null)
  const asleep = travel.state === 'sleeping'
  // The phone shop: its phones on show (this country's, cheapest first), the stand the character
  // is at, the phone picked up.
  const home = useHome()
  const shopHandsets = useMemo(() => (kind === 'phoneshop' ? (home.data?.handsets ?? []).filter((h) => h.country === travel.country) : []), [kind, home.data, travel.country])
  const shelf = useMemo<ShownPhone[]>(() => shopHandsets.map((h) => ({ id: h.id, colour: h.colour, kind: h.kind })), [shopHandsets])
  const [display, setDisplay] = useState<number | null>(null)
  const [carrying, setCarrying] = useState<string | null>(null)
  const shown = display !== null ? shopHandsets[display] : undefined
  const carried = shopHandsets.find((h) => h.id === carrying) ?? null
  const network = kind === 'starline' || kind === 'citrus' ? `${travel.country === 'LR' ? 'lr' : 'gh'}_${kind}` : null
  const business = (BUSINESS_KINDS as readonly string[]).includes(kind) ? (kind as BusinessKind) : null
  const title = ownTitle ?? (
    kind === 'phoneshop' || network ? t(`oal.street.towns.sinkor.places.${kind === 'phoneshop' ? 'phone' : kind}`) : kind === 'health' ? t('oal.world.places.health') : kind === 'house' ? t('oal.world.places.familyHome') : t('oal.world.places.room'))
  // What the character does: reaching for a phone on its stand, a finger on the reader, turning
  // to the camera. Taking (or putting back) a phone: it changes hands as the hand reaches it.
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const act = (g: Omit<Gesture, 'seq'>) => setGesture((old) => ({ ...g, seq: (old?.seq ?? 0) + 1 }))
  const [handling, setHandling] = useState(false)
  const handle = (to: string | null) => {
    if (display === null || handling) return
    setOpen(null)
    setHandling(true)
    act({ reach: true, to: `display:${display}` })
    setTimeout(() => setCarrying(to), 1000)
    setTimeout(() => setHandling(false), 3400)
  }
  // The phone chosen, from the hand to the counter; paid for, boxed by the seller, the box taken.
  const [stage, setStage] = useState<'hand' | 'counter' | 'boxing' | 'boxed' | 'taken'>('hand')
  const paid = stage === 'boxing' || stage === 'boxed' || stage === 'taken'
  const [staffSeq, setStaffSeq] = useState(0)
  const later = (ms: number, then: () => void) => setTimeout(then, ms)
  const putDown = () => {
    setHandling(true)
    act({ reach: true, to: 'counter' })
    later(1000, () => setStage('counter'))
    later(3400, () => setHandling(false))
  }
  const boxIt = () => {
    setStage('boxing')
    setOpen(null)
    setStaffSeq((k) => k + 1)
    later(1200, () => {
      setStage('boxed')
      toast.info(t('oal.shop.boxed'))
    })
  }
  const takeBox = () => {
    setHandling(true)
    act({ reach: true, to: 'counter' })
    later(1000, () => setStage('taken'))
    later(3400, () => setHandling(false))
  }
  // At home: the new phone in its box, unboxed at the table and put on charge there.
  const { run } = useHomeStep()
  const now = useGameNow()
  const mine = home.data?.phone
  const mineModel = home.data?.handsets.find((h) => h.id === mine?.handset)
  const minePhone: ShownPhone | null = mineModel ? { id: mineModel.id, colour: mineModel.colour, kind: mineModel.kind } : null
  const atHome = kind === 'house' || kind === 'room'
  const charging = mine?.charge === 'charging' && mine.charged_at !== null && new Date(`${mine.charged_at}Z`).getTime() > now().getTime()
  const homeStep = (action: 'unbox' | 'charge') => {
    setHandling(true)
    // At the table, the hands go to it; anywhere else in the house, where one stands.
    if (place === 'table') act({ reach: true, to: 'table' })
    else if (place) act({ reach: true, to: `place:${place}` })
    later(1000, () => void run({ action }).then((r) => r && toast.success(t(action === 'unbox' ? 'oal.home.phone.unboxed' : 'oal.home.phone.charged'))))
    later(3400, () => setHandling(false))
  }
  const chosen: ShownPhone | null = carried ? { id: carried.id, colour: carried.colour, kind: carried.kind } : null
  const hold: Hold | null =
    kind === 'phoneshop' && chosen ? (stage === 'hand' ? { what: 'phone', phone: chosen } : stage === 'taken' ? { what: 'box', phone: chosen } : null) : atHome && minePhone && mine && !mine.unboxed ? { what: 'box', phone: minePhone } : null
  const laid: Laid | null =
    kind === 'phoneshop' && chosen
      ? stage === 'counter' || stage === 'boxing'
        ? { what: 'phone', phone: chosen, on: 'counter' }
        : stage === 'boxed'
          ? { what: 'box', phone: chosen, on: 'counter' }
          : null
      : atHome && minePhone && mine?.unboxed && mine.charge === 'flat'
        ? { what: 'open', phone: minePhone, on: 'table' }
        : atHome && minePhone && charging
          ? { what: 'charging', phone: minePhone, on: 'table' }
          : null
  // A network's queue: the ticket taken by the door, the number served moving on until it is
  // called; the camera's flash.
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const letter = kind === 'health' ? 'B' : 'A'
  useEffect(() => {
    if (!ticket || ticket.serving >= ticket.mine) return
    const id = setTimeout(() => {
      const next = { ...ticket, serving: ticket.serving + 1 }
      setTicket(next)
      if (next.serving === next.mine) toast.info(t(kind === 'health' ? 'oal.health.called' : 'oal.office.called', { mine: `${letter}${next.mine}` }))
    }, 3500)
    return () => clearTimeout(id)
  }, [ticket, t, kind, letter])
  const [flash, setFlash] = useState(false)
  // The Ministry of Health: let in at the gate, the form taken and filled in; the clerks reaching.
  const [admitted, setAdmitted] = useState(!!fromTown && kind === 'health')
  const [form, setForm] = useState<null | 'blank' | BirthForm>(null)
  const [staffAct, setStaffAct] = useState<{ index: number; seq: number } | null>(null)
  // Sitting: the seat the character is by, the seat it sits on.
  const [bySeat, setBySeat] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [seated, setSeated] = useState<number | null>(null)
  const leave = () => {
    // Not out of the shop with a phone not paid for: it goes back on its stand.
    if (carried && !paid) toast.info(t('oal.shop.leftBehind', { name: `${carried.brand} ${carried.model}` }))
    onDoor()
  }
  // Dragged, the camera turns round the character (sideways) and tilts (up and down).
  const view = useRef({ yaw: 0, pitch: 0.35 })
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  return (
    <div
      className="fixed inset-0 z-40 bg-bg"
      data-testid="oal-home-view"
      data-kind={kind}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, a, select, [data-stick], [data-panel], [data-hud]')) return
        drag.current = { x: e.clientX, y: e.clientY, ...view.current }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        view.current = {
          yaw: drag.current.yaw - (e.clientX - drag.current.x) * 0.008,
          pitch: Math.max(-0.15, Math.min(1.3, drag.current.pitch + (e.clientY - drag.current.y) * 0.006)),
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
        <HomeScene kind={kind} appearance={appearance} asleep={asleep} stick={stick} view={view} onPlace={setPlace} shelf={shelf} carrying={carrying} onDisplay={setDisplay} gesture={gesture} hold={hold} laid={laid} staffSeq={staffSeq} staffAct={staffAct} gateOpen={admitted} seat={seated} onSeat={setBySeat} onReady={() => setReady(true)} fromTown={fromTown} onOut={onDoor} />
      </Suspense>
      {!ready && <Loading what={t('oal.loading.inside')} />}
      {hud}
      {flash && <div className="pointer-events-none absolute inset-0 z-20 bg-white/80" aria-hidden />}
      {asleep ? (
        <div className="glass absolute inset-x-3 bottom-24 mx-auto max-w-lg rounded-2xl border border-line p-1">
          <Resting travel={travel} />
        </div>
      ) : (
        <>
          <div
            data-stick
            className="glass absolute bottom-24 left-6 h-28 w-28 touch-none rounded-full border border-line"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              const r = e.currentTarget.getBoundingClientRect()
              base.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
            }}
            onPointerMove={(e) => {
              if (!base.current) return
              const dx = (e.clientX - base.current.x) / 50
              const dy = (e.clientY - base.current.y) / 50
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
          <div className="absolute bottom-24 right-6 flex flex-col items-end gap-2">
            {seated !== null ? (
              <Button onClick={() => setSeated(null)} data-testid="oal-stand-up">
                {t('oal.home.standUp')}
              </Button>
            ) : (
              bySeat !== null &&
              !handling && (
                <Button onClick={() => setSeated(bySeat)} data-testid="oal-sit-down">
                  {t('oal.home.sitDown')}
                </Button>
              )
            )}
            {ticket && (
              <p className="glass rounded-full border border-line px-3 py-1 text-xs font-semibold tabular-nums" data-testid="oal-ticket">
                {t('oal.office.board', { mine: `${letter}${ticket.mine}`, serving: `${letter}${ticket.serving}` })}
              </p>
            )}
            {carried && (
              <p className="glass rounded-full border border-line px-3 py-1 text-xs font-semibold" data-testid="oal-carrying">
                {t(paid ? 'oal.shop.yoursNow' : 'oal.shop.carrying', { name: `${carried.brand} ${carried.model}` })}
              </p>
            )}
            {atHome && charging && mine?.charged_at && (
              <p className="glass rounded-full border border-line px-3 py-1 text-xs font-semibold" data-testid="oal-charging">
                {t('oal.home.phone.charging', { time: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`${mine.charged_at}Z`)) })}
              </p>
            )}
            {place === 'door' ? (
              <Button onClick={leave} data-testid="oal-home-door">
                {kind === 'house' || kind === 'room' ? t('oal.home.goOut') : t('oal.home.leaveShop')}
              </Button>
            ) : place === 'ticket' && network && !ticket ? (
              <Button
                onClick={() => {
                  const mine = 40 + Math.floor(Math.random() * 50)
                  setTicket({ mine, serving: mine - 3 })
                  toast.info(t('oal.office.ticket', { mine: `A${mine}`, serving: `A${mine - 3}` }))
                }}
                data-testid="oal-take-ticket"
              >
                {t('oal.office.takeTicket')}
              </Button>
            ) : handling ? null : kind === 'phoneshop' && place === 'counter' && carried && stage === 'hand' ? (
              <Button onClick={putDown} data-testid="oal-put-down">
                {t('oal.shop.putDown')}
              </Button>
            ) : kind === 'phoneshop' && place === 'counter' && stage === 'boxed' ? (
              <Button onClick={takeBox} data-testid="oal-take-box">
                {t('oal.shop.takeBox')}
              </Button>
            ) : atHome && mine && !mine.unboxed ? (
              <Button onClick={() => homeStep('unbox')} data-testid="oal-unbox">
                {t('oal.home.phone.unbox')}
              </Button>
            ) : atHome && mine?.unboxed && mine.charge === 'flat' ? (
              <Button onClick={() => homeStep('charge')} data-testid="oal-charge">
                {t('oal.home.phone.charge')}
              </Button>
            ) : shown && (!carried || stage === 'hand') ? (
              <Button onClick={() => setOpen('display')} data-testid="oal-look-phone">
                {t('oal.shop.look', { name: `${shown.brand} ${shown.model}` })}
              </Button>
            ) : (
              <Button onClick={() => setOpen('menu')} data-testid="oal-home-menu">
                {place ? t(`oal.home.at.${place}`) : t('oal.home.things')}
              </Button>
            )}
          </div>
          {open && (
            <div data-panel className="glass absolute inset-x-0 bottom-20 z-10 mx-auto flex max-h-[68vh] max-w-lg flex-col gap-2 overflow-y-auto rounded-t-3xl border border-line p-3" data-testid="oal-home-panel">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{title}</p>
                <Button variant="ghost" onClick={() => setOpen(null)}>
                  {t('oal.street.done')}
                </Button>
              </div>
              {open === 'display' && shown ? (
                <PhoneCard
                  handset={shown}
                  carrying={carrying === shown.id}
                  handsFull={carrying !== null && carrying !== shown.id}
                  onTake={() => handle(shown.id)}
                  onPutBack={() => handle(null)}
                />
              ) : kind === 'phoneshop' ? (
                place === 'counter' ? (
                  <ShopCounter travel={travel} carrying={stage === 'counter' ? carried : null} onPaid={boxIt} />
                ) : (
                  <p className="border border-line bg-panel p-4 text-sm">{t('oal.shop.hint')}</p>
                )
              ) : network ? (
                place === 'desk' ? (
                  <NetworkDesk
                    travel={travel}
                    homeCountry={homeCountry}
                    network={network}
                    ticket={ticket}
                    onGesture={act}
                    onFlash={() => {
                      setFlash(true)
                      setTimeout(() => setFlash(false), 180)
                    }}
                  />
                ) : (
                  <p className="border border-line bg-panel p-4 text-sm">{t('oal.office.hint')}</p>
                )
              ) : panel ? (
                panel
              ) : business ? (
                <BusinessPanel kind={business} name={title} cat={cat} travel={travel} homeCountry={homeCountry} />
              ) : kind === 'health' ? (
                <MinistryOfHealth
                  travel={travel}
                  place={place === 'gate' || place === 'reception' || place === 'writing' || place === 'counter' || place === 'cashier' || place === 'collect' ? place : null}
                  visit={{ admitted, ticket, form }}
                  onVisit={(v) => {
                    setAdmitted(v.admitted)
                    setTicket(v.ticket)
                    setForm(v.form)
                  }}
                  onGesture={act}
                  onStaff={(index) => setStaffAct((old) => ({ index, seq: (old?.seq ?? 0) + 1 }))}
                  onClose={() => setOpen(null)}
                />
              ) : (
                <>
                  <BodyPanel travel={travel} homeTown={homeTown} homeCountry={homeCountry} />
                  <RoomSection travel={travel} />
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
