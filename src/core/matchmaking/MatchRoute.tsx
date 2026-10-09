import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useParams } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { supabase } from '@/core/lib/supabase'
import { getGameModule } from '@/games/registry'

/**
 * Someone watching a tournament game (not one of its players) is given a way back to the
 * tournament. Players have theirs on the result card.
 */
function WatcherBar({ matchId }: { matchId: string }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const watching = useQuery({
    queryKey: ['match-watching', matchId, user?.id],
    enabled: Boolean(user?.id),
    staleTime: Infinity,
    meta: { silent: true },
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.from('matches').select('tournament_id, match_players (user_id)').eq('id', matchId).maybeSingle()
      if (error) throw error
      if (!data?.tournament_id || data.match_players.some((player) => player.user_id === user!.id)) return null
      return data.tournament_id
    },
  })
  if (!watching.data) return null
  return (
    <Link
      to={`/tournaments/${watching.data}`}
      data-testid="watching-back"
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 whitespace-nowrap border-2 border-ink bg-brand px-4 py-2 text-sm font-bold text-brand-ink shadow-[0_3px_8px_rgba(0,0,0,0.4)]"
    >
      {t('tournament.watching')}
    </Link>
  )
}

/** /play/:gameId/match/:matchId — hands the match to whichever game module owns it. */
export default function MatchRoute() {
  const { gameId, matchId } = useParams()
  const module = gameId ? getGameModule(gameId) : undefined
  if (!module || !matchId || !/^[0-9a-f-]{36}$/i.test(matchId)) return <Navigate to="/lobby" replace />
  return (
    <>
      {/* A key per match: moving from one game straight to another starts from a clean screen. */}
      <module.MatchScreen key={matchId} matchId={matchId} />
      <WatcherBar matchId={matchId} />
    </>
  )
}
