// One Africa Life: out on Tubman Boulevard. The 3D street (./StreetScene.tsx, loaded only when
// opened), the thumb stick and the drag to look, and, standing at one of the street's places,
// what can be done there: eat at Ma Hawa Cookshop, the phone shop and SIM agent, the money
// changer, the kekeh stop, the clinic. Each uses the same server steps as the life's page.
import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import type { Appearance } from '../../../supabase/functions/_shared/oal'
import type { Stick } from './ArrivalsScene'
import { PhoneSection } from './Home'
import type { TravelState } from './Journey'
import type { Place } from './StreetScene'
import { MoneyChanger, Work } from './Work'

const StreetScene = lazy(() => import('./StreetScene'))

export function StreetView({ travel, appearance, homeCountry, onClose }: { travel: TravelState; appearance: Appearance; homeCountry: 'LR' | 'GH'; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const stick = useRef<Stick>({ x: 0, y: 0 })
  const look = useRef<number | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ x: number; look: number } | null>(null)
  const base = useRef<{ x: number; y: number } | null>(null)
  const view = useRef<HTMLDivElement>(null)

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
    <div ref={view} className="fixed inset-0 z-50 bg-bg" data-testid="oal-street">
      <div
        className="absolute inset-0"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, [data-stick], [data-panel]')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, look: look.current ?? 0 }
        }}
        onPointerMove={(e) => {
          if (drag.current) look.current = drag.current.look - (e.clientX - drag.current.x) * 0.008
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
          <StreetScene
            appearance={appearance}
            stick={stick}
            look={look}
            paused={open}
            onPlace={(p) => {
              setPlace(p)
              if (!p) setOpen(false)
            }}
            onPosition={(x, y) => {
              view.current?.setAttribute('data-x', x.toFixed(2))
              view.current?.setAttribute('data-y', y.toFixed(2))
            }}
          />
        </Suspense>
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
        <Button variant="ghost" onClick={onClose}>
          {t('oal.back')}
        </Button>
        <p className="glass rounded-full border border-line px-4 py-2 text-sm font-semibold">{place ? t(`oal.street.places.${place}`) : t('oal.street.where')}</p>
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
      {place && !open && (
        <div className="absolute bottom-6 right-6">
          <Button className="min-h-14 px-6 text-lg" onClick={() => setOpen(true)} data-testid="oal-place-open">
            {t(`oal.street.open.${place}`)}
          </Button>
        </div>
      )}
      {place && open && (
        <div data-panel className="absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-3" data-testid={`oal-place-${place}`}>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('oal.street.done')}
            </Button>
          </div>
          {place === 'cookshop' && (
            <div className="glass flex flex-col gap-2 border border-line p-4">
              <p>{t('oal.street.cookshop')}</p>
              <Button disabled={busy} onClick={() => void step({ action: 'eat_out' }, t('oal.street.ate'))} data-testid="oal-street-eat">
                {t('oal.body.eatOut', { price: 'L$250' })}
              </Button>
            </div>
          )}
          {place === 'clinic' && (
            <div className="glass flex flex-col gap-2 border border-line p-4">
              <p>{t('oal.street.clinic')}</p>
              <Button disabled={busy} onClick={() => void step({ action: 'clinic' }, t('oal.street.seen'))} data-testid="oal-street-clinic">
                {t('oal.body.clinic', { price: 'L$1,500' })}
              </Button>
            </div>
          )}
          {place === 'phone' && <PhoneSection travel={travel} homeCountry={homeCountry} />}
          {place === 'changer' && <MoneyChanger country={travel.country} />}
          {place === 'kekeh' && <Work travel={travel} />}
        </div>
      )}
    </div>
  )
}
