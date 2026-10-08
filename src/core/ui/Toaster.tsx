import { useTranslation } from 'react-i18next'
import { type ToastKind, useToastStore } from './toast'

const kindClass: Record<ToastKind, string> = {
  error: 'bg-danger text-white',
  success: 'bg-palm text-white',
  info: 'bg-ink text-surface',
}

export function Toaster() {
  const { t } = useTranslation()
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <button
          key={item.id}
          type="button"
          role={item.kind === 'error' ? 'alert' : 'status'}
          aria-label={`${item.message} (${t('common.dismiss')})`}
          onClick={() => dismiss(item.id)}
          className={`toast-in pointer-events-auto w-full max-w-sm rounded-lg px-4 py-3 text-start text-sm font-medium shadow-lg ${kindClass[item.kind]}`}
        >
          {item.message}
        </button>
      ))}
    </div>
  )
}
