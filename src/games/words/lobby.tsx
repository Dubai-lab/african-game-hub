import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameModule, GameOptions, LobbyOptionsProps } from '@/games/types'

/** What a game of Word Battle is made on. Players are only seated with others who chose the same. */
export type WordsOptions = { players: number }

/** The table sizes on offer, from the registry (`game_types.options_schema`). */
export function parseSizes(schema: unknown): number[] {
  const list = (schema as { players?: unknown } | null)?.players
  return Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n) && n >= 2 && n <= 4) : [2]
}

const readOptions = (value: GameOptions | null): WordsOptions => ({ players: typeof value?.players === 'number' ? value.players : 2 })

function TablePicker({ schema, value, onChange }: LobbyOptionsProps) {
  const { t } = useTranslation()
  const current = readOptions(value)
  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold">{t('words.lobby.players')}</legend>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {parseSizes(schema).map((players) => (
          <label
            key={players}
            className={`flex min-h-14 cursor-pointer items-center justify-center border px-3 py-1 text-center font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${players === current.players ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel text-fg'}`}
          >
            <input type="radio" name="words-players" className="sr-only" checked={players === current.players} onChange={() => onChange({ players })} />
            {t('words.playersCount', { count: players })}
          </label>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">{t('words.lobby.playersHint')}</p>
    </fieldset>
  )
}

export const wordsModule: GameModule = {
  id: 'words',
  // Two players unless the player chooses a bigger table.
  defaultOptions: (schema) => ({ players: parseSizes(schema).includes(2) ? 2 : (parseSizes(schema)[0] ?? 2) }),
  isValidOptions: (schema, value) => typeof value?.players === 'number' && parseSizes(schema).includes(value.players),
  // One standing for Word Battle, whatever the size of the table (the server says the same).
  ratingPool: () => 'default',
  players: (_schema, value) => readOptions(value).players,
  // Known by the games they have won, like the other games for two to four.
  standing: 'wins',
  OptionsPicker: TablePicker,
  MatchScreen: lazy(() => import('./WordsMatchPage')),
  practice: [{ to: '/play/words/computer', labelKey: 'words.computer.link' }],
  optionsLabel: (_schema, value) => String(readOptions(value).players),
}
