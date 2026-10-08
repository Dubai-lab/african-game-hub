import { BusinessDetails } from './LegalPage'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { flagEmoji, guessCountry, useCountries } from '@/core/countries/useCountries'
import { buttonClass } from '@/core/ui/Button'
import { LanguageSwitcher } from '@/core/ui/LanguageSwitcher'
import {
  FALLBACK_COUNTRY_CODES,
  type LandingGame,
  useLandingGames,
  useLandingStats,
  useLandingTerms,
} from './landingData'

const heading = 'font-display text-[1.9rem] font-extrabold leading-[1.08] text-balance lg:text-[2.75rem]'
const shell = 'mx-auto w-full max-w-6xl px-5'

function useNumberFormat() {
  const { i18n } = useTranslation()
  return useMemo(() => new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en'), [i18n.resolvedLanguage])
}

/** The band motif, used between sections. `ground` is the colour of the section above it. */
export function Band({ ground }: { ground?: string }) {
  return <div className="band" role="presentation" style={ground ? { ['--band-ground' as string]: ground } : undefined} />
}

// Each upcoming game is a woven strip, not a card.
const STRIP_COLORS = ['bg-brand text-brand-ink', 'bg-hibiscus text-white', 'bg-palm text-white', 'bg-primary-soft text-white']

function gameName(t: (key: string, options: { defaultValue: string }) => string, game: LandingGame) {
  return t(`games.${game.id}`, { defaultValue: game.name })
}

export function Games({ playHref }: { playHref: string }) {
  const { t } = useTranslation()
  const format = useNumberFormat()
  const games = useLandingGames()
  const live = games.filter((g) => g.status === 'live')
  const soon = games.filter((g) => g.status === 'coming_soon')

  return (
    <section className={`${shell} py-14 lg:py-20`}>
      <h2 className={`${heading} text-primary`}>{t('landing.games.title')}</h2>
      <p className="mt-3 max-w-prose text-muted">{t('landing.games.sub')}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-stretch">
        <div className="flex flex-col gap-6">
          {live.map((game) => {
            const stakes = game.stakeLevels.filter((s) => s > 0)
            return (
              <article key={game.id} className="relative overflow-hidden border-2 border-ink bg-panel p-6 lg:p-8">
                {/* A corner of board, so the panel reads as chess before the words do. */}
                <div
                  aria-hidden="true"
                  className="absolute -right-6 -top-6 size-28 rotate-12 border-4 border-brand"
                  style={{
                    background:
                      'repeating-conic-gradient(var(--color-surface) 0 25%, var(--color-primary-soft) 0 50%) 0 0 / 50% 50%',
                  }}
                />
                <p className="inline-flex items-center gap-2 bg-hibiscus px-2.5 py-1 text-sm font-bold text-white">
                  <span className="size-2 rounded-full bg-white" aria-hidden="true" />
                  {t('landing.games.live')}
                </p>
                <h3 className="mt-4 font-display text-5xl font-extrabold text-primary">{gameName(t, game)}</h3>
                {t(`landing.games.${game.id}Blurb`, { defaultValue: '' }) && <p className="mt-3 max-w-md">{t(`landing.games.${game.id}Blurb`, { defaultValue: '' })}</p>}
                <ul className="mt-4 flex flex-col gap-1 text-sm font-semibold text-muted">
                  {game.minutes && (
                    <li>{t('landing.games.times', { min: game.minutes[0], max: game.minutes[1] })}</li>
                  )}
                  {stakes.length > 0 && (
                    <li>
                      {t('landing.games.stakes', {
                        min: format.format(Math.min(...stakes)),
                        max: format.format(Math.max(...stakes)),
                      })}
                    </li>
                  )}
                </ul>
                <Link to={playHref} className={buttonClass('primary', 'mt-6 w-full sm:w-auto')}>
                  {t('landing.games.play')}
                </Link>
              </article>
            )
          })}
        </div>

        {soon.length > 0 && (
          <ul className="flex min-h-64 gap-2">
            {soon.map((game, index) => (
              <li
                key={game.id}
                className={`flex min-w-0 flex-1 flex-col justify-between px-2 py-4 ${STRIP_COLORS[index % STRIP_COLORS.length]}`}
              >
                <span className="font-display text-2xl font-extrabold leading-none [writing-mode:vertical-rl]">
                  {gameName(t, game)}
                </span>
                <span className="text-xs font-bold leading-tight">{t('landing.games.soon')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export function HowItWorks() {
  const { t } = useTranslation()
  const format = useNumberFormat()
  const terms = useLandingTerms()
  const values = { tokens: format.format(terms.signupBonus), rake: format.format(terms.rakePercent) }
  const steps = t('landing.how.steps', { returnObjects: true, ...values }) as { title: string; body: string }[]

  return (
    <section className="bg-panel">
      <div className={`${shell} py-14 lg:py-20`}>
        <h2 className={`${heading} text-primary`}>{t('landing.how.title')}</h2>
        {/* Numbered because the order is real: each step needs the one before it. */}
        <ol className="mt-8 grid gap-0 lg:grid-cols-4 lg:gap-8">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex gap-4 pb-8 last:pb-0 lg:flex-col lg:pb-0">
              {/* The path between steps is a run of board squares. */}
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-[18px] top-12 bottom-1 w-2 [--path-direction:180deg] lg:left-14 lg:right-0 lg:top-[18px] lg:bottom-auto lg:h-2 lg:w-auto lg:[--path-direction:90deg]"
                  style={{
                    background:
                      'repeating-linear-gradient(var(--path-direction, 180deg), var(--color-line) 0 8px, transparent 8px 16px)',
                  }}
                />
              )}
              <span
                className={`relative flex size-11 shrink-0 items-center justify-center font-display text-xl font-extrabold ${index % 2 === 0 ? 'bg-primary text-surface' : 'bg-brand text-brand-ink'}`}
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-xl font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-[0.97rem] text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// A figure is shown only once it is worth showing. Small numbers make a new platform look empty.
const SHOW_FROM = { playersOnline: 25, matchesToday: 100, countries: 5 }

export function LiveNumbers() {
  const { t } = useTranslation()
  const format = useNumberFormat()
  const stats = useLandingStats()
  if (!stats) return null

  const figures = [
    { key: 'online', value: stats.playersOnline, from: SHOW_FROM.playersOnline },
    { key: 'matches', value: stats.matchesToday, from: SHOW_FROM.matchesToday },
    { key: 'countries', value: stats.countries, from: SHOW_FROM.countries },
  ].filter((f): f is { key: string; value: number; from: number } => f.value !== null && f.value >= f.from)
  if (figures.length === 0) return null

  return (
    <section className={`${shell} py-14 lg:py-20`}>
      <h2 className={`${heading} text-primary`}>{t('landing.numbers.title')}</h2>
      <dl className="mt-8 flex flex-wrap gap-x-14 gap-y-8">
        {figures.map((figure) => (
          <div key={figure.key} className="flex flex-col-reverse">
            <dt className="font-semibold text-muted">{t(`landing.numbers.${figure.key}`)}</dt>
            <dd className="font-display text-6xl font-extrabold tabular-nums text-primary lg:text-7xl">
              {format.format(figure.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function FairPlay() {
  const { t } = useTranslation()
  const items = t('landing.fair.items', { returnObjects: true }) as { title: string; body: string }[]
  return (
    <section className="bg-primary text-surface">
      <div className={`${shell} py-14 lg:py-20`}>
        <h2 className={`${heading} text-brand`}>{t('landing.fair.title')}</h2>
        <ul className="mt-6">
          {items.map((item) => (
            <li key={item.title} className="grid gap-2 border-t border-primary-soft py-6 lg:grid-cols-[1.4fr_1fr] lg:gap-10 lg:py-8">
              <h3 className="font-display text-2xl font-semibold leading-tight text-balance lg:text-4xl">{item.title}</h3>
              <p className="max-w-prose text-primary-tint lg:pt-2">{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function Countries() {
  const { t, i18n } = useTranslation()
  const { countries } = useCountries()
  // Known only in the browser, so it is filled in after the page has loaded.
  const [mine, setMine] = useState('')

  const list = useMemo(() => {
    if (countries.length > 0) return countries
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'region' })
    } catch {
      // No Intl.DisplayNames: show the codes until the database answers.
    }
    return FALLBACK_COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code, flag: flagEmoji(code) }))
  }, [countries, i18n.resolvedLanguage])

  useEffect(() => setMine(guessCountry(list)), [list])

  return (
    <section className={`${shell} py-14 lg:py-20`}>
      <h2 className={`${heading} text-primary`}>{t('landing.countries.title')}</h2>
      <p className="mt-3 text-muted">{t('landing.countries.sub', { count: list.length })}</p>
      <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5 text-lg leading-snug">
        {list.map((country) => (
          <li
            key={country.code}
            className={country.code === mine ? 'bg-brand px-2 font-bold text-brand-ink' : undefined}
          >
            <span aria-hidden="true">{country.flag}</span> {country.name}
          </li>
        ))}
      </ul>
      <p className="mt-8 max-w-prose font-semibold">{t('landing.countries.languages')}</p>
    </section>
  )
}

export function Footer() {
  const { t } = useTranslation()
  const link = 'underline underline-offset-4'
  return (
    <footer className="bg-ink text-surface">
      <div className={`${shell} flex flex-col gap-8 py-12`}>
        <div className="flex items-start gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-hibiscus font-display text-xl font-extrabold text-white">
            {t('landing.footer.age')}
          </span>
          <p className="max-w-prose text-primary-tint">{t('landing.footer.responsible')}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-3 font-semibold">
          <Link to="/terms" className={link}>
            {t('landing.footer.terms')}
          </Link>
          <Link to="/privacy" className={link}>
            {t('landing.footer.privacy')}
          </Link>
          <Link to="/cookies" className={link}>
            {t('landing.footer.cookies')}
          </Link>
          <Link to="/refunds" className={link}>
            {t('landing.footer.refunds')}
          </Link>
          <Link to="/responsible-gaming" className={link}>
            {t('landing.footer.responsibleLink')}
          </Link>
          <LanguageSwitcher />
        </nav>
        <BusinessDetails className="text-primary-tint" />
        <p className="text-sm text-primary-tint">{t('landing.footer.rights', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  )
}
