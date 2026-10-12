import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import type { Board, Laid, Over, Seat, TableEvent, Tile } from '../../../supabase/functions/_shared/words'

// One online game of Word Battle. The server holds the game, tiles and all; this loads what this
// player may see (the board and the scores, and their own rack), listens for changes, and passes
// on what the player asks for. It is never sent anyone else's tiles, and never decides anything:
// what a turn would score is worked out on the phone only to show it before it is played, and
// whether a word is a word is the server's to say.

/** The table as everyone at it sees it. */
export type TableView = {
  seats: Seat[]
  out: Seat[]
  board: Board
  scores: Record<Seat, number>
  /** How many tiles each player holds. */
  counts: Record<Seat, number>
  bagCount: number
  turn: Seat
  moveNo: number
  lastEvent: TableEvent | null
  /** Once it is over: why, who won, the final scores, and the tiles everyone was left with. */
  over: (Over & { racks?: Record<Seat, Tile[]> }) | null
}

export type WordsPlayer = {
  userId: string
  seat: Seat
  name: string
  countryCode: string | null
  avatarUrl: string | null
  /** Chooses the figure at their place at the table. Null for a player who has not said. */
  gender: 'male' | 'female' | null
  /** Games of Word Battle this player has won. */
  wins: number
  ratingAfter: number | null
  tokensChange: number | null
}

type MatchRow = { status: string; result: string | null; winner_id: string | null; end_reason: string | null; options: unknown; stake_amount: number }
type GameRow = {
  seats: string[]
  out_seats: string[]
  board: string
  scores: Record<string, number>
  counts: Record<string, number>
  bag_count: number
  turn: string
  move_no: number
  last_event: unknown
  phase: string
  result: unknown
  deadline: string | null
}
type Snapshot = { match: MatchRow; players: WordsPlayer[]; view: TableView; deadline: number | null; rack: Tile[] }

const toView = (row: GameRow): TableView => ({
  seats: row.seats,
  out: row.out_seats ?? [],
  board: row.board,
  scores: row.scores ?? {},
  counts: row.counts ?? {},
  bagCount: row.bag_count,
  turn: row.turn,
  moveNo: row.move_no,
  lastEvent: (row.last_event as TableEvent | null) ?? null,
  over: row.phase === 'over' ? ((row.result as TableView['over']) ?? { reason: 'last_standing', winner: null, scores: row.scores ?? {} }) : null,
})

const GAME_COLUMNS = 'seats, out_seats, board, scores, counts, bag_count, turn, move_no, last_event, phase, result, deadline'
const RELOAD_AFTER = new Set(['SERVER_ERROR', 'OUT_OF_SYNC', 'GAME_OVER', 'NOT_YOUR_TURN', 'NOT_YOUR_TILE', 'SQUARE_TAKEN', 'CORRUPT_GAME'])
const CLAIM_EVERY_MS = 3000

let channelSeq = 0

export function useWordsGame(matchId: string) {
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
      const [match, game, rack, time] = await Promise.all([
        supabase
          .from('matches')
          .select('status, result, winner_id, end_reason, options, stake_amount, match_players (user_id, seat, rating_after, tokens_change, profiles (username, display_name, country_code, avatar_url, gender))')
          .eq('id', matchId)
          .maybeSingle(),
        supabase.from('words_games').select(GAME_COLUMNS).eq('match_id', matchId).maybeSingle(),
        // The access rules give back this player's own row and nobody else's.
        supabase.from('words_racks').select('tiles').eq('match_id', matchId).maybeSingle(),
        supabase.rpc('server_now'),
      ])
      if (seq !== loadSeq.current) return
      if (match.error || game.error || rack.error) throw match.error ?? game.error ?? rack.error
      if (!match.data || !game.data) return setStatus('not_found')
      // Half the round trip is the best estimate of when the server read its clock.
      if (!time.error && time.data) offset.current = Date.parse(time.data) - (sentAt + Date.now()) / 2

      const { match_players, ...matchRow } = match.data
      const won = await supabase.from('player_ratings').select('user_id, wins').eq('game_type', 'words').in('user_id', match_players.map((p) => p.user_id))
      if (seq !== loadSeq.current) return
      const wins = new Map((won.data ?? []).map((row) => [row.user_id, row.wins]))
      const players: WordsPlayer[] = match_players.map((p) => ({
        userId: p.user_id,
        seat: p.seat,
        name: p.profiles?.display_name ?? p.profiles?.username ?? '?',
        countryCode: p.profiles?.country_code ?? null,
        avatarUrl: p.profiles?.avatar_url ?? null,
        gender: p.profiles?.gender === 'male' || p.profiles?.gender === 'female' ? p.profiles.gender : null,
        wins: wins.get(p.user_id) ?? 0,
        ratingAfter: p.rating_after,
        tokensChange: p.tokens_change,
      }))
      const row = game.data as GameRow
      setSnapshot({ match: matchRow, players, view: toView(row), deadline: row.deadline ? Date.parse(row.deadline) : null, rack: (rack.data?.tiles as Tile[] | undefined) ?? [] })
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
      .channel(`words:${matchId}:${++channelSeq}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'words_games', filter: `match_id=eq.${matchId}` }, (payload) => {
        const row = payload.new as GameRow
        setSnapshot((prev) => (prev && row.move_no > prev.view.moveNo ? { ...prev, view: toView(row), deadline: row.deadline ? Date.parse(row.deadline) : null } : prev))
        // The table and the rack are two rows: the rack is fetched again with every change, so
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

  /** Asks the server for something. Resolves true when it was done. */
  const act = useCallback(
    async (action: 'place' | 'swap' | 'pass' | 'leave' | 'claim', given: { tiles?: Laid[]; swap?: Tile[] } = {}): Promise<boolean> => {
      const quiet = action === 'claim'
      const now = live.current
      if (!now) return false
      if (!quiet) setBusy(true)
      try {
        const reply = await callFunction('words-action', { match_id: matchId, action, move_no: now.view.moveNo, ...given })
        if (!reply.ok) {
          // A word that is not in the list is named, so the player knows which one to change.
          const wrong = (reply as { words?: string[] }).words
          if (reply.code === 'NOT_A_WORD' && wrong?.length) toast.error(i18n.t('words.notAWord', { count: wrong.length, words: wrong.map((word) => word.toUpperCase()).join(', ') }))
          // Why tiles cannot lie as they were laid is said in the game's own words.
          else if (!quiet && i18n.exists(`words.refusal.${reply.code}`)) toast.error(i18n.t(`words.refusal.${reply.code}`))
          else if (!quiet && reply.code !== 'OUT_OF_SYNC') toast.error(refusalMessage(reply.code))
          if (RELOAD_AFTER.has(reply.code)) void load()
          return false
        }
        // The new state normally arrives by itself a moment later. Asking for it as well costs
        // one small request and means a lost message can never leave the table stuck.
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
  const open = snapshot !== null && snapshot.view.over === null && snapshot.match.status === 'active'
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
        const { data } = await supabase.from('words_games').select('move_no').eq('match_id', matchId).maybeSingle()
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
    view: snapshot?.view ?? null,
    rack: snapshot?.rack ?? [],
    mySeat: me?.seat ?? null,
    deadline,
    place: (tiles: Laid[]) => act('place', { tiles }),
    swap: (tiles: Tile[]) => act('swap', { swap: tiles }),
    pass: () => act('pass'),
    leave: () => void act('leave'),
    reload: load,
  }
}
