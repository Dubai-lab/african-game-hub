import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

export function OfflineBanner() {
  const { t } = useTranslation()
  const online = useOnline()
  if (online) return null
  return (
    <p role="status" className="bg-ink px-4 py-2 text-center text-sm text-surface">
      {t('app.offline')}
    </p>
  )
}
