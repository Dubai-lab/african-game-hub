import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { LanguageSwitcher } from '@/core/ui/LanguageSwitcher'

/** Sign-in pages. On a computer the form sits beside a brand panel instead of alone in a wide window. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-primary p-12 text-surface lg:flex">
        <Link to="/" className="font-display text-xl font-extrabold">
          {t('app.name')}
        </Link>
        <div>
          <p className="font-display text-7xl font-extrabold leading-[0.95]">{t('landing.hero.headline')}</p>
          <p className="mt-5 max-w-sm text-lg text-primary-tint">{t('landing.games.sub')}</p>
        </div>
        <div className="band" role="presentation" />
      </aside>

      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-4 lg:justify-center lg:py-12">
        <header className="flex items-center justify-between lg:justify-end">
          <Link to="/" className="text-base font-display font-extrabold text-primary lg:hidden">
            {t('app.name')}
          </Link>
          <LanguageSwitcher />
        </header>
        <main className="mt-10 flex-1 lg:flex-none">
          <h1 className="font-display text-3xl font-extrabold text-primary lg:text-4xl">{title}</h1>
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
