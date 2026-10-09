import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Skeleton } from '@/core/ui/Skeleton'
import { GameHeader, GameNotOpen, useMatchSetup } from './setup'

/**
 * A game's own settings (for chess: board colours, pieces, premoves). Each game keeps its
 * settings on its own page, so the general Settings page stays short however many games there are.
 */
export default function GameSettingsPage() {
  const { t } = useTranslation()
  const { gameId } = useParams()
  const { games, game, module } = useMatchSetup(gameId)

  if (games.isPending) return <Skeleton className="h-64" />
  if (!game) return <GameNotOpen />
  const gameName = t(`games.${game.id}`, { defaultValue: game.name })
  const Section = module?.SettingsSection

  return (
    <div className="flex flex-col gap-6 lg:max-w-2xl">
      <GameHeader gameId={game.id} title={t('play.settingsTitle')} back={{ to: `/play/${game.id}`, label: t('play.new.backTo', { game: gameName }) }} />
      <section aria-label={t('play.settingsFor', { game: gameName })}>
        {Section ? (
          <Suspense fallback={<Skeleton className="h-40" />}>
            <Section />
          </Suspense>
        ) : (
          <p className="text-muted">{t('play.noSettings')}</p>
        )}
      </section>
    </div>
  )
}
