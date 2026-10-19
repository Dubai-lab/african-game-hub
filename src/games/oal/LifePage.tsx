// One Africa Life: the player's life. Someone who has not started one makes their character
// here, in the creator; someone who has sees their life: the game's clock, their money, where
// they are, and their journeys (./Journey.tsx). A room, the phone and work come next.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button, buttonClass } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { AGE, type Appearance, BUILD, CATALOGUE, checkGameName, defaultAppearance, FACE, HOME_TOWNS, type HomeCountry, type Sex } from '../../../supabase/functions/_shared/oal'
import type { Framing } from './CreatorScene'
import { OnTheWay, Travel, useGameNow, useTravel } from './Journey'
import { AtWork, JobsAbroad, MoneyChanger, VisaOffice, Work } from './Work'
import { PhoneSection, RoomSection } from './Home'

const CreatorScene = lazy(() => import('./CreatorScene'))

type Life = { game_name: string; sex: Sex; born_on: string; home_country: HomeCountry; home_town: string; appearance: Appearance }
type Balance = { currency: string; amount: number }

export default function LifePage() {
  const { user } = useAuth()
  const life = useQuery({
    queryKey: ['oal-life', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_lives').select('game_name, sex, born_on, home_country, home_town, appearance').eq('user_id', user!.id).maybeSingle()
      if (error) throw error
      return data as Life | null
    },
  })
  if (life.isPending) return <Skeleton className="m-4 h-96" />
  if (life.isError)
    return (
      <div className="p-4">
        <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
        <Button className="mt-3" onClick={() => void life.refetch()}>
          {'↻'}
        </Button>
      </div>
    )
  return life.data ? <LifeHome life={life.data} /> : <Creator />
}

// ---- The creator -----------------------------------------------------------------------------

type Tab = 'body' | 'face' | 'skin' | 'hair' | 'clothes' | 'you'
const TABS: Tab[] = ['body', 'face', 'skin', 'hair', 'clothes', 'you']

