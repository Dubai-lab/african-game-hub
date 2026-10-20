// One Africa Life: while a place is being fetched and built (its 3D files, the town's tiles), a
// screen that says so, with how far it has come, instead of an empty view.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DefaultLoadingManager } from 'three'

export function Loading({ what }: { what: string }) {
  const { t } = useTranslation()
  const [done, setDone] = useState({ loaded: 0, total: 0 })
  useEffect(() => {
    const before = DefaultLoadingManager.onProgress
    DefaultLoadingManager.onProgress = (url, loaded, total) => {
      before?.(url, loaded, total)
      setDone({ loaded, total })
    }
    return () => {
      DefaultLoadingManager.onProgress = before
    }
  }, [])
  const share = done.total ? Math.round((done.loaded / done.total) * 100) : 0
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bg/80" data-testid="oal-loading">
      <div className="glass flex w-64 flex-col items-center gap-3 rounded-2xl border border-line p-5 text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-line border-t-accent" aria-hidden />
        <p className="font-semibold">{what}</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(8, share)}%` }} />
        </div>
        <p className="text-xs text-muted">{t('oal.loading.slow')}</p>
      </div>
    </div>
  )
}
