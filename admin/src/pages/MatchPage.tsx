import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, useApi } from '../lib/api'
import type { Match } from '../lib/types'
import { ActionDialog, Button, Card, Failure, Loading, PageTitle, signed, Stat, Table, tokens, When, words } from '../ui'
import { MatchStatus } from './MatchesPage'

export default function MatchPage() {
  const { matchId } = useParams()
  const queryClient = useQueryClient()
  const match = useApi<Match | null>('matches.get', { matchId })
  const [aborting, setAborting] = useState(false)

  if (match.isPending) return <Loading />
  if (match.isError) return <Failure error={match.error} retry={() => void match.refetch()} />
  const m = match.data
  if (!m) return <p className="text-sm">No such match.</p>
  const pot = m.escrow.reduce((sum, e) => sum + e.amount, 0)

  return (
    <>
      <PageTitle
        aside={
          m.status === 'active' && (
            <Button variant="danger" onClick={() => setAborting(true)}>
              Call match off
            </Button>
          )
        }
      >
        {m.game_type} match <MatchStatus match={m} />
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stake each" value={tokens(m.stake_amount)} note={`Pot ${tokens(pot)}`} />
        <Stat label="Winner" value={m.winner ?? '—'} note={words(m.end_reason)} />
        <Stat label="Commission" value={m.rake == null ? '—' : tokens(m.rake)} />
        <Stat label="Settled" value={m.settled ? 'Yes' : 'No'} tone={m.status !== 'active' && !m.settled ? 'danger' : undefined} note={<When at={m.settled_at} />} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Players">
          <Table head={['Player', 'Seat', 'Rating', 'Tokens']}>
            {m.players.map((p) => (
              <tr key={p.user_id}>
                <td>
                  <Link to={`/players/${p.user_id}`} className="font-semibold text-indigo underline">
                    {p.username}
                  </Link>
                </td>
                <td>{p.seat}</td>
                <td className="whitespace-nowrap">
                  {p.rating_before ?? '—'}
                  {p.rating_after != null && ` → ${p.rating_after}`}
                </td>
                <td className="text-right">{p.tokens_change == null ? '—' : signed(p.tokens_change)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Details">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-sm [&_dt]:text-muted">
            <dt>Created</dt>
            <dd>
              <When at={m.created_at} />
            </dd>
            <dt>Started</dt>
            <dd>
              <When at={m.started_at} />
            </dd>
            <dt>Finished</dt>
            <dd>
              <When at={m.finished_at} />
            </dd>
            <dt>Pace</dt>
            <dd>{m.rating_pool ?? '—'}</dd>
            <dt>Options</dt>
            <dd className="break-all font-mono text-xs">{JSON.stringify(m.options)}</dd>
            <dt>Match ID</dt>
            <dd className="break-all font-mono text-xs">{m.id}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Money: stakes held, and every ledger movement for this match" className="mt-4">
        <Table head={['Player', 'What', 'Balance', 'Amount', 'When / state']} empty={m.escrow.length + m.ledger.length === 0}>
          {m.escrow.map((e, i) => (
            <tr key={`e${i}`}>
              <td>{e.username}</td>
              <td>escrow</td>
              <td>{e.balance_type}</td>
              <td className="text-right">{tokens(e.amount)}</td>
              <td>{words(e.status)}</td>
            </tr>
          ))}
          {m.ledger.map((l) => (
            <tr key={l.id}>
              <td>{l.username}</td>
              <td>{words(l.entry_type)}</td>
              <td>{l.balance_type}</td>
              <td className={`text-right font-semibold ${l.amount < 0 ? 'text-danger' : 'text-ok'}`}>{signed(l.amount)}</td>
              <td className="whitespace-nowrap">
                <When at={l.created_at} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {m.game && (
        <Card title="Game record (as stored)" className="mt-4">
          <dl className="grid gap-x-3 gap-y-1.5 px-4 py-3 text-sm sm:grid-cols-[10rem_1fr] [&_dt]:text-muted">
            {Object.entries(m.game)
              .filter(([key]) => key !== 'match_id')
              .map(([key, value]) => (
                <div key={key} className="contents">
                  <dt>{words(key)}</dt>
                  <dd className="break-all font-mono text-xs">{value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
              ))}
          </dl>
        </Card>
      )}

      {aborting && (
        <ActionDialog
          title="Call this match off?"
          explain="The game ends now with no result. Every stake is refunded in full, no commission is taken and no rating changes. This cannot be undone."
          confirmLabel="Call match off"
          danger
          onClose={() => setAborting(false)}
          onConfirm={async (reason) => {
            await api('matches.abort', { matchId: m.id, reason })
            await queryClient.invalidateQueries()
          }}
        />
      )}
    </>
  )
}
