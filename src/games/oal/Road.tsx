// One Africa Life: by road. At a parking station, the routes from this town (a shared car that
// leaves when full, the morning bus): the fare, the hours, a seat paid for in cash. On the road,
// the journey in 3D (./RoadScene.tsx, the player's character at the window), and how far: when
// it left, when it gets in. The server decides every step (public.oal_road_action).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import { type TravelState, useGameNow } from './Journey'

const RoadScene = lazy(() => import('./RoadScene'))

type Route = { id: string; country: 'LR' | 'GH'; from_town: string; to_town: string; mode: 'car' | 'bus'; station: string; fare: number; currency: 'LRD' | 'GHS'; hours: number; departs: string | null; opens: string; closes: string; km: number }
type RoadTrip = { id: number; route_id: string; boarded_at: string; departs_at: string; arrives_at: string; status: 'riding' | 'arrived' }

const at = (stamp: string) => new Date(`${stamp.replace(' ', 'T').slice(0, 19)}Z`)
const money = (cents: number, currency: string, language: string) => `${currency === 'LRD' ? 'L$' : 'GH¢'}${(cents / 100).toLocaleString(language, { maximumFractionDigits: 0 })}`

function useRoutes() {
  return useQuery({
    queryKey: ['oal-road-routes'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_road_routes').select('*').order('id')
      if (error) throw error
      return data as Route[]
    },
  })
}

function useRoadTrip() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-road-trip', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_road_trips').select('*').eq('user_id', user!.id).order('id', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data as RoadTrip | null
    },
  })
}

/** A parking station: where the cars and buses from this town go, and a seat on one. */
export function Station({ travel }: { travel: TravelState }) {
  const { t, i18n } = useTranslation()
  const routes = useRoutes()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  if (routes.isPending) return <Skeleton className="h-32" />
  if (routes.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
  const here = routes.data.filter((r) => r.from_town === travel.place && r.country === travel.country)
  const ride = async (route: Route) => {
    setBusy(true)
    try {
      const reply = await callFunction<{ departs: string; arrives: string }>('oal-travel', { action: 'ride', route: route.id })
      if (!reply.ok) toast.error(refusalMessage(reply.code))
      else toast.success(t('oal.road.boarded', { to: route.to_town }))
    } catch {
      toast.error(t('errors.offline'))
    } finally {
      setBusy(false)
      for (const key of ['oal-travel', 'oal-money', 'oal-road-trip']) void queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-station">
      <h2 className="text-sm font-semibold text-muted">{here[0]?.station ?? t('oal.road.station')}</h2>
      {here.length === 0 && <p className="mt-2 text-sm">{t('oal.road.none')}</p>}
      <ul className="mt-2 flex flex-col gap-3">
        {here.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 border-t border-line pt-2" data-testid={`oal-route-${r.id}`}>
            <p className="font-semibold">{t(`oal.road.mode.${r.mode}`, { to: r.to_town })}</p>
            <p className="text-sm text-muted">
              {r.mode === 'bus' ? t('oal.road.busTimes', { time: r.departs?.slice(0, 5), hours: r.hours }) : t('oal.road.carTimes', { opens: r.opens.slice(0, 5), closes: r.closes.slice(0, 5), hours: r.hours })} ·{' '}
              {t('oal.road.km', { km: r.km })}
            </p>
            <Button disabled={busy} onClick={() => void ride(r)} data-testid={`oal-ride-${r.id}`}>
              {t('oal.road.buy', { fare: money(r.fare, r.currency, i18n.language) })}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** On the road: the journey in 3D, and where it has got to. */
export function OnTheRoad({ travel, appearance }: { travel: TravelState; appearance: Appearance }) {
  const { t, i18n } = useTranslation()
  const trip = useRoadTrip()
  const routes = useRoutes()
  const now = useGameNow()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((k) => k + 1), 2000)
    return () => clearInterval(id)
  }, [])
  const route = routes.data?.find((r) => r.id === trip.data?.route_id)
  const time = (d: Date) => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
  if (!trip.data || !route) return <Skeleton className="fixed inset-0 rounded-none" />
  const departs = at(trip.data.departs_at)
  const arrives = at(trip.data.arrives_at)
  // Under way at the road's average speed up-country; still before it leaves.
  const speed = () => {
    const n = now().getTime()
    return n >= departs.getTime() && n < arrives.getTime() ? 15 : 0
  }
  const n = now().getTime()
  const progress = Math.max(0, Math.min(1, (n - departs.getTime()) / (arrives.getTime() - departs.getTime())))
  return (
    <div className="fixed inset-0 z-40 bg-bg" data-testid="oal-on-road" data-state={travel.state}>
      <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
        <RoadScene mode={route.mode} appearance={appearance} speed={speed} />
      </Suspense>
      <div className="glass absolute inset-x-3 bottom-24 mx-auto max-w-lg rounded-2xl border border-line p-3">
        <p className="font-semibold">{t(`oal.road.mode.${route.mode}`, { to: route.to_town })}</p>
        <p className="text-sm text-muted">
          {n < departs.getTime() ? t(route.mode === 'bus' ? 'oal.road.waitBus' : 'oal.road.waitCar', { time: time(departs) }) : t('oal.road.arrives', { time: time(arrives), km: Math.round(progress * route.km), total: route.km })}
        </p>
        <div className="mt-2 h-2 rounded-full bg-line">
          <div className="h-2 rounded-full bg-brand" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
