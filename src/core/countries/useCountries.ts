import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/core/lib/supabase'

export type CountryOption = { code: string; name: string; flag: string }

/** Regional-indicator emoji for an ISO country code (RW -> 🇷🇼). */
export function flagEmoji(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** Countries the hub supports, named in the current language and sorted for that language. */
export function useCountries() {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'en'

  const query = useQuery({
    queryKey: ['countries'],
    // Reference data: it changes a few times a year, so do not refetch on every focus.
    staleTime: 24 * 60 * 60 * 1000,
    meta: { errorKey: 'auth.countryLoadFailed' },
    queryFn: async () => {
      const { data, error } = await supabase.from('countries').select('country_code, name').order('name')
      if (error) throw error
      return data
    },
  })

  const countries = useMemo<CountryOption[]>(() => {
    if (!query.data) return []
    let localized: Intl.DisplayNames | null = null
    try {
      localized = new Intl.DisplayNames([language], { type: 'region' })
    } catch {
      // Older browsers: fall back to the English names from the database.
    }
    return query.data
      .map((c) => ({
        code: c.country_code,
        name: localized?.of(c.country_code) ?? c.name,
        flag: flagEmoji(c.country_code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, language))
  }, [query.data, language])

  return { countries, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch }
}

/** The visitor's likely country from their browser language (en-RW -> RW), if we support it. */
export function guessCountry(supported: CountryOption[]): string {
  const locales = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const locale of locales) {
    const region = locale?.split('-')[1]?.toUpperCase()
    if (region && supported.some((c) => c.code === region)) return region
  }
  return ''
}
