import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, useApi } from '../lib/api'
import type { Promotion, PromotionBoard, PromotionEmailResult, PromotionGame, PromotionPlayer } from '../lib/types'
import { ActionDialog, Badge, Button, Card, Failure, inputClass, Loading, PageTitle, Stat, Table, When } from '../ui'
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

/**
 * Emails winners that they have won: their place, the prize, and a request to reply with their
 * mobile money details. Given no players, it writes to every winner not yet told and not yet paid.
 */
function EmailWinners({ promotion, players, everyone, onClose, onSent }: { promotion: Promotion; players: PromotionPlayer[]; everyone: boolean; onClose: () => void; onSent: (result: PromotionEmailResult) => void }) {
  const [prize, setPrize] = useState(promotion.reward ?? '')
  const again = !everyone && players[0]?.emailed_at
  return (
    <ActionDialog
      title={everyone ? `Email ${players.length} ${players.length === 1 ? 'winner' : 'winners'} that they won?` : `${again ? 'Email again' : 'Email'} ${players[0]?.username} that they won?`}
      explain={
        <>
          <p>
            Each gets an email in their own language with their place, the prize below, and a request to reply with the mobile money number to send it to, the name on that account and the network. Replies come to the
            hub’s support mailbox. Once the prize is sent, use “Mark as paid”.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {players.map((p) => (
              <li key={p.user_id}>
                {p.place}. {p.username} <span className="break-all">({p.email})</span>
              </li>
            ))}
          </ul>
        </>
      }
      confirmLabel="Send the email"
      reasonLabel="A few words of your own, added to the email (optional)"
      reasonRequired={false}
      onClose={onClose}
      onConfirm={async (note) => {
        const result = await api<PromotionEmailResult>('promotions.email', {
          promotionId: promotion.id,
          ...(everyone ? {} : { userIds: players.map((p) => p.user_id) }),
          prize: prize.trim(),
          ...(note ? { note } : {}),
        })
        onSent(result)
      }}
    >
      <label className="grid gap-1 text-sm font-semibold">
        The prize, as the email will say it
        <input value={prize} onChange={(e) => setPrize(e.target.value)} required maxLength={200} placeholder="1000 RWF by mobile money" className={`${inputClass} font-normal`} />
      </label>
    </ActionDialog>
  )
}

const canEmail = (r: PromotionPlayer) => r.winner && !r.banned && Boolean(r.email) && r.email_confirmed

export default function PromotionPage() {
  const promotionId = Number(useParams().promotionId)
  const queryClient = useQueryClient()
  const board = useApi<PromotionBoard | null>('promotions.get', { promotionId }, { refetchInterval: 30_000 })
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [paying, setPaying] = useState<{ player: PromotionPlayer; paid: boolean } | null>(null)
  const [emailing, setEmailing] = useState<{ players: PromotionPlayer[]; everyone: boolean } | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  if (board.isPending) return <Loading />
  if (board.isError) return <Failure error={board.error} retry={() => void board.refetch()} />
  if (!board.data) return <p className="text-sm">No such promotion.</p>
  const { promotion, rows } = board.data
  const winners = rows.filter((r) => r.winner)
  // Who "Email all winners" writes to: the same choice the server makes.
  const notTold = winners.filter((r) => canEmail(r) && !r.emailed_at && !r.paid_at)

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
          <Stat label="Marked as paid" value={board.data.paid} note={`of ${winners.length} winners · ${board.data.emailed} emailed`} />
        </div>

        {sent && (
          <p role="status" className="rounded border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
            {sent}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={notTold.length === 0} onClick={() => setEmailing({ players: notTold, everyone: true })}>
            Email the winners not yet told ({notTold.length})
          </Button>
          <span className="text-sm text-muted">Tells each winner their place and prize, and asks them to reply with their mobile money number.</span>
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
                    {r.winner && (
                      <span className="mb-1 block text-xs">
                        {r.emailed_at ? (
                          <>
                            emailed <When at={r.emailed_at} />
                            {canEmail(r) && (
                              <>
                                {' '}
                                ·{' '}
                                <button type="button" className="underline" onClick={() => setEmailing({ players: [r], everyone: false })}>
                                  email again
                                </button>
                              </>
                            )}
                          </>
                        ) : canEmail(r) ? (
                          <button type="button" className="font-semibold text-indigo underline" onClick={() => setEmailing({ players: [r], everyone: false })}>
                            Email winner
                          </button>
                        ) : (
                          <span className="text-muted">{r.banned ? 'banned: not emailed' : 'no confirmed email'}</span>
                        )}
                      </span>
                    )}
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

      {emailing && (
        <EmailWinners
          promotion={promotion}
          players={emailing.players}
          everyone={emailing.everyone}
          onClose={() => setEmailing(null)}
          onSent={async (result) => {
            const parts = [`Email on its way to ${result.emailed} ${result.emailed === 1 ? 'winner' : 'winners'} (sent within a few minutes).`]
            if (result.recent > 0) parts.push(`${result.recent} emailed less than ten minutes ago, so not again yet.`)
            if (result.no_address > 0) parts.push(`${result.no_address} without a confirmed email address.`)
            setSent(parts.join(' '))
            await queryClient.invalidateQueries()
          }}
        />
      )}

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
