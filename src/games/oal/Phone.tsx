// One Africa Life: the phone in the hand. A smartphone: its status bar (the network of the SIM
// registered here, the game's time, signal, battery), a home screen of apps, a search that
// finds the app for what is wanted, each app on the phone's own screen: messages and mobile
// money, SIM and airtime, jobs (here and abroad), housing (rooms to rent), flights and hotels,
// visas (applied for online), the wallet, the map. A basic keypad phone does what one does:
// calls, texts and mobile money, no internet. No phone: one must be bought at a phone shop.
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'
import { Skeleton } from '@/core/ui/Skeleton'
import { PhoneUse, RoomSection, SimStatus, useHome } from './Home'
import { Travel, type TravelState, useGameNow } from './Journey'
import { JobsAbroad, VisaOffice, Work } from './Work'

type App = 'messages' | 'sim' | 'jobs' | 'housing' | 'flights' | 'visa' | 'wallet' | 'map' | 'search'
const SMART: App[] = ['search', 'messages', 'jobs', 'housing', 'flights', 'visa', 'wallet', 'sim', 'map']
const BASIC: App[] = ['messages', 'wallet', 'sim']
// What a search finds: words that lead to each app.
const WORDS: Record<App, string[]> = {
  messages: ['text', 'message', 'sms', 'chat', 'momo', 'mobile money', 'send money', 'cash in', 'cash out'],
  sim: ['sim', 'airtime', 'top up', 'scratch card', 'network', 'register'],
  jobs: ['job', 'work', 'apply', 'employment', 'trader', 'kekeh', 'office', 'licence'],
  housing: ['house', 'room', 'rent', 'apartment', 'home', 'landlord'],
  flights: ['flight', 'plane', 'ticket', 'airport', 'hotel', 'travel', 'accra', 'monrovia'],
  visa: ['visa', 'permit', 'embassy', 'stay'],
  wallet: ['money', 'balance', 'wallet', 'dollar', 'cedi', 'bank'],
  map: ['map', 'where', 'direction', 'place', 'go'],
  search: [],
}
const ICON: Record<App, string> = { messages: '✉', sim: '▣', jobs: '◆', housing: '⌂', flights: '✈', visa: '✓', wallet: '$', map: '◎', search: '⌕' }
const TINT: Record<App, string> = { messages: '#2f8a4a', sim: '#6a3a8a', jobs: '#c8781e', housing: '#2f6fb8', flights: '#1f4fa8', visa: '#8a2a1c', wallet: '#e2b62a', map: '#2a8a8a', search: '#3a3a4a' }

function useWallet() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['oal-money', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_balances').select('currency, amount').eq('user_id', user!.id)
      if (error) throw error
      return data as { currency: string; amount: number }[]
    },
  })
}

