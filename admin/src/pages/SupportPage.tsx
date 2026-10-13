import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ApiError, api, useApi } from '../lib/api'
import type { Page, SupportRequest } from '../lib/types'
import { Badge, Button, Card, Failure, inputClass, Loading, PageTitle, Pager, Tabs, When, words } from '../ui'

const LIMIT = 20
type Filter = 'open' | 'answered' | 'closed'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Waiting' },
  { value: 'answered', label: 'Answered' },
  { value: 'closed', label: 'Closed' },
]
const ABOUT: Record<string, string> = {
  account: 'Their account',
  game: 'A game',
  tokens: 'Tokens',
  bug: 'Something not working',
  other: 'Something else',
}

/** The answer to one request: written here, emailed to the player, kept with the request. */
function Answer({ request, done }: { request: SupportRequest; done: () => Promise<void> }) {
  const id = useId()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(status: 'answered' | 'closed') {
    if (status === 'closed' && !window.confirm('Close this request without an answer? Nothing is sent to the player.')) return
    setBusy(true)
    setError(null)
    try {
      await api('support.answer', { requestId: request.id, status, ...(reply.trim() ? { reply: reply.trim() } : {}) })
      await done()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Nothing was sent.')
      setBusy(false)
    }
  }

  return (
    <form
      className="border-t border-line px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        void send('answered')
      }}
    >
      <label htmlFor={`${id}-reply`} className="block text-sm font-semibold">
        Your answer (emailed to {request.email ?? 'the player'}, in plain words)
      </label>
      <textarea id={`${id}-reply`} value={reply} onChange={(e) => setReply(e.target.value)} required minLength={10} maxLength={1000} rows={4} className={`${inputClass} mt-1 py-2`} />
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => void send('closed')} disabled={busy}>
          Close without answering
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Working…' : 'Send the answer'}
        </Button>
      </div>
    </form>
  )
}

export default function SupportPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const filter = (search.get('status') ?? 'open') as Filter
  const offset = Number(search.get('from') ?? 0) || 0
  const requests = useApi<Page<SupportRequest>>('support.list', { status: filter, limit: LIMIT, offset }, { refetchInterval: 60_000 })

  return (
    <>
      <PageTitle aside={<Tabs value={filter} options={FILTERS} onChange={(status) => setSearch({ status })} />}>Problems reported by players</PageTitle>
      {requests.isPending ? (
        <Loading />
      ) : requests.isError ? (
        <Failure error={requests.error} retry={() => void requests.refetch()} />
      ) : requests.data.rows.length === 0 ? (
        <p className="rounded border border-line bg-panel px-4 py-8 text-center text-sm text-muted">{filter === 'open' ? 'No requests are waiting.' : 'Nothing here.'}</p>
      ) : (
        <div className="grid gap-4">
          {requests.data.rows.map((r) => (
            <Card key={r.id}>
              <div className="px-4 py-3 text-sm">
                <p className="text-base font-bold">
                  Number {r.id} ·{' '}
                  <Link to={`/players/${r.user_id}`} className="text-indigo underline">
                    {r.username ?? 'a player'}
                  </Link>{' '}
                  <Badge tone="warn">{ABOUT[r.category] ?? words(r.category)}</Badge>
                </p>
                <p className="mt-1 text-muted">
                  <When at={r.created_at} />
                  {r.email && <> · {r.email}</>}
                  {r.page && <> · on {r.page}</>}
                </p>
                <p className="mt-2 max-w-prose whitespace-pre-wrap break-words">{r.message}</p>
                {r.device && <p className="mt-2 break-words text-xs text-muted">{r.device}</p>}
              </div>
              {r.status === 'open' ? (
                <Answer request={r} done={() => queryClient.invalidateQueries()} />
              ) : (
                <div className="border-t border-line px-4 py-3 text-sm">
                  <p className="text-xs text-muted">
                    {r.status === 'answered' ? 'Answered' : 'Closed without an answer'} by {r.answered_by ?? '—'} · <When at={r.answered_at} />
                  </p>
                  {r.admin_note && <p className="mt-1 max-w-prose whitespace-pre-wrap break-words">{r.admin_note}</p>}
                </div>
              )}
            </Card>
          ))}
          <div className="rounded border border-line bg-panel">
            <Pager total={requests.data.total} limit={LIMIT} offset={offset} onOffset={(from) => setSearch({ status: filter, from: String(from) })} />
          </div>
        </div>
      )}
    </>
  )
}
