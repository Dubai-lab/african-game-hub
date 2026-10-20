// One Africa Life: the counters of offices walked into (./HomeView.tsx). A network's customer
// care: a ticket from the machine by the door, a seat until the number is called, then the
// desk: a SIM card bought; registered as the law asks: the form (name, date of birth, address),
// the identity document handed over and checked, the photograph taken at the camera, the
// fingerprints on the reader; the number given, the network's welcome text. The Ministry of
// Health's Vital Statistics office: the birth certificate applied for at its window (the form,
// the fee), ready the next day (a text says so), collected at the collection window.
//
// Every step that counts is the server's (the oal-home Edge Function).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { type Currency, localNumber, useHome, useHomeStep } from './Home'
import type { Gesture } from './HomeScene'
import { type TravelState, useGameNow } from './Journey'
import { cash } from './Work'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function useLifeFacts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-life-facts', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_lives').select('game_name, sex, born_on, home_town, home_country').eq('user_id', user!.id).single()
      if (error) throw error
      return data as { game_name: string; sex: 'male' | 'female'; born_on: string; home_town: string; home_country: 'LR' | 'GH' }
    },
  })
}

const dateOf = (day: string, language: string) => new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`))

/** The queue: a ticket's number, the number being served now. */
export type Ticket = { mine: number; serving: number }

const STEPS = ['form', 'document', 'photo', 'fingers', 'number'] as const

export function NetworkDesk({
  travel,
  homeCountry,
  network,
  ticket,
  onGesture,
  onFlash,
}: {
  travel: TravelState
  homeCountry: 'LR' | 'GH'
  network: string
  ticket: Ticket | null
  onGesture: (g: Omit<Gesture, 'seq'>) => void
  onFlash: () => void
}) {
  const { t, i18n } = useTranslation()
  const home = useHome()
  const facts = useLifeFacts()
  const { run, busy } = useHomeStep()
  const [step, setStep] = useState<number | null>(null)
  const [address, setAddress] = useState('')
  if (home.isPending || facts.isPending) return <Skeleton className="h-32" />
  if (home.isError || facts.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
  const n = home.data.networks.find((x) => x.id === network)
  if (!n) return null
  const sim = home.data.sims.find((s) => s.network === network)
  const local: Currency = travel.country === 'LR' ? 'LRD' : 'GHS'
  const document = travel.country === 'GH' && homeCountry === 'GH' ? 'ghana_card' : 'passport'
  const docName = t(`oal.phone.documents.${document}`)
  const called = ticket !== null && ticket.serving >= ticket.mine
  const register = async () => {
    // The officer's steps, each its moment and what the customer does; then the network's
    // system gives the number.
    setStep(1)
    await wait(1600)
    setStep(2)
    onGesture({ reach: false, to: 'camera' })
    await wait(900)
    onFlash()
    await wait(700)
    setStep(3)
    onGesture({ reach: true, to: 'reader' })
    await wait(3600)
    onGesture({ reach: true, to: 'reader' })
    await wait(3600)
    setStep(4)
    const r = await run<{ number: string }>({ action: 'register_sim', target: network })
    setStep(null)
    if (r) toast.success(t('oal.phone.registered', { number: localNumber(r.number) }))
  }
  return (
    <section className="flex flex-col gap-3 border border-line bg-panel p-4" data-testid="oal-network-desk">
      <p className="flex items-center gap-2 font-bold">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: n.colour }} aria-hidden />
        {t('oal.office.officer', { network: n.name })}
      </p>
      {!called && !sim?.number ? (
        <p className="text-sm" data-testid="oal-take-ticket-first">
          {ticket ? t('oal.office.notYet', { mine: `A${ticket.mine}`, serving: `A${ticket.serving}` }) : t('oal.office.ticketFirst')}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted">{t(`oal.phone.law.${travel.country}`)}</p>
          {!sim && (
            <Button disabled={busy} onClick={() => void run({ action: 'buy_sim', target: network })} data-testid={`oal-buy-sim-${network}`}>
              {t('oal.phone.buySim', { price: cash(n.sim_price, local, i18n.language) })}
            </Button>
          )}
          {sim && !sim.number && step === null && (
            <form
              className="flex flex-col gap-2 border-t border-line pt-2"
              data-testid="oal-sim-form"
              onSubmit={(e) => {
                e.preventDefault()
                void register()
              }}
            >
              <p className="text-sm font-semibold">{t('oal.office.form')}</p>
              <p className="text-sm">
                {t('oal.office.name')}: <b>{facts.data.game_name}</b>
              </p>
              <p className="text-sm">
                {t('oal.office.born')}: <b>{dateOf(facts.data.born_on, i18n.language)}</b>
              </p>
              <label className="flex flex-col gap-1 text-sm">
                {t('oal.office.address')}
                <input value={address} onChange={(e) => setAddress(e.target.value.slice(0, 80))} required minLength={3} className="min-h-11 rounded-xl border border-line bg-panel px-3" placeholder={t('oal.office.addressHint')} data-testid="oal-sim-address" />
              </label>
              <Button type="submit" disabled={busy || address.trim().length < 3} data-testid={`oal-register-${network}`}>
                {t('oal.office.handOver', { document: docName })}
              </Button>
            </form>
          )}
          {step !== null && (
            <ol className="flex flex-col gap-1 text-sm" data-testid="oal-register-steps">
              {STEPS.map((k, i) => (
                <li key={k} className={i < step ? 'text-muted line-through' : i === step ? 'font-semibold' : 'text-muted'}>
                  {i < step ? '✓ ' : i === step ? '… ' : ''}
                  {t(`oal.office.steps.${k}`, { document: docName })}
                </li>
              ))}
            </ol>
          )}
          {sim?.number && (
            <p data-testid={`oal-number-${network}`}>
              {t('oal.office.yourNumber')} <span className="font-display text-lg font-extrabold tabular-nums">{localNumber(sim.number)}</span>
            </p>
          )}
        </>
      )}
    </section>
  )
}

type Certificate = { number: string; full_name: string; sex: 'male' | 'female'; born_on: string; born_in: string; father: string; mother: string; applied_at: string; ready_at: string; collected_on: string | null }

function useCertificate() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-birth', user?.id],
    enabled: Boolean(user),
    // Read again at each window: it may have become ready since.
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_birth_certificates').select('number, full_name, sex, born_on, born_in, father, mother, applied_at, ready_at, collected_on').eq('user_id', user!.id).maybeSingle()
      if (error) throw error
      return data as Certificate | null
    },
  })
}

/** The certificate itself, as it is printed. */
export function CertificateView({ c }: { c: Certificate }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="rounded-lg border-4 border-double border-[#1f5a3a] bg-[#fbf8ee] p-4 text-[#1a1a1a]" data-testid="oal-birth-certificate">
      <p className="text-center text-xs font-bold tracking-wide">{t('oal.health.republic')}</p>
      <p className="text-center text-xs">{t('oal.health.ministry')}</p>
      <p className="mt-1 text-center font-display text-lg font-extrabold">{t('oal.health.certificate')}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt>{t('oal.office.name')}</dt>
        <dd className="font-bold">{c.full_name}</dd>
        <dt>{t('oal.health.sex')}</dt>
        <dd>{t(`oal.health.sexes.${c.sex}`)}</dd>
        <dt>{t('oal.office.born')}</dt>
        <dd>{dateOf(c.born_on, i18n.language)}</dd>
        <dt>{t('oal.health.bornIn')}</dt>
        <dd>{c.born_in}</dd>
        <dt>{t('oal.health.father')}</dt>
        <dd>{c.father}</dd>
        <dt>{t('oal.health.mother')}</dt>
        <dd>{c.mother}</dd>
      </dl>
      <p className="mt-2 text-right text-xs tabular-nums">{c.number}</p>
    </div>
  )
}

/** The Vital Statistics office's windows: birth registration (apply), collection. */
export function BirthOffice({ travel, window: at }: { travel: TravelState; window: 'counter' | 'collect' }) {
  const { t, i18n } = useTranslation()
  const facts = useLifeFacts()
  const cert = useCertificate()
  const now = useGameNow()
  const { run, busy } = useHomeStep()
  const queryClient = useQueryClient()
  const [father, setFather] = useState('')
  const [mother, setMother] = useState('')
  if (facts.isPending || cert.isPending) return <Skeleton className="h-32" />
  if (facts.isError || cert.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
  const f = facts.data
  const c = cert.data
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['oal-birth'] })
  const time = (at: string) => new Intl.DateTimeFormat(i18n.language, { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`${at}Z`))
  if (f.home_country !== 'LR' || travel.country !== 'LR') return <p className="border border-line bg-panel p-4 text-sm">{t('oal.health.onlyLiberians')}</p>
  const ready = c && new Date(`${c.ready_at}Z`).getTime() <= now().getTime()
  return (
    <section className="flex flex-col gap-3 border border-line bg-panel p-4" data-testid={`oal-health-${at}`}>
      <p className="font-bold">{t(`oal.health.windows.${at}`)}</p>
      {at === 'counter' &&
        (c ? (
          <p className="text-sm">{c.collected_on ? t('oal.health.haveIt') : ready ? t('oal.health.goCollect') : t('oal.health.processing', { time: time(c.ready_at) })}</p>
        ) : (
          <form
            className="flex flex-col gap-2"
            data-testid="oal-birth-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run({ action: 'birth_apply', father: father.trim(), mother: mother.trim() }).then((r) => {
                refresh()
                if (r) toast.success(t('oal.health.applied'))
              })
            }}
          >
            <p className="text-sm text-muted">{t('oal.health.clerk')}</p>
            <p className="text-sm">
              {t('oal.office.name')}: <b>{f.game_name}</b> · {t(`oal.health.sexes.${f.sex}`)}
            </p>
            <p className="text-sm">
              {t('oal.office.born')}: <b>{dateOf(f.born_on, i18n.language)}</b>, {f.home_town}
            </p>
            <label className="flex flex-col gap-1 text-sm">
              {t('oal.health.father')}
              <input value={father} onChange={(e) => setFather(e.target.value.slice(0, 60))} required minLength={2} className="min-h-11 rounded-xl border border-line bg-panel px-3" data-testid="oal-birth-father" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('oal.health.mother')}
              <input value={mother} onChange={(e) => setMother(e.target.value.slice(0, 60))} required minLength={2} className="min-h-11 rounded-xl border border-line bg-panel px-3" data-testid="oal-birth-mother" />
            </label>
            <Button type="submit" disabled={busy || father.trim().length < 2 || mother.trim().length < 2} data-testid="oal-birth-apply">
              {t('oal.health.apply', { fee: cash(150000, 'LRD', i18n.language) })}
            </Button>
          </form>
        ))}
      {at === 'collect' &&
        (!c ? (
          <p className="text-sm">{t('oal.health.applyFirst')}</p>
        ) : c.collected_on ? (
          <CertificateView c={c} />
        ) : ready ? (
          <Button
            disabled={busy}
            onClick={() =>
              void run({ action: 'birth_collect' }).then((r) => {
                refresh()
                if (r) toast.success(t('oal.health.collected'))
              })
            }
            data-testid="oal-birth-collect"
          >
            {t('oal.health.collect')}
          </Button>
        ) : (
          <p className="text-sm">{t('oal.health.processing', { time: time(c.ready_at) })}</p>
        ))}
    </section>
  )
}
