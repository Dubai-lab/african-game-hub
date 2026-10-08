import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'
import { useMyProfile } from '@/core/profile/useMyProfile'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { useFormat } from '@/core/ui/useFormat'
import { WalletSummary } from './WalletSummary'

const PAGE_SIZE = 30

type Entry = {
  id: number
  amount: number
  balance_type: string
  entry_type: string
  balance_after: number
  created_at: string
}

/** The player's own ledger, newest first. This is the ledger itself, not a summary of it. */
function useLedger() {
  const { user } = useAuth()
  const userId = user?.id
  return useInfiniteQuery({
    queryKey: ['ledger', userId],
    enabled: Boolean(userId),
    meta: { errorKey: 'wallet.historyFailed' },
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<Entry[]> => {
      let query = supabase
        .from('ledger_entries')
        .select('id, amount, balance_type, entry_type, balance_after, created_at')
        .order('id', { ascending: false })
        .limit(PAGE_SIZE)
      // Keyed on the id, so new entries arriving while the player reads never shift the pages.
      if (pageParam !== null) query = query.lt('id', pageParam)
      const { data, error } = await query
      if (error) throw error
      return data
    },
    getNextPageParam: (page) => (page.length === PAGE_SIZE ? page[page.length - 1]!.id : undefined),
  })
}

export default function WalletPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const profile = useMyProfile()
  const ledger = useLedger()
  const entries = ledger.data?.pages.flat() ?? []
  const realMoney = profile.data?.country?.realMoneyEnabled ?? false

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-10">
      <h1 className="font-display text-3xl font-extrabold text-primary lg:col-span-2 lg:text-4xl">{t('wallet.title')}</h1>
      <div className="flex flex-col gap-6">
      <WalletSummary profile={profile.data} />
      <p className="text-sm text-muted">{t('wallet.explain')}</p>

      <section className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {(['deposit', 'withdraw'] as const).map((action) => (
            // Present so players know it is planned, and plainly not available yet.
            <Button key={action} variant="ghost" disabled className="flex-col gap-0 bg-panel leading-tight">
              {t(`wallet.${action}`)}
              <span className="text-xs font-semibold">{t('wallet.comingSoon')}</span>
            </Button>
          ))}
        </div>
        {!realMoney && <p className="text-sm text-muted">{t('wallet.moneyOff')}</p>}
      </section>
      </div>

      <section aria-labelledby="wallet-history">
        <h2 id="wallet-history" className="font-display text-xl font-semibold">
          {t('wallet.history')}
        </h2>
        {ledger.isPending ? (
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : ledger.isError && entries.length === 0 ? (
          <div role="alert" className="mt-3 flex flex-col items-start gap-3">
            <p>{t('wallet.historyFailed')}</p>
            <Button variant="ghost" onClick={() => void ledger.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="mt-3 text-muted">{t('wallet.empty')}</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-line border-y border-line" data-testid="ledger">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{t(`wallet.entry.${entry.entry_type}`, { defaultValue: entry.entry_type })}</p>
                    <p className="text-sm text-muted">
                      {format.dateTime(entry.created_at)} · {t(entry.balance_type === 'cash' ? 'wallet.cash' : 'wallet.bonus')}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className={`text-lg font-bold tabular-nums ${entry.amount > 0 ? 'text-palm' : 'text-hibiscus'}`}>
                      {format.signedTokens(entry.amount)}
                    </p>
                    <p className="text-xs tabular-nums text-muted">
                      {t('wallet.balanceAfter', { balance: format.tokens(entry.balance_after) })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {ledger.hasNextPage && (
              <Button variant="ghost" className="mt-4 w-full" disabled={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
                {ledger.isFetchingNextPage ? t('app.loading') : t('wallet.older')}
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
