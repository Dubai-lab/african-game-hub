import { type FormEvent, useId, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { guessCountry, useCountries } from '@/core/countries/useCountries'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { TextField } from '@/core/ui/TextField'
import { toast } from '@/core/ui/toast'
import { AuthLayout } from './AuthLayout'
import { authErrorKey } from './errors'
import { fieldErrors, signupSchema } from './schemas'

export default function SignupPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isAdult, setIsAdult] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const countryFieldId = useId()
  const { countries, isLoading: countriesLoading, isError: countriesFailed, refetch: reloadCountries } = useCountries()
  // Null until the player chooses; until then we suggest the country from their browser language.
  const [chosenCountry, setChosenCountry] = useState<string | null>(null)
  const countryCode = chosenCountry ?? guessCountry(countries)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const parsed = signupSchema.safeParse({ username, countryCode, email, password, isAdult })
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setBusy(true)
    try {
      const available = await supabase.rpc('is_username_available', { p_username: parsed.data.username })
      if (available.error) return toast.error(t('errors.network'))
      if (!available.data) return setErrors({ username: 'validation.usernameTaken' })

      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          // Read by the signup trigger to create the profile. The player controls this
          // metadata, so the trigger re-validates every field and never trusts it for money.
          data: {
            username: parsed.data.username,
            country_code: parsed.data.countryCode,
            preferred_language: i18n.resolvedLanguage ?? 'en',
            age_confirmed: true,
          },
        },
      })
      if (error) return toast.error(t(authErrorKey(error)))
      // With email confirmation on there is no session yet; the player must open the link.
      if (!data.session) navigate('/auth/check-email', { state: { email: parsed.data.email } })
    } catch (err) {
      toast.error(t(authErrorKey(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('auth.signupTitle')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={t('auth.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint={t('auth.usernameHint')}
          error={errors.username && t(errors.username)}
        />
        <div>
          <label htmlFor={countryFieldId} className="block text-sm font-medium">
            {t('auth.country')}
          </label>
          <select
            id={countryFieldId}
            name="country"
            autoComplete="country"
            value={countryCode}
            onChange={(e) => setChosenCountry(e.target.value)}
            disabled={countries.length === 0}
            aria-invalid={errors.countryCode ? true : undefined}
            className={`mt-1 block min-h-12 w-full rounded-lg border bg-panel px-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 ${errors.countryCode ? 'border-danger' : 'border-line'}`}
          >
            <option value="">{countriesLoading ? t('auth.countryLoading') : t('auth.countryPlaceholder')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          {countriesFailed ? (
            <p className="mt-1 text-sm text-danger">
              {t('auth.countryLoadFailed')}{' '}
              <button type="button" onClick={() => void reloadCountries()} className="font-semibold underline">
                {t('common.retry')}
              </button>
            </p>
          ) : errors.countryCode ? (
            <p className="mt-1 text-sm text-danger">{t(errors.countryCode)}</p>
          ) : (
            <p className="mt-1 text-sm text-muted">{t('auth.countryHint')}</p>
          )}
        </div>
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password && t(errors.password)}
        />
        <div>
          <label className="flex min-h-12 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={isAdult}
              onChange={(e) => setIsAdult(e.target.checked)}
              aria-invalid={errors.isAdult ? true : undefined}
              className="size-5 shrink-0 accent-primary"
            />
            <span>{t('auth.ageConfirm')}</span>
          </label>
          {errors.isAdult && <p className="mt-1 text-sm text-danger">{t(errors.isAdult)}</p>}
        </div>
        <p className="text-sm text-muted">
          <Trans
            i18nKey="auth.consent"
            components={{
              terms: <Link to="/terms" target="_blank" className="font-semibold text-primary underline" />,
              privacy: <Link to="/privacy" target="_blank" className="font-semibold text-primary underline" />,
            }}
          />
        </p>
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? t('auth.working') : t('auth.signupButton')}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" state={location.state} className="font-semibold text-primary underline">
          {t('auth.loginButton')}
        </Link>
      </p>
    </AuthLayout>
  )
}
