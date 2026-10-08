import { Link, useSearchParams } from 'react-router'
import { useApi } from '../lib/api'
import type { MatchRow, Page } from '../lib/types'
import { Badge, Card, Failure, Loading, PageTitle, Pager, Table, Tabs, tokens, When, words } from '../ui'

const LIMIT = 25
type Filter = 'all' | 'active' | 'finished' | 'aborted'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'In play' },
  { value: 'finished', label: 'Finished' },
  { value: 'aborted', label: 'Called off' },
]

export function MatchStatus({ match }: { match: Pick<MatchRow, 'status' | 'result' | 'settled'> }) {
  if (match.status === 'active') return <Badge tone="warn">In play</Badge>
  if (match.status === 'aborted') return <Badge>Called off</Badge>
  if (match.status === 'finished') {
    return (
      <>
        <Badge tone="ok">{match.result === 'draw' ? 'Draw' : 'Finished'}</Badge> {!match.settled && <Badge tone="danger">Not settled</Badge>}
      </>
    )
  }
  return <Badge>{words(match.status)}</Badge>
}

export default function MatchesPage() {
  const [search, setSearch] = useSearchParams()
  const filter = (search.get('status') ?? 'all') as Filter
  const offset = Number(search.get('from') ?? 0) || 0
  const matches = useApi<Page<MatchRow>>('matches.list', { ...(filter === 'all' ? {} : { status: filter }), limit: LIMIT, offset }, { refetchInterval: 30_000 })

  return (
    <>
      <PageTitle aside={<Tabs value={filter} options={FILTERS} onChange={(status) => setSearch(status === 'all' ? {} : { status })} />}>Matches</PageTitle>
      {matches.isPending ? (
        <Loading />
      ) : matches.isError ? (
        <Failure error={matches.error} retry={() => void matches.refetch()} />
      ) : (
        <Card title={`${tokens(matches.data.total)} matches, newest first`}>
          <Table head={['Started', 'Game', 'Players', 'Stake each', 'Status', 'Winner', 'How it ended', '']} empty={matches.data.rows.length === 0}>
            {matches.data.rows.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">
                  <When at={m.created_at} />
                </td>
                <td>
                  {m.game_type} {m.rating_pool && <span className="text-muted">{m.rating_pool}</span>}
                </td>
                <td>{m.players ?? '—'}</td>
                <td className="text-right">{tokens(m.stake_amount)}</td>
                <td className="whitespace-nowrap">
                  <MatchStatus match={m} />
                </td>
                <td>{m.winner ?? '—'}</td>
                <td>{words(m.end_reason)}</td>
                <td>
                  <Link to={`/matches/${m.id}`} className="text-indigo underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            total={matches.data.total}
            limit={LIMIT}
            offset={offset}
            onOffset={(from) => setSearch({ ...(filter === 'all' ? {} : { status: filter }), from: String(from) })}
          />
        </Card>
      )}
    </>
  )
}
