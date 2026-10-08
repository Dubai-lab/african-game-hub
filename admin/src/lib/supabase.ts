import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && anonKey)
export const API_URL = `${url ?? ''}/functions/v1/admin-api`
export const ANON_KEY = anonKey ?? ''

// Used for signing in only. Everything the admin app reads or changes goes through the
// admin-api function; this client never queries a table.
//
// The session lives in sessionStorage under its own name: closing the tab signs the admin out,
// and nothing is shared with a player session in the same browser.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: window.sessionStorage,
    storageKey: 'agh.admin.auth',
  },
})
