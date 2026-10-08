import { isAuthApiError, isAuthRetryableFetchError, isAuthWeakPasswordError } from '@supabase/supabase-js'

const byCode: Record<string, string> = {
  invalid_credentials: 'errors.invalidCredentials',
  email_not_confirmed: 'errors.emailNotConfirmed',
  over_email_send_rate_limit: 'errors.emailRateLimit',
  over_request_rate_limit: 'errors.tooManyRequests',
  user_already_exists: 'errors.userExists',
  email_exists: 'errors.userExists',
  weak_password: 'errors.weakPassword',
  signup_disabled: 'errors.signupDisabled',
  otp_expired: 'errors.linkExpired',
  access_denied: 'errors.linkExpired',
}

/** Maps a Supabase auth error (or a URL error code) to an i18n key. Raw server text is never shown. */
export function authErrorKey(error: unknown): string {
  if (typeof error === 'string') return byCode[error] ?? 'errors.generic'
  if (isAuthRetryableFetchError(error)) return 'errors.network'
  if (isAuthWeakPasswordError(error)) return 'errors.weakPassword'
  if (isAuthApiError(error)) {
    if (error.code && byCode[error.code]) return byCode[error.code]!
    if (error.status === 429) return 'errors.tooManyRequests'
  }
  return 'errors.generic'
}
