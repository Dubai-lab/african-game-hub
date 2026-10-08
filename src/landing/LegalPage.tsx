import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { env } from '@/core/lib/env'
import { LanguageSwitcher } from '@/core/ui/LanguageSwitcher'

export const LEGAL_DOCS = { terms: '/terms', privacy: '/privacy', cookies: '/cookies', refunds: '/refunds', responsible: '/responsible-gaming' } as const
type Doc = keyof typeof LEGAL_DOCS

/** Who runs the hub, from the site's settings. Nothing is shown for a detail that has not been given. */
export function BusinessDetails({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const lines = [env?.VITE_BUSINESS_NAME, env?.VITE_BUSINESS_ADDRESS, env?.VITE_BUSINESS_REGISTRATION].filter(Boolean)
  const contact = env?.VITE_CONTACT_EMAIL
  if (lines.length === 0 && !contact) return null
  return (
    <address className={`not-italic ${className}`}>
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
      {contact && (
        <span className="block">
          {t('landing.footer.contact')}:{' '}
          <a href={`mailto:${contact}`} className="underline underline-offset-4">
            {contact}
          </a>
        </span>
      )}
    </address>
  )
}

// First drafts in plain language. They are marked as drafts on the page until a lawyer has reviewed them.
export default function LegalPage({ doc }: { doc: Doc }) {
  const { t } = useTranslation()
  const sections = t(`legal.${doc}.sections`, { returnObjects: true }) as { h: string; p: string }[]

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pb-12 pt-4">
      <header className="flex items-center justify-between">
        <Link to="/" className="font-display text-lg font-extrabold text-primary">
          {t('app.name')}
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mt-10">
        <p className="inline-block bg-brand px-2.5 py-1 text-sm font-bold text-brand-ink">{t('legal.draft')}</p>
        <h1 className="mt-4 font-display text-4xl font-extrabold text-primary">{t(`legal.${doc}.title`)}</h1>
        <p className="mt-2 text-sm text-muted">{t('legal.updated')}</p>
        <div className="mt-8 flex flex-col gap-7">
          {sections.map((section) => (
            <section key={section.h}>
              <h2 className="font-display text-xl font-semibold">{section.h}</h2>
              <p className="mt-2 text-muted">{section.p}</p>
            </section>
          ))}
          <section>
            <h2 className="font-display text-xl font-semibold">{t('legal.who')}</h2>
            <p className="mt-2 text-muted">{t('legal.whoIntro')}</p>
            <BusinessDetails className="mt-2 text-muted" />
          </section>
        </div>
        <nav aria-label={t('legal.more')} className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t-2 border-line pt-5 font-semibold">
          {(Object.keys(LEGAL_DOCS) as Doc[])
            .filter((other) => other !== doc)
            .map((other) => (
              <Link key={other} to={LEGAL_DOCS[other]} className="text-primary underline underline-offset-4">
                {t(`legal.${other}.title`)}
              </Link>
            ))}
        </nav>
        <Link to="/" className="mt-6 inline-block font-semibold text-primary underline underline-offset-4">
          {t('common.backHome')}
        </Link>
      </main>
    </div>
  )
}
