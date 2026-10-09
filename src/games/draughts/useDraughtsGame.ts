import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, type FunctionReply, refusalMessage } from '@/core/lib/functions'
import { type GameLink, openGameLink } from '@/core/lib/gameServer'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import { type ClockState, remainingMs, TENTHS_BELOW_MS } from '@/games/chess/engine/clock'
import { applyMove, type Color, replay } from '../../../supabase/functions/_shared/draughts'
import { feedback } from './sound'
import type { DraughtsController, Outcome } from './useLocalDraughtsGame'

// An online game of draughts as the app sees it. The database is the game; this only mirrors it.
//
//  - The whole game is loaded from the database when the screen opens, and loaded again every
//    time the live connection (re)connects or the app returns to the foreground. That is what
//    keeps a game from drifting after a dropped connection.
//  - Between loads, tiny live messages keep it current: one row per move, plus the clocks.
//  - Where there is a game server, moves also travel over one open connection to it, which is
//    much quicker. It records each move with the same database function, and whenever that
//    connection is not there the Edge Function is used.
//  - The player's own move is shown at once and then confirmed by the server, or taken back.
//  - Clocks are drawn from the server's values and the measured difference between this
//    device's time and the server's. The device never decides that time has run out; it can
//    only ask the server to check.

export type OnlinePlayer = {
  userId: string
  color: Color
  name: string
  countryCode: string | null
  rating: number | null
  /** Set once the match has been settled. */
  ratingAfter: number | null
  tokensChange: number | null
}

type GameRow = { ply: number; turn: Color; white_time_ms: number; black_time_ms: number; increment_ms: number; last_move_at: string; draw_offer_by: string | null }
type MatchRow = { status: string; result: string | null; winner_id: string | null; end_reason: string | null; options: unknown; stake_amount: number }
type Snapshot = { match: MatchRow; players: OnlinePlayer[]; game: GameRow; paths: number[][] }
type MoveReply = { ply: number; white_time_ms: number; black_time_ms: number; last_move_at: string; finished: boolean }

const COLUMNS = 'ply, turn, white_time_ms, black_time_ms, increment_ms, last_move_at, draw_offer_by'
const CLAIM_EVERY_MS = 3000
// Refusals after which the app's picture of the game is clearly out of date.
const RELOAD_AFTER = new Set(['SERVER_ERROR', 'OUT_OF_SYNC', 'GAME_OVER', 'TIME_OUT', 'ABORTED', 'NOT_YOUR_TURN', 'ILLEGAL_MOVE', 'CORRUPT_GAME'])
const EMPTY = replay([])!

let channelSeq = 0

