import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, useApi } from '../lib/api'
import type { Player } from '../lib/types'
import { ActionDialog, Badge, Button, Card, Failure, inputClass, Loading, PageTitle, signed, Stat, Table, tokens, When, words } from '../ui'

type Dialog = 'ban' | 'unban' | 'adjust' | null

export default function PlayerPage() {
  const { userId } = useParams()
  const queryClient = useQueryClient()
  const player = useApi<Player | null>('players.get', { userId })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [amount, setAmount] = useState('')
  const [balanceType, setBalanceType] = useState<'cash' | 'bonus'>('cash')

  if (player.isPending) return <Loading />
  if (player.isError) return <Failure error={player.error} retry={() => void player.refetch()} />
  const p = player.data
  if (!p) return <p className="text-sm">No such player.</p>

  const refresh = () => queryClient.invalidateQueries()
  const whole = Number.isInteger(Number(amount)) && Number(amount) > 0 ? Number(amount) : null

  return (
    <>
      <PageTitle
        aside={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog('adjust')}>Adjust balance</Button>
            {p.is_banned ? (
              <Button variant="primary" onClick={() => setDialog('unban')}>
                Lift ban
              </Button>
            ) : (
              <Button variant="danger" disabled={p.is_admin} title={p.is_admin ? 'Admin accounts cannot be banned here' : undefined} onClick={() => setDialog('ban')}>
                Ban player
              </Button>
            )}
          </div>
        }
      >
        {p.username}{' '}
        {p.is_banned && <Badge tone="danger">Banned</Badge>} {p.is_admin && <Badge tone="warn">Admin</Badge>}
      </PageTitle>

      {p.is_banned && (
        <p className="mb-4 rounded border border-danger bg-danger/5 px-4 py-3 text-sm">
          <strong>Banned.</strong> {p.ban_reason ?? 'No reason recorded.'} The player cannot join games or send messages; their tokens are untouched.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cash tokens" value={tokens(p.cash_balance)} note="Winnings and deposits" />
        <Stat label="Bonus tokens" value={tokens(p.bonus_balance)} note="Playable, never withdrawable" />
        <Stat label="In escrow" value={tokens(p.in_escrow)} note="Staked on games in play" />
        <Stat
          label="Reports against"
          value={tokens(p.reports_against)}
          tone={p.reports_open > 0 ? 'danger' : undefined}
          note={`${p.reports_open} open · ${p.reports_made} made by this player`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Account">
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-sm [&_dt]:text-muted">
            <dt>Display name</dt>
            <dd>{p.display_name ?? '—'}</dd>
            <dt>Email</dt>
            <dd className="break-all">
              {p.email} {p.email_confirmed ? <Badge tone="ok">Confirmed</Badge> : <Badge tone="warn">Not confirmed</Badge>}
            </dd>
            <dt>Phone</dt>
            <dd>{p.phone ?? '—'}</dd>
            <dt>Country</dt>
            <dd>{p.country_code ?? '—'}</dd>
            <dt>Language</dt>
            <dd>{p.language}</dd>
            <dt>18 or older</dt>
            <dd>{p.age_confirmed ? 'Confirmed' : 'Not confirmed'}</dd>
            <dt>Joined</dt>
            <dd>
              <When at={p.created_at} />
            </dd>
            <dt>Last sign-in</dt>
            <dd>
              <When at={p.last_sign_in_at} />
            </dd>
            <dt>Friends</dt>
            <dd>{p.friends}</dd>
            <dt>Chat in games</dt>
            <dd>{p.match_chat_enabled ? 'On' : 'Turned off by the player'}</dd>
            <dt>Account ID</dt>
            <dd className="break-all font-mono text-xs">{p.id}</dd>
          </dl>
        </Card>

        <Card title="Ratings">
          <Table head={['Game', 'Pace', 'Rating', 'Played', 'W', 'L', 'D']} empty={p.ratings.length === 0}>
            {p.ratings.map((r) => (
              <tr key={`${r.game}/${r.pool}`}>
                <td>{r.game}</td>
                <td>{r.pool}</td>
                <td className="font-semibold">{r.rating}</td>
                <td>{r.games}</td>
                <td>{r.wins}</td>
                <td>{r.losses}</td>
                <td>{r.draws}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Admin actions on this account" className="mt-4">
        <Table head={['When', 'Admin', 'Action', 'Details']} empty={p.admin_actions.length === 0}>
          {p.admin_actions.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap">
                <When at={a.created_at} />
              </td>
              <td>{a.admin}</td>
              <td>{words(a.action)}</td>
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
      </Card>

      <Card title="Ledger (latest 60 movements)" className="mt-4">
        <Table head={['#', 'When', 'Type', 'Balance', 'Amount', 'Balance after', 'Match']} empty={p.ledger.length === 0}>
          {p.ledger.map((l) => (
            <tr key={l.id}>
              <td className="text-muted">{l.id}</td>
              <td className="whitespace-nowrap">
                <When at={l.created_at} />
              </td>
              <td>{words(l.entry_type)}</td>
              <td>{l.balance_type}</td>
              <td className={`text-right font-semibold ${l.amount < 0 ? 'text-danger' : 'text-ok'}`}>{signed(l.amount)}</td>
              <td className="text-right">{tokens(l.balance_after)}</td>
              <td>
                {l.match_id && (
                  <Link to={`/matches/${l.match_id}`} className="text-indigo underline">
                    Open
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Games (latest 40)" className="mt-4">
        <Table head={['When', 'Game', 'Against', 'Stake', 'Outcome', 'Tokens', 'Rating', '']} empty={p.matches.length === 0}>
          {p.matches.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap">
                <When at={m.created_at} />
              </td>
              <td>
                {m.game_type} {m.rating_pool && <span className="text-muted">{m.rating_pool}</span>}
              </td>
              <td>{m.opponents ?? '—'}</td>
              <td className="text-right">{tokens(m.stake_amount)}</td>
              <td>
                {m.status === 'active' ? (
                  <Badge tone="warn">In play</Badge>
                ) : m.result === 'win' ? (
                  <Badge tone={m.won ? 'ok' : 'danger'}>{m.won ? 'Won' : 'Lost'}</Badge>
                ) : (
                  <Badge>{words(m.result ?? m.status)}</Badge>
                )}{' '}
                <span className="text-muted">{words(m.end_reason)}</span>
              </td>
              <td className="text-right">{m.tokens_change == null ? '—' : signed(m.tokens_change)}</td>
              <td className="whitespace-nowrap">{m.rating_after == null ? '—' : `${m.rating_before} → ${m.rating_after}`}</td>
              <td>
                <Link to={`/matches/${m.id}`} className="text-indigo underline">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {(dialog === 'ban' || dialog === 'unban') && (
        <ActionDialog
          title={dialog === 'ban' ? `Ban ${p.username}?` : `Lift the ban on ${p.username}?`}
          explain={
            dialog === 'ban'
              ? 'The player will be taken out of the queue and will not be able to join games or send messages. A game already in play continues. Their tokens are not touched.'
              : 'The player will be able to join games and send messages again.'
          }
          confirmLabel={dialog === 'ban' ? 'Ban player' : 'Lift ban'}
          danger={dialog === 'ban'}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api('players.ban', { userId: p.id, banned: dialog === 'ban', reason })
            await refresh()
          }}
        />
      )}

      {dialog === 'adjust' && (
        <ActionDialog
          title={`Adjust ${p.username}’s balance`}
          explain="This writes a permanent ledger entry of type “adjustment” and an audit log entry with your name. It cannot be deleted; a mistake is corrected with a second adjustment."
          confirmLabel={whole ? `${direction === 'add' ? 'Add' : 'Remove'} ${tokens(whole)} ${balanceType} tokens` : 'Enter an amount'}
          danger={direction === 'remove'}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            if (!whole) throw new Error('amount')
            await api('players.adjust', { userId: p.id, amount: direction === 'add' ? whole : -whole, balanceType, reason })
            setAmount('')
            await refresh()
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            <label className="text-sm font-semibold">
              Direction
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'add' | 'remove')} className={`${inputClass} mt-1`}>
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Tokens
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]+"
                required
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="text-sm font-semibold">
              Balance
              <select value={balanceType} onChange={(e) => setBalanceType(e.target.value as 'cash' | 'bonus')} className={`${inputClass} mt-1`}>
                <option value="cash">Cash</option>
                <option value="bonus">Bonus</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">
            Now: {tokens(p.cash_balance)} cash, {tokens(p.bonus_balance)} bonus.
          </p>
        </ActionDialog>
      )}
    </>
  )
}
