import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { Button } from '@/core/ui/Button'
import { LanguageSwitcher } from '@/core/ui/LanguageSwitcher'
import { Toggle } from '@/core/ui/Toggle'
import { useMatchChatSetting } from '@/core/social/social'
import { useSettingsStore } from './settingsStore'

const sectionTitle = 'font-display text-xl font-semibold'

export default function SettingsPage() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const settings = useSettingsStore()
  const matchChat = useMatchChatSetting()

  return (
    <div className="flex flex-col gap-8 lg:max-w-2xl">
      <h1 className="font-display text-3xl font-extrabold text-primary lg:text-4xl">{t('settings.title')}</h1>

      <section aria-labelledby="settings-general">
        <h2 id="settings-general" className={sectionTitle}>
          {t('settings.general')}
        </h2>
        <div className="mt-2 divide-y divide-line border-y border-line">
          <div className="flex min-h-12 items-center justify-between gap-4 py-2">
            <span className="font-semibold">{t('common.language')}</span>
            <LanguageSwitcher />
          </div>
          <Toggle label={t('chess.settings.sound')} on={settings.soundOn} onChange={(soundOn) => settings.set({ soundOn })} />
          <Toggle label={t('chess.settings.haptics')} on={settings.hapticsOn} onChange={(hapticsOn) => settings.set({ hapticsOn })} />
          <Toggle
            label={t('settings.matchChat')}
            hint={t('settings.matchChatHint')}
            on={matchChat.enabled}
            onChange={(on) => void matchChat.set(on)}
          />
          <Toggle
            label={t('settings.dataSaver')}
            hint={t('settings.dataSaverHint')}
            on={settings.dataSaver}
            onChange={(dataSaver) => settings.set({ dataSaver })}
          />
        </div>
      </section>

      <section aria-labelledby="settings-account">
        <h2 id="settings-account" className={sectionTitle}>
          {t('settings.account')}
        </h2>
        {user?.email && <p className="mt-2 break-all text-muted">{user.email}</p>}
        <Button variant="ghost" className="mt-3 w-full bg-panel" onClick={() => void signOut()}>
          {t('common.logout')}
        </Button>
      </section>

      <nav aria-label={t('settings.about')} className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-primary">
        <Link to="/terms" className="underline underline-offset-4">
          {t('landing.footer.terms')}
        </Link>
        <Link to="/privacy" className="underline underline-offset-4">
          {t('landing.footer.privacy')}
        </Link>
        <Link to="/responsible-gaming" className="underline underline-offset-4">
          {t('landing.footer.responsibleLink')}
        </Link>
      </nav>
    </div>
  )
}
