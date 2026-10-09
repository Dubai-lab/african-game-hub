import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { useGameTypes } from '@/core/games/useGameTypes'
import { Button, buttonClass } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { useFormat } from '@/core/ui/useFormat'
import { type Challenge, challengeRequest, termsText, useChallenge, useIncomingChallenges } from './challenges'
import { GameArt } from './GameArt'

/** What an invitation is for, and the two answers. Used by the link page and by the pop-up. */
function Invitation({ challenge, onDone }: { challenge: Challenge; onDone?: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const games = useGameTypes()
  const [busy, setBusy] = useState(false)
  const game = games.data?.find((g) => g.id === challenge.gameId)
  const gameName = t(`games.${challenge.gameId}`, { defaultValue: game?.name ?? challenge.gameId })

  async function answer(action: 'accept' | 'decline') {
    if (busy) return
    setBusy(true)
    const reply = await challengeRequest({ action, challenge_id: challenge.id })
    setBusy(false)
    await queryClient.invalidateQueries({ queryKey: ['incoming-challenges'] })
    await queryClient.invalidateQueries({ queryKey: ['challenge', challenge.id] })
    onDone?.()
    if (reply?.match_id) navigate(`/play/${challenge.gameId}/match/${reply.match_id}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <GameArt gameId={challenge.gameId} className="h-14 w-16 shrink-0 border-2 border-ink" />
        <div className="min-w-0">
          <p className="font-display text-xl font-extrabold text-primary">{t('challenge.incomingTitle', { name: challenge.fromName })}</p>
          <p className="font-semibold">{[gameName, termsText(game, challenge.pool, challenge.options)].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <p className="text-muted" data-testid="challenge-stake">
        {challenge.stake > 0 ? t('challenge.stake', { stake: format.tokens(challenge.stake) }) : t('challenge.free')}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {/* Only an invitation sent to this player by name can be turned down; a link is simply left alone. */}
        {challenge.toId !== null ? (
          <Button variant="ghost" onClick={() => void answer('decline')} disabled={busy}>
            {t('challenge.decline')}
          </Button>
        ) : (
          <Link to="/lobby" className={buttonClass('ghost', 'text-center')}>
            {t('challenge.notNow')}
          </Link>
        )}
        <Button onClick={() => void answer('accept')} disabled={busy}>
          {t('challenge.accept')}
        </Button>
      </div>
    </div>
  )
}

/** Opened from a shared link: says what the invitation is and lets the visitor accept it. */
export default function ChallengePage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { user } = useAuth()
  const challenge = useChallenge(id)

  if (challenge.isPending) return <Skeleton className="h-48" />
  const c = challenge.data
  const closed = !c || c.status !== 'pending' || c.expiresAt <= Date.now()

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 lg:mx-0">
      <h1 className="font-display text-3xl font-extrabold text-primary">{t('challenge.title')}</h1>
      {closed ? (
        <>
          {/* An invitation that has been taken up can no longer be read by anyone else: the same words either way. */}
          <p>{t('challenge.closed')}</p>
          {c?.status === 'accepted' && c.matchId && (c.fromId === user?.id || c.toId === user?.id) && (
            <Link to={`/play/${c.gameId}/match/${c.matchId}`} className={buttonClass('primary')}>
              {t('lobby.returnToGame')}
            </Link>
          )}
          <Link to="/lobby" className="font-semibold text-primary underline underline-offset-4">
            {t('lobby.allGames')}
          </Link>
        </>
      ) : c.fromId === user?.id ? (
        <>
          <p>{t('challenge.yours')}</p>
          <Link to={`/play/${c.gameId}/friend`} className={buttonClass('ghost')}>
            {t('challenge.title')}
          </Link>
        </>
      ) : (
        <div className="border-2 border-ink bg-panel p-4">
          <Invitation challenge={c} />
        </div>
      )}
    </div>
  )
}

/** Mounted with the app frame: when a friend invites this player, the invitation pops up. */
export function ChallengeInbox() {
  const { t } = useTranslation()
  const incoming = useIncomingChallenges()
  const [dismissed, setDismissed] = useState<string[]>([])
  const challenge = (incoming.data ?? []).find((c) => !dismissed.includes(c.id) && c.expiresAt > Date.now())
  if (!challenge) return null
  const later = () => setDismissed((ids) => [...ids, challenge.id])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 sm:items-center" role="presentation" onClick={later}>
      <div role="dialog" aria-modal="true" aria-label={t('challenge.incomingTitle', { name: challenge.fromName })} onClick={(event) => event.stopPropagation()} className="w-full max-w-md border-t-4 border-brand bg-panel px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:border-4">
        <Invitation challenge={challenge} onDone={later} />
        <button type="button" onClick={later} className="mt-2 min-h-11 w-full font-semibold text-primary underline underline-offset-4">
          {t('challenge.later')}
        </button>
      </div>
    </div>
  )
}
