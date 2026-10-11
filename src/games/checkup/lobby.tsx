import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameModule, GameOptions, LobbyOptionsProps } from '@/games/types'

/** What a game of Check Up is made on. Players are only seated with others who chose the same. */
export type CheckUpOptions = { players: number }

/** The table sizes on offer, from the registry (`game_types.options_schema`). */
export function parseSizes(schema: unknown): number[] {
  const list = (schema as { players?: unknown } | null)?.players
  return Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n) && n >= 2 && n <= 4) : [2]
}

const readOptions = (value: GameOptions | null): CheckUpOptions => ({ players: typeof value?.players === 'number' ? value.players : 2 })

function TablePicker({ schema, value, onChange }: LobbyOptionsProps) {
  const { t } = useTranslation()
  const current = readOptions(value)
  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold">{t('checkup.lobby.players')}</legend>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {parseSizes(schema).map((players) => (
          <label
            key={players}
            className={`flex min-h-14 cursor-pointer items-center justify-center border-2 px-3 py-1 text-center font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${players === current.players ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel text-ink'}`}
          >
            <input type="radio" name="checkup-players" className="sr-only" checked={players === current.players} onChange={() => onChange({ players })} />
            {t('checkup.playersCount', { count: players })}
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">{t('checkup.lobby.playersHint')}</p>
    </fieldset>
  )
}

export const checkupModule: GameModule = {
  id: 'checkup',
  defaultOptions: (schema) => ({ players: parseSizes(schema)[0] ?? 2 }),
  isValidOptions: (schema, value) => typeof value?.players === 'number' && parseSizes(schema).includes(value.players),
  // One standing for Check Up, whatever the size of the table (the server says the same).
  ratingPool: () => 'default',
  players: (_schema, value) => readOptions(value).players,
  // Card players are known by the games they have won, not by a rating number.
  standing: 'wins',
  OptionsPicker: TablePicker,
  MatchScreen: lazy(() => import('./CheckUpMatchPage')),
  practice: [{ to: '/play/checkup/computer', labelKey: 'checkup.computer.link' }],
  optionsLabel: (_schema, value) => String(readOptions(value).players),
}
