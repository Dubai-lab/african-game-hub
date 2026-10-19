// One Africa Life: a phone and its SIMs, and a room, on the life's page. A phone from the phone
// shop; a SIM from a network, registered at its shop with the document the law asks for (in
// Ghana a Ghanaian's Ghana Card, otherwise the passport), then airtime; a room rented with the
// landlord's advance (six months in Monrovia, twelve in Ghana), or life with family until then.
//
// Every step is the server's (the oal-home Edge Function, public.oal_home_action).
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
import { cash } from './Work'

type Currency = 'LRD' | 'USD' | 'GHS'
type Network = { id: string; country: 'LR' | 'GH'; name: string; colour: string; prefixes: string[]; sim_price: number }
type Handset = { id: string; country: 'LR' | 'GH'; kind: 'basic' | 'smart'; price: number }
type Sim = { network: string; number: string | null; id_kind: string | null; airtime: number }
type Room = { id: string; country: 'LR' | 'GH'; town: string; area: string; kind: string; currency: Currency; rent: number; advance: number }
type Lease = { room_id: string; starts_on: string; ends_on: string }

/** A number as people write it at home: +231771234567 → 077 123 4567. */
export const localNumber = (e164: string) => `0${e164.slice(4, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`

export function useHome() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-home', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const [networks, handsets, phone, sims, rooms, leases, card] = await Promise.all([
        supabase.from('oal_networks').select('*'),
        supabase.from('oal_handsets').select('*').order('price'),
        supabase.from('oal_phones').select('kind').eq('user_id', user!.id).maybeSingle(),
        supabase.from('oal_sims').select('network, number, id_kind, airtime').eq('user_id', user!.id),
        supabase.from('oal_rooms').select('*').order('rent'),
        supabase.from('oal_leases').select('room_id, starts_on, ends_on').eq('user_id', user!.id).order('ends_on', { ascending: false }),
        supabase.from('oal_id_cards').select('number').eq('user_id', user!.id).maybeSingle(),
      ])
      for (const r of [networks, handsets, phone, sims, rooms, leases, card]) if (r.error) throw r.error
      return {
        networks: networks.data as Network[],
        handsets: handsets.data as Handset[],
        phone: phone.data as { kind: 'basic' | 'smart' } | null,
        sims: sims.data as Sim[],
        rooms: rooms.data as Room[],
        leases: leases.data as Lease[],
        card: card.data as { number: string } | null,
      }
    },
  })
}

function useHomeStep() {
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
      for (const key of ['oal-home', 'oal-money']) void queryClient.invalidateQueries({ queryKey: [key] })
    }
  }
  return { run, busy }
}

