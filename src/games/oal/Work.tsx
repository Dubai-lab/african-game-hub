// One Africa Life: work and money on the life's page. The jobs of the town the life is in (a stall
// at the market, a rented kekeh, an office), the commercial licence, the day at work, what the
// last days brought in, and the money changer.
//
// Every step is the server's (the oal-work Edge Function); chance, time and pay are decided there
// (20261020100000_oal_work.sql). The app sends the choice and shows what the server says.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { type TravelState, useGameNow } from './Journey'

type Currency = 'LRD' | 'USD' | 'GHS'
type Job = { id: string; kind: 'trader' | 'kekeh' | 'office'; country: 'LR' | 'GH'; town: string; place: string; currency: Currency; opens: string; closes: string; pay: Record<string, number> }
type Licence = { country: string; number: string; expires_on: string }
type Application = { id: number; kind: 'licence' | 'job' | 'visa'; target: string; ready_at: string; status: 'pending' | 'approved' | 'refused' }
type Employment = { job_id: string; since: string; owed: number }
type Shift = { id: number; job_id: string; starts_at: string; ends_at: string; status: 'running' | 'done'; stock: number; spent: number; earned: number; outcome: Record<string, number> | null }

const SYMBOL: Record<Currency, string> = { LRD: 'L$', USD: 'US$', GHS: 'GH¢' }
/** An amount in hundredths, as people write it. */
export const cash = (cents: number, currency: Currency, language: string) => `${SYMBOL[currency]}${(cents / 100).toLocaleString(language, { maximumFractionDigits: 0 })}`
const at = (stamp: string) => new Date(`${stamp.replace(' ', 'T').slice(0, 19)}Z`)

function useWork() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-work', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const [jobs, licences, applications, employments, shifts] = await Promise.all([
        supabase.from('oal_jobs').select('*'),
        supabase.from('oal_licences').select('country, number, expires_on').eq('user_id', user!.id),
        supabase.from('oal_applications').select('id, kind, target, ready_at, status').eq('user_id', user!.id).order('id', { ascending: false }),
        supabase.from('oal_employments').select('job_id, since, owed').eq('user_id', user!.id),
        supabase.from('oal_shifts').select('id, job_id, starts_at, ends_at, status, stock, spent, earned, outcome').eq('user_id', user!.id).order('id', { ascending: false }).limit(5),
      ])
      for (const r of [jobs, licences, applications, employments, shifts]) if (r.error) throw r.error
      return {
        jobs: jobs.data as unknown as Job[],
        licences: licences.data as Licence[],
        applications: applications.data as Application[],
        employments: employments.data as Employment[],
        shifts: shifts.data as unknown as Shift[],
      }
    },
  })
}

