import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameModule, LobbyOptionsProps } from '@/games/types'

export type TimeControl = { id: string; base_ms: number; increment_ms: number }

/** The clocks on offer, from the registry (`game_types.options_schema`). */
export function parseTimeControls(schema: unknown): TimeControl[] {
  const list = (schema as { time_controls?: unknown } | null)?.time_controls
  if (!Array.isArray(list)) return []
  return list.filter(
    (c): c is TimeControl => typeof c?.id === 'string' && Number.isInteger(c?.base_ms) && c.base_ms > 0 && Number.isInteger(c?.increment_ms) && c.increment_ms >= 0,
  )
}

/** Minutes, and the seconds added per move when there are any: "5 | 3". The same in every language. */
export function timeControlLabel(control: TimeControl): string {
  const minutes = control.base_ms / 60_000
  const base = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)
  return control.increment_ms > 0 ? `${base} | ${control.increment_ms / 1000}` : base
}

const chosen = (value: LobbyOptionsProps['value']) => (typeof value?.time_control === 'string' ? value.time_control : null)
// A quick game is where most players start.
const PREFERRED_DEFAULT = '5+3'

function TimeControlPicker({ schema, value, onChange }: LobbyOptionsProps) {
  const { t } = useTranslation()
  const current = chosen(value)
  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold">{t('draughts.lobby.timeControl')}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {parseTimeControls(schema).map((control) => {
          const on = control.id === current
          return (
            <label
              key={control.id}
              className={`flex min-h-12 min-w-20 cursor-pointer items-center justify-center border-2 px-3 text-base font-bold tabular-nums has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${on ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel text-ink'}`}
            >
              <input
                type="radio"
                name="draughts-time-control"
                className="sr-only"
                checked={on}
                onChange={() => onChange({ time_control: control.id })}
                aria-label={t(control.increment_ms > 0 ? 'draughts.lobby.timeWithIncrement' : 'draughts.lobby.timePlain', {
                  minutes: control.base_ms / 60_000,
                  increment: control.increment_ms / 1000,
                })}
              />
              <span aria-hidden="true">{timeControlLabel(control)}</span>
            </label>
          )
        })}
      </div>
      <p className="mt-2 text-sm text-muted">{t('draughts.lobby.timeControlHint')}</p>
    </fieldset>
  )
}

export const draughtsModule: GameModule = {
  id: 'draughts',
  defaultOptions: (schema) => {
    const controls = parseTimeControls(schema)
    const pick = controls.find((c) => c.id === PREFERRED_DEFAULT) ?? controls[0]
    return pick ? { time_control: pick.id } : null
  },
  isValidOptions: (schema, value) => parseTimeControls(schema).some((c) => c.id === chosen(value)),
  // One rating for draughts, whatever the clock (the server says the same).
  ratingPool: () => 'default',
  optionsLabel: (schema, value) => {
    const control = parseTimeControls(schema).find((c) => c.id === chosen(value))
    return control ? (control.increment_ms > 0 ? timeControlLabel(control) : `${timeControlLabel(control)} min`) : ''
  },
  OptionsPicker: TimeControlPicker,
  MatchScreen: lazy(() => import('./DraughtsMatchPage')),
  SettingsSection: lazy(() => import('./DraughtsSettings')),
  practice: [{ to: '/play/draughts/computer', labelKey: 'draughts.computer.link' }],
}
