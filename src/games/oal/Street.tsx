// One Africa Life: out in town, on Tubman Boulevard or at Waterside Market. The 3D place
// (./StreetScene.tsx, loaded only when opened), the thumb stick and the drag to look, and,
// standing at one of its places, what can be done there: eat at a cookshop, the phone shop and
// SIM agent, a money changer, the kekeh stop, the clinic, the trader's own table. Each uses the
// same server steps as the life's page. Other players out in the same place are seen walking it.
import { useQueryClient } from '@tanstack/react-query'
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'
import { useTranslation } from 'react-i18next'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import type { Stick } from './ArrivalsScene'
import { PhoneSection } from './Home'
import type { TravelState } from './Journey'
import { newRide, type Destination, type RideKind, type RidePhase, type RideState } from './city/ride'
import type { OtherPlayer, Place, TownId } from './StreetScene'
import { MoneyChanger, Work } from './Work'

const StreetScene = lazy(() => import('./StreetScene'))
const CityScene = lazy(() => import('./city/CityScene'))

/** The whole town as one place (./city/CityScene.tsx): which town, where to start. */
export type CityOpen = {
  town: string
  start: { x: number; y: number; f: number } | { place: string }
}
/** The town's places that are not a hub street's own, and what they are called. */
const COMPOUND_NAME: Record<string, string> = { home: 'oal.city.places.home', health: 'oal.city.places.health', jobs: 'oal.world.places.jobs', visa: 'oal.world.places.visa', station: 'oal.world.places.stationMonrovia', sinkor: 'oal.street.towns.sinkor.where', waterside: 'oal.street.towns.waterside.where' }
const COMPOUNDS = ['home', 'health', 'jobs', 'visa', 'station']
/** A ride's fare in town (the server's: public.oal_road_action 'town'). */
const FARE: Record<'LR' | 'GH', Record<RideKind, string>> = { LR: { taxi: 'L$150', kekeh: 'L$100' }, GH: { taxi: 'GH¢15', kekeh: 'GH¢10' } }

/**
 * The others out on the street, through a Realtime channel: who is there and how they look
 * (presence), where they are (a few times a second, only while moving, or once in a while).
 * Nothing in it is trusted for anything but drawing.
 */
function useStreetCompany(town: TownId, name: string, appearance: Appearance) {
  const { user } = useAuth()
  const others = useRef(new Map<string, OtherPlayer>())
  const [present, setPresent] = useState<string[]>([])
  const channel = useRef<RealtimeChannel | null>(null)
  const last = useRef({ x: 0, y: 0, at: 0 })
  useEffect(() => {
    if (!user) return
    const me = user.id
    const ch = supabase.channel(`oal-street:${town}`, {
      config: { presence: { key: me }, broadcast: { self: false } },
    })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, { name: string; appearance: Appearance; x: number; y: number }[]>
      const ids = Object.keys(state).filter((id) => id !== me)
      for (const id of ids) {
        const seen = state[id]![0]!
        if (!others.current.has(id))
          others.current.set(id, {
            name: seen.name,
            appearance: seen.appearance,
            x: seen.x,
            y: seen.y,
            f: 0,
            m: false,
          })
      }
      for (const id of [...others.current.keys()]) if (!ids.includes(id)) others.current.delete(id)
      setPresent(ids)
    })
    ch.on('broadcast', { event: 'pos' }, ({ payload }) => {
      const p = payload as {
        id: string
        x: number
        y: number
        f: number
        m: boolean
      }
      const entry = others.current.get(p.id)
      if (entry) Object.assign(entry, { x: p.x, y: p.y, f: p.f, m: p.m })
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED')
        void ch.track({
          name,
          appearance,
          x: last.current.x,
          y: last.current.y,
        })
    })
    channel.current = ch
    return () => {
      channel.current = null
      void supabase.removeChannel(ch)
    }
  }, [user, town, name, appearance])
  const share = (x: number, y: number, f: number, m: boolean) => {
    const now = Date.now()
    const moved = Math.hypot(x - last.current.x, y - last.current.y) > 0.05
    if (!channel.current || !user || (!moved && now - last.current.at < 3000)) return
    last.current = { x, y, at: now }
    void channel.current.send({
      type: 'broadcast',
      event: 'pos',
      payload: { id: user.id, x, y, f, m },
    })
  }
  return { others, present, share }
}

