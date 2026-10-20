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
import { type ReactNode, useState } from 'react'
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

type Certificate = { number: string; full_name: string; sex: 'male' | 'female'; born_on: string; born_in: string; father: string; mother: string; witness: string | null; witness_relation: string | null; status: 'assessed' | 'paid' | 'lodged'; receipt: string | null; fee: number; applied_at: string; ready_at: string | null; collected_on: string | null }

function useCertificate() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-birth', user?.id],
    enabled: Boolean(user),
    // Read again at each window: it may have become ready since.
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('oal_birth_certificates')
        .select('number, full_name, sex, born_on, born_in, father, mother, witness, witness_relation, status, receipt, fee, applied_at, ready_at, collected_on')
        .eq('user_id', user!.id)
        .maybeSingle()
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

/** The form as filled in at the writing shelf (not yet handed in). */
export type BirthForm = { father: string; mother: string; witness: string; relation: string }
/** A visit to the Ministry: let in at the gate, the queue number from reception, the form. */
export type MinistryVisit = { admitted: boolean; ticket: Ticket | null; form: null | 'blank' | BirthForm }
/** The windows' staff, as the plan lists them: Window 1, Window 2 (collection), the cashier, reception. */
const STAFF = { counter: 0, collect: 1, cashier: 2, reception: 3 } as const

/**
 * The Ministry of Health, step by step. At the gate, the police officer asks your business and
 * lets you in. At reception, a queue number. At Window 1 when called, the application form;
 * filled in at the writing shelf (the parents, and an elder who witnesses the birth); handed in,
 * assessed: the fee to pay at the cashier, for a receipt; the receipt handed in at Window 1:
 * lodged, ready the next day (a text). At Window 2, the receipt shown, the register signed, the
 * certificate handed over. Each hand-over seen: the character and the clerk reach across.
 */
