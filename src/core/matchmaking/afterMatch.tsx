import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button, buttonClass } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'
import type { GameOptions } from '@/games/types'
import { useMatchmaking } from './useMatchmaking'

// What a player can do the moment a match ends, without going back to the lobby:
//   * play someone new on the same terms (same game, stake and options), or
//   * ask the same opponent for a rematch, which the opponent accepts or declines.
// Shared by every game. The server decides everything; this asks, listens and shows.
//
// A game looked at again later (from the match history, to review it) is another matter: the
// opponent is long gone, so there is no rematch to ask for, and a tournament game has no
// tournament to go back to. Someone new on the same terms is still on offer.
//
// Where these are shown: on the result card, and in the game's menu. Beside the board they are
// shown only while something is waiting for an answer (see needsAnswer).

/** Must match the two minutes the server allows an offer to stand (see *_rematch.sql). */
const OFFER_LIVES_MS = 120_000
/** A match that ended longer ago than this is one being looked back at, not one just played. */
const JUST_PLAYED_MS = 10 * 60_000

type Offer = { offeredBy: string; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; newMatchId: string | null; createdAt: number }
type RematchReply = { status: 'pending' | 'matched' | 'declined' | 'cancelled'; match_id: string | null }

export type RematchState = 'none' | 'sent' | 'incoming' | 'declined' | 'refused'

type Config = {
  matchId: string
  gameId: string
  stake: number
  options: GameOptions | null
  /** True once the match is over and the signed-in player was one of its two players. */
  enabled: boolean
}

let channelSeq = 0

