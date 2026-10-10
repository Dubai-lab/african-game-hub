import { useTranslation } from 'react-i18next'
import type { MyProfile } from '@/core/profile/useMyProfile'
import { Skeleton } from '@/core/ui/Skeleton'
import { useFormat } from '@/core/ui/useFormat'
import { useWallet } from './useWallet'

/** The two balances, side by side, with the play-only notice for countries without real money. */
export function WalletSummary({ profile }: { profile: MyProfile | undefined }) {
  const { t } = useTranslation()
  const format = useFormat()
  const wallet = useWallet()
  const country = profile?.country

  return (
    <section aria-labelledby="wallet-summary" className="bg-primary p-4 text-surface">
      <h2 id="wallet-summary" className="text-sm font-semibold text-primary-tint">
        {t('lobby.walletTitle')}
      </h2>
      {wallet.isError ? (
        <p className="mt-2 flex flex-wrap items-center gap-3" role="alert">
          {t('wallet.loadFailed')}
          <button type="button" onClick={() => void wallet.refetch()} className="min-h-10 font-bold underline">
            {t('common.retry')}
          </button>
        </p>
      ) : (
        // Bonus and cash are different money: bonus can be played but never withdrawn.
        <dl className="mt-1 grid grid-cols-2 gap-4">
          {(['bonus', 'cash'] as const).map((kind) => (
            <div key={kind} className="flex flex-col-reverse">
              <dt className="text-sm text-primary-tint">{t(`lobby.${kind}`)}</dt>
              <dd className="font-display text-4xl font-extrabold tabular-nums" data-testid={`balance-${kind}`}>
                {wallet.data ? format.tokens(wallet.data[kind]) : <Skeleton className="my-1.5 h-8 w-24 bg-primary-soft" />}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {country && !country.realMoneyEnabled && (
        <p className="mt-3 border-t border-primary-soft pt-3 text-sm text-primary-tint">
          {/* No price is put on these tokens: while play is free they are not worth money. */}
          {t('lobby.playOnly', { country: format.country(country.code) })}
        </p>
      )}
    </section>
  )
}
