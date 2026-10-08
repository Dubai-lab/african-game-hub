import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { useAuth } from '@/core/auth/AuthContext'
import { flagEmoji } from '@/core/countries/useCountries'
import { Button } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { useFormat } from '@/core/ui/useFormat'
import { conversationKey, markRead, sendDirectMessage, useContacts, useConversation } from './social'

/** A private conversation with one friend. Open to friends only; the server enforces it. */
export default function ChatPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const { username } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const contacts = useContacts()
  const contact = contacts.data?.find((c) => c.username === username)
  const friend = contact?.relation === 'friend' ? contact : undefined
  const conversation = useConversation(friend?.userId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const messages = conversation.data ?? []
  const lastId = messages.at(-1)?.id

  // Opening the conversation, or receiving a message while it is open, marks it as read.
  useEffect(() => {
    if (!friend) return
    end.current?.scrollIntoView({ block: 'end' })
    if (messages.some((m) => !m.mine)) {
      void markRead(friend.userId).then(() => queryClient.invalidateQueries({ queryKey: ['friends', user?.id] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friend?.userId, lastId])

  async function send(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!friend || !body || sending) return
    setSending(true)
    if (await sendDirectMessage(friend.userId, body)) {
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: conversationKey(user?.id, friend.userId) })
    }
    setSending(false)
  }

  const back = (
    <Link to="/friends" className="flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
      {t('friends.title')}
    </Link>
  )

  if (contacts.isPending) return <Skeleton className="h-64" />
  if (!friend) {
    return (
      <div className="flex flex-col items-start gap-3">
        {back}
        <p>{t('chat.friendsOnly')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col lg:h-[calc(100dvh-7rem)] lg:max-w-3xl">
      <header className="flex items-center justify-between gap-3 border-b-2 border-line pb-2">
        {back}
        <h1 className="truncate font-display text-xl font-extrabold text-primary">
          {friend.countryCode && <span aria-hidden="true">{flagEmoji(friend.countryCode)} </span>}
          {friend.name}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto py-3" role="log" aria-label={t('chat.conversation', { name: friend.name })}>
        {conversation.isPending ? (
          <Skeleton className="h-24" />
        ) : messages.length === 0 ? (
          <p className="text-center text-muted">{t('chat.empty', { name: friend.name })}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`max-w-[80%] px-3 py-2 ${message.mine ? 'self-end bg-primary text-surface' : 'self-start border border-line bg-panel'}`}
              >
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p className={`mt-0.5 text-xs ${message.mine ? 'text-primary-tint' : 'text-muted'}`}>{format.dateTime(message.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>

      <form onSubmit={send} className="flex gap-2 border-t-2 border-line pt-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('chat.write')}</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('chat.write')}
            maxLength={500}
            autoComplete="off"
            className="min-h-12 w-full rounded-lg border border-line bg-panel px-3 text-base"
          />
        </label>
        <Button type="submit" disabled={sending || !draft.trim()}>
          {t('chat.send')}
        </Button>
      </form>
    </div>
  )
}
