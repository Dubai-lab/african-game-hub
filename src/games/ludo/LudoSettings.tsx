import { useTranslation } from 'react-i18next'
import { useLobbyStore } from '@/core/lobby/lobbyStore'
import { type Preferences, useSettingsStore } from '@/core/settings/settingsStore'
import { Toggle } from '@/core/ui/Toggle'
import { BOARD_IDS, BOARDS } from './LudoBoard'

/** Ludo's part of the Settings page: the board, and how the player likes the game played. */
export default function LudoSettings() {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const lobby = useLobbyStore()

  /** A rule of play: saved, and used by the next game searched for from the lobby. */
  function rule(patch: Partial<Pick<Preferences, 'ludoDice' | 'ludoSides' | 'ludoLay'>>) {
    settings.set(patch)
    const current = lobby.optionsByGame.ludo
    if (!current) return
    lobby.chooseOptions('ludo', {
      ...current,
      ...(patch.ludoDice ? { dice: patch.ludoDice } : {}),
      ...(patch.ludoSides && current.players === 2 ? { sides: patch.ludoSides } : {}),
      ...(patch.ludoLay !== undefined ? { lay: patch.ludoLay } : {}),
    })
  }
  const pick = (chosen: boolean) => `min-h-12 border-2 px-3 font-bold ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-surface'}`

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="font-semibold">{t('ludo.settings.board')}</legend>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
          {BOARD_IDS.map((id) => {
            const board = BOARDS[id]
            return (
              <button key={id} type="button" role="radio" aria-checked={settings.ludoBoard === id} onClick={() => settings.set({ ludoBoard: id })} className={`flex flex-col items-center gap-1 border-2 p-2 ${settings.ludoBoard === id ? 'border-ink bg-brand' : 'border-line bg-surface'}`}>
                {/* A thumbnail of the board: its frame, surface and four houses. */}
                <span className="grid size-14 grid-cols-2 gap-1 p-1.5" style={{ background: board.frame[0] }} aria-hidden="true">
                  {(['red', 'green', 'blue', 'yellow'] as const).map((seat) => (
                    <span key={seat} style={{ background: board.seat[seat].base, outline: `2px solid ${board.surface[0]}` }} />
                  ))}
                </span>
                <span className="text-sm font-bold">{t(`ludo.board.${id}`)}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <Toggle label={t('ludo.settings.board3d')} hint={t('ludo.settings.board3dHint')} on={settings.ludoBoard3d} onChange={(ludoBoard3d) => settings.set({ ludoBoard3d })} />

      <fieldset>
        <legend className="font-semibold">{t('ludo.settings.dice')}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
          {([2, 1] as const).map((count) => (
            <button key={count} type="button" role="radio" aria-checked={settings.ludoDice === count} onClick={() => rule({ ludoDice: count })} className={pick(settings.ludoDice === count)}>
              {t('ludo.diceCount', { count })}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-semibold">{t('ludo.settings.sides')}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
          {([2, 1] as const).map((count) => (
            <button key={count} type="button" role="radio" aria-checked={settings.ludoSides === count} onClick={() => rule({ ludoSides: count })} className={pick(settings.ludoSides === count)}>
              {t(`ludo.sides.${count}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">{t('ludo.settings.sidesHint')}</p>
      </fieldset>

      <Toggle label={t('ludo.settings.lay')} hint={t('ludo.settings.layHint')} on={settings.ludoLay} onChange={(ludoLay) => rule({ ludoLay })} />
      <p className="text-sm text-muted">{t('ludo.settings.rulesHint')}</p>
    </div>
  )
}
