import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, type FunctionReply, refusalMessage } from '@/core/lib/functions'
import { type GameLink, openGameLink } from '@/core/lib/gameServer'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import type { LastShot } from './PoolTable'
import { type Ball, type PoolState, rack, type Seat, type Shot, type Variant } from '../../../supabase/functions/_shared/pool'

// One online pool match. The server holds the game and plays out every shot; this loads it,
// listens for changes, and passes on what the player asks for.
//
// Where there is a game server, shots also travel over one open connection to it, which is
// much quicker: it plays the shot out with the same rules, shows it to the opponent at once and
// records it with the same database function. Whenever that connection is not there, the Edge
// Function is used, as before.

export type PoolPlayer = {
  userId: string
  seat: Seat
  name: string
  countryCode: string | null
  rating: number | null
  /** Games of this kind of pool the player has won. */
  wins: number
  ratingAfter: number | null
  tokensChange: number | null
}

export type PoolGame = PoolState & {
  shotNo: number
  /** Server time by which the player to shoot must shoot, in milliseconds; null once it is over. */
  deadline: number | null
  over: boolean
  lastShot: LastShot | null
}

type MatchRow = { rating_pool: string; status: string; result: string | null; winner_id: string | null; end_reason: string | null; options: unknown; stake_amount: number }
type GameRow = {
  variant: string
  balls: unknown
  turn: string
  break_shot: boolean
  ball_in_hand: boolean
  solids_seat: string | null
  fouls: unknown
  shot_no: number
  deadline: string | null
  phase: string
  last_shot: unknown
}
type Snapshot = { match: MatchRow; players: PoolPlayer[]; game: PoolGame }

function toGame(row: GameRow): PoolGame {
  const variant = row.variant as Variant
  const stored = (row.balls as Ball[] | null) ?? []
  const fouls = (row.fouls as Record<string, number> | null) ?? {}
  const last = row.last_shot as (Omit<LastShot, 'seat'> & { seat: string }) | null
  return {
    variant,
    // Until the break, the table is the rack.
    balls: stored.length > 0 ? stored : rack(variant),
    turn: Number(row.turn) as Seat,
    breakShot: row.break_shot,
    ballInHand: row.ball_in_hand,
    solidsSeat: row.solids_seat ? (Number(row.solids_seat) as Seat) : null,
    fouls: [fouls['1'] ?? 0, fouls['2'] ?? 0],
    shotNo: row.shot_no,
    deadline: row.deadline ? Date.parse(row.deadline) : null,
    over: row.phase === 'over',
    lastShot: last ? { ...last, seat: Number(last.seat) as Seat, from: last.from ?? null } : null,
  }
}

const COLUMNS = 'variant, balls, turn, break_shot, ball_in_hand, solids_seat, fouls, shot_no, deadline, phase, last_shot'
const RELOAD_AFTER = new Set(['SERVER_ERROR', 'OUT_OF_SYNC', 'GAME_OVER', 'NOT_YOUR_TURN', 'ILLEGAL_SHOT'])
const CLAIM_EVERY_MS = 3000

let channelSeq = 0

