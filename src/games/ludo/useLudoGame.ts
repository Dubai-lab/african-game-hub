import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import type { Seat } from './board'
import type { LudoEvent, LudoState } from './rules'

// One online Ludo match. The server holds the game; this loads it, listens for changes, and
// passes on what the player asks for. It never rolls a die or moves a piece by itself.

export type LudoPlayer = {
  userId: string
  seat: Seat
  name: string
  countryCode: string | null
  rating: number | null
  /** Games of Ludo this player has won. */
  wins: number
  ratingAfter: number | null
  tokensChange: number | null
}


type MatchRow = { status: string; result: string | null; winner_id: string | null; end_reason: string | null; options: unknown; stake_amount: number }
type GameRow = {
  positions: unknown
  turn: string
  phase: string
  dice: unknown
  rolled: unknown
  dice_count: number
  teams: unknown
  capture_home: boolean
  turn_no: number
  deadline: string | null
  last_event: unknown
  places: unknown
  gone: unknown
}
type Snapshot = { match: MatchRow; players: LudoPlayer[]; game: LudoState }

const toState = (row: GameRow): LudoState => ({
  positions: row.positions as LudoState['positions'],
  turn: row.turn as Seat,
  phase: row.phase as LudoState['phase'],
  dice: (row.dice as number[] | null) ?? [],
  rolled: (row.rolled as number[] | null) ?? [],
  diceCount: row.dice_count ?? 1,
  teams: (row.teams as LudoState['teams'] | null) ?? {},
  lay: Boolean(row.capture_home),
  turnNo: row.turn_no,
  deadline: row.deadline ? Date.parse(row.deadline) : null,
  lastEvent: (row.last_event as LudoEvent | null) ?? null,
  places: (row.places as Seat[] | null) ?? [],
  gone: (row.gone as Seat[] | null) ?? [],
})

const GAME_COLUMNS = 'positions, teams, capture_home, turn, phase, dice, rolled, dice_count, turn_no, deadline, last_event, places, gone'
const RELOAD_AFTER = new Set(['OUT_OF_SYNC', 'GAME_OVER', 'NOT_YOUR_TURN', 'ILLEGAL_MOVE'])
const CLAIM_EVERY_MS = 3000

let channelSeq = 0

export function useLudoGame(matchId: string) {
  const { user } = useAuth()
  const userId = user?.id
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')
  const [connected, setConnected] = useState(true)
  const [busy, setBusy] = useState(false)
  /** Server time minus this device's time, in milliseconds. */
  const offset = useRef(0)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const sentAt = Date.now()
      const [match, game, time] = await Promise.all([
        supabase
          .from('matches')
          .select(
            'status, result, winner_id, end_reason, options, stake_amount, match_players (user_id, seat, rating_before, rating_after, tokens_change, profiles (username, display_name, country_code))',
          )
          .eq('id', matchId)
          .maybeSingle(),
        supabase.from('ludo_games').select(GAME_COLUMNS).eq('match_id', matchId).maybeSingle(),
        supabase.rpc('server_now'),
      ])
      if (seq !== loadSeq.current) return
      if (match.error || game.error) throw match.error ?? game.error
      if (!match.data || !game.data) return setStatus('not_found')
      // Half the round trip is the best estimate of when the server read its clock.
      if (!time.error && time.data) offset.current = Date.parse(time.data) - (sentAt + Date.now()) / 2

      const { match_players, ...matchRow } = match.data
      // What a Ludo player is known by: the games they have won.
      const won = await supabase.from('player_ratings').select('user_id, wins').eq('game_type', 'ludo').in('user_id', match_players.map((p) => p.user_id))
      if (seq !== loadSeq.current) return
      const wins = new Map((won.data ?? []).map((row) => [row.user_id, row.wins]))
      const players: LudoPlayer[] = match_players.map((p) => ({
        userId: p.user_id,
        seat: p.seat as Seat,
        name: p.profiles?.display_name ?? p.profiles?.username ?? '?',
        countryCode: p.profiles?.country_code ?? null,
        rating: p.rating_before,
        wins: wins.get(p.user_id) ?? 0,
        ratingAfter: p.rating_after,
        tokensChange: p.tokens_change,
      }))
      setSnapshot({ match: matchRow, players, game: toState(game.data as GameRow) })
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
      .channel(`ludo:${matchId}:${++channelSeq}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ludo_games', filter: `match_id=eq.${matchId}` }, (payload) => {
        const next = toState(payload.new as GameRow)
        // One action on the server writes this row more than once before it is finished, and
        // only the last write carries the new turn number. Anything else is a half-done state
        // and is not shown.
        setSnapshot((prev) => (prev && next.turnNo > prev.game.turnNo ? { ...prev, game: next } : prev))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (payload) => {
        const row = payload.new as MatchRow
        setSnapshot((prev) =>
          prev ? { ...prev, match: { ...prev.match, status: row.status, result: row.result, winner_id: row.winner_id, end_reason: row.end_reason } } : prev,
        )
        // The game is over: fetch what settlement wrote (tokens won or lost, new ratings).
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
    async (action: 'roll' | 'move' | 'resign' | 'claim', move?: { color: Seat; piece: number; die: number | null; full: boolean }) => {
      const quiet = action === 'claim'
      if (!quiet) setBusy(true)
      try {
        const reply = await callFunction('ludo-action', {
          match_id: matchId,
          action,
          ...(move ? { color: move.color, piece: move.piece, full: move.full, ...(move.die === null ? {} : { die: move.die }) } : {}),
          turn_no: live.current?.game.turnNo ?? 0,
        })
        if (!reply.ok) {
          if (!quiet && reply.code !== 'OUT_OF_SYNC') toast.error(refusalMessage(reply.code))
          if (RELOAD_AFTER.has(reply.code)) void load()
        } else {
          // The new state normally arrives by itself a moment later. Asking for it as well costs
          // one small request and means a lost message can never leave the table stuck.
          void load()
        }
      } catch {
        if (!quiet) toast.error(i18n.t('errors.network'))
      } finally {
        if (!quiet) setBusy(false)
      }
    },
    [matchId, load],
  )

  const me = snapshot?.players.find((p) => p.userId === userId) ?? null
  /** The turn deadline on this device's clock, while the table is open. */
  const deadline = snapshot && snapshot.game.phase !== 'over' && snapshot.game.deadline ? snapshot.game.deadline - offset.current : null

  // When the clock has run out, either player's app asks the server to act on it. (The server
  // also checks on its own every few seconds; this just makes it prompt.)
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

  // A second net under live updates: every few seconds, while the table is open and on screen,
  // ask only for the turn number, and fetch the game if it has moved on without us.
  const open = snapshot !== null && snapshot.game.phase !== 'over'
  useEffect(() => {
    if (!open) return
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data } = await supabase.from('ludo_games').select('turn_no').eq('match_id', matchId).maybeSingle()
        if (data && data.turn_no > (live.current?.game.turnNo ?? 0)) void load()
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
    game: snapshot?.game ?? null,
    mySeat: me?.seat ?? null,
    deadline,
    roll: () => void act('roll'),
    move: (move: { color: Seat; piece: number; die: number | null; full: boolean }) => void act('move', move),
    resign: () => void act('resign'),
    reload: load,
  }
}
