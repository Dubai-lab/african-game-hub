import { Link } from 'react-router'
import { useApi } from '../lib/api'
import type { Overview } from '../lib/types'
import { Failure, Loading, PageTitle, Stat, tokens, When } from '../ui'

export default function OverviewPage() {
  const overview = useApi<Overview>('overview', {}, { refetchInterval: 60_000 })
  if (overview.isPending) return <Loading />
  if (overview.isError) return <Failure error={overview.error} retry={() => void overview.refetch()} />
  const o = overview.data
  const supply = o.tokens_bonus + o.tokens_cash + o.tokens_in_escrow

  return (
    <>
      <PageTitle>Overview</PageTitle>

      {(o.open_reports > 0 || o.integrity_problems > 0) && (
        <div className="mb-5 grid gap-2">
          {o.integrity_problems > 0 && (
            <Link to="/integrity" className="rounded border border-danger bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">
              The ledger check is failing ({o.integrity_problems} {o.integrity_problems === 1 ? 'problem' : 'problems'}). Look at this first.
            </Link>
          )}
          {o.open_reports > 0 && (
            <Link to="/reports" className="rounded border border-line bg-maize/20 px-4 py-3 text-sm font-semibold">
              {o.open_reports} player {o.open_reports === 1 ? 'report is' : 'reports are'} waiting for an answer.
            </Link>
          )}
        </div>
      )}

      <h2 className="mb-2 text-sm font-bold text-muted">Right now</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Games in play" value={tokens(o.active_matches)} />
        <Stat label="Players searching" value={tokens(o.searching)} />
        <Stat label="Tokens held in escrow" value={tokens(o.tokens_in_escrow)} note="Stakes of games in play" />
        <Stat
          label="Ledger check"
          value={o.integrity_problems === 0 ? 'Balanced' : 'Failing'}
          tone={o.integrity_problems === 0 ? 'ok' : 'danger'}
          note={o.last_alert_at ? <>Last alert <When at={o.last_alert_at} /></> : 'No alert on record'}
        />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-bold text-muted">Today</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New players" value={tokens(o.players_today)} />
        <Stat label="Games finished" value={tokens(o.matches_today)} />
        <Stat label="Commission taken" value={tokens(o.rake_today)} note="Tokens" />
        <Stat label="Open reports" value={tokens(o.open_reports)} tone={o.open_reports > 0 ? 'danger' : undefined} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-bold text-muted">All time</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Players" value={tokens(o.players)} note={`${tokens(o.banned)} banned`} />
        <Stat label="Tokens players hold" value={tokens(supply)} note={`${tokens(o.tokens_bonus)} bonus · ${tokens(o.tokens_cash)} cash`} />
        <Stat label="Commission taken" value={tokens(o.rake_total)} note={`${tokens(o.rake_cash_total)} of it from cash tokens`} />
        <Stat label="Integrity alerts on record" value={tokens(o.integrity_alerts)} tone={o.integrity_alerts > 0 ? 'danger' : undefined} />
      </div>
    </>
  )
}
