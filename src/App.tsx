import { TournamentPresence } from '@/core/lobby/tournamentPresence'
import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, type ReactNode, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Outlet, Route, Routes, StaticRouter } from 'react-router'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { ProtectedRoute, PublicOnlyRoute } from '@/core/auth/guards'
import { env } from '@/core/lib/env'
import { queryClient } from '@/core/lib/queryClient'
import { AppShell } from '@/core/ui/AppShell'
import { ErrorBoundary, RouteErrorBoundary } from '@/core/ui/ErrorBoundary'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { Toaster } from '@/core/ui/Toaster'
// The landing page is the front door and is prerendered, so it is not a lazy chunk:
// its text must be there on the very first render. (Its 3D scene still loads lazily.)
import LandingPage from '@/landing/LandingPage'

// Every other page is its own chunk so the first load stays small on slow connections.
const LoginPage = lazy(() => import('@/core/auth/LoginPage'))
const SignupPage = lazy(() => import('@/core/auth/SignupPage'))
const CheckEmailPage = lazy(() => import('@/core/auth/CheckEmailPage'))
const ForgotPasswordPage = lazy(() => import('@/core/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/core/auth/ResetPasswordPage'))
const AuthCallbackPage = lazy(() => import('@/core/auth/AuthCallbackPage'))
const LobbyPage = lazy(() => import('@/core/lobby/LobbyPage'))
const GamePage = lazy(() => import('@/core/lobby/GamePage'))
const GameHomePage = lazy(() => import('@/core/lobby/GameHomePage'))
const FriendPage = lazy(() => import('@/core/lobby/FriendPage'))
const ChallengePage = lazy(() => import('@/core/lobby/ChallengePage'))
const TournamentsPage = lazy(() => import('@/core/lobby/TournamentsPage'))
const TournamentPage = lazy(() => import('@/core/lobby/TournamentPage'))
const GameSettingsPage = lazy(() => import('@/core/lobby/GameSettingsPage'))
// The chess screens (rules library, board, piece art) load only when a game is opened.
const LocalChessPage = lazy(() => import('@/games/chess/LocalGamePage'))
const ComputerChessPage = lazy(() => import('@/games/chess/ComputerGamePage'))
const ComputerLudoPage = lazy(() => import('@/games/ludo/LudoComputerPage'))
const ComputerPoolPage = lazy(() => import('@/games/pool/PoolComputerPage'))
const ComputerDraughtsPage = lazy(() => import('@/games/draughts/DraughtsComputerPage'))
const WalletPage = lazy(() => import('@/core/wallet/WalletPage'))
const ProfilePage = lazy(() => import('@/core/profile/ProfilePage'))
const LeaderboardsPage = lazy(() => import('@/core/leaderboards/LeaderboardsPage'))
const SettingsPage = lazy(() => import('@/core/settings/SettingsPage'))
const FriendsPage = lazy(() => import('@/core/social/FriendsPage'))
const ChatPage = lazy(() => import('@/core/social/ChatPage'))
const MatchRoute = lazy(() => import('@/core/matchmaking/MatchRoute'))
const LegalPage = lazy(() => import('@/landing/LegalPage'))
const NotFoundPage = lazy(() => import('@/core/ui/NotFoundPage'))

function PublicFrame() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        <Outlet />
      </Suspense>
    </RouteErrorBoundary>
  )
}

function ConfigMissing() {
  const { t } = useTranslation()
  return (
    <div role="alert" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-xl font-bold">{t('app.configMissing')}</h1>
      <p className="text-muted">{t('app.configMissingHint')}</p>
    </div>
  )
}

/** `staticLocation` is set only when a page is rendered to HTML at build time. */
function Router({ staticLocation, children }: { staticLocation?: string; children: ReactNode }) {
  return staticLocation ? (
    <StaticRouter location={staticLocation}>{children}</StaticRouter>
  ) : (
    <BrowserRouter>{children}</BrowserRouter>
  )
}

export default function App({ staticLocation }: { staticLocation?: string }) {
  if (!env) return <ConfigMissing />

  return (
    <ErrorBoundary fullScreen>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Router staticLocation={staticLocation}>
            {/* In a tournament: "I am here", wherever the player is in the app. */}
            {!staticLocation && <TournamentPresence />}
            <Routes>
              <Route element={<PublicFrame />}>
                <Route index element={<LandingPage />} />
                <Route path="terms" element={<LegalPage doc="terms" />} />
                <Route path="privacy" element={<LegalPage doc="privacy" />} />
                <Route path="cookies" element={<LegalPage doc="cookies" />} />
                <Route path="refunds" element={<LegalPage doc="refunds" />} />
                <Route path="responsible-gaming" element={<LegalPage doc="responsible" />} />
                <Route path="auth/callback" element={<AuthCallbackPage />} />
                {/* Reached from the reset email, which signs the player in: so not a signed-out-only page. */}
                <Route path="auth/reset" element={<ResetPasswordPage />} />
                <Route element={<PublicOnlyRoute />}>
                  <Route path="login" element={<LoginPage />} />
                  <Route path="signup" element={<SignupPage />} />
                  <Route path="auth/check-email" element={<CheckEmailPage />} />
                  <Route path="forgot-password" element={<ForgotPasswordPage />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              <Route element={<ProtectedRoute />}>
                <Route element={<AppShell />}>
                  <Route path="lobby" element={<LobbyPage />} />
                  {/* A game's own pages: its home, setting up a match, a friend, tournaments, its settings. */}
                  <Route path="play/:gameId" element={<GameHomePage />} />
                  <Route path="play/:gameId/new" element={<GamePage />} />
                  <Route path="play/:gameId/friend" element={<FriendPage />} />
                  <Route path="play/:gameId/tournaments" element={<TournamentsPage />} />
                  <Route path="play/:gameId/settings" element={<GameSettingsPage />} />
                  <Route path="tournaments/:id" element={<TournamentPage />} />
                  <Route path="challenge/:id" element={<ChallengePage />} />
                  <Route path="wallet" element={<WalletPage />} />
                  <Route path="leaderboards" element={<LeaderboardsPage />} />
                  <Route path="friends" element={<FriendsPage />} />
                  <Route path="friends/:username" element={<ChatPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="players/:username" element={<ProfilePage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
                {/* Game screens use the whole phone screen, so they sit outside the app frame. */}
                <Route element={<PublicFrame />}>
                  <Route path="play/chess/local" element={<LocalChessPage />} />
                  <Route path="play/chess/computer" element={<ComputerChessPage />} />
                  <Route path="play/ludo/computer" element={<ComputerLudoPage />} />
                  <Route path="play/pool/computer" element={<ComputerPoolPage />} />
                  <Route path="play/draughts/computer" element={<ComputerDraughtsPage />} />
                  <Route path="play/:gameId/match/:matchId" element={<MatchRoute />} />
                </Route>
              </Route>
            </Routes>
          </Router>
        </AuthProvider>
      </QueryClientProvider>
      <Toaster />
    </ErrorBoundary>
  )
}
