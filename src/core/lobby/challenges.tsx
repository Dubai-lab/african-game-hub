import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import i18n from '@/core/i18n'
import { callFunction, refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { Button, buttonClass } from '@/core/ui/Button'
import { toast } from '@/core/ui/toast'
import { getGameModule } from '@/games/registry'
import type { GameOptions } from '@/games/types'
import type { GameType } from '@/core/games/useGameTypes'

// Invitations to a game ("play a friend") as the app sees them. The server decides everything:
// who may accept, whether both can pay, and when the match starts.

export type Challenge = {
  id: string
  gameId: string
  stake: number
  options: GameOptions
  pool: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  matchId: string | null
  expiresAt: number
  fromId: string
  fromName: string
  /** Null: anyone holding the link may accept. */
  toId: string | null
  toName: string | null
}

const COLUMNS = `id, game_type, stake_amount, options, rating_pool, status, match_id, expires_at, from_user, to_user,
  sender:profiles!challenges_from_user_fkey (username, display_name),
  invited:profiles!challenges_to_user_fkey (username, display_name)`

type Row = {
  id: string
  game_type: string
  stake_amount: number
  options: unknown
  rating_pool: string
  status: string
  match_id: string | null
  expires_at: string
  from_user: string
  to_user: string | null
  sender: { username: string; display_name: string | null } | null
  invited: { username: string; display_name: string | null } | null
}

const toChallenge = (row: Row): Challenge => ({
  id: row.id,
  gameId: row.game_type,
  stake: row.stake_amount,
  options: (row.options as GameOptions | null) ?? {},
  pool: row.rating_pool,
  status: row.status as Challenge['status'],
  matchId: row.match_id,
  expiresAt: Date.parse(row.expires_at),
  fromId: row.from_user,
  fromName: row.sender?.display_name ?? row.sender?.username ?? '?',
  toId: row.to_user,
  toName: row.invited ? (row.invited.display_name ?? row.invited.username) : null,
})

/** One invitation, re-read every few seconds while it is still open. */
export function useChallenge(id: string | undefined) {
  return useQuery({
    queryKey: ['challenge', id],
    enabled: Boolean(id),
    staleTime: 0,
    meta: { silent: true },
    refetchInterval: (query) => (query.state.data && query.state.data.status !== 'pending' ? false : 3000),
    queryFn: async (): Promise<Challenge | null> => {
      const { data, error } = await supabase.from('challenges').select(COLUMNS).eq('id', id!).maybeSingle()
      if (error) throw error
      return data ? toChallenge(data as Row) : null
    },
  })
}

/** The invitation this player has out for a game, if any (so a refresh comes back to it). */
export function useMyOpenChallenge(gameId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-challenge', user?.id, gameId],
    enabled: Boolean(user?.id && gameId),
    staleTime: 0,
    meta: { silent: true },
    queryFn: async (): Promise<Challenge | null> => {
      const { data, error } = await supabase
        .from('challenges')
        .select(COLUMNS)
        .eq('from_user', user!.id)
        .eq('game_type', gameId!)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      if (error) throw error
      return data ? toChallenge(data as Row) : null
    },
  })
}

/** Invitations waiting for this player's answer. */
export function useIncomingChallenges() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['incoming-challenges', user?.id],
    enabled: Boolean(user?.id),
    staleTime: 0,
    refetchInterval: 6000,
    meta: { silent: true },
    queryFn: async (): Promise<Challenge[]> => {
      const { data, error } = await supabase
        .from('challenges')
        .select(COLUMNS)
        .eq('to_user', user!.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return (data as Row[]).map(toChallenge)
    },
  })
}

type Reply = { status: string; id: string | null; match_id: string | null }

/** Asks the server for something to do with an invitation. Says why not, when the answer is no. */
export async function challengeRequest(body: Record<string, unknown>): Promise<Reply | null> {
  try {
    const reply = await callFunction<Reply>('core-challenge', body)
    if (!reply.ok) {
      toast.error(refusalMessage(reply.code))
      return null
    }
    return reply
  } catch {
    toast.error(i18n.t('errors.network'))
    return null
  }
}

/** What a game with these terms is, in a few words: "Blitz · 5 | 3", "9-ball". */
export function termsText(game: GameType | undefined, pool: string, options: GameOptions | null): string {
  const label = game ? getGameModule(game.id)?.optionsLabel?.(game.optionsSchema, options) : undefined
  return [pool !== 'default' ? i18n.t(`ratingPools.${pool}`, { defaultValue: pool }) : null, label].filter(Boolean).join(' · ')
}

/** A link to pass on: shown, copied with one tap, or sent straight to WhatsApp. */
export function ShareLink({ path, text }: { path: string; text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}${path}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // No clipboard here: the link is on screen to be selected by hand.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input readOnly value={url} aria-label={t('share.link')} data-testid="share-link" onFocus={(event) => event.currentTarget.select()} className="min-h-11 w-full border-2 border-line bg-surface px-3 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => void copy()}>
          {t(copied ? 'share.copied' : 'share.copy')}
        </Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'px-2 text-center')}>
          {t('share.whatsapp')}
        </a>
      </div>
    </div>
  )
}
