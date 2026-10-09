import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { flagEmoji } from '@/core/countries/useCountries'
import { useGameTypes } from '@/core/games/useGameTypes'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { useFormat } from '@/core/ui/useFormat'
import type { GameOptions } from '@/games/types'
import { ShareLink, termsText } from './challenges'
import { GameHeader } from './setup'
import { useTournamentPresence } from './tournamentPresence'
import { useNow, whenText } from './TournamentsPage'

// One tournament: what it is, and three views of it. Standings: who is where. Games: the games
// being played right now, each of which can be opened and watched. Chat: its players talking.
// For a player who has joined, this is also the waiting room between games.

type Standing = { userId: string; name: string; countryCode: string | null; points: number; games: number; wins: number; draws: number; losses: number; place: number | null; prize: number; dropped: boolean }
type Tournament = {
  id: string
  gameId: string
  name: string
  options: GameOptions
  pool: string
  startsAt: number
  endsAt: number
  prize: number
  status: 'scheduled' | 'running' | 'finished' | 'cancelled'
  format: 'arena' | 'rounds'
  rounds: number | null
  round: number
  createdBy: string
  creator: string
  standings: Standing[]
}

function useTournament(id: string | undefined) {
  return useQuery({
    queryKey: ['tournament', id],
    enabled: Boolean(id),
    staleTime: 0,
    refetchInterval: (query) => (query.state.data && ['finished', 'cancelled'].includes(query.state.data.status) ? false : 5000),
    meta: { silent: true },
    queryFn: async (): Promise<Tournament | null> => {
      const { data, error } = await supabase
        .from('tournaments')
        .select(
          `id, game_type, name, options, rating_pool, starts_at, ends_at, prize_amount, status, created_by, format, rounds, current_round,
           creator:profiles!tournaments_created_by_fkey (username, display_name),
           tournament_players (user_id, points, games, wins, draws, losses, place, prize, dropped, joined_at,
             player:profiles!tournament_players_user_id_fkey (username, display_name, country_code))`,
        )
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const standings = data.tournament_players
        .map((row) => ({
          userId: row.user_id,
          name: row.player?.display_name ?? row.player?.username ?? '?',
          countryCode: row.player?.country_code ?? null,
          points: row.points,
          games: row.games,
          wins: row.wins,
          draws: row.draws,
          losses: row.losses,
          place: row.place,
          prize: row.prize,
          dropped: row.dropped,
          joinedAt: row.joined_at,
        }))
        // The same order the server uses for the final places.
        .sort((a, b) => b.points - a.points || b.wins - a.wins || a.games - b.games || a.joinedAt.localeCompare(b.joinedAt))
      return {
        id: data.id,
        gameId: data.game_type,
        name: data.name,
        options: (data.options as GameOptions | null) ?? {},
        pool: data.rating_pool,
        startsAt: Date.parse(data.starts_at),
        endsAt: Date.parse(data.ends_at),
        prize: data.prize_amount,
        status: data.status as Tournament['status'],
        format: data.format as Tournament['format'],
        rounds: data.rounds,
        round: data.current_round,
        createdBy: data.created_by,
        creator: data.creator?.display_name ?? data.creator?.username ?? '?',
        standings,
      }
    },
  })
}

type LiveGame = { matchId: string; players: string[] }
/** The tournament's games being played at this moment. */
function useLiveGames(id: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['tournament-games', id],
    enabled: Boolean(id),
    staleTime: 0,
    refetchInterval: live ? 5000 : false,
    meta: { silent: true },
    queryFn: async (): Promise<LiveGame[]> => {
      const { data, error } = await supabase
        .from('matches')
        .select('id, started_at, match_players (seat_order, profiles (username, display_name))')
        .eq('tournament_id', id!)
        .eq('status', 'active')
        .order('started_at', { ascending: true })
        .limit(200)
      if (error) throw error
      return data.map((match) => ({
        matchId: match.id,
        players: [...match.match_players].sort((a, b) => (a.seat_order ?? 0) - (b.seat_order ?? 0)).map((p) => p.profiles?.display_name ?? p.profiles?.username ?? '?'),
      }))
    },
  })
}

type Pairing = { a: string; b: string | null; matchId: string | null; result: string | null }
/** By rounds: who plays whom in the round now on. */
function usePairings(id: string | undefined, round: number, live: boolean) {
  return useQuery({
    queryKey: ['tournament-pairings', id, round],
    enabled: Boolean(id) && round > 0,
    staleTime: 0,
    refetchInterval: live ? 5000 : false,
    meta: { silent: true },
    queryFn: async (): Promise<Pairing[]> => {
      const { data, error } = await supabase.from('tournament_pairings').select('player_a, player_b, match_id, result').eq('tournament_id', id!).eq('round', round).order('id')
      if (error) throw error
      return data.map((row) => ({ a: row.player_a, b: row.player_b, matchId: row.match_id, result: row.result }))
    },
  })
}

