import { isAuthApiError } from '@supabase/supabase-js'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { TextField } from '@/core/ui/TextField'
import { toast } from '@/core/ui/toast'
import { AuthLayout } from './AuthLayout'
import { Captcha, type CaptchaHandle, captchaRequired } from './Captcha'
import { authErrorKey } from './errors'
import { fieldErrors, loginSchema } from './schemas'

export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const captcha = useRef<CaptchaHandle>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    if (captchaRequired && !captchaToken) return toast.error(t('auth.captchaWait'))
    setBusy(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ ...parsed.data, options: captchaToken ? { captchaToken } : undefined })
      if (error) {
        // An answer to the check is good for one attempt.
        captcha.current?.reset()
        toast.error(t(authErrorKey(error)))
        if (isAuthApiError(error) && error.code === 'email_not_confirmed') {
          navigate('/auth/check-email', { state: { email: parsed.data.email } })
        }
      }
      // On success the auth listener updates the session and the route guard moves us on.
    } catch (err) {
      toast.error(t(authErrorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.loginTitle')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={t('auth.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email && t(errors.email)}
        />
        <TextField
          label={t('auth.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password && t(errors.password)}
        />
        <Captcha ref={captcha} onToken={setCaptchaToken} onUnavailable={() => toast.error(t('auth.captchaUnavailable'))} language={i18n.resolvedLanguage} />
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? t('auth.working') : t('auth.loginButton')}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {t('auth.noAccount')}{' '}
        <Link to="/signup" state={location.state} className="font-semibold text-primary underline">
          {t('auth.createAccount')}
        </Link>
      </p>
    </AuthLayout>
  )
}
