import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useAuth } from '@/core/auth/AuthContext'
import { callFunction } from '@/core/lib/functions'

// A player in a tournament stays "here" wherever they go in the app: on the tournament's page,
// in their own game, or watching someone else's. Every few seconds the app tells the server so,
// and the server's answer says when a game of theirs has started; the app then takes them to it.

type Active = { id: string; gameId: string; format: 'arena' | 'rounds' }
type PresenceState = {
  /** The tournament this player is taking part in right now, if any. */
  active: Active | null
  /** By time: the player has asked for their next game and is waiting to be paired. */
  wantNext: boolean
  /** What the server last said: 'waiting', 'paused', 'playing', 'busy', 'dropped', 'scheduled'… */
  room: string
  enter: (active: Active) => void
  leave: () => void
  askNext: (want: boolean) => void
  heard: (room: string) => void
}

export const useTournamentPresence = create<PresenceState>()(
  persist(
    (set, get) => ({
      active: null,
      wantNext: false,
      room: '',
      enter: (active) => {
        // Entering another tournament starts afresh; coming back to the same one keeps what was asked.
        if (get().active?.id !== active.id) set({ active, wantNext: false, room: '' })
      },
      leave: () => set({ active: null, wantNext: false, room: '' }),
      askNext: (wantNext) => set({ wantNext }),
      heard: (room) => set({ room }),
    }),
    { name: 'agh.tournament', version: 1, partialize: (state) => ({ active: state.active, wantNext: state.wantNext }) },
  ),
)

const HEARTBEAT_MS = 5000
type Reply = { status: string; match_id: string | null }
/** Answers after which there is nothing more to wait for in this tournament. */
const OVER = new Set(['finished', 'cancelled', 'dropped'])
const GONE = new Set(['NOT_JOINED', 'TOURNAMENT_NOT_FOUND', 'NOT_AUTHENTICATED', 'BANNED'])

/** Mounted once for the whole app. Draws nothing. */
export function TournamentPresence() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const active = useTournamentPresence((state) => state.active)
  const wantNext = useTournamentPresence((state) => state.wantNext)
  const path = useLocation().pathname
  const here = useRef(path)
  here.current = path
  const id = active?.id
  const gameId = active?.gameId
  const format = active?.format
  const userId = user?.id

  useEffect(() => {
    if (!id || !gameId || !userId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const { heard, leave, askNext } = useTournamentPresence.getState()
    const beat = async () => {
      try {
        const reply = await callFunction<Reply>('core-tournament', { action: 'ready', tournament_id: id, ready: format === 'arena' && wantNext })
        if (stopped) return
        if (!reply.ok) {
          if (GONE.has(reply.code)) return leave()
        } else {
          heard(reply.status)
          if (reply.status === 'playing' && reply.match_id) {
            // Paired: no longer asking, and off to the board (from wherever the player is).
            askNext(false)
            const board = `/play/${gameId}/match/${reply.match_id}`
            if (here.current !== board) navigate(board)
          } else if (OVER.has(reply.status)) {
            void queryClient.invalidateQueries({ queryKey: ['tournament', id] })
            return leave()
          }
        }
      } catch {
        // Offline for a moment: the next beat tries again.
      }
      timer = setTimeout(() => void beat(), HEARTBEAT_MS)
    }
    void beat()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [id, gameId, format, wantNext, userId, navigate, queryClient])

  return null
}
