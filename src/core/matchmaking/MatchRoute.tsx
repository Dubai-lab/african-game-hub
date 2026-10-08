import { Navigate, useParams } from 'react-router'
import { getGameModule } from '@/games/registry'

/** /play/:gameId/match/:matchId — hands the match to whichever game module owns it. */
export default function MatchRoute() {
  const { gameId, matchId } = useParams()
  const module = gameId ? getGameModule(gameId) : undefined
  if (!module || !matchId || !/^[0-9a-f-]{36}$/i.test(matchId)) return <Navigate to="/lobby" replace />
  // A key per match: moving from one game straight to another starts from a clean screen.
  return <module.MatchScreen key={matchId} matchId={matchId} />
}
