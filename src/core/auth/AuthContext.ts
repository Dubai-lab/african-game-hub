import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export type AuthValue = {
  status: AuthStatus
  session: Session | null
  user: User | null
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
