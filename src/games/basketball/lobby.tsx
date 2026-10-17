import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameModule, GameOptions, LobbyOptionsProps } from '@/games/types'

// Street basketball on the hub: online one against one or two against two, run by the game
// server, and practice against the computer.

/** The sizes on offer, from the registry: 2 players (one a side) or 4 (two a side). */
function parseSizes(schema: unknown): number[] {
  const list = (schema as { players?: unknown } | null)?.players
  const sizes = Array.isArray(list) ? list.filter((n): n is number => n === 2 || n === 4) : []
  return sizes.length ? sizes : [2]
}

const readPlayers = (value: GameOptions | null) => (value?.players === 4 ? 4 : 2)

function SidesPicker({ schema, value, onChange }: LobbyOptionsProps) {
  const { t } = useTranslation()
  const current = readPlayers(value)
  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold">{t('basketball.practice.mode')}</legend>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {parseSizes(schema).map((players) => {
          const chosen = players === current
          return (
            <label
              key={players}
              className={`flex min-h-14 cursor-pointer flex-col justify-center border px-4 py-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${chosen ? 'border-edge bg-brand text-brand-ink' : 'border-line bg-panel text-fg'}`}
            >
              <input type="radio" name="basketball-players" className="sr-only" checked={chosen} onChange={() => onChange({ players })} />
              <span className="font-bold">{t(`basketball.online.modes.${players}.name`)}</span>
              <span className={`text-sm ${chosen ? '' : 'text-muted'}`}>{t(`basketball.online.modes.${players}.hint`)}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export const basketballModule: GameModule = {
  id: 'basketball',
  defaultOptions: (schema) => ({ players: parseSizes(schema)[0] ?? 2 }),
  isValidOptions: (schema, value) => typeof value?.players === 'number' && parseSizes(schema).includes(value.players),
  // One against one is rated; two against two is not yet (the server says the same).
  ratingPool: (_schema, value) => (readPlayers(value) === 4 ? 'unrated' : 'default'),
  players: (_schema, value) => readPlayers(value),
  OptionsPicker: SidesPicker,
  MatchScreen: lazy(() => import('./BasketballMatchPage')),
  practice: [{ to: '/play/basketball/practice', labelKey: 'basketball.practice.link' }],
  optionsLabel: (_schema, value) => (readPlayers(value) === 4 ? '2v2' : '1v1'),
}
