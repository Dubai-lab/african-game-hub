import { Navigate, Outlet, useLocation } from 'react-router'
import { useSettingsSync } from '@/core/settings/settingsStore'
import { useSocialLiveUpdates } from '@/core/social/social'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { useOnline } from '@/core/ui/OfflineBanner'
import { useWalletLiveUpdates } from '@/core/wallet/useWallet'
import { useAuth } from './AuthContext'

export const HOME_AFTER_LOGIN = '/lobby'

function SessionLoading() {
  const online = useOnline()
  return <LoadingScreen messageKey={online ? 'app.loading' : 'app.reconnecting'} />
}

/** Signed-in pages. Waits for the session check so the login page never flashes on refresh. */
export function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <SessionLoading />
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <SignedIn />
}

/** Services that must run exactly once while a player is signed in, whichever page they are on. */
function SignedIn() {
  useWalletLiveUpdates()
  useSettingsSync()
  useSocialLiveUpdates()
  return <Outlet />
}

/** Login and signup: a signed-in player is sent on to where they were going. */
export function PublicOnlyRoute() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <SessionLoading />
  if (status === 'authenticated') {
    const from = (location.state as { from?: unknown } | null)?.from
    // Only follow in-app paths, never an absolute URL.
    const target = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : HOME_AFTER_LOGIN
    return <Navigate to={target} replace />
  }
  return <Outlet />
}
