import { Link } from 'react-router'
import { useApi } from '../lib/api'
import type { Integrity } from '../lib/types'
import { Card, Failure, Loading, PageTitle, Table, When, words } from '../ui'

export default function IntegrityPage() {
  const integrity = useApi<Integrity>('integrity', {}, { refetchInterval: 60_000 })
  if (integrity.isPending) return <Loading />
  if (integrity.isError) return <Failure error={integrity.error} retry={() => void integrity.refetch()} />
  const { problems, alerts } = integrity.data

  return (
    <>
      <PageTitle>Ledger integrity</PageTitle>
      <p className="mb-4 max-w-prose text-sm text-muted">
        The books are checked on this page every time it loads, and by the database every 10 minutes: every wallet must equal the sum of its ledger entries,
        every stake in escrow must be accounted for, and every finished match must be settled exactly once.
      </p>

      {problems.length === 0 ? (
        <p className="rounded border border-ok bg-ok/5 px-4 py-3 text-sm font-semibold text-ok">The books balance. No problems found just now.</p>
      ) : (
        <Card title={`${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} right now — stop and investigate before anything else`} className="border-danger">
          <Table head={['Check', 'Player', 'Detail']}>
            {problems.map((p, i) => (
              <tr key={i}>
                <td className="font-semibold text-danger">{words(p.check_name)}</td>
                <td>
                  {p.user_id ? (
                    <Link to={`/players/${p.user_id}`} className="text-indigo underline">
                      Open player
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="break-all font-mono text-xs">{p.detail}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Alerts raised by the scheduled check (latest 30)" className="mt-4">
        <Table head={['When', 'Problems found']} empty={alerts.length === 0}>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap align-top">
                <When at={a.checked_at} />
              </td>
              <td className="break-all font-mono text-xs">{JSON.stringify(a.problems)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}
