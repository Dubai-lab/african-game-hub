import { useTranslation } from 'react-i18next'
import { LANGUAGES, type LanguageCode, setLanguage } from '@/core/i18n'
import { toast } from './toast'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()

  async function onChange(code: LanguageCode) {
    try {
      await setLanguage(code)
    } catch {
      toast.error(t('errors.network'))
    }
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={i18n.resolvedLanguage ?? 'en'}
        onChange={(e) => void onChange(e.target.value as LanguageCode)}
        className="min-h-10 rounded-lg border border-line bg-surface px-2 text-ink"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