export function PhoneSection({ travel, homeCountry }: { travel: TravelState; homeCountry: 'LR' | 'GH' }) {
  const { t, i18n } = useTranslation()
  const home = useHome()
  const { run, busy } = useHomeStep()
  const [topUp, setTopUp] = useState<Record<string, string>>({})
  if (home.isPending) return <Skeleton className="h-32" />
  if (home.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
  const { networks, handsets, phone, sims, card } = home.data
  const local: Currency = travel.country === 'LR' ? 'LRD' : 'GHS'
  const document = travel.country === 'GH' && homeCountry === 'GH' ? 'ghana_card' : 'passport'
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-phone">
      <h2 className="text-sm font-semibold text-muted">{t('oal.phone.title')}</h2>
      {phone ? (
        <p className="mt-1">{t(`oal.phone.have.${phone.kind}`)}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-muted">{t('oal.phone.none')}</p>
          <div className="flex flex-wrap gap-2">
            {handsets
              .filter((h) => h.country === travel.country)
              .map((h) => (
                <Button key={h.id} variant="ghost" disabled={busy} onClick={() => void run({ action: 'buy_phone', target: h.id })} data-testid={`oal-buy-${h.id}`}>
                  {t(`oal.phone.buy.${h.kind}`, { price: cash(h.price, local, i18n.language) })}
                </Button>
              ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t(`oal.phone.law.${travel.country}`)}</p>
      {card && <p className="mt-1 text-xs text-muted">{t('oal.phone.card', { number: card.number })}</p>}
      <ul className="mt-2 flex flex-col gap-2">
        {networks
          .filter((n) => n.country === travel.country)
          .map((n) => {
            const sim = sims.find((s) => s.network === n.id)
            return (
              <li key={n.id} className="flex flex-col gap-2 border-t border-line pt-2" data-testid={`oal-network-${n.id}`}>
                <span className="flex items-center gap-2 font-bold">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: n.colour }} aria-hidden />
                  {n.name}
                </span>
                {!sim && (
                  <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'buy_sim', target: n.id })} data-testid={`oal-buy-sim-${n.id}`}>
                    {t('oal.phone.buySim', { price: cash(n.sim_price, local, i18n.language) })}
                  </Button>
                )}
                {sim && !sim.number && (
                  <Button
                    disabled={busy}
                    onClick={() => void run<{ number: string }>({ action: 'register_sim', target: n.id }).then((r) => r && toast.success(t('oal.phone.registered', { number: localNumber(r.number) })))}
                    data-testid={`oal-register-${n.id}`}
                  >
                    {t('oal.phone.register', { document: t(`oal.phone.documents.${document}`) })}
                  </Button>
                )}
                {sim?.number && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-extrabold tabular-nums" data-testid={`oal-number-${n.id}`}>
                      {localNumber(sim.number)}
                    </span>
                    <span className="text-sm text-muted">{t('oal.phone.airtime', { amount: cash(sim.airtime, local, i18n.language) })}</span>
                    <input
                      value={topUp[n.id] ?? ''}
                      onChange={(e) => setTopUp({ ...topUp, [n.id]: e.target.value.replace(/[^0-9]/g, '') })}
                      inputMode="numeric"
                      className="min-h-11 w-24 rounded-xl border border-line bg-panel px-2"
                      aria-label={t('oal.phone.topUpAmount')}
                    />
                    <Button variant="ghost" disabled={busy || !Number(topUp[n.id])} onClick={() => void run({ action: 'top_up', target: n.id, amount: Number(topUp[n.id]) * 100 }).then(() => setTopUp({ ...topUp, [n.id]: '' }))}>
                      {t('oal.phone.topUp')}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
      </ul>
      {phone && sims.some((x) => x.number && networks.find((n) => n.id === x.network)?.country === travel.country) && (
        <div className="mt-3">
          <PhoneUse travel={travel} />
        </div>
      )}
    </section>
  )
}

export function RoomSection({ travel }: { travel: TravelState }) {
  const { t, i18n } = useTranslation()
  const home = useHome()
  const now = useGameNow()()
  const { run, busy } = useHomeStep()
  if (home.isPending) return <Skeleton className="h-32" />
  if (home.isError) return <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
  const { rooms, leases } = home.data
  const today = now.toISOString().slice(0, 10)
  const lease = leases.find((l) => l.ends_on > today)
  const leased = lease && rooms.find((r) => r.id === lease.room_id)
  const here = rooms.filter((r) => r.town === travel.place && r.country === travel.country)
  const date = (d: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-room">
      <h2 className="text-sm font-semibold text-muted">{t('oal.room.title')}</h2>
      <p className="mt-1">{leased ? t('oal.room.yours', { kind: t(`oal.room.kinds.${leased.kind}`), area: leased.area, town: leased.town, until: date(lease!.ends_on) }) : t('oal.room.family')}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {here.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 border-t border-line pt-2">
            <span>
              <span className="font-bold">
                {t(`oal.room.kinds.${r.kind}`)} · {r.area}
              </span>
              <br />
              <span className="text-sm text-muted">{t('oal.room.terms', { rent: cash(r.rent, r.currency, i18n.language), months: r.advance, total: cash(r.rent * r.advance, r.currency, i18n.language) })}</span>
            </span>
            <Button variant={leased?.id === r.id ? 'ghost' : undefined} disabled={busy || Boolean(leased && leased.id !== r.id)} onClick={() => void run<{ until: string }>({ action: 'rent', target: r.id }).then((x) => x && toast.success(t('oal.room.rented', { until: date(x.until) })))} data-testid={`oal-rent-${r.id}`}>
              {leased?.id === r.id ? t('oal.room.renew') : t('oal.room.rent')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- Using the phone: texts and mobile money -------------------------------------------------

type Text = { id: number; from_user: string; from_number: string; to_number: string; body: string; game_at: string; read_at: string | null }

function useTexts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-texts', user?.id],
    enabled: Boolean(user),
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_texts').select('id, from_user, from_number, to_number, body, game_at, read_at').order('id', { ascending: false }).limit(30)
      if (error) throw error
      return data as Text[]
    },
  })
}

function useWallet(currency: 'LRM' | 'GHM') {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-money', user?.id, currency],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_balances').select('amount').eq('user_id', user!.id).eq('currency', currency).maybeSingle()
      if (error) throw error
      return Number(data?.amount ?? 0)
    },
  })
}

