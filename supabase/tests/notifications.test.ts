import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// Notifications, announcements, the answers to "Report a problem", and the list of phones to
// send notifications on to: what the database writes by itself, what a player may read and
// change, and what our team may do (called the way the admin-api Edge Function calls it).

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

const player = async (language = 'en', confirmed = true) => {
  const name = `note${++n}`
  users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'UG', age_confirmed: true, preferred_language: language }, confirmed)
  return name
}
const as = <T>(user: string, work: () => Promise<T>) => db.as('authenticated', users[user]!, work)
const call = async (user: string, sql: string, params: unknown[] = []): Promise<Json> => as(user, async () => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r)
const service = async (sql: string, params: unknown[] = []): Promise<Json> => db.as('service_role', null, async () => (await db.rows<{ r: Json }>(`select ${sql} as r`, params))[0]!.r)
const notes = (user: string) => db.rows<Json>(`select id, kind, data, read_at, pushed_at from public.notifications where user_id = $1 order by id`, [users[user]])
const mails = (address: string, template: string) => db.rows<Json>(`select template, language, data, priority, status from private.mail_outbox where to_email = $1 and template = $2 order by id`, [address, template])

beforeAll(async () => {
  db = await createTestDb()
  users.boss = await db.createUser('noteboss@example.com', { username: 'noteboss', country_code: 'UG', age_confirmed: true })
  await db.pg.query(`insert into public.admins (user_id) values ($1)`, [users.boss])
}, 120_000)
afterAll(async () => {
  expect(await db.integrityProblems()).toEqual([])
  await db.close()
})