/** What can be done at a place in town (the same panel whether walked to or chosen on the map). */
export function PlacePanel({ place, travel, homeCountry }: { place: Place; travel: TravelState; homeCountry: 'LR' | 'GH' }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const lr = travel.country === 'LR'
  const step = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    try {
      const reply = await callFunction('oal-home', body)
      if (!reply.ok) toast.error(refusalMessage(reply.code))
      else toast.success(done)
    } catch {
      toast.error(t('errors.offline'))
    } finally {
      setBusy(false)
      for (const key of ['oal-travel', 'oal-money']) void queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
  return (
    <>
      {place === 'cookshop' && (
        <div className="border border-line bg-panel flex flex-col gap-2 p-4">
          <p>{t(lr ? 'oal.street.cookshop' : 'oal.street.cookshopGh')}</p>
          <Button disabled={busy} onClick={() => void step({ action: 'eat_out' }, t('oal.street.ate'))} data-testid="oal-street-eat">
            {t('oal.body.eatOut', { price: lr ? 'L$250' : 'GH¢30' })}
          </Button>
        </div>
      )}
      {place === 'clinic' && (
        <div className="border border-line bg-panel flex flex-col gap-2 p-4">
          <p>{t('oal.street.clinic')}</p>
          <Button disabled={busy} onClick={() => void step({ action: 'clinic' }, t('oal.street.seen'))} data-testid="oal-street-clinic">
            {t('oal.body.clinic', { price: lr ? 'L$1,500' : 'GH¢60' })}
          </Button>
        </div>
      )}
      {place === 'phone' && <PhoneSection travel={travel} homeCountry={homeCountry} />}
      {place === 'changer' && <MoneyChanger country={travel.country} />}
      {(place === 'kekeh' || place === 'stall') && <Work travel={travel} />}
      {(place === 'tickets' || place === 'stand' || place === 'pitch') && (
        <div className="border border-line bg-panel flex flex-col gap-2 p-4" data-testid={`oal-stadium-${place}`}>
          <p>{t(`oal.street.stadium.${place}`)}</p>
        </div>
      )}
    </>
  )
}

export function StreetView({
  town,
  travel,
  appearance,
  name,
  homeCountry,
  hud,
  start,
  city,
  onMove,
  onEnter,
}: {
  town: TownId
  travel: TravelState
  appearance: Appearance
  name: string
  homeCountry: 'LR' | 'GH'
  hud?: ReactNode
  start?: Place | null
  /** The whole town instead of one street. */
  city?: CityOpen
  onMove?: (x: number, y: number, facing: number) => void
  onEnter?: (place: Place) => boolean
}) {
  const { t } = useTranslation()
  const company = useStreetCompany(city ? (`city-${city.town.toLowerCase()}` as TownId) : town, name, appearance)
  const [streetName, setStreetName] = useState<string | null>(null)
  const placeName = (p: string) => {
    if (COMPOUND_NAME[p]) return t(COMPOUND_NAME[p]!)
    const [hub, own] = p.includes(':') ? p.split(':') : [town, p]
    return t(`oal.street.towns.${hub}.places.${own}`)
  }
  // A ride: waved down at the roadside, the driver asked where to and paid, ridden, got out of.
  const ride = useRef<RideState>(newRide())
  const [phase, setPhase] = useState<RidePhase>('none')
  const [roadside, setRoadside] = useState(false)
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [left, setLeft] = useState(0)
  const [fast, setFast] = useState(false)
  const [paying, setPaying] = useState(false)
  useEffect(() => {
    if (phase !== 'riding') return
    const id = setInterval(() => setLeft(ride.current.left), 500)
    return () => clearInterval(id)
  }, [phase])
  const queryClient = useQueryClient()
  const kind = ride.current.kind
  const goTo = async (d: Destination) => {
    setPaying(true)
    try {
      // The fare, paid to the driver as the ride starts.
      const reply = await callFunction('oal-travel', { action: 'town_ride', mode: kind })
      if (!reply.ok) return toast.error(refusalMessage(reply.code))
      ride.current.request = { type: 'go', to: d }
      toast.success(t('oal.city.ride.paid', { fare: FARE[travel.country][kind] }))
    } catch {
      toast.error(t('errors.offline'))
    } finally {
      setPaying(false)
      void queryClient.invalidateQueries({ queryKey: ['oal-money'] })
    }
  }
  const stick = useRef<Stick>({ x: 0, y: 0 })
  const look = useRef<number | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [open, setOpen] = useState(false)
  // Dragged up or down, the camera looks up at the sky or down at the ground.
  const pitch = useRef(0)
  const drag = useRef<{
    x: number
    y: number
    look: number
    pitch: number
  } | null>(null)
  const base = useRef<{ x: number; y: number } | null>(null)
  const view = useRef<HTMLDivElement>(null)

  return (
    <div ref={view} className="fixed inset-0 z-40 bg-bg" data-testid="oal-street">
      <div
        className="absolute inset-0"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, a, [data-stick], [data-panel], [data-hud]')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            look: look.current ?? 0,
            pitch: pitch.current,
          }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          look.current = drag.current.look - (e.clientX - drag.current.x) * 0.008
          pitch.current = Math.max(-0.5, Math.min(1.1, drag.current.pitch - (e.clientY - drag.current.y) * 0.006))
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
          {city ? (
            <CityScene
              town={city.town}
              start={city.start}
              appearance={appearance}
              stick={stick}
              look={look}
              pitch={pitch}
              paused={open || phase === 'waiting'}
              onPlace={(p) => {
                setPlace(p as Place | null)
                if (!p) setOpen(false)
              }}
              onStreet={setStreetName}
              ride={ride}
              onRide={setPhase}
              onRoadside={setRoadside}
              onDestinations={setDestinations}
              onPosition={(x, y, facing, moving) => {
                view.current?.setAttribute('data-x', x.toFixed(2))
                view.current?.setAttribute('data-y', y.toFixed(2))
                company.share(x, y, facing, moving)
                onMove?.(x, y, facing)
              }}
            />
          ) : (
            <StreetScene
              town={town}
              start={start ?? null}
              appearance={appearance}
              stick={stick}
              look={look}
              pitch={pitch}
              paused={open}
              others={company.others}
              present={company.present}
              onPlace={(p) => {
                setPlace(p)
                if (!p) setOpen(false)
              }}
              onPosition={(x, y, facing, moving) => {
                view.current?.setAttribute('data-x', x.toFixed(2))
                view.current?.setAttribute('data-y', y.toFixed(2))
                company.share(x, y, facing, moving)
                onMove?.(x, y, facing)
              }}
            />
          )}
        </Suspense>
      </div>
      {hud}
      <div className="pointer-events-none absolute inset-x-0 top-44 flex justify-center px-3">
        <p className="glass rounded-full border border-line px-4 py-2 text-sm font-semibold" data-testid="oal-street-chip">
          {place ? placeName(place) : city ? (streetName ?? t('oal.city.where', { town: city.town })) : t(`oal.street.towns.${town}.where`)}
          {company.present.length > 0 && <span className="ml-2 text-muted">· {t('oal.street.company', { count: company.present.length })}</span>}
        </p>
      </div>
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
      {city && phase === 'none' && roadside && !place && !open && (
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
          {(['taxi', 'kekeh'] as const).map((k) => (
            <Button key={k} className="min-h-12 px-5" onClick={() => (ride.current.request = { type: 'hail', kind: k })} data-testid={`oal-hail-${k}`}>
              {t(`oal.city.ride.hail.${k}`)}
            </Button>
          ))}
        </div>
      )}
      {city && phase === 'coming' && (
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
          <p className="glass rounded-full border border-line px-4 py-2 text-sm font-semibold" data-testid="oal-ride-coming">
            {t(`oal.city.ride.coming.${kind}`)}
          </p>
          <Button variant="ghost" onClick={() => (ride.current.request = { type: 'cancel' })}>
            {t('oal.city.ride.never')}
          </Button>
        </div>
      )}
      {city && phase === 'waiting' && (
        <div data-panel className="glass absolute inset-x-0 bottom-0 z-10 mx-auto flex max-h-[70vh] max-w-lg flex-col gap-2 overflow-y-auto rounded-t-3xl border border-line p-3" data-testid="oal-ride-where">
          <p className="font-semibold">{t(`oal.city.ride.driver.${kind}`)}</p>
          <p className="text-sm text-muted">{t('oal.city.ride.fare', { fare: FARE[travel.country][kind] })}</p>
          {destinations.map((d) => (
            <Button key={d.name} variant="ghost" disabled={paying} onClick={() => void goTo(d)} data-testid={`oal-ride-to-${d.name}`}>
              {placeName(d.name)}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => (ride.current.request = { type: 'cancel' })} data-testid="oal-ride-cancel">
            {t('oal.city.ride.never')}
          </Button>
        </div>
      )}
      {city && phase === 'riding' && (
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
          <p className="glass rounded-full border border-line px-4 py-2 text-sm font-semibold tabular-nums" data-testid="oal-riding">
            {t(`oal.city.ride.riding.${kind}`, { place: ride.current.to ? placeName(ride.current.to.name) : '', km: (left / 1000).toFixed(1) })}
          </p>
          <Button
            variant={fast ? 'primary' : 'ghost'}
            onClick={() => {
              ride.current.fast = !fast
              setFast(!fast)
            }}
            data-testid="oal-ride-fast"
          >
            {t('oal.city.ride.faster')}
          </Button>
        </div>
      )}
      {city && phase === 'arrived' && (
        <div className="absolute bottom-6 right-6">
          <Button
            className="min-h-14 px-6 text-lg"
            onClick={() => {
              ride.current.request = { type: 'out' }
              ride.current.fast = false
              setFast(false)
            }}
            data-testid="oal-ride-out"
          >
            {t('oal.city.ride.out')}
          </Button>
        </div>
      )}
      {place && !open && phase === 'none' && (
        <div className="absolute bottom-6 right-6">
          <Button className="min-h-14 px-6 text-lg" onClick={() => (onEnter?.(place) ? undefined : setOpen(true))} data-testid="oal-place-open">
            {COMPOUNDS.includes(place) ? t(`oal.city.enter.${place}`) : t(`oal.street.open.${place.split(':').pop()}`)}
          </Button>
        </div>
      )}
      {place && open && (
        <div data-panel className="absolute inset-x-0 bottom-0 z-10 mx-auto flex max-h-[70vh] max-w-lg flex-col gap-2 overflow-y-auto p-3" data-testid={`oal-place-${place}`}>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('oal.street.done')}
            </Button>
          </div>
          <PlacePanel place={place.split(':').pop() as Place} travel={travel} homeCountry={homeCountry} />
        </div>
      )}
    </div>
  )
}
