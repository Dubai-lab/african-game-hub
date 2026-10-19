// One Africa Life: the game's screen. The life is the world, full screen: the 3D street the
// player walks (./Street.tsx), or, where a place has no 3D yet, a picture of it with what can be
// done there. Over it, see-through, always: the game's clock and day, the body (food, rest,
// health), the money; a map to go anywhere in town (each place opens what can be done there; on a
// street that is in 3D, the player can walk it from there), and the phone, if the life has one
// (texts and mobile money, jobs, flights and hotels, rooms). Busy (at work, asleep, at the clinic,
// on a journey), the screen says so over the world.
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button, buttonClass } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import type { Appearance, HomeCountry, Sex } from '../../../supabase/functions/_shared/oal'
import { BodyPanel, OverstayWarning, Resting } from './Body'
import { PhoneSection, RoomSection, useHome } from './Home'
import { OnTheWay, Travel, type TravelState, useGameNow, useTravel } from './Journey'
import { PlacePanel, StreetView } from './Street'
import type { Place, TownId } from './StreetScene'
import { AtWork, JobsAbroad, VisaOffice, Work } from './Work'

export type Life = { game_name: string; sex: Sex; born_on: string; home_country: HomeCountry; home_town: string; appearance: Appearance }
type Balance = { currency: string; amount: number }

/** Where in town the player is: a 3D street (walking, maybe come to one of its places), or one
 * of the town's places shown on a picture. */
type Spot = { area: Area; place?: Place | Other; walking?: boolean }
type Other = 'home' | 'airport' | 'visa' | 'jobs'
type Area = TownId | 'town' | 'home' | 'airport' | 'visa' | 'jobs'

/** Each town's areas and their places (3D where a street has been built). */
type AreaInfo = { area: Area; places: (Place | Other)[]; walk?: TownId }
function areasOf(town: string, country: 'LR' | 'GH'): AreaInfo[] {
  const capital = town === 'Monrovia' || town === 'Accra'
  const streets: AreaInfo[] =
    town === 'Monrovia'
      ? [
          { area: 'sinkor', places: ['cookshop', 'phone', 'changer', 'kekeh', 'clinic'], walk: 'sinkor' },
          { area: 'waterside', places: ['stall', 'changer', 'cookshop'], walk: 'waterside' },
        ]
      : [{ area: 'town', places: ['cookshop', 'phone', 'changer', 'stall', 'kekeh', 'clinic'] }]
  const areas: AreaInfo[] = [{ area: 'home', places: ['home'] }, ...streets, { area: 'jobs', places: ['jobs'] }]
  if (capital) areas.push({ area: 'visa', places: ['visa'] }, { area: 'airport', places: ['airport'] })
  return areas.filter((a) => country === 'LR' || a.area !== 'waterside')
}

const BACKDROP: Partial<Record<Area, string>> = { sinkor: '/oal/backdrops/sinkor.webp', waterside: '/oal/backdrops/waterside.webp', home: '/oal/backdrops/home.webp', town: '/oal/backdrops/home.webp' }
function backdropFor(area: Area, town: string) {
  if (area === 'airport') return town === 'Accra' ? '/oal/backdrops/accra.webp' : '/oal/backdrops/ria.webp'
  if (town === 'Accra' && area !== 'home') return '/oal/backdrops/accra.webp'
  return BACKDROP[area] ?? (town === 'Monrovia' ? '/oal/backdrops/sinkor.webp' : '/oal/backdrops/home.webp')
}

const SPOT_KEY = (user: string) => `oal-spot:${user}`
function readSpot(user: string): Spot | null {
  try {
    const raw = localStorage.getItem(SPOT_KEY(user))
    return raw ? (JSON.parse(raw) as Spot) : null
  } catch {
    return null
  }
}
function saveSpot(user: string, spot: Spot) {
  try {
    localStorage.setItem(SPOT_KEY(user), JSON.stringify(spot))
  } catch {
    // A private window: the spot is not remembered, which is fine.
  }
}

