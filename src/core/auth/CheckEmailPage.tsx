import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'
import { AuthLayout } from './AuthLayout'
import { authErrorKey } from './errors'

export default function CheckEmailPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const stateEmail = (location.state as { email?: unknown } | null)?.email
  const email = typeof stateEmail === 'string' ? stateEmail : null
  const [busy, setBusy] = useState(false)

  async function resend() {
    if (!email || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) toast.error(t(authErrorKey(error)))
      else toast.success(t('auth.resent'))
    } catch (err) {
      toast.error(t(authErrorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.checkEmailTitle')}>
      <p>{email ? t('auth.checkEmailBody', { email }) : t('auth.checkEmailBodyNoAddress')}</p>
      <p className="mt-3 text-sm text-muted">{t('auth.checkEmailSpam')}</p>
      <div className="mt-8 flex flex-col gap-4">
        {email && (
          <Button variant="ghost" onClick={resend} disabled={busy}>
            {busy ? t('auth.working') : t('auth.resend')}
          </Button>
        )}
        <Link to="/login" className="text-center text-sm font-semibold text-primary underline">
          {t('auth.backToLogin')}
        </Link>
      </div>
    </AuthLayout>
  )
}
