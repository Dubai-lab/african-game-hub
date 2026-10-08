import { Link, useSearchParams } from 'react-router'
import { useApi } from '../lib/api'
import type { AuditRow, Page } from '../lib/types'
import { Card, Failure, Loading, PageTitle, Pager, signed, Table, tokens, When, words } from '../ui'

const LIMIT = 50

export default function AuditPage() {
  const [search, setSearch] = useSearchParams()
  const offset = Number(search.get('from') ?? 0) || 0
  const audit = useApi<Page<AuditRow>>('audit', { limit: LIMIT, offset })

  return (
    <>
      <PageTitle>Audit log</PageTitle>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Everything any admin has changed, written by the database in the same step as the change. Entries cannot be edited or removed by anyone.
      </p>
      {audit.isPending ? (
        <Loading />
      ) : audit.isError ? (
        <Failure error={audit.error} retry={() => void audit.refetch()} />
      ) : (
        <Card title={`${tokens(audit.data.total)} entries, newest first`}>
          <Table head={['When', 'Admin', 'Action', 'On', 'Details']} empty={audit.data.rows.length === 0}>
            {audit.data.rows.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">
                  <When at={a.created_at} />
                </td>
                <td>{a.admin}</td>
                <td className="font-semibold">{words(a.action)}</td>
                <td>
                  {a.target_user_id ? (
                    <Link to={`/players/${a.target_user_id}`} className="text-indigo underline">
                      {a.target}
                    </Link>
                  ) : a.target_match_id ? (
                    <Link to={`/matches/${a.target_match_id}`} className="text-indigo underline">
                      match
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {typeof a.details.amount === 'number' && (
                    <span className="mr-2 font-semibold">
                      {signed(a.details.amount)} {String(a.details.balance_type)}
                    </span>
                  )}
                  {String(a.details.reason ?? a.details.note ?? '')}
                </td>
              </tr>
            ))}
          </Table>
          <Pager total={audit.data.total} limit={LIMIT} offset={offset} onOffset={(from) => setSearch({ from: String(from) })} />
        </Card>
      )}
    </>
  )
}
