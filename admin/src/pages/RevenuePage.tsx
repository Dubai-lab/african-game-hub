import { useState } from 'react'
import { useApi } from '../lib/api'
import type { RevenueDay } from '../lib/types'
import { Card, Failure, Loading, PageTitle, Stat, Table, Tabs, tokens } from '../ui'

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function RevenuePage() {
  const [range, setRange] = useState('30')
  const revenue = useApi<RevenueDay[]>('revenue', { days: Number(range) })

  if (revenue.isPending) return <Loading />
  if (revenue.isError) return <Failure error={revenue.error} retry={() => void revenue.refetch()} />
  const days = revenue.data
  const sum = (key: 'matches' | 'staked' | 'rake' | 'rake_cash' | 'signups') => days.reduce((total, d) => total + d[key], 0)

  return (
    <>
      <PageTitle aside={<Tabs value={range} options={RANGES} onChange={setRange} />}>Revenue</PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Commission taken" value={tokens(sum('rake'))} note="Tokens, bonus and cash together" />
        <Stat label="Of which cash tokens" value={tokens(sum('rake_cash'))} note="Only this part can ever become money" />
        <Stat label="Tokens staked" value={tokens(sum('staked'))} note={`${tokens(sum('matches'))} games finished`} />
        <Stat label="New players" value={tokens(sum('signups'))} />
      </div>
      <p className="mt-3 max-w-prose text-xs text-muted">
        Play-money phase: no real money has been taken. Commission is counted in tokens, and bonus tokens were given away free, so the “cash tokens” column is
        the one to watch once deposits are switched on. Days are UTC.
      </p>
      <Card title="By day" className="mt-4">
        <Table head={['Day', 'Games finished', 'Tokens staked', 'Commission', 'Commission in cash tokens', 'New players']}>
          {days.map((d) => (
            <tr key={d.day} className={d.matches + d.signups === 0 ? 'text-muted' : ''}>
              <td className="whitespace-nowrap">{day.format(new Date(`${d.day}T00:00:00Z`))}</td>
              <td className="text-right">{tokens(d.matches)}</td>
              <td className="text-right">{tokens(d.staked)}</td>
              <td className="text-right font-semibold">{tokens(d.rake)}</td>
              <td className="text-right">{tokens(d.rake_cash)}</td>
              <td className="text-right">{tokens(d.signups)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  )
}
