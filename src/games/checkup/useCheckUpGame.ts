import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import { canPlay, type Card, type Over, type Pending, type Seat, type Shape, type TableEvent } from '../../../supabase/functions/_shared/checkup'

// One online game of Check Up. The server holds the game, cards and all; this loads what this
// player may see (the table, and their own hand), listens for changes, and passes on what the
// player asks for. It is never sent anyone else's cards, and never decides anything: which
// card may be played is worked out here only to light up the player's own hand.
//
// A card the player plays is shown leaving their hand at once, so the game does not feel as if
// it waits on the network; if the server says no, it is put back.

/** The table as everyone at it sees it. */
export type TableView = {
  seats: Seat[]
  out: Seat[]
  /** How many cards each player holds. */
  counts: Record<Seat, number>
  marketCount: number
  top: Card
  called: Shape | null
  turn: Seat
  pending: Pending | null
  moveNo: number
  lastEvent: TableEvent | null
  /** Once it is over: why, who won, the counts, and the cards everyone held. */
  over: (Over & { hands?: Record<Seat, Card[]> }) | null
}

export type CheckUpPlayer = {
  userId: string
  seat: Seat
  name: string
  countryCode: string | null
  avatarUrl: string | null
  /** Games of Check Up this player has won. */
  wins: number
  ratingAfter: number | null
  tokensChange: number | null
}

type MatchRow = { status: string; result: string | null; winner_id: string | null; end_reason: string | null; options: unknown; stake_amount: number }
type GameRow = {
  seats: string[]
  out_seats: string[]
  counts: Record<string, number>
  market_count: number
  top: string
  called: string | null
  turn: string
  pending_number: number | null
  pending_count: number
  move_no: number
  last_event: unknown
  phase: string
  result: unknown
  deadline: string | null
}
type Snapshot = { match: MatchRow; players: CheckUpPlayer[]; view: TableView; deadline: number | null; hand: Card[] }

const toView = (row: GameRow): TableView => ({
  seats: row.seats,
  out: row.out_seats ?? [],
  counts: row.counts ?? {},
  marketCount: row.market_count,
  top: row.top,
  called: (row.called as Shape | null) ?? null,
  turn: row.turn,
  pending: row.pending_number ? { number: row.pending_number as 2 | 5, count: row.pending_count } : null,
  moveNo: row.move_no,
  lastEvent: (row.last_event as TableEvent | null) ?? null,
  over: row.phase === 'over' ? ((row.result as TableView['over']) ?? { reason: 'last_standing', winner: null, totals: {} }) : null,
})

const GAME_COLUMNS = 'seats, out_seats, counts, market_count, top, called, turn, pending_number, pending_count, move_no, last_event, phase, result, deadline'
const RELOAD_AFTER = new Set(['SERVER_ERROR', 'OUT_OF_SYNC', 'GAME_OVER', 'NOT_YOUR_TURN', 'CARD_NOT_ALLOWED', 'NOT_YOUR_CARD', 'CORRUPT_GAME'])
const CLAIM_EVERY_MS = 3000

let channelSeq = 0

