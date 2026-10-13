import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// "Report a problem" and the hub's own emails, in the database: what a player may send and
// read, what is put in the queue for sending, and how the sending function takes emails out of
// it and says what became of them.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0

const player = async (language = 'en') => {
  const name = `sup${++n}`
  users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'KE', age_confirmed: true, preferred_language: language })
  return name
}
const as = <T>(user: string, work: () => Promise<T>) => db.as('authenticated', users[user]!, work)
const submit = async (user: string, category: string, message: string, page: string | null = null): Promise<Json> =>
  as(user, async () => (await db.rows<{ r: Json }>(`select public.submit_support_request($1, $2, $3, $4) as r`, [category, message, page, 'Test phone']))[0]!.r)
const outbox = (where = 'true') => db.rows<Json>(`select id, to_email, reply_to, template, language, data, status, attempts, last_error from private.mail_outbox where ${where} order by id`)

beforeAll(async () => {
  db = await createTestDb()
}, 120_000)
afterAll(async () => {
  await db.close()
})

describe('a player reports a problem', () => {
  it('the report is kept, the player is emailed to say so, and the support mailbox is told with the player to reply to', async () => {
    const amina = await player('fr')
    const reply = await submit(amina, 'tokens', 'My tokens did not come back after the game was called off.', '/wallet')
    expect(reply).toMatchObject({ ok: true })
    const reference = reply.reference as number

    const [kept] = await db.rows<Json>(`select user_id, category, message, page, device, status from public.support_requests where id = $1`, [reference])
    expect(kept).toEqual({ user_id: users[amina], category: 'tokens', message: 'My tokens did not come back after the game was called off.', page: '/wallet', device: 'Test phone', status: 'open' })

    const mails = await outbox(`(data ->> 'reference')::bigint = ${reference}`)
    expect(mails).toHaveLength(2)
    // To the player, in their own language.
    expect(mails[0]).toMatchObject({ to_email: `${amina}@example.com`, reply_to: null, template: 'support_received', language: 'fr', status: 'queued' })
    expect(mails[0]!.data).toMatchObject({ name: amina, reference, message: 'My tokens did not come back after the game was called off.' })
    // To our team, answerable straight to the player.
    expect(mails[1]).toMatchObject({ to_email: 'support@africangamehub.com', reply_to: `${amina}@example.com`, template: 'support_notice', language: 'en' })
    expect(mails[1]!.data).toMatchObject({ email: `${amina}@example.com`, user_id: users[amina], page: '/wallet' })
  })

  it('a report that says nothing, or names no real subject, is refused; so is one from nobody', async () => {
    const bob = await player()
    expect(await submit(bob, 'bug', 'help')).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await submit(bob, 'bug', '          short   ')).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await submit(bob, 'gossip', 'This is long enough to be a message.')).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await submit(bob, 'bug', 'x'.repeat(2001))).toEqual({ ok: false, code: 'BAD_REQUEST' })
    await expect(db.as('anon', null, () => db.pg.query(`select public.submit_support_request('bug', 'A long enough message here.', null, null)`))).rejects.toThrow(/permission denied/)
    expect(await db.rows(`select 1 from public.support_requests where user_id = $1`, [users[bob]])).toEqual([])
  })

  it('three reports a day, and no more', async () => {
    const chidi = await player()
    for (let i = 0; i < 3; i++) expect(await submit(chidi, 'game', `Problem number ${i + 1} with a game.`)).toMatchObject({ ok: true })
    expect(await submit(chidi, 'game', 'A fourth problem with a game.')).toEqual({ ok: false, code: 'TOO_MANY_REQUESTS' })
    // Tomorrow they may write again.
    await db.pg.query(`update public.support_requests set created_at = created_at - interval '25 hours' where user_id = $1`, [users[chidi]])
    expect(await submit(chidi, 'game', 'A problem on the next day.')).toMatchObject({ ok: true })
  })

  it('a player reads their own reports and nobody else’s, and can change none of them', async () => {
    const dayo = await player()
    const efua = await player()
    const { reference } = await submit(dayo, 'account', 'I cannot change my display name.')
    await submit(efua, 'other', 'A different matter altogether.')

    const mine = await as(dayo, () => db.rows<Json>(`select id, category, message, status, created_at, answered_at from public.support_requests`))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ id: reference, category: 'account', status: 'open' })
    // What our team writes about a report is not the player's to read.
    await expect(as(dayo, () => db.pg.query(`select admin_note from public.support_requests`))).rejects.toThrow(/permission denied/)
    for (const sql of [
      `update public.support_requests set status = 'closed' where id = ${reference}`,
      `delete from public.support_requests where id = ${reference}`,
      `insert into public.support_requests (user_id, category, message) values ('${users[dayo]}', 'bug', 'Written straight into the table.')`,
    ]) {
      await expect(as(dayo, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
    }
    expect(await db.as('anon', null, () => db.rows(`select 1 from public.support_requests`).catch(() => 'denied'))).toBe('denied')
  })
})

