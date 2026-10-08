import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { Button } from '@/core/ui/Button'
import { Toggle } from '@/core/ui/Toggle'
import { feedback } from '../sound/sounds'
import AppearanceSettings from './AppearanceSettings'
import { Sheet } from './panels'

type Props = {
  onClose: () => void
  /** Pass-and-play only: turn the board to face whoever is to move. */
  autoFlip?: { on: boolean; onChange: (on: boolean) => void }
}

/** Quick settings without leaving the game. The same choices are on the Settings page. */
export function SettingsSheet({ onClose, autoFlip }: Props) {
  const { t } = useTranslation()
  const settings = useSettingsStore()

  return (
    <Sheet title={t('chess.settings.title')} onClose={onClose}>
      <div className="mt-4">
        <AppearanceSettings />
      </div>

      <div className="mt-4 divide-y divide-line border-y border-line">
        <Toggle
          label={t('chess.settings.sound')}
          on={settings.soundOn}
          onChange={(soundOn) => {
            settings.set({ soundOn })
            if (soundOn) feedback('move')
          }}
        />
        <Toggle label={t('chess.settings.haptics')} on={settings.hapticsOn} onChange={(hapticsOn) => settings.set({ hapticsOn })} />
        {autoFlip && <Toggle label={t('chess.settings.autoFlip')} on={autoFlip.on} onChange={autoFlip.onChange} />}
      </div>

      <Button className="mt-5 w-full" onClick={onClose}>
        {t('chess.settings.done')}
      </Button>
    </Sheet>
  )
}
