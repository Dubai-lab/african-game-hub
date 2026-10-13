import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import { Toggle } from '@/core/ui/Toggle'
import { disablePush, enablePush, type PushState, pushState } from './push'

// The player's two choices about hearing from the hub: notifications on this phone, and the
// hub's news by email. (Emails about their own account, such as a password change or an answer
// to a report, are always sent.)

function useNewsEmails() {
  const { user } = useAuth()
  const me = user?.id
  const queryClient = useQueryClient()
  const key = ['news-emails', me]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(me),
    staleTime: 60_000,
    meta: { silent: true },
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_private').select('news_emails').eq('user_id', me!).single()
      if (error) throw error
      return data.news_emails
    },
  })
  const { t } = useTranslation()
  // The switch answers the tap at once, and keeps to what was tapped whatever an answer still
  // on its way from the server says; the account catches up a moment later.
  const [choice, setChoice] = useState<boolean | null>(null)
  async function set(on: boolean) {
    setChoice(on)
    try {
      await queryClient.cancelQueries({ queryKey: key })
      const { error } = await supabase.rpc('set_news_emails', { p_on: on })
      if (error) throw error
      queryClient.setQueryData(key, on)
    } catch {
      setChoice(null)
      toast.error(t('errors.network'))
    }
  }
  return { on: choice ?? query.data ?? true, ready: query.data !== undefined, set }
}

export function NotificationSettings() {
  const { t } = useTranslation()
  const news = useNewsEmails()
  const [phone, setPhone] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void pushState().then((state) => live && setPhone(state))
    return () => {
      live = false
    }
  }, [])

  async function setPush(on: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const state = on ? await enablePush() : await disablePush()
      setPhone(state)
      if (on && state === 'blocked') toast.error(t('notifications.settings.blocked'))
    } catch {
      toast.error(t('errors.network'))
      setPhone(await pushState())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="settings-notifications" data-testid="notification-settings">
      <h2 id="settings-notifications" className="font-display text-xl font-semibold">
        {t('notifications.title')}
      </h2>
      <div className="mt-2 divide-y divide-line border-y border-line">
        {(phone === 'on' || phone === 'off') && (
          <Toggle label={t('notifications.settings.phone')} hint={t('notifications.settings.phoneHint')} on={phone === 'on'} onChange={(on) => void setPush(on)} />
        )}
        {phone === 'blocked' && <p className="py-3 text-sm text-muted">{t('notifications.settings.blocked')}</p>}
        {phone === 'unsupported' && <p className="py-3 text-sm text-muted">{t('notifications.settings.unsupported')}</p>}
        {news.ready && <Toggle label={t('notifications.settings.news')} hint={t('notifications.settings.newsHint')} on={news.on} onChange={(on) => void news.set(on)} />}
      </div>
    </section>
  )
}
