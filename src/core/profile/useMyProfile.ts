import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'

export type MyProfile = {
  username: string
  displayName: string | null
  /** Null for accounts created without one (for example by an admin); the lobby then asks for it. */
  country: {
    code: string
    currencyCode: string
    currencyMinorUnits: number
    /** Local currency (major units) per token. Null until a rate has been set. */
    tokenRate: number | null
    realMoneyEnabled: boolean
  } | null
}

export const myProfileKey = (userId: string | undefined) => ['profile', 'me', userId]

export function useMyProfile() {
  const { user } = useAuth()
  const userId = user?.id

  return useQuery({
    queryKey: myProfileKey(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    meta: { errorKey: 'lobby.profileLoadFailed' },
    queryFn: async (): Promise<MyProfile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'username, display_name, countries (country_code, currency_code, currency_minor_units, token_to_currency_rate, real_money_enabled)',
        )
        .eq('id', userId!)
        .single()
      if (error) throw error
      const c = data.countries
      return {
        username: data.username,
        displayName: data.display_name,
        country: c && {
          code: c.country_code,
          currencyCode: c.currency_code,
          currencyMinorUnits: c.currency_minor_units,
          tokenRate: c.token_to_currency_rate,
          realMoneyEnabled: c.real_money_enabled,
        },
      }
    },
  })
}
