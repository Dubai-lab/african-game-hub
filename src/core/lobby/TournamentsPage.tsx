import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import i18n from '@/core/i18n'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { useFormat } from '@/core/ui/useFormat'
import type { GameOptions } from '@/games/types'
import { termsText } from './challenges'
import { GameHeader, GameNotOpen, spanText, useMatchSetup } from './setup'

// A game's tournaments: the ones running or coming up, the ones that are over, and a form to
// start your own and share its link.

const sectionTitle = 'font-display text-xl font-semibold'
const LENGTHS = [30, 60, 90, 120]
const ROUNDS = [3, 5, 7, 9]

export type TournamentRow = {
  id: string
  name: string
  options: GameOptions
  pool: string
  startsAt: number
  endsAt: number
  prize: number
  status: 'scheduled' | 'running' | 'finished' | 'cancelled'
  /** By time (an arena) or by rounds. */
  format: 'arena' | 'rounds'
  rounds: number | null
  round: number
  players: number
}

function useTournaments(gameId: string | undefined, finished: boolean) {
  return useQuery({
    queryKey: ['tournaments', gameId, finished],
    enabled: Boolean(gameId),
    staleTime: 0,
    refetchInterval: finished ? false : 10_000,
    meta: { silent: true },
    queryFn: async (): Promise<TournamentRow[]> => {
      const query = supabase
        .from('tournaments')
        .select('id, name, options, rating_pool, starts_at, ends_at, prize_amount, status, format, rounds, current_round, tournament_players (count)')
        .eq('game_type', gameId!)
        .in('status', finished ? ['finished'] : ['scheduled', 'running'])
        .order('starts_at', { ascending: !finished })
        .limit(40)
      const { data, error } = await query
      if (error) throw error
      return data.map((row) => ({
        id: row.id,
        name: row.name,
        options: (row.options as GameOptions | null) ?? {},
        pool: row.rating_pool,
        startsAt: Date.parse(row.starts_at),
        endsAt: Date.parse(row.ends_at),
        prize: row.prize_amount,
        status: row.status as TournamentRow['status'],
        format: row.format as TournamentRow['format'],
        rounds: row.rounds,
        round: row.current_round,
        players: (row.tournament_players as unknown as { count: number }[])[0]?.count ?? 0,
      }))
    },
  })
}