export function World({ life }: { life: Life }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const travel = useTravel()
  const [spot, setSpot] = useState<Spot | null>(() => (user ? readSpot(user.id) : null))
  const [sheet, setSheet] = useState<'map' | 'phone' | null>(null)
  const go = (next: Spot) => {
    setSpot(next)
    setSheet(null)
    if (user) saveSpot(user.id, next)
  }
  if (travel.isPending) return <Skeleton className="fixed inset-0 rounded-none" />
  if (travel.isError)
    return (
      <Backdrop src="/oal/backdrops/home.webp">
        <div className="mx-auto mt-40 max-w-sm border border-line bg-panel p-4">
          <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
          <Button className="mt-2" onClick={() => void travel.refetch()}>
            {'↻'}
          </Button>
        </div>
      </Backdrop>
    )
  const here = travel.data
  const areas = areasOf(here.place, here.country)
  // A spot from another town (or none yet): home in the home town, else the town itself.
  const atHomeTown = here.place === life.home_town && here.country === life.home_country
  const valid = spot && areas.some((a) => a.area === spot.area) ? spot : { area: (atHomeTown ? 'home' : here.place === 'Monrovia' ? 'sinkor' : 'town') as Area }
  const hud = <Hud life={life} travel={here} onMap={() => setSheet('map')} onPhone={() => setSheet('phone')} />
  const sheets = (
    <>
      {sheet === 'map' && <MapSheet areas={areas} here={here} life={life} spot={valid} onGo={go} onClose={() => setSheet(null)} />}
      {sheet === 'phone' && <PhoneSheet travel={here} life={life} onClose={() => setSheet(null)} />}
    </>
  )

  // On a journey: the airport's own screens (the arrivals hall is 3D, full screen).
  if (['in_flight', 'arrivals', 'cleared', 'held'].includes(here.state))
    return (
      <Backdrop src={here.country === 'GH' ? '/oal/backdrops/accra.webp' : '/oal/backdrops/ria.webp'}>
        {hud}
        {/* Not on glass: the arrivals hall inside is a full-screen layer, which a blur would hold in. */}
        <div className="absolute inset-x-0 bottom-20 top-44 overflow-y-auto px-3">
          <div className="mx-auto flex max-w-lg flex-col gap-3">
            <OnTheWay travel={here} appearance={life.appearance} homeCountry={life.home_country} />
          </div>
        </div>
      </Backdrop>
    )
  if (here.state === 'working' || here.state === 'sleeping' || here.state === 'clinic')
    return (
      <Backdrop src={backdropFor(here.state === 'sleeping' ? 'home' : valid.area, here.place)}>
        {hud}
        <Middle>{here.state === 'working' ? <AtWork /> : <Resting travel={here} />}</Middle>
        {sheets}
      </Backdrop>
    )

  // Walking a 3D street.
  const area = areas.find((a) => a.area === valid.area)
  if (area?.walk && (valid.walking || !valid.place))
    return (
      <>
        <StreetView key={`${area.walk}:${valid.place ?? ''}`} town={area.walk} start={(valid.place as Place) ?? null} travel={here} appearance={life.appearance} name={life.game_name} homeCountry={life.home_country} hud={<Hud life={life} travel={here} onMap={() => setSheet('map')} onPhone={() => setSheet('phone')} walking />} />
        {sheets}
      </>
    )

  // At a place, on its picture.
  const place = valid.place ?? area?.places[0] ?? 'home'
  return (
    <Backdrop src={backdropFor(valid.area, here.place)}>
      {hud}
      <Middle>
        <div className="flex flex-col gap-2" data-testid={`oal-at-${place}`}>
          <p className="glass self-start rounded-full border border-line px-4 py-2 text-sm font-semibold">{placeName(valid.area, place, here.place, life, t)}</p>
          {area?.walk && (
            <Button variant="ghost" onClick={() => go({ ...valid, walking: true })} data-testid="oal-walk-here">
              {t('oal.world.walk')}
            </Button>
          )}
          <OtherPanel place={place} travel={here} life={life} />
        </div>
      </Middle>
      {sheets}
    </Backdrop>
  )
}

function placeName(area: Area, place: Place | Other, town: string, life: Life, t: (k: string, o?: Record<string, unknown>) => string) {
  if (place === 'home') return town === life.home_town ? t('oal.world.places.familyHome') : t('oal.world.places.room')
  if (place === 'airport') return t(town === 'Accra' ? 'oal.world.places.airportACC' : 'oal.world.places.airportROB')
  if (place === 'visa') return t('oal.world.places.visa')
  if (place === 'jobs') return t('oal.world.places.jobs')
  if (area === 'town') return t(`oal.world.places.${place}`, { town })
  return t(`oal.street.towns.${area}.places.${place}`)
}

