import { type FormEvent, useId, useState, useRef, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { guessCountry, useCountries } from '@/core/countries/useCountries'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { TextField } from '@/core/ui/TextField'
import { toast } from '@/core/ui/toast'
import { AuthLayout } from './AuthLayout'
import { Captcha, type CaptchaHandle, captchaRequired } from './Captcha'
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

  // Is the name free? Asked a moment after the player stops typing, so they know before they
  // have filled in the rest of the form. (The database has the last word either way: two
  // accounts can never hold the same name, whatever the capitals.)
  const [nameState, setNameState] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle')
  useEffect(() => {
    const name = username.trim()
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return setNameState('idle')
    setNameState('checking')
    let stale = false
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('is_username_available', { p_username: name })
        if (!stale) setNameState(error ? 'idle' : data ? 'free' : 'taken')
      } catch {
        if (!stale) setNameState('idle')
      }
    }, 450)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [username])

  // What is wrong is said three ways, so it cannot be missed on a small screen: under the
  // field, in a message at the top, and by taking the player to the field.
  const form = useRef<HTMLFormElement>(null)
  function refuse(found: Record<string, string>) {
    setErrors(found)
    const first = Object.values(found)[0]
    if (first) toast.error(t(first))
    requestAnimationFrame(() => {
      const field = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      field?.focus({ preventScroll: true })
    })
  }

  const captcha = useRef<CaptchaHandle>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const parsed = signupSchema.safeParse({ username, countryCode, email, password, isAdult })
    if (!parsed.success) return refuse(fieldErrors(parsed.error))
    if (nameState === 'taken') return refuse({ username: 'validation.usernameTaken' })
    setErrors({})
    if (captchaRequired && !captchaToken) return toast.error(t('auth.captchaWait'))
    setBusy(true)
    try {
      const available = await supabase.rpc('is_username_available', { p_username: parsed.data.username })
      if (available.error) return toast.error(t('errors.network'))
      if (!available.data) {
        setNameState('taken')
        return refuse({ username: 'validation.usernameTaken' })
      }

      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          ...(captchaToken ? { captchaToken } : {}),
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
      if (error) {
        // An answer to the check is good for one attempt.
        captcha.current?.reset()
        return toast.error(t(authErrorKey(error)))
      }
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
      <form ref={form} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={t('auth.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            // What was wrong with the old name says nothing about the new one.
            setErrors(({ username: _gone, ...rest }) => rest)
          }}
          hint={nameState === 'checking' ? t('auth.usernameChecking') : t('auth.usernameHint')}
          success={nameState === 'free' ? t('auth.usernameFree', { username: username.trim() }) : undefined}
          error={errors.username ? t(errors.username) : nameState === 'taken' ? t('validation.usernameTaken') : undefined}
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
        <Captcha ref={captcha} onToken={setCaptchaToken} onUnavailable={() => toast.error(t('auth.captchaUnavailable'))} language={i18n.resolvedLanguage} />
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