describe('what a player is told', () => {
  it('a friend request tells the one asked; accepting it tells the one who asked', async () => {
    const amina = await player()
    const bayo = await player()
    expect(await call(amina, `public.send_friend_request($1)`, [bayo])).toMatchObject({ ok: true })
    expect(await notes(bayo)).toMatchObject([{ kind: 'friend_request', data: { username: amina }, read_at: null }])
    expect(await notes(amina)).toEqual([])

    expect(await call(bayo, `public.respond_friend_request($1, true)`, [users[amina]])).toMatchObject({ ok: true })
    expect(await notes(amina)).toMatchObject([{ kind: 'friend_accepted', data: { username: bayo } }])
    expect(await notes(bayo)).toHaveLength(1)
  })

  it('a player reads their own notifications only, marks them read, and can write none', async () => {
    const chika = await player()
    const dayo = await player()
    const efua = await player()
    await call(chika, `public.send_friend_request($1)`, [dayo])
    await call(efua, `public.send_friend_request($1)`, [dayo])
    await call(dayo, `public.send_friend_request($1)`, [await player()])

    const mine = await as(dayo, () => db.rows<Json>(`select id, kind, data, created_at, read_at from public.notifications order by id`))
    expect(mine.map((m) => m.data.username)).toEqual([chika, efua])
    // Whether it went to a phone is not the player's business.
    await expect(as(dayo, () => db.pg.query(`select pushed_at from public.notifications`))).rejects.toThrow(/permission denied/)
    for (const sql of [
      `update public.notifications set read_at = null`,
      `delete from public.notifications`,
      `insert into public.notifications (user_id, kind) values ('${users[dayo]}', 'announcement')`,
    ]) {
      await expect(as(dayo, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
    }
    expect(await db.as('anon', null, () => db.rows(`select 1 from public.notifications`).catch(() => 'denied'))).toBe('denied')

    // Read up to the first: the second stays new.
    await as(dayo, () => db.pg.query(`select public.mark_notifications_read($1)`, [mine[0]!.id]))
    expect((await notes(dayo)).map((m) => m.read_at !== null)).toEqual([true, false])
    await as(dayo, () => db.pg.query(`select public.mark_notifications_read()`))
    expect((await notes(dayo)).every((m) => m.read_at !== null)).toBe(true)
    // And nobody else's were touched.
    expect((await notes(chika)).every((m) => m.read_at === null)).toBe(true)
  })
})

describe('news emails', () => {
  it('are on until the player switches them off, and only for themselves', async () => {
    const fola = await player()
    const gift = await player()
    const wants = async (user: string) => (await db.rows<{ news_emails: boolean }>(`select news_emails from public.profile_private where user_id = $1`, [users[user]]))[0]!.news_emails
    expect(await wants(fola)).toBe(true)
    await as(fola, () => db.pg.query(`select public.set_news_emails(false)`))
    expect(await wants(fola)).toBe(false)
    expect(await wants(gift)).toBe(true)
    await expect(as(fola, () => db.pg.query(`update public.profile_private set news_emails = true`))).rejects.toThrow(/permission denied/)
    await expect(db.as('anon', null, () => db.pg.query(`select public.set_news_emails(false)`))).rejects.toThrow(/permission denied/)
  })
})

describe('an announcement from our team', () => {
  it('reaches every player in the app; by email only those confirmed, not banned, who want news; and not twice in ten minutes', async () => {
    const hawa = await player('fr')
    const idris = await player()
    const unconfirmed = await player('en', false)
    const banned = await player()
    await as(idris, () => db.pg.query(`select public.set_news_emails(false)`))
    await service(`public.admin_set_ban($1, $2, true, 'Abusive messages')`, [users.boss, users[banned]])

    const sent = await service(`public.admin_announce($1, $2, $3, true)`, [users.boss, '  A new game  ', 'Word Battle is now on the hub. Come and play.'])
    expect(sent).toMatchObject({ ok: true })
    for (const reader of [hawa, idris, unconfirmed]) {
      const got = (await notes(reader)).filter((m) => m.kind === 'announcement')
      expect(got).toMatchObject([{ data: { title: 'A new game', body: 'Word Battle is now on the hub. Come and play.', announcement_id: sent.id } }])
    }
    expect((await notes(banned)).filter((m) => m.kind === 'announcement')).toEqual([])

    // Behind all other mail, in the player's own language.
    expect(await mails(`${hawa}@example.com`, 'announcement')).toMatchObject([{ language: 'fr', priority: 10, status: 'queued', data: { title: 'A new game', name: hawa } }])
    for (const silent of [idris, unconfirmed, banned]) expect(await mails(`${silent}@example.com`, 'announcement')).toEqual([])
    const emails = Number((await db.rows<{ c: number }>(`select count(*)::int as c from private.mail_outbox where template = 'announcement'`))[0]!.c)
    expect(sent.emails).toBe(emails)

    // Kept, with who sent it, and written in the audit log.
    const listed = await service(`public.admin_announcements(10, 0)`)
    expect(listed).toMatchObject({ total: 1, waiting_emails: emails, rows: [{ title: 'A new game', emailed: true, created_by: 'noteboss', recipients: sent.players, emails }] })
    expect(await db.rows(`select 1 from private.admin_audit_log where action = 'announce' and admin_id = $1`, [users.boss])).toHaveLength(1)

    expect(await service(`public.admin_announce($1, 'Once more', 'The same thing said a second time.', false)`, [users.boss])).toEqual({ ok: false, code: 'TOO_SOON' })
    await db.pg.exec(`update public.announcements set created_at = created_at - interval '11 minutes'`)
    // In the app only: no email is written.
    const quiet = await service(`public.admin_announce($1, 'Maintenance', 'The hub will be closed for an hour tonight.', false)`, [users.boss])
    expect(quiet).toMatchObject({ ok: true, emails: 0 })
    expect(await mails(`${hawa}@example.com`, 'announcement')).toHaveLength(1)
  })

  it('must say something; and no player can send one or read who sent them', async () => {
    const jomo = await player()
    await db.pg.exec(`update public.announcements set created_at = created_at - interval '11 minutes'`)
    expect(await service(`public.admin_announce($1, 'Hi', 'Long enough to be a message.', false)`, [users.boss])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await service(`public.admin_announce($1, 'A title', 'short', false)`, [users.boss])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    for (const sql of [`select public.admin_announce('${users[jomo]}', 'A title', 'Long enough to be a message.', true)`, `select public.admin_announcements(10, 0)`, `select created_by from public.announcements`, `insert into public.announcements (title, body, created_by) values ('A title', 'Long enough to be a message.', '${users[jomo]}')`]) {
      await expect(as(jomo, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
    }
    // What was announced is theirs to read.
    expect((await as(jomo, () => db.rows(`select id, title, body, created_at from public.announcements`))).length).toBeGreaterThan(0)
  })
})

describe('our team answers a report', () => {
  it('the answer is emailed to the player in their language, they are told in the app, and it cannot be answered twice', async () => {
    const kofi = await player('fr')
    const { reference } = await call(kofi, `public.submit_support_request('tokens', 'My tokens did not come back after the game.', '/wallet', 'Test phone')`)

    const waiting = await service(`public.admin_support_requests('open', 10, 0)`)
    expect(waiting.rows.find((r: Json) => r.id === reference)).toMatchObject({ username: kofi, email: `${kofi}@example.com`, category: 'tokens', page: '/wallet', status: 'open' })

    expect(await service(`public.admin_answer_support($1, $2, 'answered', 'short')`, [users.boss, reference])).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await service(`public.admin_answer_support($1, $2, 'answered', $3)`, [users.boss, reference, 'Your 50 tokens are back in your wallet. Sorry for the trouble.'])).toEqual({ ok: true })
    expect(await mails(`${kofi}@example.com`, 'support_answered')).toMatchObject([
      { language: 'fr', status: 'queued', data: { name: kofi, reference, reply: 'Your 50 tokens are back in your wallet. Sorry for the trouble.', message: 'My tokens did not come back after the game.' } },
    ])
    expect((await notes(kofi)).filter((m) => m.kind === 'support_answered')).toMatchObject([{ data: { reference } }])
    // The player sees it was answered, and when; not the note our team keeps.
    expect(await as(kofi, () => db.rows<Json>(`select status, answered_at is not null as answered from public.support_requests where id = $1`, [reference]))).toEqual([{ status: 'answered', answered: true }])

    expect(await service(`public.admin_answer_support($1, $2, 'answered', 'A second answer to the same report.')`, [users.boss, reference])).toEqual({ ok: false, code: 'REQUEST_NOT_OPEN' })
    expect(await mails(`${kofi}@example.com`, 'support_answered')).toHaveLength(1)
    const answered = await service(`public.admin_support_requests('answered', 10, 0)`)
    expect(answered.rows.find((r: Json) => r.id === reference)).toMatchObject({ answered_by: 'noteboss', admin_note: 'Your 50 tokens are back in your wallet. Sorry for the trouble.' })
  })

  it('a report closed without an answer sends the player nothing', async () => {
    const lina = await player()
    const { reference } = await call(lina, `public.submit_support_request('other', 'asdf asdf asdf asdf asdf', null, null)`)
    expect(await service(`public.admin_answer_support($1, $2, 'closed', null)`, [users.boss, reference])).toEqual({ ok: true })
    expect(await mails(`${lina}@example.com`, 'support_answered')).toEqual([])
    expect((await notes(lina)).filter((m) => m.kind === 'support_answered')).toEqual([])
    for (const sql of [`select public.admin_support_requests('open', 10, 0)`, `select public.admin_answer_support('${users[lina]}', ${reference}, 'answered', 'I answer my own report.')`]) {
      await expect(as(lina, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
    }
  })
})

describe('emails about a player’s own account', () => {
  it('a suspended player is emailed once, with the reason; and again when the account is restored', async () => {
    const musa = await player('fr')
    await service(`public.admin_set_ban($1, $2, true, 'Several accounts')`, [users.boss, users[musa]])
    // Said again (the reason is corrected): no second email.
    await service(`public.admin_set_ban($1, $2, true, 'Several accounts, used to pass tokens')`, [users.boss, users[musa]])
    expect(await mails(`${musa}@example.com`, 'account_suspended')).toMatchObject([{ language: 'fr', data: { name: musa, reason: 'Several accounts' } }])
    await service(`public.admin_set_ban($1, $2, false, 'Explained to us; one account kept')`, [users.boss, users[musa]])
    expect(await mails(`${musa}@example.com`, 'account_restored')).toHaveLength(1)
  })
})

describe('notifications sent on to phones', () => {
  const claim = async (limit = 50) => (await db.as('service_role', null, () => db.rows<{ r: Json[] }>(`select public.push_claim($1) as r`, [limit])))[0]!.r
  const subscribe = (user: string, endpoint: string, language = 'en') => call(user, `public.save_push_subscription($1, $2, $3, $4)`, [endpoint, 'p'.repeat(87), 'a'.repeat(22), language])

  it('a player signs a phone up, and only what is theirs, new and unread goes to it, once', async () => {
    const nia = await player()
    const obi = await player()
    const pemi = await player()
    await claim(200)
    expect(await subscribe(nia, 'https://push.example.com/nia-phone', 'fr')).toEqual({ ok: true })
    expect(await subscribe(nia, 'http://push.example.com/not-safe')).toEqual({ ok: false, code: 'BAD_REQUEST' })

    await call(obi, `public.send_friend_request($1)`, [nia])
    await call(obi, `public.send_friend_request($1)`, [pemi])
    const taken = await claim()
    expect(taken).toHaveLength(1)
    expect(taken[0]).toMatchObject({ kind: 'friend_request', data: { username: obi }, to: [{ endpoint: 'https://push.example.com/nia-phone', language: 'fr' }] })
    // Pemi has no phone signed up: theirs is dealt with too, and nothing waits.
    expect(await db.rows(`select 1 from public.notifications where pushed_at is null`)).toEqual([])
    expect(await claim()).toEqual([])

    // One already read in the app, and one an hour old, are not sent on.
    await call(pemi, `public.send_friend_request($1)`, [nia])
    await as(nia, () => db.pg.query(`select public.mark_notifications_read()`))
    expect(await claim()).toEqual([])
  })

  it('a phone belongs to whoever is signed in on it now; one that no longer exists is forgotten', async () => {
    const quin = await player()
    const rudo = await player()
    await subscribe(quin, 'https://push.example.com/shared-phone')
    await subscribe(rudo, 'https://push.example.com/shared-phone')
    const phones = await db.rows<Json>(`select id, user_id from public.push_subscriptions where endpoint = 'https://push.example.com/shared-phone'`)
    expect(phones).toMatchObject([{ user_id: users[rudo] }])

    await db.as('service_role', null, () => db.pg.query(`select public.push_result($1, $2)`, [[], [phones[0]!.id]]))
    expect(await db.rows(`select 1 from public.push_subscriptions where endpoint = 'https://push.example.com/shared-phone'`)).toEqual([])

    await subscribe(quin, 'https://push.example.com/quin-phone')
    await call(quin, `public.remove_push_subscription($1)`, ['https://push.example.com/quin-phone'])
    expect(await db.rows(`select 1 from public.push_subscriptions where user_id = $1`, [users[quin]])).toEqual([])
  })

  it('no player can read the phones, or take what waits for them', async () => {
    const sade = await player()
    for (const sql of [`select * from public.push_subscriptions`, `select public.push_claim(5)`, `select public.push_result('{}', '{1}')`, `delete from public.push_subscriptions`]) {
      await expect(as(sade, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
    }
  })
})
