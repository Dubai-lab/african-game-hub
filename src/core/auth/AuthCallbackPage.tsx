import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { initialAuthUrlError } from '@/core/lib/supabase'
import { buttonClass } from '@/core/ui/Button'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { useAuth } from './AuthContext'
import { AuthLayout } from './AuthLayout'
import { authErrorKey } from './errors'
import { HOME_AFTER_LOGIN } from './guards'

/** Where the confirmation email link lands. The Supabase client reads the tokens from the URL itself. */
export default function AuthCallbackPage() {
  const { t } = useTranslation()
  const { status } = useAuth()

  if (status === 'authenticated') return <Navigate to={HOME_AFTER_LOGIN} replace />
  if (status === 'loading') return <LoadingScreen messageKey="auth.confirming" />

  return (
    <AuthLayout title={t('auth.loginTitle')}>
      <p role="alert">{t(authErrorKey(initialAuthUrlError ?? 'otp_expired'))}</p>
      <Link to="/login" className={buttonClass('primary', 'mt-8 w-full')}>
        {t('auth.backToLogin')}
      </Link>
    </AuthLayout>
  )
}
