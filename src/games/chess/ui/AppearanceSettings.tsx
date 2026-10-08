import { useTranslation } from 'react-i18next'
import { type PieceSetId, useSettingsStore } from '@/core/settings/settingsStore'
import { Toggle } from '@/core/ui/Toggle'
import { PIECE_SET_IDS, usePieceSet } from '../pieces/usePieceSet'
import { BOARD_THEME_IDS, BOARD_THEMES } from './themes'

function PieceSetOption({ id, chosen, onChoose }: { id: PieceSetId; chosen: boolean; onChoose: () => void }) {
  const { t } = useTranslation()
  const set = usePieceSet(id)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onChoose}
      className={`flex min-h-16 flex-1 items-center justify-center gap-1 border-2 px-2 ${chosen ? 'border-ink bg-brand' : 'border-line bg-surface'}`}
    >
      {set ? (
        <>
          <img src={set.urls.wN} alt="" className="size-11" />
          <img src={set.urls.bQ} alt="" className="size-11" />
        </>
      ) : (
        <span className="size-11 animate-pulse bg-line" aria-hidden="true" />
      )}
      <span className="sr-only">{t(`chess.settings.pieceSet.${id}`)}</span>
    </button>
  )
}

/** Board colours and piece set. Used in the in-game settings sheet and on the Settings page. */
export default function AppearanceSettings() {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const group = 'text-sm font-semibold text-muted'

  return (
    <div>
      <p className={group} id="settings-board">
        {t('chess.settings.board')}
      </p>
      <div role="radiogroup" aria-labelledby="settings-board" className="mt-2 flex gap-2">
        {BOARD_THEME_IDS.map((id) => {
          const theme = BOARD_THEMES[id]
          const chosen = settings.chessBoardTheme === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={t(`chess.settings.theme.${id}`)}
              onClick={() => settings.set({ chessBoardTheme: id })}
              className={`aspect-square max-h-24 flex-1 border-4 ${chosen ? 'border-brand outline-2 outline-ink' : 'border-transparent'}`}
              style={{ background: `repeating-conic-gradient(${theme.light} 0 25%, ${theme.dark} 0 50%) 0 0 / 100% 100%` }}
            />
          )
        })}
      </div>

      <p className={`${group} mt-4`} id="settings-pieces">
        {t('chess.settings.pieces')}
      </p>
      <div role="radiogroup" aria-labelledby="settings-pieces" className="mt-2 flex gap-2">
        {PIECE_SET_IDS.map((id) => (
          <PieceSetOption key={id} id={id} chosen={settings.chessPieceSet === id} onChoose={() => settings.set({ chessPieceSet: id })} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{t('chess.settings.credits')}</p>

      <div className="mt-4 border-y border-line">
        <Toggle
          label={t('chess.settings.premoves')}
          hint={t('chess.settings.premovesHint')}
          on={settings.chessPremoves}
          onChange={(chessPremoves) => settings.set({ chessPremoves })}
        />
      </div>
    </div>
  )
}
