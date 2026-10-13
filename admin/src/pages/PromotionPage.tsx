import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, useApi } from '../lib/api'
import type { PromotionBoard, PromotionGame, PromotionPlayer } from '../lib/types'
import { ActionDialog, Badge, Button, Card, Failure, Loading, PageTitle, Stat, Table, When } from '../ui'
import { GAMES, PromotionForm } from './PromotionForm'
import { PromotionState } from './PromotionsPage'

const flag = (code: string | null) => (code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '')
const length = (seconds: number) => (seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`)

/** One player's games in the period: who against, how long, and whether each counts. This is where two accounts feeding each other show. */
function Games({ promotionId, player }: { promotionId: number; player: PromotionPlayer }) {
  const games = useApi<PromotionGame[]>('promotions.player', { promotionId, userId: player.user_id })
  if (games.isPending) return <p className="px-4 py-3 text-sm text-muted">Loading…</p>
  if (games.isError) return <Failure error={games.error} retry={() => void games.refetch()} />
  return (
    <ol className="grid gap-1 px-4 py-3 text-sm" aria-label={`Games of ${player.username}`}>
      {games.data.map((g) => (
        <li key={g.match_id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {g.counted ? <Badge tone="ok">counts, no. {g.nth}</Badge> : <Badge>does not count</Badge>}
          <Link to={`/matches/${g.match_id}`} className="text-indigo underline">
            {GAMES[g.game_type] ?? g.game_type}
          </Link>
          <span>
            against{' '}
            {g.against.map((o, i) => (
              <Fragment key={o.user_id}>
                {i > 0 && ', '}
                <Link to={`/players/${o.user_id}`} className="text-indigo underline">
                  {o.username}
                </Link>
              </Fragment>
            ))}
          </span>
          <span className="text-muted">
            {g.won ? 'won' : 'did not win'} · {length(g.seconds)} · <When at={g.finished_at} />
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function PromotionPage() {
  const promotionId = Number(useParams().promotionId)
  const queryClient = useQueryClient()
  const board = useApi<PromotionBoard | null>('promotions.get', { promotionId }, { refetchInterval: 30_000 })
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [paying, setPaying] = useState<{ player: PromotionPlayer; paid: boolean } | null>(null)

  if (board.isPending) return <Loading />
  if (board.isError) return <Failure error={board.error} retry={() => void board.refetch()} />
  if (!board.data) return <p className="text-sm">No such promotion.</p>
  const { promotion, rows } = board.data
  const winners = rows.filter((r) => r.winner)

  return (
    <>
      <PageTitle aside={<Button onClick={() => setEditing(!editing)}>{editing ? 'Close' : 'Change'}</Button>}>
        {promotion.name} <PromotionState promotion={promotion} />
      </PageTitle>
      <div className="grid gap-4">
        <p className="text-sm text-muted">
          <When at={promotion.starts_at} /> to <When at={promotion.ends_at} /> · finish {promotion.games_needed} {promotion.games_needed === 1 ? 'game' : 'games'} (
          {promotion.game_types ? promotion.game_types.map((g) => GAMES[g] ?? g).join(', ') : 'any game'}) · the first {promotion.winners} win
          {promotion.reward && <> · {promotion.reward}</>}
          <br />
          {promotion.new_players_only ? 'Only players who registered after it started' : 'Open to every player'} · at most {promotion.max_per_opponent} against the same opponent · games of{' '}
          {promotion.min_seconds} seconds or more
        </p>
        {editing && (
          <Card title="Change this promotion">
            <PromotionForm
              promotion={promotion}
              done={async () => {
                await queryClient.invalidateQueries()
                setEditing(false)
              }}
            />
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Registered in the period" value={board.data.registered} />
          <Stat label="Still playing towards it" value={board.data.playing} />
          <Stat label="Qualified" value={board.data.qualified} note={`${winners.length} of ${promotion.winners} winning places taken`} tone={winners.length >= promotion.winners ? 'ok' : undefined} />
          <Stat label="Marked as paid" value={board.data.paid} note={`of ${winners.length} winners`} />
        </div>

        <Card title="Players, the first to qualify first">
          <Table head={['Place', 'Player', 'Reach them at', 'Registered', 'Games that count', 'Different opponents', 'Qualified', 'Reward']} empty={rows.length === 0}>
            {rows.map((r) => (
              <Fragment key={r.user_id}>
                <tr className={r.winner ? 'bg-ok/5' : ''}>
                  <td className="whitespace-nowrap font-bold">{r.place ?? '—'}</td>
                  <td>
                    <Link to={`/players/${r.user_id}`} className="font-semibold text-indigo underline">
                      {r.username}
                    </Link>{' '}
                    <span aria-hidden="true">{flag(r.country_code)}</span> {r.banned && <Badge tone="danger">banned</Badge>}
                    {r.display_name && <span className="block text-xs text-muted">{r.display_name}</span>}
                  </td>
                  <td className="text-xs">
                    {r.phone && <span className="block">{r.phone}</span>}
                    <span className="break-all">{r.email ?? '—'}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <When at={r.registered_at} />
                  </td>
                  <td className="whitespace-nowrap">
                    <button type="button" className="font-semibold text-indigo underline" aria-expanded={open === r.user_id} onClick={() => setOpen(open === r.user_id ? null : r.user_id)}>
                      {r.games} of {promotion.games_needed}
                    </button>
                    {r.games_played > r.games && <span className="block text-xs text-muted">{r.games_played} played</span>}
                  </td>
                  <td>{r.opponents <= 1 && r.games > 1 ? <Badge tone="warn">{r.opponents}</Badge> : r.opponents}</td>
                  <td className="whitespace-nowrap">
                    <When at={r.qualified_at} />
                  </td>
                  <td className="whitespace-nowrap">
                    {r.paid_at ? (
                      <>
                        <Badge tone="ok">paid</Badge>{' '}
                        <button type="button" className="text-xs underline" onClick={() => setPaying({ player: r, paid: false })}>
                          undo
                        </button>
                        <span className="block text-xs text-muted">
                          by {r.paid_by ?? '—'}
                          {r.paid_note && <> · {r.paid_note}</>}
                        </span>
                      </>
                    ) : r.winner ? (
                      <Button variant="primary" onClick={() => setPaying({ player: r, paid: true })}>
                        Mark as paid
                      </Button>
                    ) : r.place ? (
                      <span className="text-xs text-muted">too late</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
                {open === r.user_id && (
                  <tr>
                    <td colSpan={8} className="bg-ground p-0!">
                      <Games promotionId={promotionId} player={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        </Card>
      </div>

      {paying && (
        <ActionDialog
          title={paying.paid ? `Mark ${paying.player.username} as paid?` : `Take back the “paid” mark on ${paying.player.username}?`}
          explain={
            paying.paid
              ? `Do this after you have sent the reward${promotion.reward ? ` (${promotion.reward})` : ''}. The system sends nothing itself; this is the note that it was done.`
              : 'Use this when the mark was made by mistake. It is kept in the audit log.'
          }
          confirmLabel={paying.paid ? 'Mark as paid' : 'Take the mark back'}
          reasonLabel={paying.paid ? 'How it was sent (for example the mobile money number or reference)' : 'Why'}
          reasonRequired={!paying.paid}
          onClose={() => setPaying(null)}
          onConfirm={async (note) => {
            await api('promotions.paid', { promotionId, userId: paying.player.user_id, paid: paying.paid, ...(note ? { note } : {}) })
            await queryClient.invalidateQueries()
          }}
        />
      )}
    </>
  )
}
