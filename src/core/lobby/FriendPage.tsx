import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useRakeBps } from '@/core/games/useGameTypes'
import { useContacts } from '@/core/social/social'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { toast } from '@/core/ui/toast'
import { WalletSummary } from '@/core/wallet/WalletSummary'
import { useMyProfile } from '@/core/profile/useMyProfile'
import { challengeRequest, ShareLink, useChallenge, useMyOpenChallenge } from './challenges'
import { StakePicker } from './GamePage'
import { GameHeader, GameNotOpen, useMatchSetup } from './setup'

const sectionTitle = 'font-display text-xl font-semibold'

/**
 * Play a friend: choose who (a friend by name, or anyone who is given the link), the stake and
 * how to play, and send the invitation. Then wait here; when it is accepted the game opens.
 */
export default function FriendPage() {
  const { t } = useTranslation()
  const { gameId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const profile = useMyProfile()
  const rake = useRakeBps()
  const contacts = useContacts()
  const { games, game, module, balance, stake, options, setStake, setOptions } = useMatchSetup(gameId)

  /** A friend's username, or null for "anyone with the link". */
  const [to, setTo] = useState<string | null>(params.get('to'))
  const [busy, setBusy] = useState(false)
  // The invitation that is out: found again after a refresh, or just sent.
  const open = useMyOpenChallenge(game?.id)
  const [sentId, setSentId] = useState<string | null>(null)
  const sent = useChallenge(sentId ?? open.data?.id)
  const challenge = sent.data

  // The answer, when it comes.
  const status = challenge?.status
  const matchId = challenge?.matchId
  const invitedName = challenge?.toName
  useEffect(() => {
    if (!challenge || !game) return
    if (status === 'accepted' && matchId) {
      navigate(`/play/${game.id}/match/${matchId}`)
    } else if (status === 'declined') {
      toast.info(t('challenge.declined', { name: invitedName ?? '' }))
      setSentId(null)
      void queryClient.invalidateQueries({ queryKey: ['my-challenge'] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, matchId])

  if (games.isPending) return <Skeleton className="h-64" />
  if (!game || !module) return <GameNotOpen />

  const gameName = t(`games.${game.id}`, { defaultValue: game.name })
  const friends = (contacts.data ?? []).filter((contact) => contact.relation === 'friend')
  const chosen = to !== null && friends.some((friend) => friend.username === to) ? to : null
  const waiting = challenge && challenge.status === 'pending' && challenge.expiresAt > Date.now()

  async function send() {
    if (!game || !options || busy) return
    setBusy(true)
    const reply = await challengeRequest({ action: 'create', game_type: game.id, stake, options, ...(chosen ? { to_username: chosen } : {}) })
    setBusy(false)
    if (reply?.id) setSentId(reply.id)
  }
  async function cancel() {
    if (!challenge || busy) return
    setBusy(true)
    await challengeRequest({ action: 'cancel', challenge_id: challenge.id })
    setBusy(false)
    setSentId(null)
    await queryClient.invalidateQueries({ queryKey: ['my-challenge'] })
  }

  const pick = (on: boolean) => `flex min-h-12 items-center border-2 px-3 text-start font-bold ${on ? 'border-ink bg-brand text-brand-ink' : 'border-line bg-panel'}`

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-10">
      <div className="lg:col-span-2">
        <GameHeader gameId={game.id} title={t('challenge.title')} back={{ to: `/play/${game.id}/new`, label: t('play.new.backTo', { game: gameName }) }} />
      </div>
      <div className="flex flex-col gap-6">
        <WalletSummary profile={profile.data} />
      </div>

      <div className="flex flex-col gap-6 lg:border-2 lg:border-line lg:bg-panel lg:p-6">
        {waiting ? (
          <section aria-live="polite" className="flex flex-col gap-4" data-testid="challenge-waiting">
            <div className="flex items-center gap-3">
              <span className="size-8 shrink-0 animate-spin rounded-full border-4 border-line border-t-primary motion-reduce:animate-none" aria-hidden="true" />
              <h2 className="font-display text-xl font-extrabold text-primary">{challenge.toName ? t('challenge.waitingFor', { name: challenge.toName }) : t('challenge.waitingLink')}</h2>
            </div>
            <p className="text-sm text-muted">{t('challenge.expires')}</p>
            <ShareLink path={`/challenge/${challenge.id}`} text={t('challenge.shareText', { game: gameName })} />
            <Button variant="ghost" onClick={() => void cancel()} disabled={busy}>
              {t('challenge.cancel')}
            </Button>
          </section>
        ) : (
          <>
            <fieldset>
              <legend className={sectionTitle}>{t('challenge.who')}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup">
                <button type="button" role="radio" aria-checked={chosen === null} onClick={() => setTo(null)} className={pick(chosen === null)}>
                  {t('challenge.anyone')}
                </button>
                {friends.map((friend) => (
                  <button key={friend.userId} type="button" role="radio" aria-checked={chosen === friend.username} onClick={() => setTo(friend.username)} className={pick(chosen === friend.username)}>
                    <span className="truncate">{friend.name}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted">
                {chosen === null ? t('challenge.anyoneHint') : t('challenge.friendHint')}{' '}
                {friends.length === 0 && (
                  <Link to="/friends" className="font-semibold text-primary underline underline-offset-4">
                    {t('play.home.findFriends')}
                  </Link>
                )}
              </p>
            </fieldset>
            <StakePicker game={game} players={2} stake={stake} balance={balance} rakeBps={rake.data} onSelect={setStake} />
            <module.OptionsPicker schema={game.optionsSchema} value={options} onChange={setOptions} />
            <Button className="min-h-14 w-full text-lg" disabled={!options || busy} onClick={() => void send()}>
              {busy ? t('auth.working') : t(chosen === null ? 'challenge.sendLink' : 'challenge.send')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
