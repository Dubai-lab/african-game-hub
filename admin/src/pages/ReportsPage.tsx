import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, useApi } from '../lib/api'
import type { Page, Report } from '../lib/types'
import { ActionDialog, Badge, Button, Card, Failure, Loading, PageTitle, Pager, Tabs, When, words } from '../ui'

const LIMIT = 20
type Filter = 'open' | 'resolved' | 'dismissed'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Waiting' },
  { value: 'resolved', label: 'Acted on' },
  { value: 'dismissed', label: 'Dismissed' },
]
const REASONS: Record<string, string> = {
  abuse: 'Abusive messages',
  cheating: 'Cheating',
  multiple_accounts: 'Several accounts',
  other: 'Something else',
}

export default function ReportsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const filter = (search.get('status') ?? 'open') as Filter
  const offset = Number(search.get('from') ?? 0) || 0
  const reports = useApi<Page<Report>>('reports.list', { status: filter, limit: LIMIT, offset }, { refetchInterval: 60_000 })
  const [closing, setClosing] = useState<{ report: Report; as: 'resolved' | 'dismissed' } | null>(null)

  return (
    <>
      <PageTitle aside={<Tabs value={filter} options={FILTERS} onChange={(status) => setSearch({ status })} />}>Reports from players</PageTitle>
      {reports.isPending ? (
        <Loading />
      ) : reports.isError ? (
        <Failure error={reports.error} retry={() => void reports.refetch()} />
      ) : reports.data.rows.length === 0 ? (
        <p className="rounded border border-line bg-panel px-4 py-8 text-center text-sm text-muted">
          {filter === 'open' ? 'No reports are waiting.' : 'Nothing here.'}
        </p>
      ) : (
        <div className="grid gap-4">
          {reports.data.rows.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="text-sm">
                  <p className="text-base font-bold">
                    <Link to={`/players/${r.reported_id}`} className="text-indigo underline">
                      {r.reported}
                    </Link>{' '}
                    <Badge tone="danger">{REASONS[r.reason] ?? words(r.reason)}</Badge>{' '}
                    {r.reports_against_player > 1 && <Badge tone="warn">{r.reports_against_player} reports in total</Badge>}
                  </p>
                  <p className="mt-1 text-muted">
                    Reported by{' '}
                    <Link to={`/players/${r.reporter_id}`} className="text-indigo underline">
                      {r.reporter}
                    </Link>{' '}
                    · <When at={r.created_at} />
                    {r.match_id && (
                      <>
                        {' · '}
                        <Link to={`/matches/${r.match_id}`} className="text-indigo underline">
                          the match
                        </Link>
                      </>
                    )}
                  </p>
                  {r.note && <p className="mt-2 max-w-prose whitespace-pre-wrap">“{r.note}”</p>}
                </div>
                {r.status === 'open' ? (
                  <div className="flex gap-2">
                    <Button onClick={() => setClosing({ report: r, as: 'dismissed' })}>Dismiss</Button>
                    <Button variant="primary" onClick={() => setClosing({ report: r, as: 'resolved' })}>
                      Mark acted on
                    </Button>
                  </div>
                ) : (
                  <p className="text-right text-xs text-muted">
                    {r.status === 'resolved' ? 'Acted on' : 'Dismissed'} by {r.resolved_by ?? '—'}
                    <br />
                    <When at={r.resolved_at} />
                    {r.resolution_note && (
                      <>
                        <br />
                        <span className="text-ink">{r.resolution_note}</span>
                      </>
                    )}
                  </p>
                )}
              </div>

              <div className="border-t border-line px-4 py-3">
                <p className="mb-2 text-xs font-semibold text-muted">
                  {r.match_id ? 'What was said in that match' : 'The private conversation between the two'} (copied when the report was made)
                </p>
                {r.context.length === 0 ? (
                  <p className="text-sm text-muted">Nothing was said.</p>
                ) : (
                  <ol className="grid max-h-72 gap-1 overflow-y-auto text-sm" aria-label="Messages">
                    {r.context.map((line, i) => {
                      const byReported = line.from === r.reported_id
                      return (
                        <li key={i} className={`rounded px-2 py-1 ${byReported ? 'bg-danger/10' : 'bg-ground'}`}>
                          <span className="font-semibold">{byReported ? r.reported : line.from === r.reporter_id ? r.reporter : 'another player'}:</span>{' '}
                          <span className="whitespace-pre-wrap break-words">{line.body}</span>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
            </Card>
          ))}
          <div className="rounded border border-line bg-panel">
            <Pager total={reports.data.total} limit={LIMIT} offset={offset} onOffset={(from) => setSearch({ status: filter, from: String(from) })} />
          </div>
        </div>
      )}

      {closing && (
        <ActionDialog
          title={closing.as === 'resolved' ? `Mark the report on ${closing.report.reported} as acted on?` : `Dismiss the report on ${closing.report.reported}?`}
          explain={
            closing.as === 'resolved'
              ? 'Use this after you have done something about it (a ban, a warning, a refund). Closing the report does not itself change the player’s account.'
              : 'Use this when the report does not need action. The report stays on record.'
          }
          confirmLabel={closing.as === 'resolved' ? 'Mark acted on' : 'Dismiss report'}
          reasonLabel="What you did or decided (kept with the report)"
          reasonRequired={closing.as === 'resolved'}
          onClose={() => setClosing(null)}
          onConfirm={async (note) => {
            await api('reports.resolve', { reportId: closing.report.id, status: closing.as, ...(note ? { note } : {}) })
            await queryClient.invalidateQueries()
          }}
        />
      )}
    </>
  )
}
