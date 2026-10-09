import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Toggle } from '@/core/ui/Toggle'
import { DRAUGHTS_BOARD_IDS, DRAUGHTS_BOARDS, DRAUGHTS_PIECES, DRAUGHTS_PIECES_IDS } from './themes'

/** Draughts' own settings: the board, the pieces, and the helps on the board. */
export default function DraughtsSettings() {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const group = 'text-sm font-semibold text-muted'

  return (
    <div>
      <p className={group} id="draughts-settings-board">
        {t('draughts.settings.board')}
      </p>
      <div role="radiogroup" aria-labelledby="draughts-settings-board" className="mt-2 flex gap-2">
        {DRAUGHTS_BOARD_IDS.map((id) => {
          const theme = DRAUGHTS_BOARDS[id]
          const chosen = settings.draughtsBoard === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={t(`draughts.settings.theme.${id}`)}
              onClick={() => settings.set({ draughtsBoard: id })}
              className={`aspect-square max-h-24 flex-1 border-4 ${chosen ? 'border-brand outline-2 outline-ink' : 'border-transparent'}`}
              style={{ background: `repeating-conic-gradient(${theme.light} 0 25%, ${theme.dark} 0 50%) 0 0 / 100% 100%` }}
            />
          )
        })}
      </div>

      <p className={`${group} mt-4`} id="draughts-settings-pieces">
        {t('draughts.settings.pieces')}
      </p>
      <div role="radiogroup" aria-labelledby="draughts-settings-pieces" className="mt-2 flex gap-2">
        {DRAUGHTS_PIECES_IDS.map((id) => {
          const chosen = settings.draughtsPieces === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={t(`draughts.settings.pieceSet.${id}`)}
              onClick={() => settings.set({ draughtsPieces: id })}
              className={`flex min-h-16 flex-1 items-center justify-center gap-2 border-2 px-2 ${chosen ? 'border-ink bg-brand' : 'border-line bg-surface'}`}
            >
              {(['w', 'b'] as const).map((side) => (
                <span key={side} className="size-10 rounded-full border-4" style={{ background: DRAUGHTS_PIECES[id][side].top, borderColor: DRAUGHTS_PIECES[id][side].edge }} aria-hidden="true" />
              ))}
            </button>
          )
        })}
      </div>

      <div className="mt-4 divide-y divide-line border-y border-line">
        <Toggle label={t('draughts.settings.hints')} hint={t('draughts.settings.hintsHint')} on={settings.draughtsHints} onChange={(draughtsHints) => settings.set({ draughtsHints })} />
        <Toggle label={t('draughts.settings.numbers')} hint={t('draughts.settings.numbersHint')} on={settings.draughtsNumbers} onChange={(draughtsNumbers) => settings.set({ draughtsNumbers })} />
      </div>
    </div>
  )
}