export function useDraughtsGame(matchId: string) {
  const { user } = useAuth()
  const userId = user?.id

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')
  const [pending, setPending] = useState<{ path: number[]; ply: number } | null>(null)
  const [connected, setConnected] = useState(true)
  const [abortSeconds, setAbortSeconds] = useState(30)
  /** Server time minus this device's time, in milliseconds. */
  const offset = useRef(0)
  const loadSeq = useRef(0)
  const live = useRef<{ snapshot: Snapshot | null; pending: typeof pending }>({ snapshot: null, pending: null })
  live.current = { snapshot, pending }

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const sentAt = Date.now()
      const [match, game, moves, time] = await Promise.all([
        supabase
          .from('matches')
          .select(
            'status, result, winner_id, end_reason, options, stake_amount, match_players (user_id, seat, rating_before, rating_after, tokens_change, profiles (username, display_name, country_code))',
          )
          .eq('id', matchId)
          .maybeSingle(),
        supabase.from('draughts_games').select(COLUMNS).eq('match_id', matchId).maybeSingle(),
        supabase.from('draughts_moves').select('ply, path').eq('match_id', matchId).order('ply'),
        supabase.rpc('server_now'),
      ])
      if (seq !== loadSeq.current) return
      if (match.error || game.error || moves.error) throw match.error ?? game.error ?? moves.error
      if (!match.data || !game.data) return setStatus('not_found')

      // Half the round trip is the best estimate of when the server read its clock.
      if (!time.error && time.data) offset.current = Date.parse(time.data) - (sentAt + Date.now()) / 2

      const { match_players, ...matchRow } = match.data
      const players: OnlinePlayer[] = match_players.map((p) => ({
        userId: p.user_id,
        color: p.seat === 'white' ? 'w' : 'b',
        name: p.profiles?.display_name ?? p.profiles?.username ?? '?',
        countryCode: p.profiles?.country_code ?? null,
        rating: p.rating_before,
        ratingAfter: p.rating_after,
        tokensChange: p.tokens_change,
      }))
      const paths = moves.data.map((m) => m.path as number[])
      setSnapshot({ match: matchRow, players, game: game.data as GameRow, paths })
      setPending((current) => (current && paths.length >= current.ply ? null : current))
      setStatus('ready')
    } catch {
      if (seq !== loadSeq.current) return
      // Keep showing what we have; only a first load with nothing to show is an error screen.
      setStatus((current) => (current === 'ready' ? current : 'error'))
    }
  }, [matchId])

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('first_move_abort_seconds')
      .single()
      .then(({ data }) => {
        if (data) setAbortSeconds(data.first_move_abort_seconds)
      })
  }, [])

  /** A move heard about from elsewhere (the database's live messages, or the game server). */
  const addMove = useCallback(
    (row: { ply: number; path: number[] }) => {
      const current = live.current.snapshot
      if (!current) return
      if (row.ply === current.paths.length + 1) {
        setSnapshot((prev) => (prev && row.ply === prev.paths.length + 1 ? { ...prev, paths: [...prev.paths, row.path] } : prev))
        setPending((p) => (p && p.ply <= row.ply ? null : p))
      } else if (row.ply > current.paths.length + 1) {
        // A move went missing in between: do not guess, reload.
        void load()
      }
    },
    [load],
  )

  // Live updates. Every (re)connect reloads the full game, so nothing missed while away is lost.
  useEffect(() => {
    setStatus('loading')
    setSnapshot(null)
    setPending(null)
    const channel = supabase
      .channel(`draughts:${matchId}:${++channelSeq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'draughts_moves', filter: `match_id=eq.${matchId}` }, (payload) => {
        addMove(payload.new as { ply: number; path: number[] })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'draughts_games', filter: `match_id=eq.${matchId}` }, (payload) => {
        const row = payload.new as GameRow
        setSnapshot((prev) => (prev && row.ply >= prev.game.ply ? { ...prev, game: { ...prev.game, ...row } } : prev))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (payload) => {
        const row = payload.new as MatchRow
        setSnapshot((prev) => (prev ? { ...prev, match: { ...prev.match, status: row.status, result: row.result, winner_id: row.winner_id, end_reason: row.end_reason } } : prev))
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
  }, [matchId, load, addMove])

  // ---- What the table shows ----

  const me = snapshot?.players.find((p) => p.userId === userId) ?? null
  const myColor = me?.color ?? null

  // The quick road, for the two players while the game is on: the opponent's move arrives here
  // a moment before the database's own message (which is then recognised as already known).
  const link = useRef<GameLink | null>(null)
  const playing = myColor !== null && snapshot?.match.status === 'active'
  useEffect(() => {
    if (!playing) return
    const opened = openGameLink('draughts', matchId, {
      // The server holds a different number of moves than we do: one of us is behind.
      onReady: (ply) => {
        if (ply !== (live.current.snapshot?.paths.length ?? 0)) void load()
      },
      onMessage: (message) => {
        if (message.t === 'move' && typeof message.ply === 'number' && Array.isArray(message.path)) {
          addMove({ ply: message.ply, path: message.path as number[] })
        } else if (message.t === 'clock' && typeof message.ply === 'number') {
          const row = message as unknown as { ply: number; white_time_ms: number; black_time_ms: number; last_move_at: string }
          setSnapshot((prev) =>
            prev && row.ply >= prev.game.ply
              ? { ...prev, game: { ...prev.game, ply: row.ply, turn: row.ply % 2 === 0 ? 'w' : 'b', white_time_ms: row.white_time_ms, black_time_ms: row.black_time_ms, last_move_at: row.last_move_at, draw_offer_by: null } }
              : prev,
          )
        } else if (message.t === 'revert' || message.t === 'restarting') {
          // A move was taken back, or the server is going away: the database has the truth.
          void load()
        }
      },
    })
    link.current = opened
    return () => {
      opened?.close()
      link.current = null
    }
  }, [playing, matchId, load, addMove])

  const paths = useMemo(() => {
    if (!snapshot) return []
    return pending && pending.ply === snapshot.paths.length + 1 ? [...snapshot.paths, pending.path] : snapshot.paths
  }, [snapshot, pending])

  const position = useMemo(() => replay(paths), [paths])
  // Moves that do not replay mean our copy is damaged: fetch a clean one.
  useEffect(() => {
    if (!position && snapshot) void load()
  }, [position, snapshot, load])

  const { state, played } = position ?? EMPTY
  const active = snapshot?.match.status === 'active'

  const outcome = useMemo<Outcome | null>(() => {
    const match = snapshot?.match
    if (!match || match.status === 'active' || match.status === 'waiting') return null
    if (match.status === 'aborted') return { winner: null, reason: match.end_reason === 'admin_abort' ? 'called_off' : 'aborted' }
    const winner = snapshot.players.find((p) => p.userId === match.winner_id)?.color ?? null
    return { winner: match.result === 'win' ? winner : null, reason: match.end_reason ?? 'other' }
  }, [snapshot])

  const clock = useMemo<ClockState>(() => {
    const game = snapshot?.game
    if (!game) return { whiteMs: 0, blackMs: 0, incrementMs: 0, running: null, since: null }
    // A clock runs once both players have made their first move; while our own move is on its
    // way to the server both are held still for that moment.
    const running = active && game.ply >= 2 && !pending ? game.turn : null
    return { whiteMs: game.white_time_ms, blackMs: game.black_time_ms, incrementMs: game.increment_ms, running, since: running ? Date.parse(game.last_move_at) - offset.current : null }
  }, [snapshot, active, pending])

  /** Before both players have moved: who must move, and by when (this device's time). */
  const firstMove = useMemo(() => {
    const game = snapshot?.game
    if (!game || !active || game.ply >= 2) return null
    return { color: game.turn, deadline: Date.parse(game.last_move_at) - offset.current + abortSeconds * 1000 }
  }, [snapshot, active, abortSeconds])

  const drawOfferBy = useMemo<Color | null>(() => {
    const by = snapshot?.game.draw_offer_by
    return by ? (snapshot.players.find((p) => p.userId === by)?.color ?? null) : null
  }, [snapshot])

  // Sounds for the opponent's moves and for the end of the game (our own moves sound at once).
  const heard = useRef<{ match: string; plies: number; over: boolean } | null>(null)
  useEffect(() => {
    if (status !== 'ready') return
    const over = outcome !== null
    const previous = heard.current
    heard.current = { match: matchId, plies: played.length, over }
    if (!previous || previous.match !== matchId) return
    const last = played.at(-1)
    if (played.length > previous.plies && last && last.color !== myColor) feedback(last.promoted ? 'promote' : last.captures.length > 0 ? 'capture' : 'move')
    if (over && !previous.over) setTimeout(() => feedback('gameEnd'), 250)
  }, [status, matchId, played, outcome, myColor])

  // ---- What the player can do ----

  const tryMove = useCallback(
    (path: number[]): boolean => {
      const current = live.current.snapshot
      if (!current || live.current.pending || current.match.status !== 'active' || !myColor) return false
      const stored = replay(current.paths)
      // Whose turn it is comes from the moves themselves (the clock row is a separate message).
      if (!stored || stored.state.turn !== myColor) return false
      const step = applyMove(stored.state, path)
      if (!step) return false

      // Shown immediately; the server has the final say.
      const ply = current.paths.length + 1
      setPending({ path: step.move.path, ply })
      feedback(step.move.promoted ? 'promote' : step.move.captures.length > 0 ? 'capture' : 'move')

      const takeBack = (message: string) => {
        setPending((p) => (p && p.ply === ply ? null : p))
        toast.info(message)
      }
      // Over the open connection when there is one; otherwise the Edge Function, as always.
      const server = link.current?.ready ? link.current : null
      const sent: Promise<FunctionReply<MoveReply>> = server
        ? server.request<FunctionReply<MoveReply>>({ t: 'move', path: step.move.path, ply: ply - 1 })
        : callFunction<MoveReply>('draughts-action', { match_id: matchId, action: 'move', path: step.move.path, ply: ply - 1 })
      sent
        .then((reply) => {
          if (!reply.ok) {
            takeBack(reply.code === 'ILLEGAL_MOVE' ? i18n.t('draughts.moveRejected') : refusalMessage(reply.code))
            if (RELOAD_AFTER.has(reply.code)) void load()
            return
          }
          setSnapshot((prev) => {
            if (!prev) return prev
            const confirmed = prev.paths.length >= reply.ply ? prev.paths : [...prev.paths, step.move.path]
            const game: GameRow =
              prev.game.ply >= reply.ply
                ? prev.game
                : { ...prev.game, ply: reply.ply, turn: myColor === 'w' ? 'b' : 'w', white_time_ms: reply.white_time_ms, black_time_ms: reply.black_time_ms, last_move_at: reply.last_move_at, draw_offer_by: null }
            return { ...prev, paths: confirmed, game }
          })
          setPending((p) => (p && p.ply <= reply.ply ? null : p))
        })
        .catch(() => {
          if (!server) {
            takeBack(i18n.t('draughts.moveNotSent'))
            return void load()
          }
          // The connection dropped with the move in the air: it may or may not have been
          // played. The database knows; only if it was not is the move taken back.
          void load().then(() => setTimeout(() => live.current.pending?.ply === ply && takeBack(i18n.t('draughts.moveNotSent')), 60))
        })
      return true
    },
    [matchId, myColor, load],
  )

  const act = useCallback(
    async (action: 'resign' | 'offer_draw' | 'accept_draw' | 'decline_draw') => {
      try {
        const reply = await callFunction('draughts-action', { match_id: matchId, action })
        if (!reply.ok) toast.error(refusalMessage(reply.code))
        void load()
      } catch {
        toast.error(i18n.t('errors.network'))
      }
    },
    [matchId, load],
  )

  // When a clock on screen reaches zero, ask the server to look at its own clock. The server
  // ends the game only if it agrees. Either player may ask; asking twice is harmless.
  const lastClaim = useRef(0)
  const warned = useRef(false)
  useEffect(() => {
    if (!active || !connected || !myColor) return
    const id = setInterval(() => {
      const now = Date.now()
      const expired = firstMove ? now > firstMove.deadline + 400 : clock.running !== null && remainingMs(clock, clock.running, now) <= 0
      if (clock.running === myColor && !warned.current && remainingMs(clock, myColor, now) <= TENTHS_BELOW_MS) {
        warned.current = true
        feedback('lowTime')
      }
      if (!expired || now - lastClaim.current < CLAIM_EVERY_MS) return
      lastClaim.current = now
      callFunction('draughts-action', { match_id: matchId, action: 'claim' })
        .then(() => load())
        .catch(() => {
          // Offline: the server's own sweep will end the game regardless.
        })
    }, 250)
    return () => clearInterval(id)
  }, [active, connected, firstMove, clock, myColor, matchId, load])

  // A second net under the live messages: every few seconds ask only for the move count.
  useEffect(() => {
    if (!active) return
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data } = await supabase.from('draughts_games').select('ply').eq('match_id', matchId).maybeSingle()
        if (data && data.ply > (live.current.snapshot?.paths.length ?? 0)) void load()
      } catch {
        // Offline for a moment: the reconnect reloads everything anyway.
      }
    }, 6000)
    return () => clearInterval(id)
  }, [active, matchId, load])

  const controller: DraughtsController = {
    state,
    played,
    turn: state.turn,
    clock,
    outcome,
    drawOfferBy,
    tryMove,
    resign: () => void act('resign'),
    offerDraw: () => void act('offer_draw'),
    respondToDraw: (accept) => void act(accept ? 'accept_draw' : 'decline_draw'),
  }

  return {
    status,
    controller,
    players: snapshot?.players ?? [],
    myColor,
    connected,
    firstMove,
    options: snapshot?.match.options ?? null,
    stake: snapshot?.match.stake_amount ?? 0,
    reload: load,
  }
}
