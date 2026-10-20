// One Africa Life: home, as the world screen shows it. In the home town, the family's house; in
// another town, the room rented there; else none. The home in 3D (./HomeScene.tsx), walked with
// the thumb stick, its places (the bed: sleep; the kitchen and the table: cook, eat with family;
// the door: out, by the map) and, always to hand, what can be done at home. Asleep, the
// character lies in bed until morning, the time it wakes over it.
import { lazy, type ReactNode, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import type { Stick } from './ArrivalsScene'
import { BodyPanel, Resting } from './Body'
import { RoomSection, useHome } from './Home'
import type { HomeKind, HomePlace } from './HomeScene'
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

export function HomeView({ kind, travel, appearance, homeTown, homeCountry, hud, onDoor }: { kind: HomeKind; travel: TravelState; appearance: Appearance; homeTown: string; homeCountry: 'LR' | 'GH'; hud: ReactNode; onDoor: () => void }) {
  const { t } = useTranslation()
  const stick = useRef<Stick>({ x: 0, y: 0 })
  const base = useRef<{ x: number; y: number } | null>(null)
  const [place, setPlace] = useState<HomePlace | null>(null)
  const [open, setOpen] = useState(false)
  const asleep = travel.state === 'sleeping'
  // Dragged, the camera turns round the character (sideways) and tilts (up and down).
  const view = useRef({ yaw: 0, pitch: 0.95 })
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
          pitch: Math.max(0.25, Math.min(1.45, drag.current.pitch + (e.clientY - drag.current.y) * 0.006)),
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
        <HomeScene kind={kind} appearance={appearance} asleep={asleep} stick={stick} view={view} onPlace={setPlace} />
      </Suspense>
      {hud}
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
            {place === 'door' ? (
              <Button onClick={onDoor} data-testid="oal-home-door">
                {t('oal.home.goOut')}
              </Button>
            ) : (
              <Button onClick={() => setOpen(true)} data-testid="oal-home-menu">
                {place ? t(`oal.home.at.${place}`) : t('oal.home.things')}
              </Button>
            )}
          </div>
          {open && (
            <div data-panel className="glass absolute inset-x-0 bottom-0 z-10 mx-auto flex max-h-[75vh] max-w-lg flex-col gap-2 overflow-y-auto rounded-t-3xl border border-line p-3" data-testid="oal-home-panel">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{kind === 'house' ? t('oal.world.places.familyHome') : t('oal.world.places.room')}</p>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {t('oal.street.done')}
                </Button>
              </div>
              <BodyPanel travel={travel} homeTown={homeTown} homeCountry={homeCountry} />
              <RoomSection travel={travel} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
