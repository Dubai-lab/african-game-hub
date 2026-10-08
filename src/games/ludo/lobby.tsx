import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/core/settings/settingsStore'
import type { GameModule, GameOptions, LobbyOptionsProps } from '@/games/types'

type Mode = { id: string; pieces: number }
/** What a Ludo match is made on. Players are only seated with others who chose the same. */
export type LudoOptions = { mode: string | null; players: number; dice: number; sides: number; lay: boolean }

/** The game lengths on offer, from the registry (`game_types.options_schema`). */
export function parseModes(schema: unknown): Mode[] {
  const list = (schema as { modes?: unknown } | null)?.modes
  if (!Array.isArray(list)) return []
  return list.filter((m): m is Mode => typeof m?.id === 'string' && Number.isInteger(m?.pieces) && m.pieces >= 1 && m.pieces <= 4)
}

/** The table sizes on offer. */
export function parseSizes(schema: unknown): number[] {
  const list = (schema as { players?: unknown } | null)?.players
  return Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n) && n >= 2 && n <= 4) : [2]
}

/** Reads a stored choice, filling anything missing from the player's Ludo settings. */
export function readOptions(value: GameOptions | null): LudoOptions {
  const settings = useSettingsStore.getState()
  const players = typeof value?.players === 'number' ? value.players : 2
  return {
    mode: typeof value?.mode === 'string' ? value.mode : null,
    players,
    dice: value?.dice === 1 || value?.dice === 2 ? value.dice : settings.ludoDice,
    // Both sides is a two-player game.
    sides: players !== 2 ? 1 : value?.sides === 1 || value?.sides === 2 ? value.sides : settings.ludoSides,
    lay: typeof value?.lay === 'boolean' ? value.lay : settings.ludoLay,
  }
}

const option = (chosen: boolean) =>
  `flex min-h-14 cursor-pointer flex-col justify-center border-2 px-3 py-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel text-ink'}`

function TablePicker({ schema, value, onChange }: LobbyOptionsProps) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const current = readOptions(value)
  const choose = (patch: Partial<LudoOptions>) => {
    const next = { ...current, ...patch }
    if (next.players !== 2) next.sides = 1
    onChange(next)
    // The choices that are also Ludo settings are remembered there.
    if (patch.dice) settings.set({ ludoDice: patch.dice as 1 | 2 })
    if (patch.sides) settings.set({ ludoSides: patch.sides as 1 | 2 })
    if (patch.lay !== undefined) settings.set({ ludoLay: patch.lay })
  }
  const radio = (name: string, chosen: boolean, onPick: () => void, label: string, hint?: string) => (
    <label key={label} className={`${option(chosen)} ${hint ? '' : 'items-center text-center'} font-bold`}>
      <input type="radio" name={name} className="sr-only" checked={chosen} onChange={onPick} />
      <span>{label}</span>
      {hint && <span className="text-sm font-normal">{hint}</span>}
    </label>
  )

  return (
    <div className="flex flex-col gap-6">
      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('ludo.lobby.players')}</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {parseSizes(schema).map((players) => radio('ludo-players', players === current.players, () => choose({ players }), t('ludo.playersCount', { count: players })))}
        </div>
        <p className="mt-2 text-sm text-muted">{t('ludo.lobby.playersHint')}</p>
      </fieldset>

      {current.players === 2 && (
        <fieldset>
          <legend className="font-display text-xl font-semibold">{t('ludo.lobby.sides')}</legend>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[2, 1].map((sides) => radio('ludo-sides', sides === current.sides, () => choose({ sides }), t(`ludo.sides.${sides}`), t(`ludo.sidesHint.${sides}`)))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('ludo.lobby.length')}</legend>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {parseModes(schema).map((m) => radio('ludo-mode', m.id === current.mode, () => choose({ mode: m.id }), t(`ludo.mode.${m.id}`, { defaultValue: m.id }), t('ludo.lobby.pieces', { count: m.pieces })))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-display text-xl font-semibold">{t('ludo.lobby.rules')}</legend>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[2, 1].map((dice) => radio('ludo-dice', dice === current.dice, () => choose({ dice }), t('ludo.diceCount', { count: dice })))}
          {[true, false].map((lay) => radio('ludo-lay', lay === current.lay, () => choose({ lay }), t(lay ? 'ludo.lay.on' : 'ludo.lay.off'), t(lay ? 'ludo.lay.onHint' : 'ludo.lay.offHint')))}
        </div>
        <p className="mt-2 text-sm text-muted">{t('ludo.lobby.hint')}</p>
      </fieldset>
    </div>
  )
}

export const ludoModule: GameModule = {
  id: 'ludo',
  defaultOptions: (schema) => {
    const first = parseModes(schema).find((m) => m.pieces === 4) ?? parseModes(schema)[0]
    return first ? { ...readOptions({ players: parseSizes(schema)[0] ?? 2 }), mode: first.id } : null
  },
  isValidOptions: (schema, value) => {
    const o = readOptions(value)
    return (
      parseModes(schema).some((m) => m.id === o.mode) &&
      parseSizes(schema).includes(o.players) &&
      // A choice saved before these options existed is not complete: start again from the defaults.
      (value?.dice === 1 || value?.dice === 2) &&
      (value?.sides === 1 || value?.sides === 2) &&
      typeof value?.lay === 'boolean' &&
      (o.players === 2 || value.sides === 1)
    )
  },
  // One Ludo standing, whatever the choices (the server says the same).
  ratingPool: () => 'default',
  players: (_schema, value) => readOptions(value).players,
  // Ludo players are known by the games they have won, not by a rating number.
  standing: 'wins',
  OptionsPicker: TablePicker,
  MatchScreen: lazy(() => import('./LudoMatchPage')),
  practice: [{ to: '/play/ludo/computer', labelKey: 'ludo.computer.link' }],
  SettingsSection: lazy(() => import('./LudoSettings')),
}
