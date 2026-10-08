import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameModule, LobbyOptionsProps } from '@/games/types'
import { type Pace, paceOf, parseTimeControls, timeControlLabel } from './timeControls'

const PACES: Pace[] = ['bullet', 'blitz', 'rapid']
// Blitz is where most players start; fall back to whatever is first.
const PREFERRED_DEFAULT = '5+0'

function selectedId(value: LobbyOptionsProps['value']): string | null {
  return typeof value?.time_control === 'string' ? value.time_control : null
}

function TimeControlPicker({ schema, value, onChange }: LobbyOptionsProps) {
  const { t } = useTranslation()
  const controls = parseTimeControls(schema)
  const current = selectedId(value)

  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold">{t('chess.lobby.timeControl')}</legend>
      <div className="mt-3 flex flex-col gap-3">
        {PACES.map((pace) => {
          const group = controls.filter((c) => paceOf(c) === pace)
          if (group.length === 0) return null
          return (
            <div key={pace} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-sm font-semibold text-muted">{t(`chess.lobby.pace.${pace}`)}</span>
              <div className="flex flex-wrap gap-2">
                {group.map((control) => {
                  const chosen = control.id === current
                  return (
                    <label
                      key={control.id}
                      className={`flex min-h-12 min-w-16 cursor-pointer items-center justify-center border-2 px-3 text-base font-bold tabular-nums has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel text-ink'}`}
                    >
                      <input
                        type="radio"
                        name="chess-time-control"
                        className="sr-only"
                        checked={chosen}
                        onChange={() => onChange({ time_control: control.id })}
                        aria-label={t(control.increment_ms > 0 ? 'chess.lobby.timeWithIncrement' : 'chess.lobby.timePlain', {
                          minutes: control.base_ms / 60_000,
                          increment: control.increment_ms / 1000,
                        })}
                      />
                      <span aria-hidden="true">{timeControlLabel(control)}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-sm text-muted">{t('chess.lobby.timeControlHint')}</p>
    </fieldset>
  )
}

export const chessModule: GameModule = {
  id: 'chess',
  defaultOptions: (schema) => {
    const controls = parseTimeControls(schema)
    const pick = controls.find((c) => c.id === PREFERRED_DEFAULT) ?? controls[0]
    return pick ? { time_control: pick.id } : null
  },
  isValidOptions: (schema, value) => {
    const id = selectedId(value)
    return id !== null && parseTimeControls(schema).some((c) => c.id === id)
  },
  ratingPool: (schema, value) => {
    const control = parseTimeControls(schema).find((c) => c.id === selectedId(value))
    return control ? paceOf(control) : 'blitz'
  },
  OptionsPicker: TimeControlPicker,
  MatchScreen: lazy(() => import('./online/OnlineGamePage')),
  SettingsSection: lazy(() => import('./ui/AppearanceSettings')),
  practice: [
    { to: '/play/chess/computer', labelKey: 'lobby.playComputer' },
    { to: '/play/chess/local', labelKey: 'lobby.playLocal' },
  ],
}
