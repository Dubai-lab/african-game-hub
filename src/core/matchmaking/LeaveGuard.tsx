import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/core/ui/Button'

/**
 * Stops a player from walking out of a live game by accident. While `active`, pressing the
 * phone's (or the browser's) Back button does not leave the game screen: it asks first. Their
 * clock keeps running while they are away, so leaving by mistake can cost them the game.
 *
 * How: a marker is placed on top of the page's history when the game is live. Back lands on the
 * page underneath the marker, which is this same screen, and that is the moment to ask. "Stay"
 * puts the marker back; "Leave" goes back once more, for real. Once the game is over the marker
 * is simply stepped over. Links and buttons in the app are not affected: this is only for Back.
 */
export function LeaveGuard({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [asking, setAsking] = useState(false)
  const live = useRef(active)
  live.current = active
  /** Whether our marker is the top of the history just now. */
  const marked = useRef(false)

  useEffect(() => {
    if (!active || marked.current) return
    try {
      window.history.pushState({ ...(window.history.state as object | null), aghLeaveGuard: true }, '')
      marked.current = true
    } catch {
      // History not available (a locked-down browser): the game works, without the question.
    }
  }, [active])

  useEffect(() => {
    const onBack = () => {
      // Only our own marker being stepped off is of interest.
      if (!marked.current || (window.history.state as { aghLeaveGuard?: boolean } | null)?.aghLeaveGuard) return
      marked.current = false
      if (live.current) setAsking(true)
      // The game ended while the marker was there: this Back was meant to leave, so carry on.
      else window.history.back()
    }
    window.addEventListener('popstate', onBack)
    return () => window.removeEventListener('popstate', onBack)
  }, [])

  // The game ended while the question was up: there is nothing left to ask.
  useEffect(() => {
    if (!active) setAsking(false)
  }, [active])

  if (!asking) return null
  const stay = () => {
    setAsking(false)
    try {
      window.history.pushState({ ...(window.history.state as object | null), aghLeaveGuard: true }, '')
      marked.current = true
    } catch {
      // As above.
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 sm:items-center" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-label={t('leaveGame.title')} className="w-full max-w-md border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:border-4">
        <h2 className="font-display text-2xl font-extrabold text-primary">{t('leaveGame.title')}</h2>
        <p className="mt-1 text-muted">{t('leaveGame.body')}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => window.history.back()}>
            {t('leaveGame.leave')}
          </Button>
          <Button onClick={stay} autoFocus>
            {t('leaveGame.stay')}
          </Button>
        </div>
      </div>
    </div>
  )
}