function Creator() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [appearance, setAppearance] = useState<Appearance>(() => defaultAppearance('male'))
  const [tab, setTab] = useState<Tab>('body')
  const [name, setName] = useState('')
  const [age, setAge] = useState(24)
  const [country, setCountry] = useState<HomeCountry>('LR')
  const [town, setTown] = useState<string>(HOME_TOWNS.LR[0])
  const [sending, setSending] = useState(false)
  const turn = useRef(0)
  const drag = useRef<{ x: number; turn: number } | null>(null)
  const framing: Framing = tab === 'face' || tab === 'hair' ? 'face' : 'full'

  const set = (patch: Partial<Appearance>) => setAppearance((a) => ({ ...a, ...patch }))
  const chooseSex = (sex: Sex) => {
    if (sex === appearance.sex) return
    const next = defaultAppearance(sex)
    setAppearance({ ...next, skin: appearance.skin, build: appearance.build, face: appearance.face, hairColour: appearance.hairColour, eyes: appearance.eyes })
  }

  const start = async () => {
    const gameName = checkGameName(name)
    if (!gameName) return toast.error(t('oal.creator.nameNeeded'))
    setSending(true)
    try {
      const reply = await callFunction('oal-start-life', { game_name: gameName, age, home_country: country, home_town: town, appearance })
      if (!reply.ok) return toast.error(refusalMessage(reply.code))
      await queryClient.invalidateQueries({ queryKey: ['oal-life'] })
    } catch {
      toast.error(t('errors.offline'))
    } finally {
      setSending(false)
    }
  }

  const slider = (label: string, value: number, onChange: (v: number) => void, min = -1, max = 1) => (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-sm font-semibold">
        <span>{label}</span>
      </span>
      <input type="range" min={min} max={max} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-brand" />
    </label>
  )
  const choice = (label: string, chosen: boolean, onClick: () => void, key: string) => (
    <button key={key} type="button" onClick={onClick} aria-pressed={chosen} className={`min-h-12 rounded-full border px-4 text-sm font-bold ${chosen ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel text-fg'}`}>
      {label}
    </button>
  )

  return (
    <div className="flex min-h-(--app-h) flex-col lg:flex-row" data-testid="oal-creator">
      {/* The character, large. Dragged sideways, it turns. */}
      <div
        className="relative h-[52vh] shrink-0 lg:h-auto lg:flex-1"
        onPointerDown={(e) => {
          // A tap on a button over the picture is the button's, not a turn.
          if ((e.target as HTMLElement).closest('button, a')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, turn: turn.current }
        }}
        onPointerMove={(e) => {
          if (drag.current) turn.current = drag.current.turn + (e.clientX - drag.current.x) * 0.012
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
          <CreatorScene appearance={appearance} framing={framing} turn={turn} />
        </Suspense>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <Link to="/lobby" className={buttonClass('ghost', 'min-h-11 px-4')}>
            {t('oal.back')}
          </Link>
          <div className="glass flex gap-1 rounded-full border border-line p-1">
            {(['male', 'female'] as const).map((sex) => choice(t(`oal.creator.sex.${sex}`), appearance.sex === sex, () => chooseSex(sex), sex))}
          </div>
        </div>
      </div>

      {/* The choices. */}
      <div className="flex flex-1 flex-col gap-4 p-4 lg:max-w-md">
        <h1 className="font-display text-2xl font-extrabold text-accent">{t('oal.creator.title')}</h1>
        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${tab === id ? 'bg-brand text-brand-ink' : 'border border-line bg-panel'}`}>
              {t(`oal.creator.tabs.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'body' && (
          <div className="flex flex-col gap-4">
            {BUILD.map((field) => slider(t(`oal.creator.build.${field}`), appearance.build[field], (v) => set({ build: { ...appearance.build, [field]: v } })))}
          </div>
        )}
        {tab === 'face' && (
          <div className="grid gap-4 sm:grid-cols-2">
            {FACE.map((field) => slider(t(`oal.creator.face.${field}`), appearance.face[field], (v) => set({ face: { ...appearance.face, [field]: v } })))}
          </div>
        )}
        {tab === 'skin' && (
          <div className="flex flex-col gap-4">
            {slider(t('oal.creator.skin'), appearance.skin, (v) => set({ skin: v }), 0, 1)}
            <p className="text-sm text-muted">{t('oal.creator.skinHint')}</p>
            <div className="flex flex-wrap gap-2">{CATALOGUE.eyes.map((id) => choice(t(`oal.creator.eyes.${id}`), appearance.eyes === id, () => set({ eyes: id }), id))}</div>
          </div>
        )}
        {tab === 'hair' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">{CATALOGUE.hair[appearance.sex].map((id) => choice(t(`oal.creator.hair.${id}`), appearance.hair === id, () => set({ hair: id }), id))}</div>
            <div className="flex flex-wrap gap-2">{CATALOGUE.hairColour.map((id) => choice(t(`oal.creator.hairColour.${id}`), appearance.hairColour === id, () => set({ hairColour: id }), id))}</div>
            <p className="text-sm text-muted">{t('oal.creator.hairHint')}</p>
          </div>
        )}
        {tab === 'clothes' && (
          <div className="flex flex-wrap gap-2">{CATALOGUE.outfit[appearance.sex].map((id) => choice(t(`oal.creator.outfit.${id}`), appearance.outfit === id, () => set({ outfit: id }), id))}</div>
        )}
        {tab === 'you' && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t('oal.creator.name')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="min-h-12 rounded-xl border border-line bg-panel px-3 text-fg" autoComplete="off" />
              <span className="text-xs text-muted">{t('oal.creator.nameHint')}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t('oal.creator.age', { age })}</span>
              <input type="range" min={AGE.min} max={AGE.max} value={age} onChange={(e) => setAge(Number(e.target.value))} className="accent-brand" />
            </label>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">{t('oal.creator.home')}</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(HOME_TOWNS) as HomeCountry[]).flatMap((c) =>
                  HOME_TOWNS[c].map((place) =>
                    choice(`${place}, ${t(`oal.countries.${c}`)}`, country === c && town === place, () => {
                      setCountry(c)
                      setTown(place)
                    }, `${c}-${place}`),
                  ),
                )}
              </div>
            </div>
            <Button className="min-h-14 text-lg" disabled={sending} onClick={() => void start()} data-testid="oal-start">
              {t('oal.creator.start')}
            </Button>
          </div>
        )}
        {tab !== 'you' && (
          <Button variant="ghost" onClick={() => setTab(TABS[TABS.indexOf(tab) + 1]!)}>
            {t('oal.creator.next')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---- The life ------------------------------------------------------------------------------

function useGameClock() {
  const gameNow = useGameNow()
  const [, tick] = useState(0)
  useEffect(() => {
    // A game minute is two real seconds.
    const timer = setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(timer)
  }, [])
  return gameNow()
}

function LifeHome({ life }: { life: Life }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const now = useGameClock()
  const money = useQuery({
    queryKey: ['oal-money', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('oal_balances').select('currency, amount').eq('user_id', user!.id)
      if (error) throw error
      return data as Balance[]
    },
  })
  const age = Math.floor((now.getTime() - Date.parse(life.born_on)) / (365.25 * 24 * 3600 * 1000))
  const date = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now)
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(now)
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4" data-testid="oal-life">
      <Link to="/lobby" className="font-semibold text-accent underline underline-offset-4">
        {t('oal.back')}
      </Link>
      <h1 className="font-display text-3xl font-extrabold text-accent">{life.game_name}</h1>
      <p className="text-muted">{t('oal.life.who', { age, town: life.home_town, country: t(`oal.countries.${life.home_country}`) })}</p>
      <section className="border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-muted">{t('oal.life.clock')}</h2>
        <p className="font-display text-2xl font-extrabold tabular-nums">{time}</p>
        <p>{date}</p>
        <p className="mt-1 text-xs text-muted">{t('oal.life.clockHint')}</p>
      </section>
      <section className="border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold text-muted">{t('oal.life.money')}</h2>
        {money.data?.map((b) => (
          <p key={b.currency} className="font-display text-xl font-extrabold tabular-nums">
            {b.currency} {(b.amount / 100).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        ))}
        <p className="mt-1 text-xs text-muted">{t('oal.life.moneyHint')}</p>
      </section>
      <Whereabouts life={life} />
    </div>
  )
}

/** Where the life is now: at home or abroad in a town, with its journeys; or on the way. */
function Whereabouts({ life }: { life: Life }) {
  const { t } = useTranslation()
  const travel = useTravel()
  if (travel.isPending) return <Skeleton className="h-32" />
  if (travel.isError)
    return (
      <div>
        <p className="text-alert">{refusalMessage('SERVER_ERROR')}</p>
        <Button className="mt-2" onClick={() => void travel.refetch()}>
          {'↻'}
        </Button>
      </div>
    )
  const here = travel.data
  return (
    <>
      {here.state === 'settled' && <p className="font-semibold">{t('oal.life.where', { town: here.place, country: t(`oal.countries.${here.country}`) })}</p>}
      {here.state === 'settled' && (
        <>
          <Work travel={here} />
          <MoneyChanger country={here.country} />
          <PhoneSection travel={here} homeCountry={life.home_country} />
          <RoomSection travel={here} />
          <VisaOffice homeCountry={life.home_country} />
          <JobsAbroad homeCountry={life.home_country} />
          <Travel travel={here} />
        </>
      )}
      {here.state === 'working' && <AtWork />}
      {here.state !== 'settled' && here.state !== 'working' && <OnTheWay travel={here} appearance={life.appearance} homeCountry={life.home_country} />}
    </>
  )
}
