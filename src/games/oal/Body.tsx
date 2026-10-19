// One Africa Life: the body on the life's page. Food, rest and health (kept by the server on the
// game's clock: 20261023100000_oal_needs.sql), and what can be done for them in town: a meal with
// family at home, a cookshop plate, cooking where there is a kitchen, sleep, the clinic. While
// asleep or at the clinic, how long for. And a warning when staying past the date the
// immigration officer gave: the fine waiting at the airport.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'
import { type TravelState, useGameNow } from './Journey'

const at = (stamp: string) => new Date(`${stamp.replace(' ', 'T').slice(0, 19)}Z`)

function useBodyStep() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const run = async <T,>(body: Record<string, unknown>): Promise<(T & { ok: true }) | null> => {
    setBusy(true)
    try {
      const reply = await callFunction<T>('oal-home', body)
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
      for (const key of ['oal-travel', 'oal-money']) void queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
  return { run, busy }
}

function Bar({ label, value, testId }: { label: string; value: number; testId: string }) {
  const tone = value < 25 ? 'bg-alert' : value < 50 ? 'bg-warn' : 'bg-brand'
  return (
    <div className="flex flex-col gap-1" data-testid={testId} data-value={value}>
      <span className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </span>
      <div className="h-2 rounded-full bg-line">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

export function BodyPanel({ travel, homeTown, homeCountry }: { travel: TravelState; homeTown: string; homeCountry: 'LR' | 'GH' }) {
  const { t } = useTranslation()
  const now = useGameNow()()
  const { run, busy } = useBodyStep()
  const [hours, setHours] = useState(8)
  const b = travel.body
  if (!b) return null
  const atHome = travel.place === homeTown && travel.country === homeCountry
  const ateWithFamily = b.family_meal_on === now.toISOString().slice(0, 10)
  const lr = travel.country === 'LR'
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-body">
      <h2 className="text-sm font-semibold text-muted">{t('oal.body.title')}</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <Bar label={t('oal.body.food')} value={b.food} testId="oal-food" />
        <Bar label={t('oal.body.rest')} value={b.rest} testId="oal-rest" />
        <Bar label={t('oal.body.health')} value={b.health} testId="oal-health" />
      </div>
      {b.health < 30 && <p className="mt-2 text-sm text-alert">{t('oal.body.unwell')}</p>}
      {b.rest < 15 && b.health >= 30 && <p className="mt-2 text-sm text-warn">{t('oal.body.tired')}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {atHome && (
          <Button variant="ghost" disabled={busy || ateWithFamily} onClick={() => void run({ action: 'eat_family' })} data-testid="oal-eat-family">
            {ateWithFamily ? t('oal.body.ateWithFamily') : t('oal.body.eatFamily')}
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'eat_out' })} data-testid="oal-eat-out">
          {t('oal.body.eatOut', { price: lr ? 'L$250' : 'GH¢30' })}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'cook' })} data-testid="oal-cook">
          {t('oal.body.cook', { price: lr ? 'L$150' : 'GH¢15' })}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={hours} aria-label={t('oal.body.sleepHours')} onChange={(e) => setHours(Number(e.target.value))} className="min-h-11 rounded-xl border border-line bg-panel px-2">
          {[2, 4, 6, 8, 10].map((h) => (
            <option key={h} value={h}>
              {t('oal.work.hoursCount', { count: h })}
            </option>
          ))}
        </select>
        <Button disabled={busy} onClick={() => void run<{ rough: boolean }>({ action: 'sleep', hours }).then((r) => r?.rough && toast.info(t('oal.body.rough')))} data-testid="oal-sleep">
          {t('oal.body.sleep')}
        </Button>
        {b.health < 70 && (
          <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'clinic' })} data-testid="oal-clinic">
            {t('oal.body.clinic', { price: lr ? 'L$1,500' : 'GH¢60' })}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{t('oal.body.hint')}</p>
    </section>
  )
}

/** Asleep, or at the clinic: until when. */
export function Resting({ travel }: { travel: TravelState }) {
  const { t, i18n } = useTranslation()
  const until = travel.body?.busy_until
  const time = until ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(at(until)) : ''
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-resting">
      <h2 className="font-display text-xl font-extrabold">{travel.state === 'clinic' ? t('oal.body.atClinic', { time }) : t('oal.body.asleep', { time })}</h2>
      {travel.state === 'sleeping' && travel.body?.rough && <p className="mt-1 text-sm text-warn">{t('oal.body.rough')}</p>}
    </section>
  )
}

/** Staying past the date the officer gave, with no visa covering it: the fine waiting. */
export function OverstayWarning({ travel, homeCountry }: { travel: TravelState; homeCountry: 'LR' | 'GH' }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const now = useGameNow()()
  const abroad = travel.country !== homeCountry
  const papers = useQuery({
    queryKey: ['oal-stay', user?.id, travel.country],
    enabled: Boolean(user) && abroad,
    queryFn: async () => {
      const [entry, visas] = await Promise.all([
        supabase.from('oal_border_entries').select('permitted_until, category').eq('user_id', user!.id).eq('country', travel.country).eq('decision', 'admitted').order('id', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('oal_visas').select('valid_until').eq('user_id', user!.id).eq('country', travel.country),
      ])
      if (entry.error) throw entry.error
      if (visas.error) throw visas.error
      return { entry: entry.data as { permitted_until: string | null; category: string } | null, visas: visas.data as { valid_until: string }[] }
    },
  })
  if (!abroad || !papers.data?.entry?.permitted_until) return null
  const today = now.toISOString().slice(0, 10)
  const covered = [papers.data.entry.permitted_until, ...papers.data.visas.map((v) => v.valid_until)].sort().at(-1)!
  const date = (d: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))
  if (covered >= today) return <p className="text-sm text-muted">{t('oal.body.stayUntil', { date: date(covered) })}</p>
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${covered}T00:00:00Z`)) / 86_400_000)
  return (
    <p className="border border-alert bg-panel p-3 text-sm text-alert" data-testid="oal-overstay">
      {t('oal.body.overstay', { date: date(covered), days, fine: `US$${days * 10}` })}
    </p>
  )
}