/** Redraws every few seconds so that "ends in 17 min" stays true. */
export function useNow(everyMs = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

/** "Ends in 17 min", "Round 2 of 5", "Starts in 2 h", "Finished". */
export function whenText(row: { status: string; startsAt: number; endsAt: number; format?: string; rounds?: number | null; round?: number }, now: number): string {
  if (row.status === 'cancelled') return i18n.t('tournament.cancelled')
  if (row.status === 'finished') return i18n.t('tournament.ended')
  if (now < row.startsAt) return i18n.t('tournament.startsIn', { time: spanText(row.startsAt - now) })
  if (row.format === 'rounds') return row.round ? i18n.t('tournament.round', { round: row.round, rounds: row.rounds ?? 0 }) : i18n.t('tournament.starting')
  if (now < row.endsAt) return i18n.t('tournament.endsIn', { time: spanText(row.endsAt - now) })
  return i18n.t('tournament.timeUp')
}

export default function TournamentsPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const navigate = useNavigate()
  const { gameId } = useParams()
  const { games, game, module, balance, options, pool, players, setOptions } = useMatchSetup(gameId)
  const [tab, setTab] = useState<'open' | 'finished' | 'create'>('open')
  const list = useTournaments(game?.id, tab === 'finished')
  const now = useNow()

  // The form.
  const [name, setName] = useState('')
  const [when, setWhen] = useState<'now' | '15' | '60' | 'pick'>('now')
  const [picked, setPicked] = useState('')
  const [kind, setKind] = useState<'arena' | 'rounds'>('arena')
  const [minutes, setMinutes] = useState(60)
  const [rounds, setRounds] = useState(5)
  const [prizeOn, setPrizeOn] = useState(false)
  const [prize, setPrize] = useState('')
  const [busy, setBusy] = useState(false)

  if (games.isPending) return <Skeleton className="h-64" />
  if (!game || !module) return <GameNotOpen />
  const gameName = t(`games.${game.id}`, { defaultValue: game.name })
  // Tournament games are between two players.
  const twoPlayers = players === 2
  const amount = prizeOn ? Math.floor(Number(prize)) : 0
  const tooMuch = prizeOn && balance !== null && amount > balance
  const badAmount = prizeOn && (!Number.isFinite(amount) || amount <= 0)
  const startsAt = when === 'now' ? null : when === 'pick' ? (picked ? new Date(picked) : null) : new Date(Date.now() + Number(when) * 60_000)
  const badTime = when === 'pick' && (!startsAt || Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 60_000)
  const canCreate = name.trim().length >= 3 && options !== null && twoPlayers && !tooMuch && !badAmount && !badTime && !busy

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!canCreate || !game) return
    setBusy(true)
    try {
      const reply = await callFunction<{ id: string | null }>('core-tournament', {
        action: 'create',
        game_type: game.id,
        name: name.trim(),
        options,
        ...(startsAt ? { starts_at: startsAt.toISOString() } : {}),
        format: kind,
        ...(kind === 'arena' ? { minutes } : { rounds }),
        prize: amount,
      })
      if (!reply.ok) toast.error(refusalMessage(reply.code))
      else if (reply.id) navigate(`/tournaments/${reply.id}`)
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  const tabClass = (on: boolean) => `min-h-11 flex-1 border-2 px-2 text-sm font-bold ${on ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`
  const pick = (on: boolean) => `min-h-11 border-2 px-3 text-sm font-bold ${on ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`

  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <GameHeader gameId={game.id} title={t('tournament.title')} back={{ to: `/play/${game.id}/new`, label: t('play.new.backTo', { game: gameName }) }} />

      <div className="flex gap-2" role="tablist">
        {(['open', 'finished', 'create'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={tabClass(tab === id)}>
            {t(`tournament.tabs.${id}`)}
          </button>
        ))}
      </div>

      {tab !== 'create' ? (
        list.isPending ? (
          <Skeleton className="h-40" />
        ) : (list.data ?? []).length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted">{t(tab === 'open' ? 'tournament.none' : 'tournament.noneFinished')}</p>
            {tab === 'open' && <Button onClick={() => setTab('create')}>{t('tournament.tabs.create')}</Button>}
          </div>
        ) : (
          <ul className="divide-y divide-line border-y border-line" data-testid="tournament-list">
            {list.data!.map((row) => (
              <li key={row.id}>
                <Link to={`/tournaments/${row.id}`} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{row.name}</span>
                    <span className="block text-sm text-muted">
                      {[termsText(game, row.pool, row.options), t('tournament.players', { count: row.players })].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-end text-sm">
                    <span className="block font-semibold">{whenText(row, now)}</span>
                    <span className={`block font-bold tabular-nums ${row.prize > 0 ? 'text-palm' : 'text-muted'}`}>{row.prize > 0 ? t('tournament.prize', { amount: format.tokens(row.prize) }) : t('tournament.noPrize')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form onSubmit={(event) => void create(event)} className="flex flex-col gap-6 lg:border-2 lg:border-line lg:bg-panel lg:p-6">
          <label className="flex flex-col gap-1.5">
            <span className={sectionTitle}>{t('tournament.form.name')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={t('tournament.form.namePlaceholder')} className="min-h-12 w-full rounded-lg border border-line bg-panel px-3 text-base" />
          </label>

          <module.OptionsPicker schema={game.optionsSchema} value={options} onChange={setOptions} />
          {!twoPlayers && <p className="text-sm font-semibold text-hibiscus">{t('tournament.form.twoPlayers')}</p>}

          <fieldset>
            <legend className={sectionTitle}>{t('tournament.form.when')}</legend>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
              {(['now', '15', '60', 'pick'] as const).map((id) => (
                <button key={id} type="button" role="radio" aria-checked={when === id} onClick={() => setWhen(id)} className={pick(when === id)}>
                  {t(`tournament.form.start.${id}`)}
                </button>
              ))}
            </div>
            {when === 'pick' && (
              <input type="datetime-local" value={picked} onChange={(event) => setPicked(event.target.value)} aria-label={t('tournament.form.start.pick')} className="mt-2 min-h-12 w-full rounded-lg border border-line bg-panel px-3 text-base" />
            )}
          </fieldset>

          <fieldset>
            <legend className={sectionTitle}>{t('tournament.form.kind')}</legend>
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup">
              {(['arena', 'rounds'] as const).map((id) => (
                <button key={id} type="button" role="radio" aria-checked={kind === id} onClick={() => setKind(id)} className={`${pick(kind === id)} py-2 text-start`}>
                  {t(`tournament.form.kinds.${id}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">{t(`tournament.form.kindHint.${kind}`)}</p>
          </fieldset>

          {kind === 'arena' ? (
            <fieldset>
              <legend className={sectionTitle}>{t('tournament.form.length')}</legend>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
                {LENGTHS.map((length) => (
                  <button key={length} type="button" role="radio" aria-checked={minutes === length} onClick={() => setMinutes(length)} className={pick(minutes === length)}>
                    {t('tournament.form.minutes', { count: length })}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <fieldset>
              <legend className={sectionTitle}>{t('tournament.form.rounds')}</legend>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
                {ROUNDS.map((count) => (
                  <button key={count} type="button" role="radio" aria-checked={rounds === count} onClick={() => setRounds(count)} className={pick(rounds === count)}>
                    {t('tournament.roundsCount', { count })}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className={sectionTitle}>{t('tournament.form.prize')}</legend>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
              <button type="button" role="radio" aria-checked={!prizeOn} onClick={() => setPrizeOn(false)} className={pick(!prizeOn)}>
                {t('tournament.form.prizeFree')}
              </button>
              <button type="button" role="radio" aria-checked={prizeOn} onClick={() => setPrizeOn(true)} className={pick(prizeOn)}>
                {t('tournament.form.prizeTokens')}
              </button>
            </div>
            {prizeOn && (
              <>
                <input type="number" inputMode="numeric" min={1} step={1} value={prize} onChange={(event) => setPrize(event.target.value)} aria-label={t('tournament.form.prizeAmount')} placeholder="500" className="mt-2 min-h-12 w-full rounded-lg border border-line bg-panel px-3 text-base tabular-nums" />
                <p className={`mt-1 text-sm ${tooMuch ? 'font-semibold text-hibiscus' : 'text-muted'}`}>{tooMuch ? t('tournament.form.tooMuch') : balance !== null && t('tournament.form.balance', { amount: format.tokens(balance) })}</p>
                <p className="mt-1 text-sm text-muted">{t('tournament.form.prizeHint')}</p>
              </>
            )}
          </fieldset>

          <Button type="submit" className="min-h-14 w-full text-lg" disabled={!canCreate}>
            {busy ? t('auth.working') : t('tournament.form.submit')}
          </Button>
          <p className="text-sm text-muted">{[gameName, termsText(game, pool, options)].filter(Boolean).join(' · ')}</p>
        </form>
      )}
    </div>
  )
}
