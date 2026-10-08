import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameModule, LobbyOptionsProps } from '@/games/types'

/** The games of pool on offer, from the registry (`game_types.options_schema`). */
export function parseVariants(schema: unknown): string[] {
  const list = (schema as { variants?: unknown } | null)?.variants
  return Array.isArray(list) ? list.filter((v): v is string => v === '8ball' || v === '9ball') : []
}

const chosen = (value: LobbyOptionsProps['value']) => (typeof value?.variant === 'string' ? value.variant : null)

function VariantPicker({ schema, value, onChange }: LobbyOptionsProps) {
  const { t } = useTranslation()
  const current = chosen(value)
  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold">{t('pool.lobby.game')}</legend>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {parseVariants(schema).map((variant) => (
          <label
            key={variant}
            className={`flex min-h-16 cursor-pointer flex-col justify-center border-2 px-3 py-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${variant === current ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel text-ink'}`}
          >
            <input type="radio" name="pool-variant" className="sr-only" checked={variant === current} onChange={() => onChange({ variant })} />
            <span className="font-bold">{t(`pool.variant.${variant}`)}</span>
            <span className="text-sm">{t(`pool.lobby.hint.${variant}`)}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">{t('pool.lobby.note')}</p>
    </fieldset>
  )
}

export const poolModule: GameModule = {
  id: 'pool',
  defaultOptions: (schema) => {
    const first = parseVariants(schema)[0]
    return first ? { variant: first } : null
  },
  isValidOptions: (schema, value) => parseVariants(schema).includes(chosen(value) ?? ''),
  // 8-ball and 9-ball are different games, each with its own rating (the server says the same).
  ratingPool: (_schema, value) => (chosen(value) === '9ball' ? 'nine_ball' : 'eight_ball'),
  // Pool players are known by the games they have won, not by a rating number (the hidden
  // rating still pairs players of similar strength).
  standing: 'wins',
  OptionsPicker: VariantPicker,
  MatchScreen: lazy(() => import('./PoolMatchPage')),
  practice: [{ to: '/play/pool/computer', labelKey: 'pool.computer.link' }],
  SettingsSection: lazy(() => import('./PoolSettings')),
}
