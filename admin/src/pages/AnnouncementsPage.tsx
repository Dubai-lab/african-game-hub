import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api, useApi } from '../lib/api'
import type { Announcements } from '../lib/types'
import { Badge, Button, Card, Failure, inputClass, Loading, PageTitle, When } from '../ui'

/** Writes to every player: a notification in the app, and an email as well when asked. */
function Write({ done }: { done: () => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [email, setEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ players: number; emails: number } | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const how = email ? 'in the app AND by email' : 'in the app'
    if (!window.confirm(`Send “${title.trim()}” to every player, ${how}? It cannot be taken back.`)) return
    setBusy(true)
    setError(null)
    setSent(null)
    try {
      setSent(await api<{ players: number; emails: number }>('announcements.send', { title: title.trim(), body: body.trim(), email }))
      setTitle('')
      setBody('')
      setEmail(false)
      await done()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Nothing was sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Write to every player">
      <form onSubmit={submit} className="grid gap-3 px-4 py-3 text-sm">
        <p className="text-muted">
          Players read it as it is written here, in one language: write it in English and French if it matters to everyone. Plain words; never promise winnings.
        </p>
        <label className="grid gap-1 font-semibold">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={80} className={inputClass} />
        </label>
        <label className="grid gap-1 font-semibold">
          Message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} required minLength={10} maxLength={2000} rows={6} className={`${inputClass} py-2`} />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="mt-0.5 size-4" />
          <span>
            <span className="font-semibold">Also send it by email</span>
            <span className="block text-muted">To every player with a confirmed address who has not switched news emails off. The emails leave a few each minute, so a large number takes time.</span>
          </span>
        </label>
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
        {sent && (
          <p role="status" className="font-semibold text-ok">
            Sent to {sent.players} players in the app{sent.emails > 0 ? `, and ${sent.emails} emails are on their way` : ''}.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Working…' : 'Send to every player'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

export default function AnnouncementsPage() {
  const queryClient = useQueryClient()
  const list = useApi<Announcements>('announcements.list', { limit: 25 }, { refetchInterval: 60_000 })

  return (
    <>
      <PageTitle>Announcements</PageTitle>
      <div className="grid gap-4">
        <Write done={() => queryClient.invalidateQueries()} />
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <Failure error={list.error} retry={() => void list.refetch()} />
        ) : (
          <>
            {list.data.waiting_emails > 0 && (
              <p className="rounded border border-line bg-panel px-4 py-3 text-sm">
                {list.data.waiting_emails} announcement emails are still waiting to leave, at {list.data.per_minute} a minute.
              </p>
            )}
            {list.data.rows.length === 0 ? (
              <p className="rounded border border-line bg-panel px-4 py-8 text-center text-sm text-muted">Nothing has been announced yet.</p>
            ) : (
              list.data.rows.map((a) => (
                <Card key={a.id}>
                  <div className="px-4 py-3 text-sm">
                    <p className="text-base font-bold">
                      {a.title} {a.emailed && <Badge tone="warn">also by email</Badge>}
                    </p>
                    <p className="mt-1 text-muted">
                      <When at={a.created_at} /> · by {a.created_by ?? '—'} · {a.recipients} players{a.emailed ? ` · ${a.emails} emails` : ''}
                    </p>
                    <p className="mt-2 max-w-prose whitespace-pre-wrap break-words">{a.body}</p>
                  </div>
                </Card>
              ))
            )}
          </>
        )}
      </div>
    </>
  )
}