function OtherPanel({ place, travel, life }: { place: Place | Other; travel: TravelState; life: Life }) {
  if (place === 'home')
    return (
      <>
        <BodyPanel travel={travel} homeTown={life.home_town} homeCountry={life.home_country} />
        <RoomSection travel={travel} />
      </>
    )
  if (place === 'airport') return <Travel travel={travel} />
  if (place === 'visa') return <VisaOffice homeCountry={life.home_country} />
  if (place === 'jobs')
    return (
      <>
        <Work travel={travel} />
        <JobsAbroad homeCountry={life.home_country} />
      </>
    )
  return <PlacePanel place={place} travel={travel} homeCountry={life.home_country} />
}

// ---- The frame ---------------------------------------------------------------------------------

function Backdrop({ src, children }: { src: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-bg" data-testid="oal-life">
      <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-surface/35" />
      {children}
    </div>
  )
}

/** What is open in the world: under the clock, above the buttons, scrolling if long. */
function Middle({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-20 top-44 overflow-y-auto px-3" data-panel>
      <div className="glass mx-auto flex max-w-lg flex-col gap-3 rounded-3xl border border-line p-3">{children}</div>
    </div>
  )
}

// ---- Always on screen: clock, body, money; the map and the phone -----------------------------

function useMoney() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-money', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_balances').select('currency, amount').eq('user_id', user!.id)
      if (error) throw error
      return data as Balance[]
    },
  })
}

function Hud({ life, travel, onMap, onPhone, walking }: { life: Life; travel: TravelState; onMap: () => void; onPhone: () => void; walking?: boolean }) {
  const { t, i18n } = useTranslation()
  const now = useGameNow()()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(id)
  }, [])
  const money = useMoney()
  const [allMoney, setAllMoney] = useState(false)
  const [menu, setMenu] = useState(false)
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(now)
  const day = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(now)
  const b = travel.body
  const local = travel.country === 'LR' ? 'LRD' : 'GHS'
  const amount = (c: string) => money.data?.find((m) => m.currency === c)?.amount ?? 0
  const fmt = (c: string) => `${t(`oal.life.currencies.${c}`, { defaultValue: c })} ${(amount(c) / 100).toLocaleString(i18n.language, { maximumFractionDigits: 0 })}`
  const warning = b && (b.health < 30 ? t('oal.world.unwell') : b.rest < 15 ? t('oal.world.tired') : b.food < 15 ? t('oal.world.hungry') : null)
  return (
    <div data-hud className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3" data-testid="oal-hud">
      <div className="glass pointer-events-auto flex min-w-36 flex-col gap-1 rounded-2xl border border-line px-3 py-2">
        <p className="font-display text-xl font-extrabold leading-none tabular-nums" data-testid="oal-hud-time">
          {time}
        </p>
        <p className="text-xs text-muted">{day}</p>
        {b && (
          <div className="mt-1 flex flex-col gap-1" aria-label={t('oal.body.title')}>
            <Meter label={t('oal.body.food')} value={b.food} testId="oal-hud-food" />
            <Meter label={t('oal.body.rest')} value={b.rest} testId="oal-hud-rest" />
            <Meter label={t('oal.body.health')} value={b.health} testId="oal-hud-health" />
          </div>
        )}
        {warning && <p className="text-xs font-semibold text-alert">{warning}</p>}
        <div className="max-w-44 text-xs">
          <OverstayWarning travel={travel} homeCountry={life.home_country} />
        </div>
      </div>
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <button type="button" onClick={() => setAllMoney((v) => !v)} className="glass rounded-2xl border border-line px-3 py-2 text-right" aria-expanded={allMoney} data-testid="oal-hud-money">
            <span className="block font-display text-base font-extrabold leading-tight tabular-nums">{fmt(local)}</span>
            <span className="block text-xs tabular-nums text-muted">{fmt('USD')}</span>
          </button>
          <button type="button" onClick={() => setMenu((v) => !v)} className="glass h-11 w-11 rounded-full border border-line text-lg" aria-label={t('oal.world.menu')} aria-expanded={menu} data-testid="oal-menu">
            {'☰'}
          </button>
        </div>
        {allMoney && (
          <div className="glass rounded-2xl border border-line px-3 py-2 text-right text-sm tabular-nums" data-testid="oal-hud-money-all">
            {money.data?.map((m) => (
              <p key={m.currency}>{fmt(m.currency)}</p>
            ))}
            <p className="mt-1 max-w-44 text-xs text-muted">{t('oal.life.moneyHint')}</p>
          </div>
        )}
        {menu && (
          <div className="glass flex flex-col gap-1 rounded-2xl border border-line p-2 text-sm">
            <p className="px-2 font-semibold">{life.game_name}</p>
            <p className="px-2 text-xs" data-testid="oal-who">
              {t('oal.life.who', { age: Math.floor((now.getTime() - Date.parse(life.born_on)) / (365.25 * 24 * 3600 * 1000)), town: life.home_town, country: t(`oal.countries.${life.home_country}`) })}
            </p>
            <p className="px-2 text-xs text-muted">{t('oal.life.clockHint')}</p>
            <Link to="/lobby" className={buttonClass('ghost', 'min-h-11')}>
              {t('oal.world.leave')}
            </Link>
          </div>
        )}
      </div>
      {/* Walking: round buttons on the right, above the place's button; else a bar at the foot. */}
      <div className={walking ? 'pointer-events-auto fixed bottom-28 right-4 flex flex-col gap-3' : 'pointer-events-auto fixed inset-x-0 bottom-0 flex justify-center gap-3 p-3'}>
        <button type="button" onClick={onMap} className={`glass border border-line font-bold ${walking ? 'h-14 w-14 rounded-full text-xs' : 'min-h-12 flex-1 rounded-full text-base sm:max-w-48'}`} data-testid="oal-map">
          {t('oal.world.map')}
        </button>
        <button type="button" onClick={onPhone} className={`glass border border-line font-bold ${walking ? 'h-14 w-14 rounded-full text-xs' : 'min-h-12 flex-1 rounded-full text-base sm:max-w-48'}`} data-testid="oal-phone-button">
          {t('oal.world.phone')}
        </button>
      </div>
    </div>
  )
}

