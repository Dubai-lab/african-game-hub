import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import i18n from '@/core/i18n'
import { queryClient } from '@/core/lib/queryClient'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import { AuthContext, type AuthStatus, type AuthValue } from './AuthContext'

const RESTORE_RETRY_MS = 3000

/** The session as last stored by the Supabase client, even if its token has since expired. */
function savedSession(): Session | null {
  try {
    const stored = JSON.parse(localStorage.getItem('agh.auth') ?? 'null') as Partial<Session> | null
    return stored?.access_token && stored.user?.id ? (stored as Session) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  useEffect(() => {
    let active = true
    let resolved = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const apply = (next: Session | null) => {
      resolved = true
      // Keep the same object when only unrelated fields changed, so a token refresh
      // never re-renders (or redirects) the whole tree.
      setSession((prev) => (prev?.access_token === next?.access_token ? prev : next))
      setStatus(next ? 'authenticated' : 'unauthenticated')
    }

    // Reads the stored session (refreshing it if expired). A network failure is never
    // treated as "logged out": we keep what we have and try again.
    async function sync() {
      clearTimeout(retryTimer)
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!active) return
        if (!error) return apply(data.session)
        if (!isAuthRetryableFetchError(error)) return apply(null)
      } catch (err) {
        console.warn('[auth] session check failed', err)
      }
      if (!active || resolved) return
      // Offline with a session saved on this phone: open the app with it, so the player sees
      // their cached profile and history. Nothing can be changed until the connection is back,
      // at which point the session is refreshed in the usual way.
      const saved = savedSession()
      if (saved) apply(saved)
      retryTimer = setTimeout(sync, saved ? RESTORE_RETRY_MS * 5 : RESTORE_RETRY_MS)
    }

    void sync()

    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return
      if (event === 'SIGNED_OUT') {
        apply(null)
        queryClient.clear()
      } else if (next) {
        apply(next)
      }
    })

    const revalidate = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    document.addEventListener('visibilitychange', revalidate)
    window.addEventListener('focus', revalidate)
    window.addEventListener('online', revalidate)

    return () => {
      active = false
      clearTimeout(retryTimer)
      data.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', revalidate)
      window.removeEventListener('focus', revalidate)
      window.removeEventListener('online', revalidate)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      // The local session is removed even if the server cannot be reached.
      const { error } = await supabase.auth.signOut()
      if (error) toast.info(i18n.t('errors.logoutFailed'))
    } catch (err) {
      console.error('[auth] sign out failed', err)
      toast.error(i18n.t('errors.generic'))
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({ status, session, user: session?.user ?? null, signOut }),
    [status, session, signOut],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