export function PhoneDevice({ travel, homeCountry, onMap, onClose }: { travel: TravelState; homeCountry: 'LR' | 'GH'; onMap: () => void; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const home = useHome()
  const wallet = useWallet()
  const now = useGameNow()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((k) => k + 1), 2000)
    return () => clearInterval(id)
  }, [])
  const [app, setApp] = useState<App | null>(null)
  const [query, setQuery] = useState('')
  const phone = home.data?.phone
  const sim = home.data?.sims.find((s) => s.number && home.data!.networks.find((n) => n.id === s.network)?.country === travel.country)
  const network = sim ? home.data!.networks.find((n) => n.id === sim.network)?.name : null
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(now())
  const apps = phone?.kind === 'smart' ? SMART : BASIC
  // A new phone works once out of its box and charged (at home).
  const ready = Boolean(phone && phone.unboxed && (phone.charge === 'charged' || (phone.charge === 'charging' && phone.charged_at && new Date(`${phone.charged_at}Z`).getTime() <= now().getTime())))
  const hhmm = (at: string) => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`${at}Z`))
  const open = (a: App) => (a === 'map' ? onMap() : setApp(a))
  const found = query.trim()
    ? SMART.filter((a) => a !== 'search' && (t(`oal.phone.apps.${a}`).toLowerCase().includes(query.toLowerCase()) || WORDS[a].some((w) => w.includes(query.toLowerCase()) || query.toLowerCase().includes(w))))
    : []

  const screen: ReactNode = home.isPending ? (
    <Skeleton className="m-3 h-40" />
  ) : !phone ? (
    <p className="p-4 text-sm" data-testid="oal-no-phone">
      {t('oal.world.noPhone')}
    </p>
  ) : !ready ? (
    <p className="p-4 text-sm" data-testid="oal-phone-not-ready">
      {!phone.unboxed ? t('oal.phone.inBox') : phone.charge === 'flat' ? t('oal.phone.flat') : t('oal.phone.stillCharging', { time: phone.charged_at ? hhmm(phone.charged_at) : '' })}
    </p>
  ) : app === null ? (
    <div className={`grid gap-4 p-4 ${phone.kind === 'smart' ? 'grid-cols-3' : 'grid-cols-1'}`} data-testid="oal-phone-home">
      {apps.map((a) => (
        <button key={a} type="button" onClick={() => open(a)} className={`flex items-center gap-2 ${phone.kind === 'smart' ? 'flex-col' : 'flex-row rounded-lg border border-line px-3 py-2 text-left'}`} data-testid={`oal-app-${a}`}>
          <span className={`flex items-center justify-center text-2xl text-white ${phone.kind === 'smart' ? 'h-14 w-14 rounded-2xl' : 'h-8 w-8 rounded'}`} style={{ background: TINT[a] }} aria-hidden>
            {ICON[a]}
          </span>
          <span className="text-xs font-semibold">{t(`oal.phone.apps.${a}`)}</span>
        </button>
      ))}
    </div>
  ) : (
    <div className="flex flex-col gap-3 p-3" data-testid={`oal-phone-app-${app}`}>
      {app === 'search' && (
        <>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('oal.phone.searchHint')} aria-label={t('oal.phone.apps.search')} className="min-h-11 rounded-full border border-line bg-panel px-4" data-testid="oal-phone-search" autoFocus />
          {found.map((a) => (
            <button key={a} type="button" onClick={() => open(a)} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-left" data-testid={`oal-found-${a}`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-lg text-white" style={{ background: TINT[a] }} aria-hidden>
                {ICON[a]}
              </span>
              <span>
                <span className="block font-semibold">{t(`oal.phone.apps.${a}`)}</span>
                <span className="block text-xs text-muted">{t(`oal.phone.about.${a}`)}</span>
              </span>
            </button>
          ))}
          {query.trim() && found.length === 0 && <p className="text-sm text-muted">{t('oal.phone.nothing')}</p>}
        </>
      )}
      {app === 'messages' && (sim ? <PhoneUse travel={travel} /> : <p className="text-sm">{t('oal.phone.noSim')}</p>)}
      {app === 'sim' && <SimStatus travel={travel} />}
      {app === 'jobs' && (
        <>
          <Work travel={travel} />
          <JobsAbroad homeCountry={homeCountry} />
        </>
      )}
      {app === 'housing' && <RoomSection travel={travel} />}
      {app === 'flights' && <Travel travel={travel} />}
      {app === 'visa' && <VisaOffice homeCountry={homeCountry} />}
      {app === 'wallet' && (
        <div className="flex flex-col gap-2">
          {wallet.data?.map((b) => (
            <p key={b.currency} className="flex justify-between border-b border-line pb-2 tabular-nums">
              <span>{t(`oal.life.currencies.${b.currency}`, { defaultValue: b.currency })}</span>
              <span className="font-display font-extrabold">{(b.amount / 100).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </p>
          ))}
          <p className="text-xs text-muted">{t('oal.life.moneyHint')}</p>
        </div>
      )}
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-surface/50 p-3 sm:items-center" onClick={onClose}>
      {/* The phone: a black body, its screen, the status bar, the home bar. */}
      <div
        className="flex h-[min(88vh,760px)] w-[min(94vw,380px)] flex-col overflow-hidden rounded-[2.6rem] border-[10px] border-[#0c0c10] bg-[#14182e] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="oal-phone-sheet"
        data-kind={phone?.kind ?? 'none'}
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-2 text-xs font-semibold text-fg">
          <span className="tabular-nums">{time}</span>
          <span className="h-4 w-20 rounded-full bg-[#0c0c10]" aria-hidden />
          <span className="flex items-center gap-1">
            <span>{network ?? (phone ? t('oal.phone.noService') : '')}</span>
            <span aria-hidden>{sim ? '▂▄▆' : '▂'}</span>
            <span aria-hidden>▮</span>
          </span>
        </div>
        <div className="flex items-center justify-between px-3 py-1">
          {app ? (
            <button type="button" onClick={() => setApp(null)} className="min-h-10 rounded-full px-3 text-sm font-semibold text-accent" data-testid="oal-phone-back">
              ‹ {t(`oal.phone.apps.${app}`)}
            </button>
          ) : (
            <span className="px-3 text-sm font-semibold text-muted">{phone ? t(`oal.phone.have.${phone.kind}`) : t('oal.world.phone')}</span>
          )}
          <button type="button" onClick={onClose} className="min-h-10 rounded-full px-3 text-sm font-semibold" aria-label={t('oal.street.done')}>
            {t('oal.street.done')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{screen}</div>
        <button type="button" onClick={() => setApp(null)} className="mx-auto my-2 h-1.5 w-28 rounded-full bg-fg/60" aria-label={t('oal.phone.home')} />
      </div>
    </div>,
    document.body,
  )
}
