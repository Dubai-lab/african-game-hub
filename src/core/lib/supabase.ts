import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env } from './env'

/**
 * Error passed back by Supabase in the URL after an email link (for example an expired
 * confirmation link). Read before the client starts, because the client clears the hash.
 */
export const initialAuthUrlError: string | null = (() => {
  if (typeof window === 'undefined') return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  return hash.get('error_code') ?? query.get('error_code')
})()

/**
 * True when the page was opened from a "reset your password" email. Read before the client
 * starts, for the same reason. It is what allows the new-password page to be used.
 */
export const arrivedByRecoveryLink: boolean = (() => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type') === 'recovery'
})()

// The one Supabase client for the whole app. Only the anon key ever reaches the browser.
export const supabase = createClient<Database>(
  env?.VITE_SUPABASE_URL ?? 'http://localhost',
  env?.VITE_SUPABASE_ANON_KEY ?? 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Implicit rather than PKCE: players often sign up in one browser and open the
      // confirmation email in another (Gmail's in-app browser), where a PKCE verifier is missing.
      flowType: 'implicit',
      storageKey: 'agh.auth',
    },
  },
)
