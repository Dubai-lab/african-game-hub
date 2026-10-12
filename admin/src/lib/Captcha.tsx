import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// The check that whoever is signing in is a person (Cloudflare Turnstile): for almost everyone
// a box that ticks itself. When it is switched on for the Supabase project, EVERY sign-in must
// carry an answer, the admin system's included, so this is the same check the player site
// shows. It is switched on here by building with VITE_TURNSTILE_SITE_KEY (the public half of
// the key); without it nothing is shown or loaded. The answer is checked by Supabase's auth
// server, never by this page.
//
// The admin site's Content-Security-Policy must allow https://challenges.cloudflare.com as a
// source of scripts and of frames, or the box cannot be loaded.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Whether signing in must carry an answer from the check. */
export const captchaRequired = Boolean(SITE_KEY)

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
const turnstile = () => (window as unknown as { turnstile?: Turnstile }).turnstile

let loading: Promise<void> | null = null
function load(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new Error('The check could not be loaded'))
    }
    document.head.append(script)
  })
  return loading
}

export type CaptchaHandle = {
  /** An answer can be used once: after a failed attempt a new one is needed. */
  reset: () => void
}

type Props = {
  /** The answer to send with the form, or null while there is none (not yet solved, or expired). */
  onToken: (token: string | null) => void
  /** The check could not be shown at all (blocked, offline). */
  onUnavailable?: () => void
}

export const Captcha = forwardRef<CaptchaHandle, Props>(function Captcha({ onToken, onUnavailable }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const handlers = useRef({ onToken, onUnavailable })
  handlers.current = { onToken, onUnavailable }

  useImperativeHandle(ref, () => ({
    reset() {
      handlers.current.onToken(null)
      if (widget.current) turnstile()?.reset(widget.current)
    },
  }))

  useEffect(() => {
    if (!SITE_KEY) return
    let gone = false
    load().then(
      () => {
        const api = turnstile()
        if (gone || !box.current || !api) return
        widget.current = api.render(box.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => handlers.current.onToken(null),
        })
      },
      () => !gone && handlers.current.onUnavailable?.(),
    )
    return () => {
      gone = true
      if (widget.current) turnstile()?.remove(widget.current)
      widget.current = null
    }
  }, [])

  if (!SITE_KEY) return null
  // Room is kept for the box so the form does not jump when it arrives.
  return <div ref={box} className="min-h-[65px]" data-testid="captcha" />
})