type ChatLine = { id: number; senderId: string; name: string; body: string }
function useChat(id: string | undefined, on: boolean) {
  return useQuery({
    queryKey: ['tournament-chat', id],
    enabled: Boolean(id) && on,
    staleTime: 0,
    refetchInterval: 4000,
    meta: { silent: true },
    queryFn: async (): Promise<ChatLine[]> => {
      const { data, error } = await supabase
        .from('tournament_messages')
        .select('id, sender_id, body, profiles (username, display_name)')
        .eq('tournament_id', id!)
        .order('id', { ascending: false })
        .limit(100)
      if (error) throw error
      return data.reverse().map((row) => ({ id: row.id, senderId: row.sender_id, name: row.profiles?.display_name ?? row.profiles?.username ?? '?', body: row.body }))
    },
  })
}

function Chat({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const chat = useChat(id, true)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useRef<HTMLOListElement>(null)
  const count = chat.data?.length ?? 0
  // The newest line is kept in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [count])

  async function send(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('send_tournament_message', { p_tournament_id: id, p_body: body })
      const reply = data as { ok: boolean; code?: string } | null
      if (error || !reply) toast.error(t('errors.generic'))
      else if (!reply.ok) toast.error(refusalMessage(reply.code ?? ''))
      else {
        setDraft('')
        await queryClient.invalidateQueries({ queryKey: ['tournament-chat', id] })
      }
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ol ref={list} className="flex max-h-80 min-h-32 flex-col gap-1.5 overflow-y-auto border-2 border-line bg-panel p-3" role="log" data-testid="tournament-chat">
        {count === 0 ? (
          <li className="text-muted">{t('tournament.chat.empty')}</li>
        ) : (
          chat.data!.map((line) => (
            <li key={line.id} className="break-words">
              <span className={`font-bold ${line.senderId === user?.id ? 'text-primary' : ''}`}>{line.name}</span> <span>{line.body}</span>
            </li>
          ))
        )}
      </ol>
      {canWrite ? (
        <form onSubmit={(event) => void send(event)} className="flex gap-2">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={300} aria-label={t('tournament.chat.placeholder')} placeholder={t('tournament.chat.placeholder')} className="min-h-12 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-base" />
          <Button type="submit" disabled={busy || !draft.trim()}>
            {t('tournament.chat.send')}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted">{t('tournament.chat.joinToWrite')}</p>
      )}
    </div>
  )
}

type Reply = { status: string; match_id: string | null }
type Tab = 'standings' | 'games' | 'chat'

export default function TournamentPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const queryClient = useQueryClient()
  const { id } = useParams()
  const { user } = useAuth()
  const games = useGameTypes()
  const tournament = useTournament(id)
  const now = useNow(1000)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('standings')
  const presence = useTournamentPresence()

  const data = tournament.data
  const me = data?.standings.find((row) => row.userId === user?.id)
  const joined = me !== undefined
  const live = data?.status === 'running' || data?.status === 'scheduled'
  const liveGames = useLiveGames(id, Boolean(live))
  const pairings = usePairings(id, data?.format === 'rounds' ? data.round : 0, Boolean(live))

  // A player in a tournament that is still on is "here" for it, on this page and everywhere else.
  const tournamentId = data?.id
  const gameId = data?.gameId
  const kind = data?.format
  const dropped = me?.dropped ?? false
  const { enter, leave } = presence
  useEffect(() => {
    if (!tournamentId || !gameId || !kind) return
    if (joined && live && !dropped) enter({ id: tournamentId, gameId, format: kind })
    else if (!live && useTournamentPresence.getState().active?.id === tournamentId) leave()
  }, [tournamentId, gameId, kind, joined, live, dropped, enter, leave])

  if (tournament.isPending) return <Skeleton className="h-64" />
  if (!data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t('tournament.page.notFound')}</p>
        <Link to="/lobby" className="font-semibold text-primary underline underline-offset-4">
          {t('lobby.allGames')}
        </Link>
      </div>
    )
  }

  const game = games.data?.find((g) => g.id === data.gameId)
  const gameName = t(`games.${data.gameId}`, { defaultValue: game?.name ?? data.gameId })
  const mine = data.createdBy === user?.id
  const canCancel = mine && data.status === 'scheduled' && now < data.startsAt
  const running = data.status === 'running'
  const byRounds = data.format === 'rounds'
  // By rounds, entry closes when round 1 starts.
  const canJoin = !joined && (byRounds ? data.status === 'scheduled' : live)
  const nameOf = (userId: string | null) => data.standings.find((row) => row.userId === userId)?.name ?? '?'
  const asking = presence.active?.id === data.id && presence.wantNext
  const myPairing = byRounds ? (pairings.data ?? []).find((p) => p.a === user?.id || p.b === user?.id) : undefined
  const myGame = (liveGames.data ?? []).find((g) => myPairing?.matchId === g.matchId)

  async function act(action: 'join' | 'cancel') {
    if (busy) return
    setBusy(true)
    try {
      const reply = await callFunction<Reply>('core-tournament', { action, tournament_id: data!.id })
      if (!reply.ok) toast.error(refusalMessage(reply.code))
      await queryClient.invalidateQueries({ queryKey: ['tournament', data!.id] })
    } catch {
      toast.error(t('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  // What the player is waiting for, in words.
  const roomText = !joined || !live
    ? ''
    : data.status === 'scheduled'
      ? t('tournament.page.notStarted')
      : dropped
        ? t('tournament.page.dropped')
        : byRounds
          ? !myPairing
            ? t('tournament.page.roundSoon')
            : myPairing.result === 'bye'
              ? t('tournament.page.bye')
              : myPairing.result !== null
                ? t('tournament.page.roundWait')
                : myPairing.matchId
                  ? t('tournament.page.yourGame')
                  : t('tournament.page.gameSoon', { name: nameOf(myPairing.a === user?.id ? myPairing.b : myPairing.a) })
          : now >= data.endsAt
            ? t('tournament.page.timeUp')
            : asking
              ? t('tournament.page.waiting')
              : t('tournament.page.pressNext')

  const tabClass = (on: boolean) => `min-h-11 flex-1 border-2 px-2 text-sm font-bold ${on ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`
  const gamesCount = liveGames.data?.length ?? 0

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-10">
      <div className="lg:col-span-2">
        <GameHeader gameId={data.gameId} title={data.name} back={{ to: `/play/${data.gameId}/tournaments`, label: t('tournament.page.back') }} />
      </div>

      <div className="flex flex-col gap-5">
        <section className="border-2 border-ink bg-panel p-4" data-testid="tournament-info" data-status={data.status} data-round={data.round}>
          <p className="font-semibold">{[gameName, termsText(game, data.pool, data.options), byRounds ? t('tournament.roundsCount', { count: data.rounds ?? 0 }) : t('tournament.byTime')].filter(Boolean).join(' · ')}</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-primary" role="timer">
            {whenText(data, now)}
          </p>
          <p className={`mt-1 font-bold tabular-nums ${data.prize > 0 ? 'text-palm' : 'text-muted'}`} data-testid="tournament-prize">
            {data.prize > 0 ? t('tournament.prize', { amount: format.tokens(data.prize) }) : t('tournament.noPrize')}
          </p>
          <p className="mt-1 text-sm text-muted">{t('tournament.page.by', { name: data.creator })}</p>
          <p className="mt-3 text-sm text-muted">{t(byRounds ? 'tournament.page.howRounds' : 'tournament.page.how')}</p>
          {data.prize > 0 && <p className="mt-1 text-sm text-muted">{t('tournament.page.split')}</p>}
        </section>

        {canJoin && (
          <Button className="min-h-14 text-lg" onClick={() => void act('join')} disabled={busy}>
            {t('tournament.page.join')}
          </Button>
        )}
        {!joined && live && byRounds && data.status !== 'scheduled' && <p className="text-sm text-muted">{t('tournament.page.closed')}</p>}

        {joined && live && (
          <section aria-live="polite" className="flex flex-col gap-3 border-2 border-line bg-panel p-4" data-testid="tournament-room" data-room={presence.room}>
            <p className="flex items-center gap-3 font-semibold">
              {running && !dropped && (byRounds ? myPairing?.result === null : asking) && <span className="size-5 shrink-0 animate-spin rounded-full border-4 border-line border-t-primary motion-reduce:animate-none" aria-hidden="true" />}
              {roomText}
            </p>
            {/* By time: the player asks for each game. By rounds: the system pairs; there is nothing to press. */}
            {running && !byRounds && now < data.endsAt && (
              <Button variant={asking ? 'ghost' : 'primary'} className="min-h-12" onClick={() => presence.askNext(!asking)}>
                {t(asking ? 'tournament.page.stop' : data.standings.find((row) => row.userId === user?.id)?.games ? 'tournament.page.next' : 'tournament.page.first')}
              </Button>
            )}
            {myGame && (
              <Link to={`/play/${data.gameId}/match/${myGame.matchId}`} className="font-semibold text-primary underline underline-offset-4">
                {t('lobby.returnToGame')}
              </Link>
            )}
          </section>
        )}
        {data.status === 'finished' && me && me.prize > 0 && <p className="border-2 border-ink bg-brand p-4 font-bold text-brand-ink">{t('tournament.page.youWon', { amount: format.tokens(me.prize) })}</p>}

        {live && (
          <section aria-labelledby="tournament-share">
            <h2 id="tournament-share" className="font-display text-xl font-semibold">
              {t('tournament.page.share')}
            </h2>
            <div className="mt-3">
              <ShareLink path={`/tournaments/${data.id}`} text={t('tournament.page.shareText', { game: gameName, name: data.name })} />
            </div>
          </section>
        )}
        {canCancel && (
          <Button variant="ghost" onClick={() => void act('cancel')} disabled={busy}>
            {t('tournament.page.cancel')}
          </Button>
        )}
      </div>

      <section aria-label={data.name} className="flex flex-col gap-3">
        <div className="flex gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'standings'} onClick={() => setTab('standings')} className={tabClass(tab === 'standings')}>
            {t('tournament.page.standings')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'games'} onClick={() => setTab('games')} className={tabClass(tab === 'games')} data-testid="tournament-games-tab">
            {t('tournament.page.games', { count: gamesCount })}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')} className={tabClass(tab === 'chat')}>
            {t('tournament.page.chat')}
          </button>
        </div>

        {tab === 'standings' &&
          (data.standings.length === 0 ? (
            <p className="text-muted">{t('tournament.page.nobody')}</p>
          ) : (
            <>
              <p className="text-sm text-muted">{t('tournament.players', { count: data.standings.length })}</p>
              <ol className="divide-y divide-line border-y border-line" data-testid="tournament-standings">
                {data.standings.map((row, index) => (
                  <li key={row.userId} className={`flex items-center gap-3 px-2 py-2.5 ${row.userId === user?.id ? 'bg-brand/30' : ''} ${row.dropped ? 'opacity-60' : ''}`}>
                    <span className="w-7 shrink-0 text-center font-display text-lg font-extrabold tabular-nums">{row.place ?? index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {row.countryCode && <span aria-hidden="true">{flagEmoji(row.countryCode)} </span>}
                        {row.name}
                      </span>
                      <span className="block text-xs tabular-nums text-muted">
                        {t('tournament.page.record', { wins: row.wins, draws: row.draws, losses: row.losses })}
                        {row.dropped && ` · ${t('tournament.page.out')}`}
                      </span>
                    </span>
                    {row.prize > 0 && <span className="shrink-0 text-sm font-bold tabular-nums text-palm">+{format.tokens(row.prize)}</span>}
                    <span className="w-10 shrink-0 text-end font-display text-xl font-extrabold tabular-nums" aria-label={t('tournament.page.points', { count: row.points })}>
                      {row.points}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ))}

        {tab === 'games' && (
          <div className="flex flex-col gap-4">
            {gamesCount === 0 ? (
              <p className="text-muted">{t(live ? 'tournament.page.noGames' : 'tournament.page.noGamesOver')}</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line" data-testid="tournament-games">
                {liveGames.data!.map((row) => (
                  <li key={row.matchId}>
                    {/* Any game can be opened and watched while it is played. */}
                    <Link to={`/play/${data.gameId}/match/${row.matchId}`} className="flex items-center gap-3 px-2 py-3">
                      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-hibiscus motion-reduce:animate-none" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-semibold">{row.players.join(' – ')}</span>
                      <span className="shrink-0 text-sm font-semibold text-primary underline underline-offset-4">{t('tournament.page.watch')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {byRounds && data.round > 0 && (pairings.data ?? []).length > 0 && (
              <div>
                <h3 className="font-semibold">{t('tournament.round', { round: data.round, rounds: data.rounds ?? 0 })}</h3>
                <ul className="mt-2 divide-y divide-line border-y border-line text-sm" data-testid="tournament-pairings">
                  {pairings.data!.map((p, index) => (
                    <li key={index} className="flex items-center justify-between gap-3 px-2 py-2">
                      <span className="min-w-0 truncate">{p.b ? `${nameOf(p.a)} – ${nameOf(p.b)}` : nameOf(p.a)}</span>
                      <span className="shrink-0 font-semibold text-muted">{t(`tournament.pairing.${p.result ?? (p.matchId ? 'playing' : 'waiting')}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && <Chat id={data.id} canWrite={joined || mine} />}
      </section>
    </div>
  )
}
