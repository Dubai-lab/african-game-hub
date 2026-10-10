import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router'
import { arrivedByRecoveryLink, initialAuthUrlError, supabase } from '@/core/lib/supabase'
import { Button, buttonClass } from '@/core/ui/Button'
import { LoadingScreen } from '@/core/ui/LoadingScreen'
import { TextField } from '@/core/ui/TextField'
import { toast } from '@/core/ui/toast'
import { useAuth } from './AuthContext'
import { AuthLayout } from './AuthLayout'
import { authErrorKey } from './errors'
import { HOME_AFTER_LOGIN } from './guards'
import { fieldErrors, resetSchema } from './schemas'

/**
 * Where the "reset your password" email link lands. The link itself signs the player in (the
 * Supabase client reads it from the address); here they choose the new password.
 *
 * Only someone who arrived by such a link may use this page. A player who is merely signed in
 * and opens the address is sent on to the lobby: changing a password must take more than a
 * phone left unlocked.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const { status } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  if (status === 'loading') return <LoadingScreen messageKey="auth.reset.opening" />
  if (status === 'authenticated' && !arrivedByRecoveryLink) return <Navigate to={HOME_AFTER_LOGIN} replace />
  if (status !== 'authenticated') {
    // The link was used already, is too old, or was cut short when it was copied.
    return (
      <AuthLayout title={t('auth.reset.title')}>
        <p role="alert">{t(initialAuthUrlError ? authErrorKey(initialAuthUrlError) : 'auth.reset.badLink')}</p>
        <Link to="/forgot-password" className={buttonClass('primary', 'mt-8 w-full')}>
          {t('auth.reset.askAgain')}
        </Link>
        <Link to="/login" className="mt-4 block text-center text-sm font-semibold text-primary underline">
          {t('auth.backToLogin')}
        </Link>
      </AuthLayout>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const parsed = resetSchema.safeParse({ password, confirm })
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
      if (error) return toast.error(t(authErrorKey(error)))
      // Whoever else was signed in to this account (the reason for the reset, perhaps) is not any more.
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined)
      toast.success(t('auth.reset.done'))
      navigate(HOME_AFTER_LOGIN, { replace: true })
    } catch (err) {
      toast.error(t(authErrorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.reset.title')}>
      <p className="mb-5 text-muted">{t('auth.reset.intro')}</p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={t('auth.reset.newPassword')}
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password && t(errors.password)}
        />
        <TextField
          label={t('auth.reset.confirm')}
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm && t(errors.confirm)}
        />
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? t('auth.working') : t('auth.reset.save')}
        </Button>
      </form>
    </AuthLayout>
  )
}
