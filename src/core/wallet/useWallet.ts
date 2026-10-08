import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'

export type Wallet = { bonus: number; cash: number }

const walletKey = (userId: string | undefined) => ['wallet', userId]

/**
 * The signed-in player's balances. Read-only: the client can never change them.
 * Any number of components may call this; they share one cached query.
 */
export function useWallet() {
  const { user } = useAuth()
  const userId = user?.id

  return useQuery({
    queryKey: walletKey(userId),
    enabled: Boolean(userId),
    meta: { errorKey: 'wallet.loadFailed' },
    queryFn: async (): Promise<Wallet> => {
      const { data, error } = await supabase
        .from('wallets')
        .select('bonus_balance, cash_balance')
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return { bonus: data?.bonus_balance ?? 0, cash: data?.cash_balance ?? 0 }
    },
  })
}

let channelSeq = 0

/**
 * Keeps the wallet live. Mounted ONCE, in the signed-in app frame: Supabase refuses a second
 * listener on a channel that is already open, so this must not live inside useWallet().
 *
 * Balances stay fresh three ways: Realtime pushes every change, each (re)connect refetches in
 * case a push was missed while offline, and TanStack Query refetches when the app regains focus.
 */
export function useWalletLiveUpdates() {
  const { user } = useAuth()
  const userId = user?.id
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId) return
    const key = walletKey(userId)
    // A fresh topic per mount: a channel that is still closing can never be picked up again.
    const channel = supabase
      .channel(`wallet:${userId}:${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { bonus_balance?: unknown; cash_balance?: unknown }
          // A balance change always comes with new ledger rows: refresh the history too.
          void queryClient.invalidateQueries({ queryKey: ['ledger', userId] })
          if (typeof row.bonus_balance === 'number' && typeof row.cash_balance === 'number') {
            queryClient.setQueryData<Wallet>(key, { bonus: row.bonus_balance, cash: row.cash_balance })
          } else {
            void queryClient.invalidateQueries({ queryKey: key })
          }
        },
      )
      // The client rejoins by itself after a drop; each (re)join refetches to cover the gap.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void queryClient.invalidateQueries({ queryKey: key })
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, queryClient])
}
