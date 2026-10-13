import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { env } from '@/core/lib/env'
import { refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'

// "Report a problem": a player tells our team what went wrong. The report is kept on the
// server, the player is emailed at once to say it has arrived and when to expect an answer,
// and the support mailbox is told. Below the form the player sees the reports they have sent
// and whether each has been answered.

const CATEGORIES = ['account', 'game', 'tokens', 'bug', 'other'] as const
type Category = (typeof CATEGORIES)[number]
const SHORTEST = 10
const LONGEST = 2000

type Mine = { id: number; category: string; status: string; created_at: string }
const mineKey = (userId: string | undefined) => ['support', 'mine', userId]

export default function SupportPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()
  const messageId = useId()
  const [category, setCategory] = useState<Category>('bug')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<number | null>(null)
  // The page the player came from, when the link said so: where the trouble was.
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null

  const mine = useQuery({
    queryKey: mineKey(user?.id),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<Mine[]> => {
      const { data, error } = await supabase.from('support_requests').select('id, category, status, created_at').order('id', { ascending: false }).limit(10)
      if (error) throw error
      return data
    },
  })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const text = message.trim()
    if (text.length < SHORTEST) return setProblem(t('support.tooShort', { count: SHORTEST }))
    setProblem(null)
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('submit_support_request', {
        p_category: category,
        p_message: text,
        p_page: cameFrom ?? undefined,
        // What the player is using, to help find the fault: the browser's own description of itself, nothing more.
        p_device: navigator.userAgent.slice(0, 300),
      })
      if (error) return toast.error(t('errors.network'))
      const reply = data as { ok: boolean; code?: string; reference?: number }
      if (!reply.ok) return setProblem(reply.code === 'TOO_MANY_REQUESTS' ? t('support.tooMany') : refusalMessage(reply.code ?? ''))
      setSent(reply.reference ?? 0)
      setMessage('')
      void queryClient.invalidateQueries({ queryKey: mineKey(user?.id) })
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  const contact = env?.VITE_CONTACT_EMAIL
  const day = (iso: string) => new Date(iso).toLocaleDateString(i18n.resolvedLanguage, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="flex flex-col gap-8 lg:max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-extrabold text-primary lg:text-4xl">{t('support.title')}</h1>
        <p className="mt-2 text-muted">{t('support.intro')}</p>
      </div>

      {sent !== null ? (
        <section role="status" className="border-2 border-ink bg-panel p-5" data-testid="support-sent">
          <h2 className="font-display text-2xl font-extrabold text-primary">{t('support.sentTitle')}</h2>
          <p className="mt-2">{t('support.sentBody', { reference: sent })}</p>
          {user?.email && <p className="mt-2 text-muted">{t('support.sentEmail', { email: user.email })}</p>}
          <Button variant="ghost" className="mt-4" onClick={() => setSent(null)}>
            {t('support.another')}
          </Button>
        </section>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" data-testid="support-form">
          <fieldset>
            <legend className="font-display text-xl font-semibold">{t('support.about')}</legend>
            <div className="mt-3 flex flex-col gap-2">
              {CATEGORIES.map((option) => (
                <label
                  key={option}
                  className={`flex min-h-12 cursor-pointer items-center border-2 px-3 py-1 font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary ${option === category ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel text-ink'}`}
                >
                  <input type="radio" name="support-category" className="sr-only" checked={option === category} onChange={() => setCategory(option)} />
                  {t(`support.category.${option}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={messageId} className="font-display text-xl font-semibold">
              {t('support.message')}
            </label>
            <textarea
              id={messageId}
              name="message"
              rows={6}
              maxLength={LONGEST}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value)
                setProblem(null)
              }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${messageId}-hint`}
              className={`mt-2 block w-full rounded-lg border bg-panel p-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 ${problem ? 'border-danger' : 'border-line'}`}
            />
            <p id={`${messageId}-hint`} className={`mt-1 flex justify-between gap-3 text-sm ${problem ? 'text-danger' : 'text-muted'}`}>
              <span>{problem ?? t('support.messageHint')}</span>
              <span className="shrink-0 tabular-nums">
                {message.length} / {LONGEST}
              </span>
            </p>
          </div>

          {user?.email && <p className="text-sm text-muted">{t('support.replyTo', { email: user.email })}</p>}
          <Button type="submit" disabled={busy} className="min-h-12">
            {busy ? t('support.sending') : t('support.send')}
          </Button>
        </form>
      )}

      <section aria-labelledby="support-mine">
        <h2 id="support-mine" className="font-display text-xl font-semibold">
          {t('support.mine')}
        </h2>
        {mine.isLoading ? (
          <div className="mt-3 h-16 animate-pulse rounded-lg bg-line/60" aria-hidden="true" />
        ) : mine.isError ? (
          <p className="mt-2 text-muted">{t('errors.loadFailed')}</p>
        ) : mine.data && mine.data.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2" data-testid="support-list">
            {mine.data.map((request) => (
              <li key={request.id} className="flex items-center justify-between gap-3 border-2 border-line bg-panel px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {t('support.number', { reference: request.id })} · {t(`support.category.${request.category}`, { defaultValue: request.category })}
                  </span>
                  <span className="block text-sm text-muted">{day(request.created_at)}</span>
                </span>
                <span className={`shrink-0 px-2 py-0.5 text-sm font-bold ${request.status === 'open' ? 'bg-brand text-brand-ink' : 'bg-palm text-white'}`}>{t(`support.status.${request.status}`, { defaultValue: request.status })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">{t('support.none')}</p>
        )}
      </section>

      {contact && (
        <p className="text-sm text-muted">
          {t('support.orEmail')}{' '}
          <a href={`mailto:${contact}`} className="font-semibold text-primary underline underline-offset-4">
            {contact}
          </a>
        </p>
      )}
    </div>
  )
}
