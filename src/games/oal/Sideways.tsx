// One Africa Life is played with the phone sideways (landscape), as games are. Where the browser
// lets a page turn the screen (Android: full screen, or the app installed), it is turned at the
// first touch; where it does not (an iPhone), a phone held upright is asked to be turned. The
// rest of the hub stays as it is (upright): the screen is let go on leaving.
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/core/ui/Button'

/** A phone (a touch screen) held upright. */
const UPRIGHT = '(orientation: portrait) and (pointer: coarse)'

type Lockable = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void>; unlock?: () => void }

/** Whether the game put the page in full screen (and so takes it out again). */
const entered = { current: false }

/** Full screen (where the browser has it), then the screen turned sideways and held there. */
async function turnSideways() {
  const orientation = screen.orientation as Lockable | undefined
  if (!orientation?.lock) return false
  try {
    await orientation.lock('landscape')
    return true
  } catch {
    // (Most browsers turn it only in full screen.)
  }
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      entered.current = true
    }
    await orientation.lock('landscape')
    return true
  } catch {
    return false
  }
}

export function Sideways({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [upright, setUpright] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(UPRIGHT).matches)
  // Whether this browser can turn the screen itself (not an iPhone's).
  const [canTurn] = useState(() => typeof screen !== 'undefined' && Boolean((screen.orientation as Lockable | undefined)?.lock) && Boolean(document.documentElement.requestFullscreen))
  useEffect(() => {
    const q = matchMedia(UPRIGHT)
    const on = () => setUpright(q.matches)
    q.addEventListener('change', on)
    // Turned at the first touch (a page may go full screen only when touched).
    const first = () => {
      if (matchMedia(UPRIGHT).matches) void turnSideways()
    }
    window.addEventListener('pointerdown', first, { once: true })
    // (Upright already: turned now where the browser lets it without full screen, an installed app.)
    if (q.matches) void (screen.orientation as Lockable | undefined)?.lock?.('landscape').catch(() => {})
    return () => {
      q.removeEventListener('change', on)
      window.removeEventListener('pointerdown', first)
      // Leaving the game: the screen let go, out of full screen.
      try {
        ;(screen.orientation as Lockable | undefined)?.unlock?.()
      } catch {
        // (Nothing held.)
      }
      if (document.fullscreenElement && entered.current) void document.exitFullscreen().catch(() => {})
    }
  }, [])
  return (
    <>
      {children}
      {upright && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-bg p-6 text-center" data-testid="oal-turn-phone">
          <svg viewBox="0 0 64 64" className="h-24 w-24 animate-[oal-turn_2.4s_ease-in-out_infinite] text-accent" aria-hidden>
            <rect x="20" y="6" width="24" height="52" rx="5" fill="none" stroke="currentColor" strokeWidth="3" />
            <circle cx="32" cy="51" r="2.2" fill="currentColor" />
          </svg>
          <h2 className="font-display text-2xl font-extrabold">{t('oal.sideways.title')}</h2>
          <p className="max-w-xs text-sm text-muted">{t('oal.sideways.body')}</p>
          {canTurn && (
            <Button className="min-h-12 px-6" onClick={() => void turnSideways()} data-testid="oal-turn-now">
              {t('oal.sideways.turn')}
            </Button>
          )}
        </div>
      )}
    </>
  )
}