function useWorkStep() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const run = async <T,>(body: Record<string, unknown>): Promise<(T & { ok: true }) | null> => {
    setBusy(true)
    try {
      const reply = await callFunction<T>('oal-work', body)
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
      for (const key of ['oal-work', 'oal-travel', 'oal-money']) void queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
  return { run, busy }
}

// ---- The town's jobs -----------------------------------------------------------------------

export function Work({ travel }: { travel: TravelState }) {
  const { t, i18n } = useTranslation()
  const work = useWork()
  const now = useGameNow()()
  const { run, busy } = useWorkStep()
  const [stock, setStock] = useState('2000')
  const [hours, setHours] = useState(8)
  if (work.isPending) return <Skeleton className="h-40" />
  if (work.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
  const { jobs, licences, applications, employments, shifts } = work.data
  const here = jobs.filter((j) => j.town === travel.place && j.country === travel.country)
  const time = (d: Date) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
  const clock = now.toISOString().slice(11, 16)
  const licence = licences.find((l) => l.country === travel.country && l.expires_on > now.toISOString().slice(0, 10))
  const licenceApp = applications.find((a) => a.kind === 'licence' && a.target === travel.country && a.status === 'pending')
  const last = shifts.find((s) => s.status === 'done')
  const lastJob = last && jobs.find((j) => j.id === last.job_id)

  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-work">
      <h2 className="text-sm font-semibold text-muted">{t('oal.work.title', { town: travel.place })}</h2>
      {last && lastJob && (
        <p className="mt-2 text-sm" data-testid="oal-last-shift">
          {t(`oal.work.result.${lastJob.kind}`, {
            place: lastJob.place,
            sold: Math.round((last.outcome?.sold ?? 0) * 100),
            markup: Math.round((last.outcome?.markup ?? 0) * 100),
            passengers: last.outcome?.passengers ?? 0,
            took: cash(last.earned, lastJob.currency, i18n.language),
            spent: cash(last.spent, lastJob.currency, i18n.language),
            owed: cash(last.outcome?.owed ?? 0, lastJob.currency, i18n.language),
          })}
        </p>
      )}
      {here.length === 0 && <p className="mt-2 text-muted">{t('oal.work.none')}</p>}
      <ul className="mt-2 flex flex-col gap-3">
        {here.map((job) => {
          const open = clock >= job.opens.slice(0, 5) && clock < job.closes.slice(0, 5)
          const hoursPick = (
            <select value={hours} aria-label={t('oal.work.hours')} onChange={(e) => setHours(Number(e.target.value))} className="min-h-11 rounded-xl border border-line bg-panel px-2">
              {[2, 4, 6, 8, 10, 12].map((h) => (
                <option key={h} value={h}>
                  {t('oal.work.hoursCount', { count: h })}
                </option>
              ))}
            </select>
          )
          return (
            <li key={job.id} className="flex flex-col gap-2 border-t border-line pt-3" data-testid={`oal-job-${job.id}`}>
              <span className="font-bold">
                {t(`oal.work.kinds.${job.kind}`)} · {job.place}
              </span>
              <span className="text-sm text-muted">
                {t(`oal.work.about.${job.kind}`, {
                  opens: job.opens.slice(0, 5),
                  closes: job.closes.slice(0, 5),
                  dues: cash(job.pay.dues ?? 0, job.currency, i18n.language),
                  balance: cash(job.pay.balance ?? 0, job.currency, i18n.language),
                  fuel: cash(job.pay.fuel ?? 0, job.currency, i18n.language),
                  fare: cash(job.pay.fare ?? 0, job.currency, i18n.language),
                  salary: cash(job.pay.salary ?? 0, job.currency, i18n.language),
                })}
              </span>
              {job.kind === 'trader' && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    {t('oal.work.stock', { symbol: SYMBOL[job.currency] })}
                    <input value={stock} onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="min-h-11 w-28 rounded-xl border border-line bg-panel px-2" data-testid="oal-stock" />
                  </label>
                  {hoursPick}
                  <Button disabled={busy || !open || !Number(stock)} onClick={() => void run({ action: 'start_shift', job: job.id, hours, stock: Number(stock) * 100 })} data-testid={`oal-start-${job.id}`}>
                    {t('oal.work.goTrade')}
                  </Button>
                </div>
              )}
              {job.kind === 'kekeh' &&
                (licence ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{t('oal.work.licensed', { number: licence.number })}</span>
                    {hoursPick}
                    <Button disabled={busy || !open} onClick={() => void run({ action: 'start_shift', job: job.id, hours })} data-testid={`oal-start-${job.id}`}>
                      {t('oal.work.goRide')}
                    </Button>
                  </div>
                ) : licenceApp ? (
                  <span className="text-sm">{t('oal.work.licenceReady', { when: time(at(licenceApp.ready_at)) })}</span>
                ) : (
                  <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'apply', kind: 'licence', target: travel.country }).then((r) => r && toast.success(t('oal.work.licenceApplied')))} data-testid="oal-apply-licence">
                    {t('oal.work.applyLicence', { fee: travel.country === 'LR' ? 'L$2,500' : 'GH¢150' })}
                  </Button>
                ))}
              {job.kind === 'office' &&
                (() => {
                  const employed = employments.find((e) => e.job_id === job.id)
                  const app = applications.find((a) => a.kind === 'job' && a.target === job.id)
                  if (employed)
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">{t('oal.work.employed', { owed: cash(employed.owed, job.currency, i18n.language) })}</span>
                        <Button disabled={busy || !open} onClick={() => void run({ action: 'start_shift', job: job.id })} data-testid={`oal-start-${job.id}`}>
                          {t('oal.work.goOffice')}
                        </Button>
                      </div>
                    )
                  if (app?.status === 'pending') return <span className="text-sm">{t('oal.work.answerOn', { when: time(at(app.ready_at)) })}</span>
                  return (
                    <div className="flex flex-col gap-1">
                      {app?.status === 'refused' && <span className="text-sm text-warn">{t('oal.work.notTaken')}</span>}
                      <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'apply', kind: 'job', target: job.id }).then((r) => r && toast.success(t('oal.work.applied')))} data-testid={`oal-apply-${job.id}`}>
                        {t('oal.work.apply')}
                      </Button>
                    </div>
                  )
                })()}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---- At work ---------------------------------------------------------------------------------

