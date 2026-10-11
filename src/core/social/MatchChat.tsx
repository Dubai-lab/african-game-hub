import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/core/auth/AuthContext'
import { refusalMessage } from '@/core/lib/functions'
import { supabase } from '@/core/lib/supabase'
import { toast } from '@/core/ui/toast'
import { EMOJI, quickFor } from './quickMessages'
import { ReportDialog } from './SafetyActions'
import { useMatchChatSetting } from './social'

// Chat between the players of one match. Shared by every game. Two tabs, like the chat of any
// messaging app a player already knows:
//   - Chat:  what has been said, and a line to type on;
//   - Quick: ready-made messages and reactions, sent with one touch (see quickMessages.ts).
// Open to opponents who are not friends, but only while BOTH have live chat switched on; the
// server checks that on every message, so switching it off cannot be worked around.

type Line = { id: number; senderId: string; kind: string; body: string }
type Status = { mine: boolean; others: boolean }

let channelSeq = 0

type Props = {
  matchId: string
  names: Record<string, string>
  /** Which game this is: each has ready-made messages of its own ("Nice shot", "Nice roll"). */
  gameId: string
  /** Told when a ready-made message or a reaction has been sent, so the chat can be put away. */
  onQuickSent?: () => void
  /** The game is over. From then on the chat closes when the opponent leaves the game. */
  ended?: boolean
  /** Told whenever the chat closes or opens again for that reason. */
  onClosed?: (closed: boolean) => void
  /** Told each time the opponent says something. */
  onHeard?: () => void
}

/** How long an opponent may be gone (a refresh, a dropped connection) before they count as having left. */
const GONE_AFTER_MS = 6000

