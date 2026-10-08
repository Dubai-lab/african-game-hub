import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Numbers, money, dates and country names written the way the player's language writes them. */
export function useFormat() {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'en'
  return useMemo(() => {
    const number = new Intl.NumberFormat(language)
    const signed = new Intl.NumberFormat(language, { signDisplay: 'exceptZero' })
    // Times are stored in UTC and shown in the player's own time zone.
    const dateTime = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' })
    const dateOnly = new Intl.DateTimeFormat(language, { dateStyle: 'medium' })
    let regions: Intl.DisplayNames | null = null
    try {
      regions = new Intl.DisplayNames([language], { type: 'region' })
    } catch {
      // Older browsers: country codes are shown instead of names.
    }
    return {
      tokens: (value: number) => number.format(value),
      signedTokens: (value: number) => signed.format(value),
      money: (value: number, currency: string, digits: number) =>
        new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: digits }).format(value),
      dateTime: (iso: string) => dateTime.format(new Date(iso)),
      date: (iso: string) => dateOnly.format(new Date(iso)),
      country: (code: string) => regions?.of(code) ?? code,
    }
  }, [language])
}
