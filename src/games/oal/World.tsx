// One Africa Life: the game's screen. The life is the world, full screen: the 3D street the
// player walks (./Street.tsx), or, where a place has no 3D yet, a picture of it with what can be
// done there. Over it, see-through, always: the game's clock and day, the body (food, rest,
// health), the money; a map to go anywhere in town (each place opens what can be done there; on a
// street that is in 3D, the player can walk it from there), and the phone, if the life has one
// (texts and mobile money, jobs, flights and hotels, rooms). Busy (at work, asleep, at the clinic,
// on a journey), the screen says so over the world. Going from one part of town to another is
// walked, or ridden by kekeh or taxi for the fare (out to the airport, a taxi); up-country, from
// the parking station (./Road.tsx), the journey is seen on the road.
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button, buttonClass } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { gates } from './homeModel'
import { useQueryClient } from '@tanstack/react-query'
import type { Appearance, HomeCountry, Sex } from '../../../supabase/functions/_shared/oal'
import { BodyPanel, OverstayWarning, Resting } from './Body'
import { RoomSection } from './Home'
import { OnTheWay, Travel, type TravelState, useGameNow, useTravel } from './Journey'
import { type MapPoint, MapView, type Mark, markAt, useTownMap } from './MapView'
import { HomeView, useHomeKind } from './HomeView'
import { PhoneDevice } from './Phone'
import { OnTheRoad, Station } from './Road'
import { PlacePanel, StreetView } from './Street'
import type { Place, TownId } from './StreetScene'
import { type Business, businessKey, businessOf, INSIDE_OF } from './city/business'
import type { HomeKind } from './HomeScene'
import { AtWork, JobsAbroad, VisaOffice, Work } from './Work'

export type Life = { game_name: string; sex: Sex; born_on: string; home_country: HomeCountry; home_town: string; appearance: Appearance }
type Balance = { currency: string; amount: number }

/** Where in town the player is: a 3D street (walking, maybe come to one of its places), or one
 * of the town's places shown on a picture. */
type Spot = { area: Area; place?: Place | Other; walking?: boolean; at?: { x: number; y: number; f: number }; biz?: Business }
type Other = 'home' | 'airport' | 'visa' | 'jobs' | 'station' | 'health'
type Area = TownId | 'town' | 'home' | 'airport' | 'visa' | 'jobs' | 'station' | 'health' | 'city' | 'biz'

/** Each town's areas and their places (3D where a street has been built). */
type AreaInfo = { area: Area; places: (Place | Other)[]; walk?: TownId }
function areasOf(town: string, country: 'LR' | 'GH'): AreaInfo[] {
  const capital = town === 'Monrovia' || town === 'Accra'
  const streets: AreaInfo[] =
    town === 'Monrovia'
      ? [
          { area: 'sinkor', places: ['cookshop', 'phone', 'starline', 'citrus', 'changer', 'kekeh', 'clinic'], walk: 'sinkor' },
          { area: 'waterside', places: ['stall', 'changer', 'cookshop'], walk: 'waterside' },
          { area: 'skd', places: ['tickets', 'stand', 'pitch'], walk: 'skd' },
        ]
      : town === 'Voinjama'
        ? [{ area: 'voinjama', places: ['stall', 'cookshop', 'phone', 'changer', 'kekeh', 'clinic'], walk: 'voinjama' }]
        : [{ area: 'town', places: ['cookshop', 'phone', 'changer', 'stall', 'kekeh', 'clinic'] }]
  const areas: AreaInfo[] = [{ area: 'home', places: ['home'] }, ...streets, { area: 'jobs', places: ['jobs'] }]
  if (capital) areas.push({ area: 'visa', places: ['visa'] }, { area: 'airport', places: ['airport'] })
  if (town === 'Monrovia' || town === 'Voinjama') areas.push({ area: 'station', places: ['station'] })
  if (town === 'Monrovia') areas.push({ area: 'health', places: ['health'] })
  return areas.filter((a) => country === 'LR' || a.area !== 'waterside')
}

/** The part of town an area is in: going between parts is walked or ridden; out to the airport
 * (Roberts International is at Harbel, 48 km), a taxi. */
