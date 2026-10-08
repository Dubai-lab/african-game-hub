import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router'
import { useSocialBadge } from '@/core/social/social'
import { RouteErrorBoundary } from './ErrorBoundary'
import { OfflineBanner } from './OfflineBanner'

const TABS = ['lobby', 'wallet', 'leaderboards', 'friends', 'profile', 'settings'] as const

/**
 * Frame for signed-in pages, in two shapes:
 *  - phone: the name on top, the tabs within thumb reach at the bottom, one column of content;
 *  - computer: a sidebar on the left, and the pages use the width (each lays out its own columns).
 */
export function AppShell() {
  const { t } = useTranslation()
  const waiting = useSocialBadge()
  // Shown on the Friends tab: unread messages plus friend requests to answer.
  const badge = (tab: string) =>
    tab === 'friends' && waiting > 0 ? (
      <span className="ms-1 flex min-w-5 justify-center rounded-full bg-hibiscus px-1 text-xs font-bold leading-5 text-white" data-testid="friends-badge">
        {waiting}
      </span>
    ) : null

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col bg-primary px-4 py-6 text-surface lg:flex">
        <Link to="/lobby" className="px-3 font-display text-xl font-extrabold">
          {t('app.name')}
        </Link>
        <nav aria-label={t('nav.label')} className="mt-8">
          <ul className="flex flex-col gap-1">
            {TABS.map((tab) => (
              <li key={tab}>
                <NavLink
                  to={`/${tab}`}
                  className={({ isActive }) =>
                    `flex min-h-12 items-center px-3 font-display text-lg font-extrabold ${isActive ? 'bg-brand text-brand-ink' : 'hover:bg-primary-soft'}`
                  }
                >
                  {t(`nav.${tab}`)}
                  {badge(tab)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="band mt-auto" role="presentation" style={{ ['--band-ground' as string]: 'var(--color-primary)' }} />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <OfflineBanner />
        <header className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-5 pb-3 pt-4 lg:hidden">
          <Link to="/lobby" className="text-base font-display font-extrabold text-primary">
            {t('app.name')}
          </Link>
        </header>
        <main className="flex-1 px-5 pb-24 pt-4 lg:px-10 lg:pb-12 lg:pt-10">
          <div className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-6xl">
            <RouteErrorBoundary>
              <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-line/60" aria-hidden="true" />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
      </div>

      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid h-14 max-w-md grid-cols-6">
          {TABS.map((tab) => (
            <li key={tab}>
              <NavLink
                to={`/${tab}`}
                className={({ isActive }) =>
                  `flex h-full items-center justify-center px-0.5 text-center font-display text-[0.7rem] font-extrabold leading-tight ${isActive ? 'bg-primary text-surface' : 'text-primary'}`
                }
              >
                {t(`nav.${tab}`)}
                {badge(tab)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
