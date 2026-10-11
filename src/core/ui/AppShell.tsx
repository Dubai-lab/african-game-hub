import { ChallengeInbox } from '@/core/lobby/ChallengePage'
import { Suspense, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useSocialBadge } from '@/core/social/social'
import { RouteErrorBoundary } from './ErrorBoundary'
import { OfflineBanner } from './OfflineBanner'

const TABS = ['lobby', 'wallet', 'leaderboards', 'friends', 'profile', 'settings'] as const

/**
 * Frame for signed-in pages, in two shapes:
 *  - phone: the name on top, the tabs within thumb reach at the bottom, and one column of
 *    content between them. The top bar and the tabs never move: the page scrolls between them,
 *    under the line that closes the top bar, as in an app and not as on a website.
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

  // A game's own page (/play/chess) belongs to the Play tab.
  const { pathname } = useLocation()
  const inGame = /^\/(play|tournaments|challenge)\//.test(pathname)
  // A new page starts at its top, not where the last one was left.
  const page = useRef<HTMLElement>(null)
  useEffect(() => {
    page.current?.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="h-(--app-h) overflow-hidden lg:grid lg:h-auto lg:min-h-(--app-h) lg:grid-cols-[15rem_minmax(0,1fr)] lg:overflow-visible">
      <aside className="sticky top-0 hidden h-(--app-h) flex-col bg-primary px-4 py-6 text-surface lg:flex">
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
                    `flex min-h-12 items-center px-3 font-display text-lg font-extrabold ${isActive || (tab === 'lobby' && inGame) ? 'bg-brand text-brand-ink' : 'hover:bg-primary-soft'}`
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

      <div className="flex h-(--app-h) min-w-0 flex-col lg:h-auto lg:min-h-(--app-h)">
        <OfflineBanner />
        {/* The top bar: fixed, closed by a line the page scrolls under. */}
        <header className="shrink-0 border-b-2 border-line bg-surface lg:hidden" data-testid="top-bar">
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-5 py-3">
            <Link to="/lobby" className="text-base font-display font-extrabold text-primary">
              {t('app.name')}
            </Link>
          </div>
        </header>
        <main ref={page} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-24 pt-4 lg:overflow-visible lg:px-10 lg:pb-12 lg:pt-10" data-testid="page-scroll">
          <div className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-6xl">
            <RouteErrorBoundary>
              <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-line/60" aria-hidden="true" />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
      </div>

      {/* A friend's invitation to a game pops up wherever the player is in the app. */}
      <ChallengeInbox />

      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-panel pb-[var(--safe-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid h-14 max-w-md grid-cols-6">
          {TABS.map((tab) => (
            <li key={tab}>
              <NavLink
                to={`/${tab}`}
                className={({ isActive }) =>
                  `flex h-full items-center justify-center px-0.5 text-center font-display text-[0.7rem] font-extrabold leading-tight ${isActive || (tab === 'lobby' && inGame) ? 'bg-primary text-surface' : 'text-primary'}`
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