export function useCheckUpGame(matchId: string) {
  const { user } = useAuth()
  const userId = user?.id
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')
  const [connected, setConnected] = useState(true)
  const [busy, setBusy] = useState(false)
  /** The player's own card, shown as played while the server is deciding. */
  const [early, setEarly] = useState<{ moveNo: number; card: Card; call: Shape | null } | null>(null)
  /** Server time minus this device's time, in milliseconds. */
  const offset = useRef(0)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const sentAt = Date.now()
      const [match, game, hand, time] = await Promise.all([
        supabase
          .from('matches')
          .select('status, result, winner_id, end_reason, options, stake_amount, match_players (user_id, seat, rating_after, tokens_change, profiles (username, display_name, country_code, avatar_url))')
          .eq('id', matchId)
          .maybeSingle(),
        supabase.from('checkup_games').select(GAME_COLUMNS).eq('match_id', matchId).maybeSingle(),
        // The access rules give back this player's own row and nobody else's.
        supabase.from('checkup_hands').select('cards').eq('match_id', matchId).maybeSingle(),
        supabase.rpc('server_now'),
      ])
      if (seq !== loadSeq.current) return
      if (match.error || game.error || hand.error) throw match.error ?? game.error ?? hand.error
      if (!match.data || !game.data) return setStatus('not_found')
      // Half the round trip is the best estimate of when the server read its clock.
      if (!time.error && time.data) offset.current = Date.parse(time.data) - (sentAt + Date.now()) / 2

      const { match_players, ...matchRow } = match.data
      const won = await supabase.from('player_ratings').select('user_id, wins').eq('game_type', 'checkup').in('user_id', match_players.map((p) => p.user_id))
      if (seq !== loadSeq.current) return
      const wins = new Map((won.data ?? []).map((row) => [row.user_id, row.wins]))
      const players: CheckUpPlayer[] = match_players.map((p) => ({
        userId: p.user_id,
        seat: p.seat,
        name: p.profiles?.display_name ?? p.profiles?.username ?? '?',
        countryCode: p.profiles?.country_code ?? null,
        avatarUrl: p.profiles?.avatar_url ?? null,
        wins: wins.get(p.user_id) ?? 0,
        ratingAfter: p.rating_after,
        tokensChange: p.tokens_change,
      }))
      const row = game.data as GameRow
      setSnapshot({ match: matchRow, players, view: toView(row), deadline: row.deadline ? Date.parse(row.deadline) : null, hand: (hand.data?.cards as Card[] | undefined) ?? [] })
      setStatus('ready')
    } catch {
      if (seq !== loadSeq.current) return
      // Keep showing what we have; only a first load with nothing to show is an error screen.
      setStatus((current) => (current === 'ready' ? current : 'error'))
    }
  }, [matchId])

  // Live updates. Every (re)connect reloads the whole game, so nothing missed while away is lost.
  useEffect(() => {
    setStatus('loading')
    setSnapshot(null)
    const channel = supabase
      .channel(`checkup:${matchId}:${++channelSeq}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'checkup_games', filter: `match_id=eq.${matchId}` }, (payload) => {
        const row = payload.new as GameRow
        setSnapshot((prev) => (prev && row.move_no > prev.view.moveNo ? { ...prev, view: toView(row), deadline: row.deadline ? Date.parse(row.deadline) : null } : prev))
        // The table and the hand are two rows: the hand is fetched again with every change, so
        // the two can never be shown out of step for more than a moment.
        void load()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (payload) => {
        const row = payload.new as MatchRow
        setSnapshot((prev) => (prev ? { ...prev, match: { ...prev.match, status: row.status, result: row.result, winner_id: row.winner_id, end_reason: row.end_reason } } : prev))
        // The game is over: fetch what settlement wrote (tokens won or lost).
        if (row.status !== 'active') void load()
      })
      .subscribe((state) => {
        setConnected(state === 'SUBSCRIBED')
        if (state === 'SUBSCRIBED') void load()
      })

    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      loadSeq.current++
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [matchId, load])

  const live = useRef(snapshot)
  live.current = snapshot

  const act = useCallback(
    async (action: 'play' | 'draw' | 'leave' | 'claim', card?: Card, call?: Shape) => {
      const quiet = action === 'claim'
      const now = live.current
      if (!now) return
      if (!quiet) setBusy(true)
      // Only a card the rules allow is shown early; anything else simply waits for the server.
      if (action === 'play' && card && now.hand.includes(card) && canPlay(now.view, card)) setEarly({ moveNo: now.view.moveNo, card, call: call ?? null })
      try {
        const reply = await callFunction('checkup-action', { match_id: matchId, action, move_no: now.view.moveNo, ...(card ? { card } : {}), ...(call ? { call } : {}) })
        if (!reply.ok) {
          if (!quiet && reply.code !== 'OUT_OF_SYNC') toast.error(refusalMessage(reply.code))
          setEarly(null)
          if (RELOAD_AFTER.has(reply.code)) void load()
        } else {
          // The new state normally arrives by itself a moment later. Asking for it as well costs
          // one small request and means a lost message can never leave the table stuck.
          void load()
        }
      } catch {
        if (!quiet) toast.error(i18n.t('errors.network'))
        setEarly(null)
      } finally {
        if (!quiet) setBusy(false)
      }
    },
    [matchId, load],
  )

  const me = snapshot?.players.find((p) => p.userId === userId) ?? null
  const open = snapshot !== null && snapshot.view.over === null && snapshot.match.status === 'active'

  // The early picture lasts only until the server's own state for that move arrives.
  let view = snapshot?.view ?? null
  let hand = snapshot?.hand ?? []
  if (snapshot && view && early && me && early.moveNo === view.moveNo) {
    const at = hand.indexOf(early.card)
    if (at >= 0) hand = [...hand.slice(0, at), ...hand.slice(at + 1)]
    // Half a move ahead: the table shows (and flies) the card now; the server's own move, when
    // it arrives, is the whole number after it.
    view = { ...view, top: early.card, called: early.call, counts: { ...view.counts, [me.seat]: hand.length }, moveNo: view.moveNo + 0.5, lastEvent: { seat: me.seat, kind: 'play', card: early.card, ...(early.call ? { call: early.call } : {}) } }
  }

  /** The turn deadline on this device's clock, while the game is on. */
  const deadline = open && snapshot.deadline ? snapshot.deadline - offset.current : null

  // When the clock has run out, any player's app asks the server to act on it. (The server
  // also checks on its own; this just makes it prompt.)
  useEffect(() => {
    if (!me || deadline === null) return
    let timer: ReturnType<typeof setTimeout>
    const check = () => {
      const late = Date.now() - deadline
      if (late > 500) void act('claim')
      timer = setTimeout(check, late > 0 ? CLAIM_EVERY_MS : Math.min(-late + 600, 30_000))
    }
    timer = setTimeout(check, Math.max(600, deadline - Date.now() + 600))
    return () => clearTimeout(timer)
  }, [me, deadline, act])

  // A second net under live updates: every few seconds, while the game is on and on screen, ask
  // only for the move number, and fetch the game if it has moved on without us.
  useEffect(() => {
    if (!open) return
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data } = await supabase.from('checkup_games').select('move_no').eq('match_id', matchId).maybeSingle()
        if (data && data.move_no > (live.current?.view.moveNo ?? 0)) void load()
      } catch {
        // Offline for a moment: the reconnect reloads everything anyway.
      }
    }, 6000)
    return () => clearInterval(id)
  }, [open, matchId, load])

  return {
    status,
    connected,
    busy,
    match: snapshot?.match ?? null,
    players: snapshot?.players ?? [],
    view,
    hand,
    mySeat: me?.seat ?? null,
    deadline,
    play: (card: Card, call?: Shape) => void act('play', card, call),
    draw: () => void act('draw'),
    leave: () => void act('leave'),
    reload: load,
  }
}