function Meter({ label, value, testId }: { label: string; value: number; testId: string }) {
  const tone = value < 25 ? 'bg-alert' : value < 50 ? 'bg-warn' : 'bg-brand'
  return (
    <div className="flex items-center gap-2" data-testid={testId} data-value={value} title={`${label} ${value}`}>
      <span className="w-12 text-[0.7rem] text-muted">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-line">
        <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId: string }) {
  const { t } = useTranslation()
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-surface/40" onClick={onClose}>
      <div className="glass flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-3xl border border-line p-4" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-extrabold text-accent">{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            {t('oal.street.done')}
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function MapSheet({ areas, here, life, spot, onGo, onClose }: { areas: ReturnType<typeof areasOf>; here: TravelState; life: Life; spot: Spot; onGo: (s: Spot) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t('oal.world.mapTitle', { town: here.place })} onClose={onClose} testId="oal-map-sheet">
      {areas.map((a) => (
        <div key={a.area} className="flex flex-col gap-2 border-t border-line pt-2">
          {a.walk ? (
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{t(`oal.street.towns.${a.walk}.where`)}</p>
              <Button variant="ghost" onClick={() => onGo({ area: a.area, walking: true })} data-testid={`oal-map-walk-${a.area}`}>
                {t('oal.world.walk')}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {a.places.map((p) => {
              const here_ = spot.area === a.area && (spot.place ?? a.places[0]) === p && !spot.walking
              return (
                <button key={p} type="button" onClick={() => onGo({ area: a.area, place: p })} aria-current={here_ ? 'location' : undefined} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${here_ ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel'}`} data-testid={`oal-map-${a.area}-${p}`}>
                  {placeName(a.area, p, here.place, life, t)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </Sheet>
  )
}

function PhoneSheet({ travel, life, onClose }: { travel: TravelState; life: Life; onClose: () => void }) {
  const { t } = useTranslation()
  const home = useHome()
  const [app, setApp] = useState<'messages' | 'jobs' | 'flights' | 'rooms'>('messages')
  const phone = home.data?.phone
  return (
    <Sheet title={t('oal.world.phone')} onClose={onClose} testId="oal-phone-sheet">
      {home.isPending ? (
        <Skeleton className="h-32" />
      ) : !phone ? (
        <p className="text-sm" data-testid="oal-no-phone">
          {t('oal.world.noPhone')}
        </p>
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {(['messages', 'jobs', 'flights', 'rooms'] as const).map((a) => (
              <button key={a} type="button" role="tab" aria-selected={app === a} onClick={() => setApp(a)} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${app === a ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel'}`} data-testid={`oal-app-${a}`}>
                {t(`oal.world.apps.${a}`)}
              </button>
            ))}
          </div>
          {app === 'messages' && <PhoneSection travel={travel} homeCountry={life.home_country} />}
          {app === 'jobs' && (
            <>
              <Work travel={travel} />
              <JobsAbroad homeCountry={life.home_country} />
            </>
          )}
          {app === 'flights' && <Travel travel={travel} />}
          {app === 'rooms' && <RoomSection travel={travel} />}
        </>
      )}
    </Sheet>
  )
}
