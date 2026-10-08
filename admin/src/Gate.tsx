import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { api, ApiError, sessionProblem } from './lib/api'
import { configured, supabase } from './lib/supabase'
import { Button, inputClass } from './ui'

// Signing in to the admin system takes two steps, every time:
//   1. email and password of an account that is on the admin list,
//   2. a six-digit code from an authenticator app on the admin's phone.
// The server checks both on every request; this screen only walks the admin through them.

type Stage = 'checking' | 'signed-out' | 'second-step' | 'ready'
type Session = { email: string | null; signOut: () => void }

const IDLE_LIMIT_MS = 20 * 60 * 1000

async function leave() {
  // 'local': ends this admin session only, not the same person's player session elsewhere.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
}

export function Gate({ children }: { children: (session: Session) => ReactNode }) {
  const [stage, setStage] = useState<Stage>('checking')
  const [email, setEmail] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const signOut = useCallback((message: string | null = null) => {
    void leave().then(() => {
      setNotice(message)
      setStage('signed-out')
    })
  }, [])

  /** Asks the server where this session stands. */
  const check = useCallback(async () => {
    try {
      const status = await api<{ secondStepPassed: boolean; email: string | null }>('session')
      setEmail(status.email)
      setStage(status.secondStepPassed ? 'ready' : 'second-step')
      return true
    } catch (error) {
      setNotice(error instanceof ApiError && error.code === 'NETWORK' ? error.message : null)
      setStage('signed-out')
      return false
    }
  }, [])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return setStage('signed-out')
      // A stored session that no longer passes is thrown away.
      void check().then((passed) => (passed ? undefined : leave()))
    })
    const lost = () => signOut('Your session has ended. Sign in again.')
    sessionProblem.addEventListener('lost', lost)
    return () => sessionProblem.removeEventListener('lost', lost)
  }, [check, signOut])

  // Left unattended, the admin system locks itself.
  useEffect(() => {
    if (stage !== 'ready') return
    let timer = window.setTimeout(() => signOut('Signed out after 20 minutes without activity.'), IDLE_LIMIT_MS)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => signOut('Signed out after 20 minutes without activity.'), IDLE_LIMIT_MS)
    }
    const events = ['pointerdown', 'keydown', 'scroll'] as const
    events.forEach((name) => window.addEventListener(name, reset, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((name) => window.removeEventListener(name, reset))
    }
  }, [stage, signOut])

  if (!configured) {
    return (
      <Frame title="Not set up">
        <p className="text-sm">VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing. Set them and rebuild.</p>
      </Frame>
    )
  }
  if (stage === 'checking') return <Frame title="Checking your session…" />
  if (stage === 'ready') return <>{children({ email, signOut: () => signOut(null) })}</>
  if (stage === 'second-step') return <SecondStep onPassed={() => void check()} onCancel={() => signOut(null)} />
  return <SignIn notice={notice} onSignedIn={check} />
}

function Frame({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink p-4">
      <div className="w-full max-w-sm rounded bg-panel p-6">
        <p className="text-xs font-bold tracking-wide text-indigo">AFRICAN GAME HUB · ADMIN</p>
        <h1 className="mt-1 text-xl font-bold">{title}</h1>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </main>
  )
}

function SignIn({ notice, onSignedIn }: { notice: string | null; onSignedIn: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const { error: failed } = await supabase.auth.signInWithPassword({
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
      })
      // One answer for a wrong password and for a real account that is not an admin, so this
      // screen cannot be used to find out which accounts are admins.
      if (failed || !(await onSignedIn())) {
        await leave()
        setError(failed && !failed.status ? 'Could not reach the server. Try again.' : 'Wrong email or password, or this account has no admin access.')
      }
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame title="Sign in">
      <form onSubmit={submit} className="grid gap-3">
        {notice && <p className="rounded bg-ground px-3 py-2 text-sm">{notice}</p>}
        <label className="text-sm font-semibold">
          Email
          <input name="email" type="email" autoComplete="username" required className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm font-semibold">
          Password
          <input name="password" type="password" autoComplete="current-password" required className={`${inputClass} mt-1`} />
        </label>
        {error && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-xs text-muted">Admins only. Every action taken here is recorded.</p>
      </form>
    </Frame>
  )
}

type Factor = { id: string; qr?: string; secret?: string }

function SecondStep({ onPassed, onCancel }: { onPassed: () => void; onCancel: () => void }) {
  // undefined: still looking; null: this admin has no authenticator yet.
  const [factor, setFactor] = useState<Factor | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void supabase.auth.mfa.listFactors().then(({ data, error: failed }) => {
      if (!current) return
      if (failed) return setError('Could not load your sign-in settings. Reload the page.')
      const ready = data.totp.find((f) => f.status === 'verified')
      setFactor(ready ? { id: ready.id } : null)
    })
    return () => {
      current = false
    }
  }, [])

  async function startSetup() {
    setBusy(true)
    setError(null)
    try {
      // A setup that was started and never finished is thrown away first.
      const { data: existing } = await supabase.auth.mfa.listFactors()
      for (const stale of existing?.all.filter((f) => f.status === 'unverified') ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id })
      }
      const { data, error: failed } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Admin ${new Date().toISOString()}` })
      if (failed) throw failed
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch {
      setError('Could not start the setup. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!factor) return
    const code = String(new FormData(event.currentTarget).get('code')).replace(/\s/g, '')
    setBusy(true)
    setError(null)
    try {
      const { error: failed } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
      if (failed) {
        setError('That code is not right. Codes change every 30 seconds; enter the current one.')
        return
      }
      onPassed()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (factor === undefined) return <Frame title="One more step…">{error && <p className="text-sm font-semibold text-danger">{error}</p>}</Frame>

  if (factor === null) {
    return (
      <Frame title="Protect this account">
        <div className="grid gap-3 text-sm">
          <p>
            Admin access needs a second step: a six-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy
            or similar). You set it up once.
          </p>
          <p className="text-muted">Have the app installed and open before you continue.</p>
          {error && (
            <p role="alert" className="font-semibold text-danger">
              {error}
            </p>
          )}
          <Button variant="primary" disabled={busy} onClick={() => void startSetup()}>
            {busy ? 'Preparing…' : 'Set up authenticator'}
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </Frame>
    )
  }

  return (
    <Frame title={factor.qr ? 'Scan, then enter the code' : 'Enter your code'}>
      <form onSubmit={submit} className="grid gap-3 text-sm">
        {factor.qr ? (
          <>
            <p>In your authenticator app choose “Add account”, scan this picture, then type the six-digit code it shows.</p>
            <img src={factor.qr} alt="Setup code for your authenticator app" className="mx-auto h-44 w-44" />
            <p className="text-muted">
              Cannot scan? Enter this key by hand: <code className="break-all font-mono text-ink" data-testid="totp-secret">{factor.secret}</code>
            </p>
          </>
        ) : (
          <p>Open your authenticator app and type the six-digit code for African Game Hub.</p>
        )}
        <label className="font-semibold">
          Six-digit code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
            autoFocus
            className={`${inputClass} mt-1 font-mono text-lg tracking-widest`}
          />
        </label>
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </form>
    </Frame>
  )
}