describe('the welcome email', () => {
  it('is queued once, when an account’s address is confirmed, in the player’s language', async () => {
    const id = await db.createUser('newcomer@example.com', { username: 'newcomer', country_code: 'SN', age_confirmed: true, preferred_language: 'fr' }, false)
    expect(await outbox(`to_email = 'newcomer@example.com'`)).toEqual([])

    await db.pg.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id])
    const mails = await outbox(`to_email = 'newcomer@example.com'`)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ template: 'welcome', language: 'fr', status: 'queued', data: { name: 'newcomer' } })

    // Confirmed again (a changed address, say): no second welcome.
    await db.pg.query(`update auth.users set email_confirmed_at = null where id = $1`, [id])
    await db.pg.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id])
    expect(await outbox(`to_email = 'newcomer@example.com'`)).toHaveLength(1)
  })

  it('an account made already confirmed (by our team, or for a test) is not written to', async () => {
    await db.createUser('made-confirmed@example.com', { username: 'made_confirmed', country_code: 'RW', age_confirmed: true })
    expect(await outbox(`to_email = 'made-confirmed@example.com'`)).toEqual([])
  })
})

describe('the queue', () => {
  const claim = async (limit: number | null) => (await db.as('service_role', null, () => db.rows<{ r: Json[] }>(`select public.mail_claim($1) as r`, [limit])))[0]!.r

  it('hands out the oldest emails first, a few at a time, and never the same one twice', async () => {
    await db.pg.exec(`update private.mail_outbox set status = 'sent'`)
    await db.pg.exec(`insert into private.mail_outbox (to_email, template, data) select 'q' || g || '@example.com', 'welcome', '{}' from generate_series(1, 6) g`)
    const first = await claim(2)
    expect(first.map((m) => m.to_email)).toEqual(['q1@example.com', 'q2@example.com'])
    expect(first[0]).toMatchObject({ template: 'welcome', language: 'en' })
    // Unless told otherwise, as many as the mailbox's pace allows: four.
    const second = await claim(null)
    expect(second.map((m) => m.to_email)).toEqual(['q3@example.com', 'q4@example.com', 'q5@example.com', 'q6@example.com'])
    expect(await claim(null)).toEqual([])
  })

  it('an email that was sent is done; one that failed is tried again later, five times in all', async () => {
    await db.pg.exec(`update private.mail_outbox set status = 'sent'`)
    await db.pg.exec(`insert into private.mail_outbox (to_email, template) values ('good@example.com', 'welcome'), ('bad@example.com', 'welcome')`)
    const [good, bad] = await claim(null)
    await db.as('service_role', null, () => db.pg.query(`select public.mail_done($1, true, null)`, [good!.id]))
    await db.as('service_role', null, () => db.pg.query(`select public.mail_done($1, false, 'The mailbox refused it')`, [bad!.id]))
    expect(await outbox(`to_email = 'good@example.com'`)).toMatchObject([{ status: 'sent', attempts: 1, last_error: null }])
    expect(await outbox(`to_email = 'bad@example.com'`)).toMatchObject([{ status: 'queued', attempts: 1, last_error: 'The mailbox refused it' }])
    // Not at once: it waits its turn.
    expect(await claim(null)).toEqual([])

    for (let attempt = 2; attempt <= 5; attempt++) {
      await db.pg.exec(`update private.mail_outbox set not_before = now() where to_email = 'bad@example.com'`)
      const [again] = await claim(null)
      expect(again!.id).toBe(bad!.id)
      await db.as('service_role', null, () => db.pg.query(`select public.mail_done($1, false, 'Still refused')`, [bad!.id]))
    }
    expect(await outbox(`to_email = 'bad@example.com'`)).toMatchObject([{ status: 'failed', attempts: 5, last_error: 'Still refused' }])
    await db.pg.exec(`update private.mail_outbox set not_before = now() where to_email = 'bad@example.com'`)
    expect(await claim(null)).toEqual([])
  })

  it('emails claimed while the mailbox is not set up are put back, with no try spent', async () => {
    await db.pg.exec(`update private.mail_outbox set status = 'sent' where status = 'queued'`)
    await db.pg.exec(`insert into private.mail_outbox (to_email, template) values ('wait@example.com', 'welcome')`)
    const [waiting] = await claim(null)
    await db.as('service_role', null, () => db.pg.query(`select public.mail_release($1)`, [[waiting!.id]]))
    expect(await outbox(`to_email = 'wait@example.com'`)).toMatchObject([{ status: 'queued', attempts: 0 }])
  })

  it('an email left "being sent" by a function that died is offered again after ten minutes', async () => {
    await db.pg.exec(`update private.mail_outbox set status = 'sent' where status = 'queued'`)
    await db.pg.exec(`insert into private.mail_outbox (to_email, template) values ('stuck@example.com', 'welcome')`)
    const [stuck] = await claim(null)
    expect(await claim(null)).toEqual([])
    await db.pg.exec(`update private.mail_outbox set claimed_at = now() - interval '11 minutes' where id = ${stuck!.id}`)
    expect((await claim(null)).map((m) => m.id)).toEqual([stuck!.id])
  })

  it('no player can read the queue, take from it, or reach the settings and their key', async () => {
    const fola = await player()
    for (const sql of [`select * from private.mail_outbox`, `select * from private.mail_settings`, `select public.mail_claim(5)`, `select public.mail_done(1, true, null)`, `select public.mail_release('{1}')`, `select private.queue_mail('x@example.com', 'welcome', 'en', '{}')`]) {
      await expect(as(fola, () => db.pg.query(sql))).rejects.toThrow(/permission denied/)
    }
  })
})
