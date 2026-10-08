import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import type { GameOptions } from '@/games/types'

type JoinReply = { status: 'matched' | 'queued'; match_id: string | null }
export type SearchRequest = { gameId: string; stake: number; options: GameOptions }

// While searching the app checks in this often. Each check-in tells the server the player is
// still there, and is also a second way to learn about a match if the live push was missed.
const CHECK_IN_MS = 5000

let channelSeq = 0

/**
 * Finding an opponent. The server does the pairing; this only asks, waits and listens.
 * `onMatched` is called once, with the match to open.
 */
export function useMatchmaking(onMatched: (gameId: string, matchId: string) => void) {
  const { user } = useAuth()
  const userId = user?.id
  const [search, setSearch] = useState<(SearchRequest & { startedAt: number }) | null>(null)
  const [starting, setStarting] = useState(false)
  const matched = useRef(false)
  const notify = useRef(onMatched)
  notify.current = onMatched

  const found = useCallback((gameId: string, matchId: string) => {
    if (matched.current) return
    matched.current = true
    setSearch(null)
    notify.current(gameId, matchId)
  }, [])

  /** One request to the server. Returns false when the search should stop. */
  const checkIn = useCallback(
    async (request: SearchRequest, quiet: boolean): Promise<boolean> => {
      try {
        const reply = await callFunction<JoinReply>('core-join-queue', {
          game_type: request.gameId,
          stake: request.stake,
          options: request.options,
        })
        if (!reply.ok) {
          toast.error(refusalMessage(reply.code))
          return false
        }
        if (reply.status === 'matched' && reply.match_id) {
          found(request.gameId, reply.match_id)
          return false
        }
        return true
      } catch {
        // Offline for a moment: keep the search open and try again on the next check-in.
        if (!quiet) toast.error(i18n.t('errors.network'))
        return quiet
      }
    },
    [found],
  )

  const start = useCallback(
    async (request: SearchRequest) => {
      if (starting || search) return
      matched.current = false
      setStarting(true)
      const keepSearching = await checkIn(request, false)
      setStarting(false)
      if (keepSearching) setSearch({ ...request, startedAt: Date.now() })
    },
    [checkIn, search, starting],
  )

  const cancel = useCallback(() => {
    setSearch(null)
    callFunction('core-leave-queue', {}).catch(() => {
      // If this does not arrive, the entry expires by itself once the check-ins stop.
    })
  }, [])

  // While searching: check in on a timer, and at once when the app comes back to the foreground.
  useEffect(() => {
    if (!search) return
    let active = true
    const tick = async () => {
      const keepSearching = await checkIn(search, true)
      if (active && !keepSearching && !matched.current) setSearch(null)
    }
    const timer = setInterval(() => void tick(), CHECK_IN_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [search, checkIn])

  // The fast path: the server creates our seat in the new match and Realtime tells us at once.
  useEffect(() => {
    if (!search || !userId) return
    const gameId = search.gameId
    const channel = supabase
      .channel(`matchmaking:${userId}:${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_players', filter: `user_id=eq.${userId}` },
        (payload) => {
          const matchId = (payload.new as { match_id?: unknown }).match_id
          if (typeof matchId === 'string') found(gameId, matchId)
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [search, userId, found])

  // Leaving the lobby while searching cancels the search.
  const searching = search !== null
  useEffect(() => {
    if (!searching) return
    return () => {
      if (!matched.current) callFunction('core-leave-queue', {}).catch(() => {})
    }
  }, [searching])

  return { search, starting, start, cancel }
}

/** A game the player is still in (for example after closing the app mid-game). */
export function useActiveMatch() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['active-match', user?.id],
    enabled: Boolean(user?.id),
    staleTime: 0,
    meta: { silent: true },
    queryFn: async () => {
      // Row level security already limits unfinished matches to the player's own.
      const { data, error } = await supabase
        .from('matches')
        .select('id, game_type')
        .in('status', ['waiting', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return data[0] ? { matchId: data[0].id, gameId: data[0].game_type } : null
    },
  })
}