export function MatchChat({ matchId, names, gameId, onQuickSent, ended = false, onClosed, onHeard }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const me = user?.id
  const queryClient = useQueryClient()
  const setting = useMatchChatSetting()
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<'chat' | 'quick'>('chat')
  const [pop, setPop] = useState<Line | null>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const opponentIds = Object.keys(names).filter((id) => id !== me)
  const log = useRef<HTMLUListElement>(null)
  const [opponentGone, setOpponentGone] = useState(false)
  // The latest of what the page asked to be told, without re-subscribing when it changes.
  const heard = useRef(onHeard)
  heard.current = onHeard
  const closedTold = useRef(onClosed)
  closedTold.current = onClosed

  const statusKey = ['match-chat-status', matchId, me]
  const linesKey = ['match-chat', matchId]

  const status = useQuery({
    queryKey: statusKey,
    enabled: Boolean(me),
    // The opponent may change their mind during the game.
    refetchInterval: 20_000,
    meta: { silent: true },
    queryFn: async (): Promise<Status> => {
      const { data, error } = await supabase.rpc('match_chat_status', { p_match_id: matchId })
      if (error) throw error
      return (data as Status | null) ?? { mine: false, others: false }
    },
  })

  const lines = useQuery({
    queryKey: linesKey,
    enabled: Boolean(me),
    staleTime: 0,
    meta: { silent: true },
    queryFn: async (): Promise<Line[]> => {
      const { data, error } = await supabase
        .from('match_messages')
        .select('id, sender_id, kind, body')
        .eq('match_id', matchId)
        .order('id', { ascending: false })
        .limit(60)
      if (error) throw error
      return data.reverse().map((m) => ({ id: m.id, senderId: m.sender_id, kind: m.kind, body: m.body }))
    },
  })

  // New lines arrive live; each (re)connect reloads the lot in case something was missed.
  useEffect(() => {
    if (!me) return
    const channel = supabase
      .channel(`match-chat:${matchId}:${++channelSeq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_messages', filter: `match_id=eq.${matchId}` }, (payload) => {
        const row = payload.new as { id: number; sender_id: string; kind: string; body: string }
        const line: Line = { id: row.id, senderId: row.sender_id, kind: row.kind, body: row.body }
        queryClient.setQueryData<Line[]>(linesKey, (previous = []) => (previous.some((l) => l.id === line.id) ? previous : [...previous, line]))
        // What the opponent says pops up over the game, so it is seen without scrolling.
        if (line.senderId !== me) {
          setPop(line)
          heard.current?.()
        }
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') void queryClient.invalidateQueries({ queryKey: linesKey })
      })
    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, me, queryClient])

  // Who is at the game. Each player's screen says "I am here" for as long as it is open on this
  // match; when the game is over and the opponent's screen has gone, there is nobody to talk to.
  // (Nothing is decided from this but whether the chat is offered: it is not proof of anything.)
  useEffect(() => {
    if (!me) return
    const channel = supabase.channel(`match-here:${matchId}`, { config: { presence: { key: me } } })
    let gone: ReturnType<typeof setTimeout> | undefined
    const look = () => {
      const here = Object.keys(channel.presenceState())
      const present = opponentIds.length === 0 || opponentIds.some((id) => here.includes(id))
      clearTimeout(gone)
      if (present) setOpponentGone(false)
      else gone = setTimeout(() => setOpponentGone(true), GONE_AFTER_MS)
    }
    channel.on('presence', { event: 'sync' }, look).subscribe((state) => {
      if (state === 'SUBSCRIBED') void channel.track({ at: Date.now() })
    })
    return () => {
      clearTimeout(gone)
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, me])

  const left = ended && opponentGone
  useEffect(() => {
    closedTold.current?.(left)
  }, [left])

  useEffect(() => {
    if (!pop) return
    const id = setTimeout(() => setPop(null), 3500)
    return () => clearTimeout(id)
  }, [pop])

  const count = lines.data?.length ?? 0
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [count])

  /** What a line says, in this player's language. */
  const said = (line: Line) => (line.kind === 'quick' ? t(`chat.quick.${line.body}`, { defaultValue: line.body }) : line.body)

  async function send(kind: 'text' | 'emoji' | 'quick', body: string) {
    try {
      const { data, error } = await supabase.rpc('send_match_message', { p_match_id: matchId, p_kind: kind, p_body: body })
      if (error) return toast.error(t('errors.generic'))
      const reply = data as { ok: boolean; code?: string }
      if (!reply.ok) {
        toast.error(refusalMessage(reply.code ?? 'SERVER_ERROR'))
        void status.refetch()
        return
      }
      void queryClient.invalidateQueries({ queryKey: linesKey })
      if (kind !== 'text') {
        // Sent with one touch: back to the conversation, and the chat may be put away.
        setTab('chat')
        onQuickSent?.()
      }
    } catch {
      toast.error(t('errors.network'))
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body) return
    setDraft('')
    void send('text', body)
  }

  const mine = setting.loaded ? setting.enabled : (status.data?.mine ?? true)
  const others = status.data?.others ?? true
  const open = mine && others

  return (
    <section aria-label={t('chat.matchTitle')} className="flex min-h-0 flex-1 flex-col gap-2" data-testid="match-chat" data-open={open && !left}>
      {pop && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4"
          data-testid="chat-pop"
        >
          <p className="toast-in max-w-sm border-2 border-ink bg-panel px-4 py-2 text-center shadow-lg">
            <span className="block text-xs font-semibold text-muted">{names[pop.senderId] ?? ''}</span>
            <span className={pop.kind === 'emoji' ? 'text-5xl leading-tight' : 'break-words font-semibold'}>{said(pop)}</span>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted">{t('chat.matchTitle')}</h2>
        <div className="flex items-center gap-4">
          {opponentIds.map((id) => (
            <button key={id} type="button" className="min-h-8 text-sm font-semibold text-primary underline underline-offset-4" onClick={() => setReporting(id)}>
              {opponentIds.length > 1 ? t('safety.reportNamed', { name: names[id] }) : t('safety.report')}
            </button>
          ))}
          <button
            type="button"
            className="min-h-8 text-sm font-semibold text-primary underline underline-offset-4"
            onClick={() => void setting.set(!mine)}
          >
            {mine ? t('chat.turnOff') : t('chat.turnOn')}
          </button>
        </div>
      </div>
      {reporting && <ReportDialog target={{ userId: reporting, name: names[reporting] ?? '' }} matchId={matchId} onClose={() => setReporting(null)} />}

      {left ? (
        <p className="text-sm text-muted" data-testid="chat-left">
          {t('chat.left', { name: opponentIds.map((id) => names[id] ?? '').filter(Boolean).join(', ') })}
        </p>
      ) : !mine ? (
        <p className="text-sm text-muted">{t('chat.offYou')}</p>
      ) : !others ? (
        <p className="text-sm text-muted">{t('chat.offOpponent')}</p>
      ) : (
        <>
          <div role="tablist" aria-label={t('chat.matchTitle')} className="grid shrink-0 grid-cols-2 border-b-2 border-line">
            {(['chat', 'quick'] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={`-mb-0.5 min-h-10 border-b-4 text-sm font-bold ${tab === name ? 'border-primary text-primary' : 'border-transparent text-muted'}`}
              >
                {t(`chat.tab.${name}`)}
              </button>
            ))}
          </div>

          {tab === 'chat' ? (
            <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-2">
              {/* What has been said. It takes whatever room there is, and scrolls by itself. */}
              <ul ref={log} className="flex min-h-16 flex-1 flex-col gap-1 overflow-y-auto border border-line bg-surface p-2 text-sm lg:max-h-40" role="log">
                {count === 0 && <li className="text-muted">{t('chat.matchEmpty')}</li>}
                {(lines.data ?? []).map((line) => (
                  <li key={line.id} className="break-words">
                    <span className="font-semibold">{line.senderId === me ? t('chess.computer.you') : (names[line.senderId] ?? '')}: </span>
                    <span className={line.kind === 'emoji' ? 'text-xl leading-none' : ''}>{said(line)}</span>
                  </li>
                ))}
              </ul>
              <form onSubmit={submit} className="flex shrink-0 gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{t('chat.matchWrite')}</span>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t('chat.matchWrite')}
                    maxLength={200}
                    autoComplete="off"
                    enterKeyHint="send"
                    className="min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-base"
                  />
                </label>
                <button type="submit" disabled={!draft.trim()} className="min-h-11 rounded-md bg-brand px-4 text-sm font-bold text-brand-ink disabled:opacity-60">
                  {t('chat.send')}
                </button>
              </form>
            </div>
          ) : (
            <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {/* Ready-made messages: this game's own, and the ones for any game. */}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="group" aria-label={t('chat.quickMessages')}>
                {quickFor(gameId).map((name) => (
                  <button key={name} type="button" onClick={() => void send('quick', name)} className="min-h-11 border border-line bg-panel px-2 text-sm font-semibold active:bg-brand" data-quick={name}>
                    {t(`chat.quick.${name}`)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-8 gap-1" role="group" aria-label={t('chat.emoji')}>
                {EMOJI.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => void send('emoji', emoji)} className="flex aspect-square items-center justify-center border border-line bg-panel text-2xl active:bg-brand">
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