export function usePoolGame(matchId: string) {
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
            'rating_pool, status, result, winner_id, end_reason, options, stake_amount, match_players (user_id, seat, rating_before, rating_after, tokens_change, profiles (username, display_name, country_code))',
          )
          .eq('id', matchId)
          .maybeSingle(),
        supabase.from('pool_games').select(COLUMNS).eq('match_id', matchId).maybeSingle(),
        supabase.rpc('server_now'),
      ])
      if (seq !== loadSeq.current) return
      if (match.error || game.error) throw match.error ?? game.error
      if (!match.data || !game.data) return setStatus('not_found')
      // Half the round trip is the best estimate of when the server read its clock.
      if (!time.error && time.data) offset.current = Date.parse(time.data) - (sentAt + Date.now()) / 2

      const { match_players, ...matchRow } = match.data
      // Players are shown by the games they have won (8-ball and 9-ball are counted apart).
      const won = await supabase.from('player_ratings').select('user_id, wins').eq('game_type', 'pool').eq('pool', matchRow.rating_pool).in('user_id', match_players.map((p) => p.user_id))
      if (seq !== loadSeq.current) return
      const wins = new Map((won.data ?? []).map((row) => [row.user_id, row.wins]))
      const players: PoolPlayer[] = match_players.map((p) => ({
        userId: p.user_id,
        seat: Number(p.seat) as Seat,
        name: p.profiles?.display_name ?? p.profiles?.username ?? '?',
        countryCode: p.profiles?.country_code ?? null,
        rating: p.rating_before,
        wins: wins.get(p.user_id) ?? 0,
        ratingAfter: p.rating_after,
        tokensChange: p.tokens_change,
      }))
      setSnapshot({ match: matchRow, players, game: toGame(game.data as GameRow) })
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
      .channel(`pool:${matchId}:${++channelSeq}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pool_games', filter: `match_id=eq.${matchId}` }, (payload) => {
        const next = toGame(payload.new as GameRow)
        // Only a newer shot (or the game ending) replaces what is on screen.
        setSnapshot((prev) => (prev && (next.shotNo > prev.game.shotNo || (next.over && !prev.game.over)) ? { ...prev, game: next } : prev))
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

  // The quick road, for the two players while the game is on.
  const link = useRef<GameLink | null>(null)
  const seated = snapshot?.players.some((p) => p.userId === userId) ?? false
  const playing = seated && snapshot !== null && !snapshot.game.over && snapshot.match.status === 'active'
  useEffect(() => {
    if (!playing) return
    const opened = openGameLink('pool', matchId, {
      // The server holds a different shot number than we do: one of us is behind.
      onReady: (shotNo) => {
        if (shotNo !== (live.current?.game.shotNo ?? 0)) void load()
      },
      onMessage: (message) => {
        if (message.t === 'move' && typeof message.ply === 'number') {
          // The opponent's shot, straight from the server: what was asked, where it was played
          // from, what the rules made of it, and the table afterwards.
          const told = message as unknown as {
            ply: number
            seat: string
            shot: Shot
            result: LastShot['result'] & { winner?: unknown }
            from: Ball[]
            state: { balls: Ball[]; turn: string; breakShot: boolean; ballInHand: boolean; solidsSeat: string | null; fouls: [number, number] }
            deadline: string | null
          }
          setSnapshot((prev) =>
            prev && told.ply > prev.game.shotNo
              ? {
                  ...prev,
                  game: {
                    ...prev.game,
                    balls: told.state.balls,
                    turn: Number(told.state.turn) as Seat,
                    breakShot: told.state.breakShot,
                    ballInHand: told.state.ballInHand,
                    solidsSeat: told.state.solidsSeat ? (Number(told.state.solidsSeat) as Seat) : null,
                    fouls: told.state.fouls,
                    shotNo: told.ply,
                    deadline: told.deadline ? Date.parse(told.deadline) : null,
                    over: told.result.winner !== null && told.result.winner !== undefined,
                    lastShot: { no: told.ply - 1, seat: Number(told.seat) as Seat, shot: told.shot, from: told.from, result: { ...told.result, winner: told.result.winner ? (Number(told.result.winner) as Seat) : null } },
                  },
                }
              : prev,
          )
        } else if (message.t === 'revert' || message.t === 'restarting') {
          // A shot was taken back, or the server is going away: the database has the truth.
          void load()
        }
      },
    })
    link.current = opened
    return () => {
      opened?.close()
      link.current = null
    }
  }, [playing, matchId, load])

  /** Sends a request to the server. Resolves true when it was accepted. */
  const act = useCallback(
    async (action: 'shoot' | 'resign' | 'claim', shot?: Shot): Promise<boolean> => {
      const quiet = action === 'claim'
      if (!quiet) setBusy(true)
      try {
        const shotNo = live.current?.game.shotNo ?? 0
        // A shot goes over the open connection when there is one; everything else, and every
        // shot when there is not, through the Edge Function.
        const server = action === 'shoot' && shot && link.current?.ready ? link.current : null
        let reply: FunctionReply<Record<string, never>>
        if (server) {
          try {
            reply = await server.request<FunctionReply<Record<string, never>>>({ t: 'move', ply: shotNo, shot })
          } catch (error) {
            // The connection dropped with the shot in the air: the database knows whether it counted.
            void load()
            throw error
          }
        } else {
          reply = await callFunction('pool-action', { match_id: matchId, action, shot_no: shotNo, ...(shot ? { shot } : {}) })
        }
        if (!reply.ok) {
          if (!quiet && reply.code !== 'OUT_OF_SYNC') toast.error(refusalMessage(reply.code))
          if (RELOAD_AFTER.has(reply.code)) void load()
          return false
        }
        // The new state normally arrives by itself a moment later; asking for it as well means
        // a lost message can never leave the table stuck.
        void load()
        return true
      } catch {
        if (!quiet) toast.error(i18n.t('errors.network'))
        return false
      } finally {
        if (!quiet) setBusy(false)
      }
    },
    [matchId, load],
  )

  const me = snapshot?.players.find((p) => p.userId === userId) ?? null
  const open = snapshot !== null && !snapshot.game.over && snapshot.match.status === 'active'
  /** The shot deadline on this device's clock. */
  const deadline = open && snapshot.game.deadline ? snapshot.game.deadline - offset.current : null

  // When the clock has run out, either player's app asks the server to act on it.
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

  // A second net under live updates: every few seconds ask only for the shot number.
  useEffect(() => {
    if (!open) return
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data } = await supabase.from('pool_games').select('shot_no, phase').eq('match_id', matchId).maybeSingle()
        if (data && (data.shot_no > (live.current?.game.shotNo ?? 0) || data.phase === 'over')) void load()
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
    shoot: (shot: Shot) => act('shoot', shot),
    resign: () => void act('resign'),
    reload: load,
  }
}