export function MinistryOfHealth({
  travel,
  place,
  visit,
  onVisit,
  onGesture,
  onStaff,
  onClose,
}: {
  travel: TravelState
  place: 'gate' | 'reception' | 'writing' | 'counter' | 'cashier' | 'collect' | null
  visit: MinistryVisit
  onVisit: (v: MinistryVisit) => void
  onGesture: (g: Omit<Gesture, 'seq'>) => void
  onStaff: (index: number) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const facts = useLifeFacts()
  const cert = useCertificate()
  const now = useGameNow()
  const { run, busy } = useHomeStep()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<BirthForm>({ father: '', mother: '', witness: '', relation: '' })
  const [working, setWorking] = useState(false)
  if (facts.isPending || cert.isPending) return <Skeleton className="h-32" />
  if (facts.isError || cert.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
  const f = facts.data
  const c = cert.data
  const fee = cash(150000, 'LRD', i18n.language)
  const say = (key: string, o?: Record<string, unknown>) => <p className="text-sm italic">{t(key, o)}</p>
  const time = (at: string) => new Intl.DateTimeFormat(i18n.language, { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`${at}Z`))
  const ready = Boolean(c?.ready_at && new Date(`${c.ready_at}Z`).getTime() <= now().getTime())
  // Across the window: the character reaches, the clerk reaches, then it is done.
  const handOver = async (staff: number, then: () => Promise<unknown> | void) => {
    setWorking(true)
    onClose()
    onGesture({ reach: true, to: `place:${place}` })
    onStaff(staff)
    await wait(1300)
    try {
      await then()
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['oal-birth'] })
      await wait(1800)
      setWorking(false)
    }
  }
  const field = (k: keyof BirthForm, label: string, max = 60) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value.slice(0, max) })} required minLength={2} className="min-h-11 rounded-xl border border-line bg-panel px-3" data-testid={`oal-birth-${k}`} />
    </label>
  )
  const called = visit.ticket !== null && visit.ticket.serving >= visit.ticket.mine
  if (f.home_country !== 'LR' || travel.country !== 'LR') return <p className="border border-line bg-panel p-4 text-sm">{t('oal.health.onlyLiberians')}</p>

  let body: ReactNode
  if (place === 'gate') {
    body = visit.admitted ? (
      say('oal.health.gate.goIn')
    ) : (
      <>
        {say('oal.health.gate.ask')}
        <Button
          onClick={() => {
            onVisit({ ...visit, admitted: true })
            toast.info(t('oal.health.gate.goIn'))
            onClose()
          }}
          data-testid="oal-gate-business"
        >
          {t('oal.health.gate.business')}
        </Button>
      </>
    )
  } else if (place === 'reception') {
    body = (
      <>
        {say(c?.status === 'lodged' ? 'oal.health.reception.collect' : 'oal.health.reception.hello')}
        {!visit.ticket && c?.status !== 'lodged' && (
          <Button
            onClick={() => {
              const mine = 20 + Math.floor(Math.random() * 60)
              onVisit({ ...visit, ticket: { mine, serving: mine - 3 } })
              toast.info(t('oal.office.ticket', { mine: `B${mine}`, serving: `B${mine - 3}` }))
              onClose()
            }}
            data-testid="oal-take-number"
          >
            {t('oal.health.reception.number')}
          </Button>
        )}
      </>
    )
  } else if (place === 'writing') {
    body =
      visit.form === 'blank' ? (
        <form
          className="flex flex-col gap-2"
          data-testid="oal-birth-form"
          onSubmit={(e) => {
            e.preventDefault()
            const filled = { father: draft.father.trim(), mother: draft.mother.trim(), witness: draft.witness.trim(), relation: draft.relation.trim() }
            onClose()
            onGesture({ reach: true, to: 'place:writing' })
            setTimeout(() => {
              onVisit({ ...visit, form: filled })
              toast.success(t('oal.health.form.done'))
            }, 3400)
          }}
        >
          <p className="font-semibold">{t('oal.health.form.title')}</p>
          <p className="text-xs text-muted">{t('oal.health.form.part1')}</p>
          <p className="text-sm">
            {t('oal.office.name')}: <b>{f.game_name}</b> · {t(`oal.health.sexes.${f.sex}`)}
          </p>
          <p className="text-sm">
            {t('oal.office.born')}: <b>{dateOf(f.born_on, i18n.language)}</b>, {f.home_town}
          </p>
          <p className="text-xs text-muted">{t('oal.health.form.part2')}</p>
          {field('father', t('oal.health.father'))}
          {field('mother', t('oal.health.mother'))}
          <p className="text-xs text-muted">{t('oal.health.form.part3')}</p>
          {field('witness', t('oal.health.form.witness'))}
          {field('relation', t('oal.health.form.relation'), 30)}
          <Button type="submit" disabled={Object.values(draft).some((v) => v.trim().length < 2)} data-testid="oal-birth-sign">
            {t('oal.health.form.sign')}
          </Button>
        </form>
      ) : visit.form ? (
        say('oal.health.form.ready')
      ) : (
        say('oal.health.form.none')
      )
  } else if (place === 'counter') {
    body = !c ? (
      !called ? (
        say(visit.ticket ? 'oal.office.notYet' : 'oal.health.counter.number', visit.ticket ? { mine: `B${visit.ticket.mine}`, serving: `B${visit.ticket.serving}` } : undefined)
      ) : visit.form === null ? (
        <>
          {say('oal.health.counter.giveForm')}
          <Button disabled={working} onClick={() => void handOver(STAFF.counter, () => onVisit({ ...visit, form: 'blank' }))} data-testid="oal-take-form">
            {t('oal.health.counter.takeForm')}
          </Button>
        </>
      ) : visit.form === 'blank' ? (
        say('oal.health.counter.fillFirst')
      ) : (
        <>
          {say('oal.health.counter.handIn')}
          <Button
            disabled={working || busy}
            onClick={() => {
              const form = visit.form as BirthForm
              void handOver(STAFF.counter, () => run({ action: 'birth_apply', ...form }).then((r) => r && toast.info(t('oal.health.counter.assessed', { fee }))))
            }}
            data-testid="oal-birth-apply"
          >
            {t('oal.health.counter.handInForm')}
          </Button>
        </>
      )
    ) : c.status === 'assessed' ? (
      say('oal.health.counter.payFirst', { fee })
    ) : c.status === 'paid' ? (
      <>
        {say('oal.health.counter.receipt')}
        <Button disabled={working || busy} onClick={() => void handOver(STAFF.counter, () => run({ action: 'birth_lodge' }).then((r) => r && toast.success(t('oal.health.applied'))))} data-testid="oal-birth-lodge">
          {t('oal.health.counter.handInReceipt', { receipt: c.receipt })}
        </Button>
      </>
    ) : (
      say(c.collected_on ? 'oal.health.haveIt' : ready ? 'oal.health.goCollect' : 'oal.health.processing', c.ready_at ? { time: time(c.ready_at) } : undefined)
    )
  } else if (place === 'cashier') {
    body =
      c?.status === 'assessed' ? (
        <>
          {say('oal.health.cashier.slip', { fee })}
          <Button disabled={working || busy} onClick={() => void handOver(STAFF.cashier, () => run<{ receipt: string }>({ action: 'birth_pay' }).then((r) => r && toast.success(t('oal.health.cashier.paid', { receipt: r.receipt }))))} data-testid="oal-birth-pay">
            {t('oal.health.cashier.pay', { fee })}
          </Button>
        </>
      ) : (
        say(c ? 'oal.health.cashier.done' : 'oal.health.cashier.nothing')
      )
  } else if (place === 'collect') {
    body = !c || c.status !== 'lodged' ? (
      say('oal.health.applyFirst')
    ) : c.collected_on ? (
      <CertificateView c={c} />
    ) : ready ? (
      <>
        {say('oal.health.collect.show')}
        <Button disabled={working || busy} onClick={() => void handOver(STAFF.collect, () => run({ action: 'birth_collect' }).then((r) => r && toast.success(t('oal.health.collected'))))} data-testid="oal-birth-collect">
          {t('oal.health.collect.button', { receipt: c.receipt })}
        </Button>
      </>
    ) : (
      say('oal.health.processing', { time: c.ready_at ? time(c.ready_at) : '' })
    )
  } else body = <p className="text-sm">{t('oal.health.hint')}</p>
  return (
    <section className="flex flex-col gap-3 border border-line bg-panel p-4" data-testid={`oal-health-${place ?? 'hall'}`}>
      {place && <p className="font-bold">{t(`oal.health.windows.${place}`)}</p>}
      {body}
    </section>
  )
}
