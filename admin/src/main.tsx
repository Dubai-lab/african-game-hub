import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Component, type ReactNode, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router'
import { Gate } from './Gate'
import './index.css'
import { ApiError, useApi } from './lib/api'
import type { Overview } from './lib/types'
import AuditPage from './pages/AuditPage'
import IntegrityPage from './pages/IntegrityPage'
import MatchesPage from './pages/MatchesPage'
import MatchPage from './pages/MatchPage'
import OverviewPage from './pages/OverviewPage'
import PlayerPage from './pages/PlayerPage'
import PlayersPage from './pages/PlayersPage'
import ReportsPage from './pages/ReportsPage'
import RevenuePage from './pages/RevenuePage'
import { Button } from './ui'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // A refusal is an answer, not a fault: only connection problems are worth retrying.
      retry: (count, error) => error instanceof ApiError && error.code === 'NETWORK' && count < 2,
    },
  },
})

const NAV = [
  ['/', 'Overview'],
  ['/players', 'Players'],
  ['/matches', 'Matches'],
  ['/reports', 'Reports'],
  ['/revenue', 'Revenue'],
  ['/integrity', 'Integrity'],
  ['/audit', 'Audit log'],
] as const

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="rounded border border-danger bg-panel p-4 text-sm">
        <p className="font-semibold">This page hit a problem. Nothing was changed.</p>
        <Button className="mt-2" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
}

function Shell({ email, signOut }: { email: string | null; signOut: () => void }) {
  const overview = useApi<Overview>('overview', {}, { refetchInterval: 60_000 })
  const open = overview.data?.open_reports ?? 0
  const broken = (overview.data?.integrity_problems ?? 0) > 0

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="flex flex-col bg-ink text-white lg:sticky lg:top-0 lg:h-dvh">
        <div className="px-4 pb-2 pt-4">
          <p className="text-sm font-bold">African Game Hub</p>
          <p className="text-xs text-white/60">Admin</p>
        </div>
        <nav aria-label="Sections" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex min-h-9 shrink-0 items-center gap-2 rounded px-3 text-sm font-semibold ${isActive ? 'bg-white text-ink' : 'text-white/85 hover:bg-white/10'}`
              }
            >
              {label}
              {to === '/reports' && open > 0 && <span className="rounded bg-danger px-1.5 text-xs text-white">{open}</span>}
              {to === '/integrity' && broken && <span className="rounded bg-danger px-1.5 text-xs text-white">!</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-white/15 p-4 text-xs lg:block">
          <p className="break-all text-white/70">{email}</p>
          <button type="button" onClick={signOut} className="mt-2 font-semibold underline">
            Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2 text-xs lg:hidden">
          <span className="truncate text-muted">{email}</span>
          <button type="button" onClick={signOut} className="font-semibold underline">
            Sign out
          </button>
        </div>
        <main className="mx-auto max-w-7xl p-4 lg:p-8">
          <Boundary>
            <Routes>
              <Route index element={<OverviewPage />} />
              <Route path="players" element={<PlayersPage />} />
              <Route path="players/:userId" element={<PlayerPage />} />
              <Route path="matches" element={<MatchesPage />} />
              <Route path="matches/:matchId" element={<MatchPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="revenue" element={<RevenuePage />} />
              <Route path="integrity" element={<IntegrityPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="*" element={<p className="text-sm">No such page.</p>} />
            </Routes>
          </Boundary>
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Gate>
          {(session) => {
            return <Shell {...session} />
          }}
        </Gate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
