import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useApi } from '../lib/api'
import type { Page, PlayerRow } from '../lib/types'
import { Badge, Button, Card, Failure, inputClass, Loading, PageTitle, Pager, Table, tokens, When } from '../ui'

const LIMIT = 25

export default function PlayersPage() {
  // The search lives in the address, so Back returns to the same results.
  const [search, setSearch] = useSearchParams()
  const query = search.get('q') ?? ''
  const offset = Number(search.get('from') ?? 0) || 0
  const [typed, setTyped] = useState(query)
  const players = useApi<Page<PlayerRow>>('players.search', { query, limit: LIMIT, offset })

  function submit(event: FormEvent) {
    event.preventDefault()
    setSearch(typed.trim() ? { q: typed.trim() } : {})
  }

  return (
    <>
      <PageTitle>Players</PageTitle>
      <form onSubmit={submit} className="mb-4 flex max-w-xl gap-2" role="search">
        <input
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Username, name, email or account ID"
          aria-label="Find a player"
          className={inputClass}
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      {players.isPending ? (
        <Loading />
      ) : players.isError ? (
        <Failure error={players.error} retry={() => void players.refetch()} />
      ) : (
        <Card title={query ? `${tokens(players.data.total)} found for “${query}”` : `${tokens(players.data.total)} players, newest first`}>
          <Table head={['Player', 'Email', 'Country', 'Bonus', 'Cash', 'Joined', '']} empty={players.data.rows.length === 0}>
            {players.data.rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/players/${p.id}`} className="font-semibold text-indigo underline">
                    {p.username}
                  </Link>
                  {p.display_name && p.display_name !== p.username && <span className="ml-2 text-muted">{p.display_name}</span>}
                </td>
                <td className="whitespace-nowrap">{p.email}</td>
                <td>{p.country_code ?? '—'}</td>
                <td className="text-right">{tokens(p.bonus_balance)}</td>
                <td className="text-right">{tokens(p.cash_balance)}</td>
                <td className="whitespace-nowrap">
                  <When at={p.created_at} />
                </td>
                <td>{p.is_banned && <Badge tone="danger">Banned</Badge>}</td>
              </tr>
            ))}
          </Table>
          <Pager total={players.data.total} limit={LIMIT} offset={offset} onOffset={(from) => setSearch({ ...(query ? { q: query } : {}), from: String(from) })} />
        </Card>
      )}
    </>
  )
}
