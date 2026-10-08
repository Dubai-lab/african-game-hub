import { useQuery } from '@tanstack/react-query'
import { ANON_KEY, API_URL, supabase } from './supabase'

/** A "no" from the server, with its reason code. */
export class ApiError extends Error {
  readonly code: string
  constructor(code: string) {
    super(MESSAGES[code] ?? `The server refused the request (${code}).`)
    this.code = code
  }
}

const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'Your session has ended. Sign in again.',
  NOT_ADMIN: 'This account has no admin access.',
  SECOND_STEP_REQUIRED: 'Enter the code from your authenticator app to continue.',
  FORBIDDEN: 'This address is not allowed to use the admin system.',
  BAD_REQUEST: 'The server did not accept those values. Check them and try again.',
  REASON_REQUIRED: 'Write a reason (at least 5 characters). It is kept in the audit log.',
  CANNOT_BAN_ADMIN: 'An admin account cannot be banned from here.',
  CANNOT_ADJUST_SELF: 'You cannot adjust your own wallet. Ask another admin.',
  INSUFFICIENT_BALANCE: 'The player does not have that many tokens in that balance.',
  PLAYER_NOT_FOUND: 'No such player.',
  MATCH_NOT_ACTIVE: 'That match is already over.',
  REPORT_NOT_OPEN: 'That report has already been closed.',
  NETWORK: 'Could not reach the server. Check the connection and try again.',
  SERVER_ERROR: 'Something went wrong on the server. Nothing was changed.',
}

/** Session problems are announced here so the app can go back to the sign-in screen. */
export const sessionProblem = new EventTarget()

export async function api<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    sessionProblem.dispatchEvent(new Event('lost'))
    throw new ApiError('NOT_AUTHENTICATED')
  }

  let body: { ok: boolean; code?: string; data?: T }
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params }),
    })
    body = (await response.json()) as typeof body
  } catch {
    throw new ApiError('NETWORK')
  }

  if (!body.ok) {
    const code = body.code ?? 'SERVER_ERROR'
    // The sign-in screen asks "session" itself and deals with the answer.
    if (action !== 'session' && (code === 'NOT_AUTHENTICATED' || code === 'NOT_ADMIN' || code === 'SECOND_STEP_REQUIRED')) {
      sessionProblem.dispatchEvent(new Event('lost'))
    }
    throw new ApiError(code)
  }
  return body.data as T
}

/** Reads through the admin API, refreshed whenever the admin comes back to the tab. */
export function useApi<T>(action: string, params: Record<string, unknown> = {}, options: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: [action, params],
    queryFn: () => api<T>(action, params),
    refetchInterval: options.refetchInterval,
  })
}