export function useAfterMatch({ matchId, gameId, stake, options, enabled }: Config) {
  const { user } = useAuth()
  const me = user?.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const left = useRef(false)
  const open = useCallback(
    (game: string, match: string) => {
      if (left.current) return
      left.current = true
      navigate(`/play/${game}/match/${match}`)
    },
    [navigate],
  )

  // --- A tournament game: the next game is found by the tournament, not from here -----------------
  const tournament = useQuery({
    queryKey: ['match-tournament', matchId],
    staleTime: Infinity,
    meta: { silent: true },
    queryFn: async (): Promise<{ tournamentId: string | null; past: boolean }> => {
      const { data, error } = await supabase.from('matches').select('tournament_id, finished_at').eq('id', matchId).maybeSingle()
      if (error) throw error
      // Read once, when the page opens: a game still being played has no end yet, and is not past.
      const ended = data?.finished_at ? Date.parse(data.finished_at) : null
      return { tournamentId: data?.tournament_id ?? null, past: ended !== null && Date.now() - ended > JUST_PLAYED_MS }
    },
  })
  const past = tournament.data?.past ?? false

  // --- Someone new, same terms -----------------------------------------------------------------
  const matchmaking = useMatchmaking(open)

  // --- Rematch -----------------------------------------------------------------------------------
  // A rematch can only be agreed in the minutes after a game; after that there is nothing to wait for.
  const [stillOpen, setOpen] = useState(true)
  useEffect(() => {
    if (!enabled) return
    setOpen(true)
    const id = setTimeout(() => setOpen(false), 10 * 60_000)
    return () => clearTimeout(id)
  }, [enabled, matchId])

  const offer = useQuery({
    queryKey: ['rematch', matchId],
    enabled: enabled && Boolean(me) && !past,
    staleTime: 0,
    // Realtime tells us at once; this is the net under it.
    refetchInterval: stillOpen ? 5000 : false,
    meta: { silent: true },
    queryFn: async (): Promise<Offer | null> => {
      const { data, error } = await supabase
        .from('rematch_offers')
        .select('offered_by, status, new_match_id, created_at')
        .eq('match_id', matchId)
        .maybeSingle()
      if (error) throw error
      return data && { offeredBy: data.offered_by, status: data.status as Offer['status'], newMatchId: data.new_match_id, createdAt: Date.parse(data.created_at) }
    },
  })

  useEffect(() => {
    if (!enabled || !me) return
    const channel = supabase
      .channel(`rematch:${matchId}:${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rematch_offers', filter: `match_id=eq.${matchId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['rematch', matchId] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [enabled, me, matchId, queryClient])

  // The opponent said yes: both players go to the new game.
  const current = offer.data ?? null
  useEffect(() => {
    if (enabled && current?.status === 'accepted' && current.newMatchId) open(gameId, current.newMatchId)
  }, [enabled, current, gameId, open])

  // An unanswered offer lapses; the screen follows without waiting for the server to say so.
  const [now, setNow] = useState(() => Date.now())
  const pending = current?.status === 'pending'
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [pending])
  const live = pending && now - current.createdAt < OFFER_LIVES_MS

  const [busy, setBusy] = useState(false)
  const act = useCallback(
    async (action: 'offer' | 'accept' | 'decline' | 'cancel') => {
      setBusy(true)
      try {
        const reply = await callFunction<RematchReply>('core-rematch', { match_id: matchId, action })
        if (!reply.ok) toast.error(refusalMessage(reply.code))
        else if (reply.status === 'matched' && reply.match_id) open(gameId, reply.match_id)
      } catch {
        toast.error(i18n.t('errors.network'))
      } finally {
        setBusy(false)
        void queryClient.invalidateQueries({ queryKey: ['rematch', matchId] })
      }
    },
    [matchId, gameId, open, queryClient],
  )

  // Walking away withdraws an offer nobody has answered, so the opponent cannot accept a game
  // the player is no longer there for.
  const mineIsWaiting = useRef(false)
  mineIsWaiting.current = Boolean(live && current?.offeredBy === me)
  useEffect(() => {
    return () => {
      if (mineIsWaiting.current && !left.current) callFunction('core-rematch', { match_id: matchId, action: 'cancel' }).catch(() => {})
    }
  }, [matchId])

  const rematch: RematchState = !current
    ? 'none'
    : live
      ? current.offeredBy === me
        ? 'sent'
        : 'incoming'
      : current.status === 'declined'
        ? current.offeredBy === me
          ? 'declined'
          : 'refused'
        : 'none'

  return {
    enabled,
    /** The match is one being looked back at: nothing that needs the opponent is offered. */
    past,
    /** A rematch may still be asked for: just played, and the minutes for it have not run out. */
    canRematch: enabled && !past && stillOpen,
    busy,
    rematch,
    offerRematch: () => void act('offer'),
    acceptRematch: () => void act('accept'),
    declineRematch: () => void act('decline'),
    cancelRematch: () => void act('cancel'),
    searching: matchmaking.search !== null,
    starting: matchmaking.starting,
    findNew: () => {
      if (options) void matchmaking.start({ gameId, stake, options })
    },
    cancelSearch: matchmaking.cancel,
    tournamentId: tournament.data?.tournamentId ?? null,
  }
}

export type AfterMatch = ReturnType<typeof useAfterMatch>

/**
 * Something is waiting for an answer: a search for a new opponent is on, or a rematch has been
 * asked for (either way). Only then are the buttons shown beside the board as well as in the menu.
 */
export function needsAnswer(state: AfterMatch): boolean {
  return state.searching || state.rematch === 'incoming' || state.rematch === 'sent'
}

/**
 * The buttons themselves. Drawn from the state above and holding none of their own, so the same
 * state can be shown in two places at once (on the result card and beside the board).
 */
export function AfterMatchActions({ state, opponent, newGameLabel }: { state: AfterMatch; opponent: string; newGameLabel: string }) {
  const { t } = useTranslation()

  if (state.tournamentId) {
    // A tournament game looked at again later: its tournament is over, there is nowhere to go back to.
    if (state.past) return null
    return (
      <div className="flex flex-col gap-2" data-testid="after-match">
        <Link to={`/tournaments/${state.tournamentId}`} className={buttonClass('primary', 'w-full')}>
          {t('tournament.back')}
        </Link>
      </div>
    )
  }

  if (state.searching) {
    return (
      <div className="flex flex-col gap-2" data-testid="after-match">
        <p role="status" className="flex items-center justify-center gap-2 text-center font-semibold">
          <span className="size-2.5 animate-pulse rounded-full bg-palm" aria-hidden="true" />
          {t('afterMatch.searching')}
        </p>
        <Button variant="ghost" onClick={state.cancelSearch}>
          {t('afterMatch.cancelSearch')}
        </Button>
      </div>
    )
  }

  if (state.rematch === 'incoming') {
    return (
      <div className="flex flex-col gap-2" data-testid="after-match">
        <p role="status" className="text-center font-semibold">
          {t('afterMatch.incoming', { name: opponent })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={state.declineRematch} disabled={state.busy}>
            {t('afterMatch.decline')}
          </Button>
          <Button onClick={state.acceptRematch} disabled={state.busy}>
            {t('afterMatch.accept')}
          </Button>
        </div>
        <button type="button" onClick={state.findNew} disabled={state.starting} className="min-h-10 text-sm font-semibold text-accent underline underline-offset-4">
          {newGameLabel}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-testid="after-match">
      {state.rematch === 'sent' && (
        <p role="status" className="text-center text-sm font-semibold text-muted">
          {t('afterMatch.sent', { name: opponent })}
        </p>
      )}
      {state.rematch === 'declined' && (
        <p role="status" className="text-center text-sm font-semibold text-muted">
          {t('afterMatch.declined', { name: opponent })}
        </p>
      )}
      <div className={`grid gap-2 *:px-2 ${state.canRematch ? 'grid-cols-2' : ''}`}>
        <Button variant="ghost" onClick={state.findNew} disabled={state.starting}>
          {newGameLabel}
        </Button>
        {!state.canRematch ? null : state.rematch === 'sent' ? (
          <Button variant="ghost" onClick={state.cancelRematch} disabled={state.busy}>
            {t('afterMatch.cancelOffer')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={state.offerRematch} disabled={state.busy || state.rematch === 'declined'}>
            {t('afterMatch.rematch')}
          </Button>
        )}
      </div>
    </div>
  )
}