export function AtWork() {
  const { t, i18n } = useTranslation()
  const work = useWork()
  const now = useGameNow()()
  const shift = work.data?.shifts.find((s) => s.status === 'running')
  const job = shift && work.data?.jobs.find((j) => j.id === shift.job_id)
  if (!shift || !job) return <Skeleton className="h-24" />
  const starts = at(shift.starts_at)
  const ends = at(shift.ends_at)
  const progress = Math.max(0, Math.min(1, (now.getTime() - starts.getTime()) / (ends.getTime() - starts.getTime())))
  const time = (d: Date) => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-at-work">
      <h2 className="font-display text-xl font-extrabold">{t(`oal.work.at.${job.kind}`, { place: job.place })}</h2>
      <div className="mt-3 h-2 rounded-full bg-line">
        <div className="h-2 rounded-full bg-brand" style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="mt-2 text-sm">{t('oal.work.until', { time: time(ends) })}</p>
      <p className="mt-1 text-xs text-muted">{t('oal.work.atHint')}</p>
    </section>
  )
}

// ---- The money changer ---------------------------------------------------------------------

export function MoneyChanger({ country }: { country: 'LR' | 'GH' }) {
  const { t, i18n } = useTranslation()
  const { run, busy } = useWorkStep()
  const [amount, setAmount] = useState('')
  const local: Currency = country === 'LR' ? 'LRD' : 'GHS'
  const change = (from: Currency) =>
    void run<{ currency: Currency; received: number }>({ action: 'exchange', from, amount: Number(amount) * 100 }).then((r) => {
      if (r) {
        setAmount('')
        toast.success(t('oal.money.changed', { got: cash(r.received, r.currency, i18n.language) }))
      }
    })
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-changer">
      <h2 className="text-sm font-semibold text-muted">{t('oal.money.changer')}</h2>
      <p className="mt-1 text-sm text-muted">{t('oal.money.rate', { local: SYMBOL[local], rate: country === 'LR' ? 190 : 12 })}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="min-h-11 w-28 rounded-xl border border-line bg-panel px-2" aria-label={t('oal.money.amount')} data-testid="oal-change-amount" />
        <Button disabled={busy || !Number(amount)} onClick={() => change(local)} data-testid="oal-buy-usd">
          {t('oal.money.buyUsd', { local: SYMBOL[local] })}
        </Button>
        <Button variant="ghost" disabled={busy || !Number(amount)} onClick={() => change('USD')} data-testid="oal-sell-usd">
          {t('oal.money.sellUsd', { local: SYMBOL[local] })}
        </Button>
      </div>
    </section>
  )
}

// ---- Jobs abroad, and the visa office ----------------------------------------------------

type Visa = { country: 'LR' | 'GH'; kind: 'long_visit' | 'work'; number: string; valid_until: string }

function useVisas() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-visas', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_visas').select('country, kind, number, valid_until').eq('user_id', user!.id).order('valid_until', { ascending: false })
      if (error) throw error
      return data as Visa[]
    },
  })
}

