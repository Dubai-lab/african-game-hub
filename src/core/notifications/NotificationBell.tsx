import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'

// The bell: what has happened that the player should know of. A friend request, a challenge,
// a tournament starting, an answer from our team, a message from the hub. The server writes
// them; the app shows them, each in the player's language, and marks them read once seen.

type Notification = { id: number; kind: string; data: Record<string, unknown>; created_at: string; read_at: string | null }
const key = (userId: string | undefined) => ['notifications', userId]
let channelSeq = 0

function useNotifications() {
  const { user } = useAuth()
  const userId = user?.id
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: key(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase.from('notifications').select('id, kind, data, created_at, read_at').order('id', { ascending: false }).limit(30)
      if (error) throw error
      return data as Notification[]
    },
  })
  // A new one arrives by itself; on every (re)connect the list is fetched again, so none is missed.
  useEffect(() => {
    if (!userId) return
    const refresh = () => void queryClient.invalidateQueries({ queryKey: key(userId) })
    const channel = supabase
      .channel(`notifications:${userId}:${++channelSeq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refresh)
      .subscribe((state) => state === 'SUBSCRIBED' && refresh())
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, queryClient])

  const markRead = async () => {
    const newest = list.data?.[0]?.id
    if (!newest || !list.data?.some((n) => n.read_at === null)) return
    try {
      await supabase.rpc('mark_notifications_read', { p_up_to: newest })
      void queryClient.invalidateQueries({ queryKey: key(userId) })
    } catch {
      // Still unread next time: nothing is lost.
    }
  }
  return { list: list.data ?? [], unread: (list.data ?? []).filter((n) => n.read_at === null).length, markRead }
}

/** Where a tap on a notification leads, when it leads anywhere. */
function linkOf(n: Notification): string | null {
  if (n.kind === 'friend_request' || n.kind === 'friend_accepted') return '/friends'
  if (n.kind === 'challenge' && typeof n.data.challenge_id === 'string') return `/challenge/${n.data.challenge_id}`
  if (n.kind === 'tournament_started' && typeof n.data.tournament_id === 'string') return `/tournaments/${n.data.tournament_id}`
  if (n.kind === 'support_answered') return '/support'
  return null
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 7h-17S6 15 6 9z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function NotificationBell({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const { list, unread, markRead } = useNotifications()
  const [open, setOpen] = useState(false)

  const when = (iso: string) => new Date(iso).toLocaleString(i18n.resolvedLanguage, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const words = (n: Notification) => {
    if (n.kind === 'announcement') return String(n.data.title ?? '')
    const game = typeof n.data.game === 'string' ? t(`games.${n.data.game}`, { defaultValue: '' }) : ''
    return t(`notifications.kind.${n.kind}`, { username: n.data.username ?? '', name: n.data.name ?? '', game, reference: n.data.reference ?? '', defaultValue: t('notifications.kind.other') })
  }
  const close = () => {
    setOpen(false)
    // Seen: they are read.
    void markRead()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? t('notifications.openUnread', { count: unread }) : t('notifications.open')}
        className={`relative flex size-11 shrink-0 items-center justify-center ${className}`}
        data-testid="notification-bell"
        data-unread={unread}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute end-0.5 top-0.5 flex min-w-5 justify-center rounded-full bg-hibiscus px-1 text-xs font-bold leading-5 text-white" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" onClick={close} role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('notifications.title')}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-md flex-col border-t-4 border-brand bg-panel text-ink sm:border-4"
            data-testid="notification-panel"
          >
            <h2 className="px-5 pt-5 font-display text-2xl font-extrabold text-primary">{t('notifications.title')}</h2>
            {list.length === 0 ? (
              <p className="px-5 py-6 text-muted">{t('notifications.none')}</p>
            ) : (
              <ul className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-line">
                {list.map((n) => {
                  const to = linkOf(n)
                  const body = (
                    <>
                      <span className={`block ${n.read_at === null ? 'font-bold' : ''}`}>{words(n)}</span>
                      {n.kind === 'announcement' && typeof n.data.body === 'string' && <span className="mt-1 block whitespace-pre-wrap text-sm">{n.data.body}</span>}
                      <span className="mt-0.5 block text-xs text-muted">{when(n.created_at)}</span>
                    </>
                  )
                  return (
                    <li key={n.id} className={`border-b border-line ${n.read_at === null ? 'bg-primary-tint/40' : ''}`} data-kind={n.kind}>
                      {to ? (
                        <Link to={to} onClick={close} className="block px-5 py-3">
                          {body}
                        </Link>
                      ) : (
                        <div className="px-5 py-3">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="px-5 pb-[max(1.25rem,var(--safe-bottom))] pt-4">
              <Button className="w-full" onClick={close}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