function districtOf(town: string, area: Area): string {
  if (area === 'airport') return 'airport'
  if (town === 'Monrovia') return ({ city: 'sinkor', biz: 'sinkor', home: 'sinkor', sinkor: 'sinkor', waterside: 'downtown', jobs: 'downtown', visa: 'downtown', station: 'paynesville', skd: 'paynesville', health: 'congotown' } as Record<string, string>)[area] ?? 'sinkor'
  return 'town'
}
type Ride = 'walk' | 'kekeh' | 'taxi' | 'airport'
/** The places on Tubman Boulevard with an inside to walk into, and which. */
const INSIDE: Record<string, HomeKind> = { phone: 'phoneshop', starline: 'starline', citrus: 'citrus' }

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
  // Where the player last stood on a 3D street (its own metres), for the map's arrow.
  const walked = useRef<{ area: string; x: number; y: number; facing: number } | null>(null)
  const queryClient = useQueryClient()
  const [riding, setRiding] = useState<{ to: Spot; rides: Ride[] } | null>(null)
  // The GPS's target in the town (set on the map), until got there.
  const [target, setTarget] = useState<{ x: number; y: number; name: string } | null>(null)
  const townMap = useTownMap(travel.data?.place ?? '')
  const arrive = (next: Spot) => {
    setSpot(next)
    setSheet(null)
    setRiding(null)
    if (user) saveSpot(user.id, next)
  }
  /** To another part of town: how (walking, a kekeh, a taxi; out to the airport, a taxi). */
  const go = (next: Spot) => {
    const here_ = travel.data
    const from = spot ?? { area: 'home' as Area }
    if (!here_ || districtOf(here_.place, from.area) === districtOf(here_.place, next.area)) return arrive(next)
    setRiding({ to: next, rides: next.area === 'airport' || from.area === 'airport' ? ['airport'] : ['walk', 'kekeh', 'taxi'] })
  }
  const ride = async (how: Ride) => {
    if (!riding) return
    try {
      const reply = await callFunction<{ fare: number }>('oal-travel', { action: 'town_ride', mode: how })
      if (!reply.ok) return toast.error(refusalMessage(reply.code))
      arrive(riding.to)
    } catch {
      toast.error(t('errors.offline'))
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['oal-money'] })
    }
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
  // Monrovia is one town to walk (./city/CityScene.tsx): its streets, the family's compound, the
  // Ministry of Health's, the shops on Tubman Boulevard, all in it.
  const whole = here.place === 'Monrovia' && here.country === 'LR'
  const valid = spot && (areas.some((a) => a.area === spot.area) || (whole && (spot.area === 'city' || (spot.area === 'biz' && spot.biz)))) ? spot : { area: (atHomeTown ? 'home' : (areas.find((a) => a.walk)?.area ?? 'town')) as Area }
  /** Out into the town: at a place's door, or where it was left. */
  const outTo = (place: string) => arrive({ area: 'city', place: place as Place })
  // In Monrovia, chosen from the map's list: the GPS set to it (never there at once), but the
  // airport (48 km out of town: a taxi there).
  const guide = (next: Spot) => {
    const at = whole && next.area !== 'airport' && townMap.data ? markAt(townMap.data, { area: next.area, place: next.place ?? next.area }) : null
    if (!at) return go(next)
    setTarget({ x: at[0], y: at[1], name: placeName(next.area, (next.place ?? next.area) as Place | Other, here.place, life, t) })
    setSheet(null)
  }
  const hud = <Hud life={life} travel={here} onMap={() => setSheet('map')} onPhone={() => setSheet('phone')} />
  const sheets = (
    <>
      {sheet === 'map' && (
        <MapView
          town={here.place}
          marks={areas.flatMap((a) => a.places.map((p): Mark => ({ area: a.area, place: p, name: placeName(a.area, p, here.place, life, t), walk: Boolean(a.walk) })))}
          areaNames={Object.fromEntries(areas.filter((a) => a.places.length > 1).map((a) => [a.area, a.walk ? t(`oal.street.towns.${a.walk}.where`) : t('oal.world.places.townCentre', { town: here.place })]))}
          me={mapPoint(valid, walked.current)}
          onGo={(mark, walk) => go({ area: mark.area as Area, place: mark.place as Place | Other, walking: walk })}
          onClose={() => setSheet(null)}
          list={<MapList areas={areas} here={here} life={life} spot={valid} onGo={guide} />}
          onTarget={here.place === 'Monrovia' ? (tg) => setTarget(tg) : undefined}
        />
      )}
      {sheet === 'phone' && <PhoneDevice travel={here} homeCountry={life.home_country} onMap={() => setSheet('map')} onClose={() => setSheet(null)} />}
      {riding && <RideChoice country={here.country} rides={riding.rides} onRide={(how) => void ride(how)} onClose={() => setRiding(null)} />}
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
  if (here.state === 'on_road')
    return (
      <>
        <OnTheRoad travel={here} appearance={life.appearance} />
        <div className="pointer-events-none fixed inset-0 z-[45]">{hud}</div>
        {sheets}
      </>
    )
  // At home (or asleep at home): the home in 3D.
  if ((valid.area === 'home' && here.state === 'settled') || here.state === 'sleeping')
    return (
      <>
        <AtHome
          travel={here}
          life={life}
          hud={hud}
          onDoor={() => (whole && atHomeTown ? outTo('home') : setSheet('map'))}
          fromTown={whole && atHomeTown}
          fallback={
            <Backdrop src={backdropFor(here.state === 'sleeping' ? 'home' : valid.area, here.place)}>
              {hud}
              <Middle>{here.state === 'sleeping' ? <Resting travel={here} /> : <OtherPanel place="home" travel={here} life={life} />}</Middle>
            </Backdrop>
          }
        />
        {sheets}
      </>
    )
  if (here.state === 'working' || here.state === 'clinic')
    return (
      <Backdrop src={backdropFor(valid.area, here.place)}>
        {hud}
        <Middle>{here.state === 'working' ? <AtWork /> : <Resting travel={here} />}</Middle>
        {sheets}
      </Backdrop>
    )

  // Walking the town (Monrovia): from where it was left, or out of a place's door, or where a
  // street is entered.
  if (whole && (valid.area === 'city' || (valid.area === 'sinkor' && (valid.walking || !valid.place))))
    return (
      <>
        <StreetView
          key={`city:${valid.place ?? ''}:${valid.at ? 'at' : ''}`}
          town="sinkor"
          city={{ town: 'Monrovia', start: valid.at ?? { place: valid.area === 'sinkor' ? 'enter:sinkor' : (valid.place ?? 'home') } }}
          target={target}
          onArrived={() => setTarget(null)}
          travel={here}
          appearance={life.appearance}
          name={life.game_name}
          homeCountry={life.home_country}
          onMove={(x, y, facing) => {
            walked.current = { area: 'city', x, y, facing }
            if (user) saveSpot(user.id, { area: 'city', at: { x, y, f: facing } })
          }}
          onEnter={(p) => {
            // In through a gate or a door: a business of the town into its kind's inside.
            const biz = businessOf(p)
            if (biz) {
              if (!INSIDE_OF[biz.cat]) return false
              arrive({ area: 'biz', biz })
              return true
            }
            if (p === ('home' as Place)) arrive({ area: 'home' })
            else if (['jobs', 'visa'].includes(p)) arrive({ area: p as Area, place: p as Other })
            // The parking station: its tickets sold at the booth, out in the town.
            else if ((p as string) === 'station') return false
            else if (p === ('health-gate' as Place)) {
              // The police at the gate: asked one's business, let in (the gate slides open).
              if (!gates.health) toast.info(`${t('oal.health.gate.ask')} ${t('oal.health.gate.business')}`)
              gates.health = true
              setTimeout(() => toast.info(t('oal.health.gate.goIn')), 1200)
            } else if (p === ('health' as Place)) arrive({ area: 'health', place: 'health' })
            else if (!(p in INSIDE)) return false
            else arrive({ area: 'sinkor', place: p })
            return true
          }}
          hud={<Hud life={life} travel={here} onMap={() => setSheet('map')} onPhone={() => setSheet('phone')} walking />}
          panelOf={(p) => (p === 'station' ? <Station travel={here} /> : null)}
        />
        {sheets}
      </>
    )

  // Walking a 3D street.
  const area = areas.find((a) => a.area === valid.area)
  if (area?.walk && (valid.walking || !valid.place))
    return (
      <>
        <StreetView
          key={`${area.walk}:${valid.place ?? ''}`}
          town={area.walk}
          start={(valid.place as Place) ?? null}
          travel={here}
          appearance={life.appearance}
          name={life.game_name}
          homeCountry={life.home_country}
          onMove={(x, y, facing) => (walked.current = { area: valid.area, x, y, facing })}
          onEnter={(p) => {
            // A shop with an inside: in through its door.
            if (area.walk !== 'sinkor' || !(p in INSIDE)) return false
            arrive({ area: 'sinkor', place: p })
            return true
          }}
          hud={<Hud life={life} travel={here} onMap={() => setSheet('map')} onPhone={() => setSheet('phone')} walking />}
        />
        {sheets}
      </>
    )

  // Inside one of the town's businesses (its kind's inside, its own name): out of its door onto
  // the street before it.
  if (whole && valid.area === 'biz' && valid.biz) {
    const b = valid.biz
    const kind = INSIDE_OF[b.cat]!
    return (
      <>
        <HomeView
          key={businessKey(b)}
          kind={kind}
          title={b.name}
          cat={b.cat}
          travel={here}
          appearance={life.appearance}
          homeTown={life.home_town}
          homeCountry={life.home_country}
          hud={hud}
          onDoor={() => arrive({ area: 'city', at: { x: b.door[0], y: b.door[1], f: Math.atan2(-b.face[0], b.face[1]) } })}
          fromTown
        />
        {sheets}
      </>
    )
  }

  // Inside the Ministry of Health: out of its door, where next (on the map, walked or ridden).
  if (valid.area === 'health')
    return (
      <>
        <HomeView key="health" kind="health" travel={here} appearance={life.appearance} homeTown={life.home_town} homeCountry={life.home_country} hud={hud} onDoor={() => (whole ? outTo('health') : setSheet('map'))} fromTown={whole} />
        {sheets}
      </>
    )

  // Inside a shop on Tubman Boulevard: the phone shop, the networks' customer care.
  const inside = valid.area === 'sinkor' && valid.place ? INSIDE[valid.place] : undefined
  if (inside)
    return (
      <>
        <HomeView key={inside} kind={inside} travel={here} appearance={life.appearance} homeTown={life.home_town} homeCountry={life.home_country} hud={hud} onDoor={() => (whole ? outTo(valid.place!) : arrive({ area: 'sinkor', place: valid.place!, walking: true }))} fromTown={whole} />
        {sheets}
      </>
    )

  // In Monrovia, the visa office and the job centre: their buildings in the town, walked into
  // (an office inside), out of their doors onto the street again.
  if (whole && (valid.area === 'visa' || valid.area === 'jobs'))
    return (
      <>
        <HomeView
          key={valid.area}
          kind="office"
          title={placeName(valid.area, valid.area, here.place, life, t)}
          travel={here}
          appearance={life.appearance}
          homeTown={life.home_town}
          homeCountry={life.home_country}
          hud={hud}
          onDoor={() => outTo(valid.area)}
          fromTown
          panel={<OtherPanel place={valid.area} travel={here} life={life} />}
        />
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
  if (place === 'health') return t('oal.world.places.health')
  if (place === 'jobs') return t('oal.world.places.jobs')
  if (place === 'station') return t(town === 'Monrovia' ? 'oal.world.places.stationMonrovia' : 'oal.world.places.station', { town })
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
  if (place === 'station') return <Station travel={travel} />
  if (place === 'visa') return <VisaOffice homeCountry={life.home_country} />
  if (place === 'jobs')
    return (
      <>
        <Work travel={travel} />
        <JobsAbroad homeCountry={life.home_country} />
      </>
    )
  if (place === 'health') return null
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

/** The map's places as a list (for reading, and for those who would rather). */
function MapList({ areas, here, life, spot, onGo }: { areas: AreaInfo[]; here: TravelState; life: Life; spot: Spot; onGo: (s: Spot) => void }) {
  const { t } = useTranslation()
  return (
    <div className="glass flex flex-col gap-3 rounded-2xl border border-line p-3">
      {areas.map((a) => (
        <div key={a.area} className="flex flex-col gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0">
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
    </div>
  )
}

/** Where the player is on the town's map: on a 3D street, where they stood; else at the place. */
function mapPoint(spot: Spot, walked: { area: string; x: number; y: number; facing: number } | null): MapPoint {
  if (spot.area === 'city' && walked?.area === 'city') return { area: 'city', local: { x: walked.x, y: walked.y, facing: walked.facing } }
  if (spot.walking && walked && walked.area === spot.area) return { area: spot.area, local: { x: walked.x, y: walked.y, facing: walked.facing } }
  return { area: spot.area, place: spot.place }
}

const FARES: Record<'LR' | 'GH', Record<Ride, string>> = {
  LR: { walk: '', kekeh: 'L$100', taxi: 'L$150', airport: 'L$3,000' },
  GH: { walk: '', kekeh: 'GH¢10', taxi: 'GH¢15', airport: 'GH¢100' },
}

/** How to get there: walking, or a kekeh or taxi for its fare. */
function RideChoice({ country, rides, onRide, onClose }: { country: 'LR' | 'GH'; rides: Ride[]; onRide: (how: Ride) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t('oal.world.howTitle')} onClose={onClose} testId="oal-ride-choice">
      <div className="flex flex-col gap-2">
        {rides.map((how) => (
          <Button key={how} variant={how === 'walk' ? 'ghost' : undefined} onClick={() => onRide(how)} data-testid={`oal-ride-${how}`}>
            {t(`oal.world.ride.${how}`, { fare: FARES[country][how] })}
          </Button>
        ))}
      </div>
    </Sheet>
  )
}

/** Home in 3D where the life has one here (the family's house, a rented room); else the picture. */
function AtHome({ travel, life, hud, onDoor, fallback, fromTown }: { travel: TravelState; life: Life; hud: ReactNode; onDoor: () => void; fallback: ReactNode; fromTown?: boolean }) {
  const kind = useHomeKind(travel, life.home_town, life.home_country)
  if (kind === undefined) return <Skeleton className="fixed inset-0 rounded-none" />
  if (kind === null) return <>{fallback}</>
  return <HomeView kind={kind} travel={travel} appearance={life.appearance} homeTown={life.home_town} homeCountry={life.home_country} hud={hud} onDoor={onDoor} fromTown={fromTown && kind === 'house'} />
}
