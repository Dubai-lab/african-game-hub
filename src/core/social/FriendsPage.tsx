import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { flagEmoji } from '@/core/countries/useCountries'
import { Button, buttonClass } from '@/core/ui/Button'
import { Skeleton } from '@/core/ui/Skeleton'
import { type Contact, useContacts, useFriendActions } from './social'

const sectionTitle = 'font-display text-xl font-semibold'

function Name({ contact }: { contact: Contact }) {
  return (
    <Link to={`/players/${contact.username}`} className="min-w-0 flex-1 truncate font-semibold underline-offset-4 hover:underline">
      {contact.countryCode && <span aria-hidden="true">{flagEmoji(contact.countryCode)} </span>}
      {contact.name}
    </Link>
  )
}

export default function FriendsPage() {
  const { t } = useTranslation()
  const contacts = useContacts()
  const actions = useFriendActions()
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)

  const all = contacts.data ?? []
  const incoming = all.filter((c) => c.relation === 'incoming')
  const friends = all.filter((c) => c.relation === 'friend')
  const outgoing = all.filter((c) => c.relation === 'outgoing')

  async function add(event: FormEvent) {
    event.preventDefault()
    const name = username.trim().replace(/^@/, '')
    if (!name || busy) return
    setBusy(true)
    if (await actions.request(name)) setUsername('')
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-10">
      <h1 className="font-display text-3xl font-extrabold text-primary lg:col-span-2 lg:text-4xl">{t('friends.title')}</h1>

      <div className="flex flex-col gap-7">
        <section aria-labelledby="friends-add">
          <h2 id="friends-add" className={sectionTitle}>
            {t('friends.add')}
          </h2>
          <form onSubmit={add} className="mt-3 flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('auth.username')}</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t('friends.usernamePlaceholder')}
                autoCapitalize="none"
                spellCheck={false}
                maxLength={21}
                className="min-h-12 w-full rounded-lg border border-line bg-panel px-3 text-base"
              />
            </label>
            <Button type="submit" disabled={busy || !username.trim()}>
              {t('friends.send')}
            </Button>
          </form>
          <p className="mt-2 text-sm text-muted">{t('friends.privacy')}</p>
        </section>

        {incoming.length > 0 && (
          <section aria-labelledby="friends-incoming">
            <h2 id="friends-incoming" className={sectionTitle}>
              {t('friends.incoming')}
            </h2>
            <ul className="mt-3 divide-y divide-line border-y border-line" data-testid="friend-requests">
              {incoming.map((contact) => (
                <li key={contact.userId} className="flex flex-wrap items-center gap-2 py-3">
                  <Name contact={contact} />
                  <Button className="min-h-10 px-3 text-sm" onClick={() => void actions.respond(contact.userId, true)}>
                    {t('friends.accept')}
                  </Button>
                  <Button variant="ghost" className="min-h-10 bg-panel px-3 text-sm" onClick={() => void actions.respond(contact.userId, false)}>
                    {t('friends.decline')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {outgoing.length > 0 && (
          <section aria-labelledby="friends-outgoing">
            <h2 id="friends-outgoing" className={sectionTitle}>
              {t('friends.outgoing')}
            </h2>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {outgoing.map((contact) => (
                <li key={contact.userId} className="flex items-center gap-2 py-3">
                  <Name contact={contact} />
                  <Button variant="ghost" className="min-h-10 bg-panel px-3 text-sm" onClick={() => void actions.remove(contact.userId)}>
                    {t('friends.cancel')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section aria-labelledby="friends-list">
        <h2 id="friends-list" className={sectionTitle}>
          {t('friends.list')}
        </h2>
        {contacts.isPending ? (
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : contacts.isError ? (
          <div role="alert" className="mt-3 flex flex-col items-start gap-3">
            <p>{t('friends.loadFailed')}</p>
            <Button variant="ghost" onClick={() => void contacts.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : friends.length === 0 ? (
          <p className="mt-3 text-muted">{t('friends.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line" data-testid="friends">
            {friends.map((contact) => (
              <li key={contact.userId} className="flex items-center gap-2 py-3">
                <Name contact={contact} />
                {contact.unread > 0 && (
                  <span className="flex min-w-6 justify-center rounded-full bg-hibiscus px-1.5 text-sm font-bold text-white" aria-label={t('friends.unread', { count: contact.unread })}>
                    {contact.unread}
                  </span>
                )}
                <Link to={`/friends/${contact.username}`} className={buttonClass('primary', 'min-h-10 px-4 text-sm')}>
                  {t('friends.message')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
