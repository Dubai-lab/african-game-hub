import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApi } from '../lib/api'
import type { Page, PromotionRow } from '../lib/types'
import { Badge, Button, Card, Failure, Loading, PageTitle, Table, When } from '../ui'
import { GAMES, PromotionForm } from './PromotionForm'

/** Where a promotion stands today. */
export function PromotionState({ promotion }: { promotion: { starts_at: string; ends_at: string } }) {
  const now = Date.now()
  if (now < new Date(promotion.starts_at).getTime()) return <Badge>Not started</Badge>
  if (now > new Date(promotion.ends_at).getTime()) return <Badge tone="neutral">Ended</Badge>
  return <Badge tone="ok">Running</Badge>
}

export default function PromotionsPage() {
  const navigate = useNavigate()
  const list = useApi<Page<PromotionRow>>('promotions.list', { limit: 50 }, { refetchInterval: 60_000 })
  const [writing, setWriting] = useState(false)

  return (
    <>
      <PageTitle aside={!writing && <Button variant="primary" onClick={() => setWriting(true)}>New promotion</Button>}>Promotions</PageTitle>
      <div className="grid gap-4">
        <p className="max-w-prose text-sm text-muted">
          A promotion reads the record of who registered and which games they finished, and ranks the players who got there first. It moves no tokens: you give the reward yourself, and tick
          each winner here so that nobody is paid twice.
        </p>
        {writing && (
          <Card title="New promotion">
            <PromotionForm done={(id) => navigate(`/promotions/${id}`)} />
          </Card>
        )}
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <Failure error={list.error} retry={() => void list.refetch()} />
        ) : (
          <Card>
            <Table head={['Promotion', '', 'From', 'To', 'To do', 'Qualified', 'Paid']} empty={list.data.rows.length === 0}>
              {list.data.rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/promotions/${p.id}`} className="font-semibold text-indigo underline">
                      {p.name}
                    </Link>
                    {p.reward && <span className="block text-xs text-muted">{p.reward}</span>}
                  </td>
                  <td>
                    <PromotionState promotion={p} />
                  </td>
                  <td className="whitespace-nowrap">
                    <When at={p.starts_at} />
                  </td>
                  <td className="whitespace-nowrap">
                    <When at={p.ends_at} />
                  </td>
                  <td className="whitespace-nowrap">
                    {p.games_needed} {p.games_needed === 1 ? 'game' : 'games'}
                    <span className="block text-xs text-muted">{p.game_types ? p.game_types.map((g) => GAMES[g] ?? g).join(', ') : 'any game'}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {p.qualified} <span className="text-muted">of {p.winners} places</span>
                  </td>
                  <td>{p.paid}</td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </>
  )
}
