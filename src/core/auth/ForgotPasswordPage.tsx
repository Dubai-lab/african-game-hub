import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { TextField } from '@/core/ui/TextField'
import { toast } from '@/core/ui/toast'
import { AuthLayout } from './AuthLayout'
import { Captcha, type CaptchaHandle, captchaRequired } from './Captcha'
import { authErrorKey } from './errors'
import { fieldErrors, forgotSchema } from './schemas'

/**
 * "I forgot my password": asks for the account's email and has a link sent to it. The answer is
 * the same whether or not that email has an account, so this page cannot be used to find out
 * who plays here.
 */
export default function ForgotPasswordPage() {
  const { t, i18n } = useTranslation()
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const captcha = useRef<CaptchaHandle>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const parsed = forgotSchema.safeParse({ email })
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    if (captchaRequired && !captchaToken) return toast.error(t('auth.captchaWait'))
    setBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${window.location.origin}/auth/reset`,
        ...(captchaToken ? { captchaToken } : {}),
      })
      // An answer to the check is good for one attempt, whatever came of it.
      captcha.current?.reset()
      if (error) return toast.error(t(authErrorKey(error)))
      setSentTo(parsed.data.email)
    } catch (err) {
      toast.error(t(authErrorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title={t('auth.forgot.sentTitle')}>
        <p>{t('auth.forgot.sentBody', { email: sentTo })}</p>
        <p className="mt-3 text-sm text-muted">{t('auth.forgot.sentHint')}</p>
        <div className="mt-8 flex flex-col gap-4">
          <Button variant="ghost" onClick={() => setSentTo(null)}>
            {t('auth.forgot.again')}
          </Button>
          <Link to="/login" className="text-center text-sm font-semibold text-primary underline">
            {t('auth.backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.forgot.title')}>
      <p className="mb-5 text-muted">{t('auth.forgot.intro')}</p>
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
        <Captcha ref={captcha} onToken={setCaptchaToken} onUnavailable={() => toast.error(t('auth.captchaUnavailable'))} language={i18n.resolvedLanguage} />
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? t('auth.working') : t('auth.forgot.send')}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        <Link to="/login" className="font-semibold text-primary underline">
          {t('auth.backToLogin')}
        </Link>
      </p>
    </AuthLayout>
  )
}