/** Office jobs in the other country, applied for from here (as people apply online). */
export function JobsAbroad({ homeCountry }: { homeCountry: 'LR' | 'GH' }) {
  const { t, i18n } = useTranslation()
  const work = useWork()
  const { run, busy } = useWorkStep()
  if (!work.data) return null
  const abroad = work.data.jobs.filter((j) => j.kind === 'office' && j.country !== homeCountry)
  const time = (d: Date) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-jobs-abroad">
      <h2 className="text-sm font-semibold text-muted">{t('oal.visa.jobsAbroad')}</h2>
      {abroad.map((job) => {
        const employed = work.data.employments.some((e) => e.job_id === job.id)
        const app = work.data.applications.find((a) => a.kind === 'job' && a.target === job.id)
        return (
          <div key={job.id} className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
            <span className="font-bold">
              {job.place}, {job.town}
            </span>
            <span className="text-sm text-muted">{t('oal.work.about.office', { salary: cash(job.pay.salary ?? 0, job.currency, i18n.language) })}</span>
            {employed ? (
              <span className="text-sm">{t('oal.visa.offer')}</span>
            ) : app?.status === 'pending' ? (
              <span className="text-sm">{t('oal.work.answerOn', { when: time(at(app.ready_at)) })}</span>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'apply', kind: 'job', target: job.id }).then((r) => r && toast.success(t('oal.work.applied')))} data-testid={`oal-apply-${job.id}`}>
                {t('oal.work.apply')}
              </Button>
            )}
          </div>
        )
      })}
    </section>
  )
}

/** The visa office: visas held, and applications for the other country. */
export function VisaOffice({ homeCountry }: { homeCountry: 'LR' | 'GH' }) {
  const { t, i18n } = useTranslation()
  const visas = useVisas()
  const work = useWork()
  const now = useGameNow()()
  const queryClient = useQueryClient()
  const { run, busy } = useWorkStep()
  const [months, setMonths] = useState(6)
  const other: 'LR' | 'GH' = homeCountry === 'LR' ? 'GH' : 'LR'
  const today = now.toISOString().slice(0, 10)
  const held = (visas.data ?? []).filter((v) => v.valid_until > today)
  const pending = (work.data?.applications ?? []).filter((a) => a.kind === 'visa' && a.status === 'pending')
  const date = (d: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))
  const time = (d: Date) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
  const applyFor = (target: string) =>
    void run({ action: 'apply', kind: 'visa', target }).then((r) => {
      if (r) {
        toast.success(t('oal.visa.applied'))
        void queryClient.invalidateQueries({ queryKey: ['oal-visas'] })
      }
    })
  const country = t(`oal.countries.${other}`)
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-visa">
      <h2 className="text-sm font-semibold text-muted">{t('oal.visa.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('oal.visa.ecowas', { country })}</p>
      {held.map((v) => (
        <p key={v.number} className="mt-2 font-bold" data-testid="oal-visa-held">
          {t(`oal.visa.held.${v.kind}`, { country: t(`oal.countries.${v.country}`), number: v.number, until: date(v.valid_until) })}
        </p>
      ))}
      {pending.map((a) => (
        <p key={a.id} className="mt-2 text-sm">
          {t('oal.visa.pending', { when: time(at(a.ready_at)) })}
        </p>
      ))}
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-2">
        <span className="font-bold">{t('oal.visa.longVisit', { country })}</span>
        <span className="text-sm text-muted">{t('oal.visa.longVisitAbout')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <select value={months} aria-label={t('oal.visa.months')} onChange={(e) => setMonths(Number(e.target.value))} className="min-h-11 rounded-xl border border-line bg-panel px-2">
            {[4, 6, 9, 12].map((m) => (
              <option key={m} value={m}>
                {t('oal.visa.monthsCount', { count: m })}
              </option>
            ))}
          </select>
          <Button disabled={busy} onClick={() => applyFor(`${other}:long_visit:${months}`)} data-testid="oal-apply-long-visit">
            {t('oal.visa.apply', { fee: 'US$100' })}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-2">
        <span className="font-bold">{t('oal.visa.work', { country })}</span>
        <span className="text-sm text-muted">{t('oal.visa.workAbout')}</span>
        <Button variant="ghost" disabled={busy} onClick={() => applyFor(`${other}:work`)} data-testid="oal-apply-work-visa">
          {t('oal.visa.apply', { fee: other === 'GH' ? 'US$300' : 'US$250' })}
        </Button>
      </div>
    </section>
  )
}
