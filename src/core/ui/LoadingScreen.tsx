import { useTranslation } from 'react-i18next'

export function LoadingScreen({ messageKey = 'app.loading' }: { messageKey?: string }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
      <span className="size-9 animate-spin rounded-full border-4 border-line border-t-primary" aria-hidden="true" />
      <p className="text-sm text-muted">{t(messageKey)}</p>
    </div>
  )
}
