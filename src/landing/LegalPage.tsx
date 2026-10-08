import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LanguageSwitcher } from '@/core/ui/LanguageSwitcher'

type Doc = 'terms' | 'privacy' | 'responsible'

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
        <div className="mt-8 flex flex-col gap-7">
          {sections.map((section) => (
            <section key={section.h}>
              <h2 className="font-display text-xl font-semibold">{section.h}</h2>
              <p className="mt-2 text-muted">{section.p}</p>
            </section>
          ))}
        </div>
        <Link to="/" className="mt-10 inline-block font-semibold text-primary underline underline-offset-4">
          {t('common.backHome')}
        </Link>
      </main>
    </div>
  )
}