/** Texts (an inbox, and a new one to any number) and the mobile money wallet on the SIM. */
export function PhoneUse({ travel }: { travel: TravelState }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const texts = useTexts()
  const queryClient = useQueryClient()
  const wallet = useWallet(travel.country === 'LR' ? 'LRM' : 'GHM')
  const { run, busy } = useHomeStep()
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const [amount, setAmount] = useState('')
  const [sendTo, setSendTo] = useState('')
  const local: Currency = travel.country === 'LR' ? 'LRD' : 'GHS'
  const unread = (texts.data ?? []).filter((x) => x.from_user !== user?.id && !x.read_at)
  const refresh = () => {
    for (const key of ['oal-texts', 'oal-money', 'oal-home']) void queryClient.invalidateQueries({ queryKey: [key] })
  }
  const time = (d: string) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 19)}Z`))
  const money = (action: string, extra: Record<string, unknown> = {}) =>
    void run({ action, amount: Number(amount) * 100, ...extra }).then((r) => {
      if (r) {
        setAmount('')
        toast.success(t(`oal.phone.momo.done.${action}`))
        refresh()
      }
    })
  return (
    <section className="border border-line bg-panel p-4" data-testid="oal-phone-use">
      <h2 className="text-sm font-semibold text-muted">
        {t('oal.phone.texts')} {unread.length > 0 && <span className="ml-1 rounded-full bg-brand px-2 text-brand-ink">{unread.length}</span>}
      </h2>
      <ul className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto" data-testid="oal-inbox">
        {(texts.data ?? []).map((x) => (
          <li key={x.id} className={`text-sm ${x.from_user === user?.id ? 'text-muted' : ''}`}>
            <span className="font-bold tabular-nums">{x.from_user === user?.id ? t('oal.phone.toNumber', { number: localNumber(x.to_number) }) : localNumber(x.from_number)}</span> · {time(x.game_at)}
            <br />
            {x.body}
          </li>
        ))}
        {texts.data?.length === 0 && <li className="text-sm text-muted">{t('oal.phone.noTexts')}</li>}
      </ul>
      {unread.length > 0 && (
        <Button variant="ghost" disabled={busy} onClick={() => void run({ action: 'read_texts' }).then(refresh)}>
          {t('oal.phone.markRead')}
        </Button>
      )}
      <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
        <input value={to} onChange={(e) => setTo(e.target.value.replace(/[^0-9+ ]/g, ''))} placeholder="077 123 4567" inputMode="tel" aria-label={t('oal.phone.toLabel')} className="min-h-11 rounded-xl border border-line bg-panel px-2 tabular-nums" data-testid="oal-text-to" />
        <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 160))} rows={2} aria-label={t('oal.phone.message')} className="rounded-xl border border-line bg-panel p-2" data-testid="oal-text-body" />
        <Button
          disabled={busy || !to || !body.trim()}
          onClick={() =>
            void run({ action: 'text', number: to, body: body.trim() }).then((r) => {
              if (r) {
                setBody('')
                toast.success(t('oal.phone.sent'))
                refresh()
              }
            })
          }
          data-testid="oal-text-send"
        >
          {t('oal.phone.send', { price: travel.country === 'LR' ? 'L$5' : 'GH¢0.10' })}
        </Button>
      </div>

      <h2 className="mt-4 text-sm font-semibold text-muted">{t('oal.phone.momo.title')}</h2>
      <p className="font-display text-xl font-extrabold tabular-nums" data-testid="oal-wallet">
        {cash(wallet.data ?? 0, local, i18n.language)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" aria-label={t('oal.phone.momo.amount')} className="min-h-11 w-28 rounded-xl border border-line bg-panel px-2" data-testid="oal-momo-amount" />
        <Button variant="ghost" disabled={busy || !Number(amount)} onClick={() => money('cash_in')} data-testid="oal-cash-in">
          {t('oal.phone.momo.cashIn')}
        </Button>
        <Button variant="ghost" disabled={busy || !Number(amount)} onClick={() => money('cash_out')} data-testid="oal-cash-out">
          {t('oal.phone.momo.cashOut')}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={sendTo} onChange={(e) => setSendTo(e.target.value.replace(/[^0-9+ ]/g, ''))} placeholder="077 123 4567" inputMode="tel" aria-label={t('oal.phone.momo.sendTo')} className="min-h-11 w-36 rounded-xl border border-line bg-panel px-2 tabular-nums" data-testid="oal-momo-to" />
        <Button disabled={busy || !Number(amount) || !sendTo} onClick={() => money('send_money', { number: sendTo })} data-testid="oal-momo-send">
          {t('oal.phone.momo.send')}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">{t('oal.phone.momo.fees', { least: travel.country === 'LR' ? 'L$5' : 'GH¢0.50' })}</p>
    </section>
  )
}
