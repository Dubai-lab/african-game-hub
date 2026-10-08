import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/core/settings/settingsStore'
import { CLOTH_IDS, CLOTHS } from './PoolCanvas'

/** Pool's part of the Settings page: the cloth, and how much of the aiming line is shown. */
export default function PoolSettings() {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const pick = (chosen: boolean) => `min-h-12 border-2 px-3 font-bold ${chosen ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-surface'}`

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="font-semibold">{t('pool.settings.cloth')}</legend>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
          {CLOTH_IDS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={settings.poolCloth === id} onClick={() => settings.set({ poolCloth: id })} className={`flex flex-col items-center gap-1 border-2 p-2 ${settings.poolCloth === id ? 'border-ink bg-brand' : 'border-line bg-surface'}`}>
              {/* A thumbnail of the table: wooden frame, cloth, a ball. */}
              <span className="flex h-10 w-16 items-center justify-center rounded-sm border-4 border-[#7a4520]" style={{ background: `radial-gradient(${CLOTHS[id].cloth[0]}, ${CLOTHS[id].cloth[2]})` }} aria-hidden="true">
                <span className="size-2.5 rounded-full bg-[#f7f5ec]" />
              </span>
              <span className="text-sm font-bold">{t(`pool.cloth.${id}`)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-semibold">{t('pool.settings.guide')}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
          {(['full', 'short'] as const).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={settings.poolGuide === id} onClick={() => settings.set({ poolGuide: id })} className={pick(settings.poolGuide === id)}>
              {t(`pool.guide.${id}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">{t('pool.settings.guideHint')}</p>
      </fieldset>
    </div>
  )
}
