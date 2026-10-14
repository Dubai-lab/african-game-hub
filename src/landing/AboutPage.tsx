import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { env } from '@/core/lib/env'
import { LanguageSwitcher } from '@/core/ui/LanguageSwitcher'
import { FOUNDER } from './founder'
import { Band, Footer, Games, LiveNumbers } from './sections'

// Who we are and what the hub is for. Only what the hub really does today; what is planned is
// said to be planned, and nothing here promises money.
const heading = 'font-display text-[1.9rem] font-extrabold leading-[1.08] text-balance lg:text-[2.75rem]'
const shell = 'mx-auto w-full max-w-6xl px-5'

export default function AboutPage() {
  const { t } = useTranslation()
  const { status } = useAuth()
  const signedIn = status === 'authenticated'
  const playHref = signedIn ? '/lobby' : '/signup'
  const pillars = t('about.built.items', { returnObjects: true }) as { title: string; body: string }[]
  const promises = t('about.promises.items', { returnObjects: true }) as { title: string; body: string }[]
  const contact = env?.VITE_CONTACT_EMAIL

  return (
    <div className="overflow-x-clip">
      <section className="bg-primary text-surface">
        <div className={shell}>
          <header className="flex items-center justify-between gap-3 py-4">
            <Link to="/" className="font-display text-lg font-extrabold">
              {t('app.name')}
            </Link>
            <LanguageSwitcher />
          </header>
          <div className="pb-14 pt-10 lg:pb-24 lg:pt-16">
            <p className="font-bold text-brand">{t('about.kicker')}</p>
            <h1 className="mt-3 max-w-4xl font-display text-[3rem] font-extrabold leading-[0.95] text-balance lg:text-[5.5rem]">{t('about.title')}</h1>
            <p className="mt-6 max-w-2xl text-lg text-primary-tint lg:text-xl">{t('about.intro')}</p>
          </div>
        </div>
      </section>
      <Band />

      <main>
        {/* The mission, on its own, large. */}
        <section className={`${shell} py-14 lg:py-20`}>
          <h2 className={`${heading} text-primary`}>{t('about.mission.title')}</h2>
          <p className="mt-5 max-w-3xl text-xl font-semibold leading-relaxed lg:text-2xl">{t('about.mission.body')}</p>
        </section>

        {/* What the hub is, in three. */}
        <section className="bg-panel">
          <div className={`${shell} py-14 lg:py-20`}>
            <h2 className={`${heading} text-primary`}>{t('about.built.title')}</h2>
            <ul className="mt-8 grid gap-4 lg:grid-cols-3">
              {pillars.map((item, index) => (
                <li key={item.title} className="border-2 border-ink bg-surface p-5">
                  <span className={`inline-block px-2 py-0.5 text-sm font-extrabold ${index === 1 ? 'bg-brand text-brand-ink' : index === 2 ? 'bg-hibiscus text-white' : 'bg-primary text-surface'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-3 font-display text-2xl font-extrabold leading-tight">{item.title}</h3>
                  <p className="mt-2 text-muted">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <LiveNumbers />
        <Games playHref={playHref} />

        {/* What we hold ourselves to. */}
        <section className="bg-primary text-surface">
          <div className={`${shell} py-14 lg:py-20`}>
            <h2 className={`${heading} text-brand`}>{t('about.promises.title')}</h2>
            <ol className="mt-6">
              {promises.map((item, index) => (
                <li key={item.title} className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 border-t border-primary-soft py-6 lg:grid-cols-[5rem_1.2fr_1fr] lg:gap-10 lg:py-8">
                  <span className="row-span-2 font-display text-4xl font-extrabold text-brand lg:row-span-1 lg:text-5xl">{index + 1}</span>
                  <h3 className="font-display text-2xl font-semibold leading-tight text-balance lg:text-3xl">{item.title}</h3>
                  <p className="max-w-prose text-primary-tint lg:pt-1">{item.body}</p>
                </li>
              ))}
            </ol>
            <Link to="/responsible-gaming" className="mt-4 inline-block font-semibold underline underline-offset-4">
              {t('landing.footer.responsibleLink')}
            </Link>
          </div>
        </section>
        <Band />

        {FOUNDER.name && (
          <section className={`${shell} py-14 lg:py-20`} data-testid="about-founder">
            <h2 className={`${heading} text-primary`}>{t('about.founder.title')}</h2>
            <figure className="mt-8 flex max-w-3xl flex-col gap-6 sm:flex-row sm:items-center">
              {FOUNDER.photo ? (
                <img src={FOUNDER.photo} alt={FOUNDER.name} width={220} height={220} loading="lazy" className="size-44 shrink-0 border-4 border-ink object-cover sm:size-56" />
              ) : (
                <span aria-hidden="true" className="flex size-44 shrink-0 items-center justify-center border-4 border-ink bg-brand font-display text-6xl font-extrabold text-brand-ink sm:size-56">
                  {FOUNDER.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}
                </span>
              )}
              <figcaption>
                <p className="font-display text-3xl font-extrabold text-primary">{FOUNDER.name}</p>
                <p className="mt-1 inline-block bg-primary px-2 py-0.5 text-sm font-bold text-surface">{t('about.founder.role')}</p>
                <p className="mt-4 text-lg text-muted">{t('about.founder.body')}</p>
              </figcaption>
            </figure>
          </section>
        )}

        {/* Last: the one thing to do next. */}
        <section className="bg-brand text-brand-ink">
          <div className={`${shell} flex flex-col items-start gap-5 py-14 lg:flex-row lg:items-center lg:justify-between lg:py-20`}>
            <div>
              <h2 className={heading}>{t('about.cta.title')}</h2>
              <p className="mt-2 max-w-xl text-lg font-semibold">{t('about.cta.body')}</p>
              {contact && (
                <p className="mt-3">
                  {t('about.cta.questions')}{' '}
                  <a href={`mailto:${contact}`} className="font-bold underline underline-offset-4">
                    {contact}
                  </a>
                </p>
              )}
            </div>
            <Link
              to={playHref}
              className="flex min-h-14 w-full items-center justify-center rounded-lg border-2 border-ink bg-ink px-8 text-lg font-bold text-surface hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-auto"
            >
              {signedIn ? t('landing.goToLobby') : t('about.cta.button')}
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
