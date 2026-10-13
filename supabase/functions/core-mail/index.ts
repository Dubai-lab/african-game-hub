// Sends the hub's own emails. It is woken once a minute by the database (never by a player),
// takes the next few emails out of the queue, sends each through the hub's mailbox, and writes
// down what became of it. An email that cannot be sent stays in the queue and is tried again.
//
// It needs these secrets on the project:
//   MAIL_CRON_KEY   proves a call comes from our own database (set by scripts/setupMail.ts)
//   SMTP_HOST, SMTP_PORT, SMTP_USER   the mailbox to send from (set by scripts/setupMail.ts)
//   SMTP_PASS       that mailbox's password (entered by the owner, never by a script)
// and may be given:
//   MAIL_SITE_URL, MAIL_SUPPORT_ADDRESS, MAIL_FROM_NAME
import nodemailer from 'npm:nodemailer@6'
import { admin } from '../_shared/http.ts'
import { type MailData, type MailTemplate, renderMail } from '../_shared/mailTemplates.ts'

type Queued = { id: number; to_email: string; reply_to: string | null; template: MailTemplate; language: string; data: MailData }

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** Compares two secrets without giving away, by how long it takes, how much of a guess was right. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const key = Deno.env.get('MAIL_CRON_KEY') ?? ''
  if (key.length < 20 || !same(request.headers.get('x-mail-key') ?? '', key)) return reply({ ok: false, code: 'FORBIDDEN' }, 403)

  try {
    const claimed = await admin.rpc('mail_claim', { p_limit: null })
    if (claimed.error) throw claimed.error
    const queue = (claimed.data ?? []) as Queued[]
    if (queue.length === 0) return reply({ ok: true, sent: 0 })

    const host = Deno.env.get('SMTP_HOST')
    const user = Deno.env.get('SMTP_USER')
    const pass = Deno.env.get('SMTP_PASS')
    const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
    if (!host || !user || !pass) {
      // Not set up yet: nothing is lost, and nothing is counted as a failed try.
      await admin.rpc('mail_release', { p_ids: queue.map((mail) => mail.id) })
      return reply({ ok: false, code: 'NOT_CONFIGURED', waiting: queue.length })
    }

    const context = {
      siteUrl: (Deno.env.get('MAIL_SITE_URL') ?? 'https://africangamehub.com').replace(/\/$/, ''),
      supportAddress: Deno.env.get('MAIL_SUPPORT_ADDRESS') ?? 'support@africangamehub.com',
    }
    const from = { name: Deno.env.get('MAIL_FROM_NAME') ?? 'African Game Hub', address: user }
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })

    let sent = 0
    let failed = 0
    for (const mail of queue) {
      try {
        const rendered = renderMail(mail.template, mail.language, mail.data, context)
        await transport.sendMail({
          from,
          to: mail.to_email,
          // An answer goes to people, not to the address that only sends.
          replyTo: mail.reply_to ?? context.supportAddress,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        })
        await admin.rpc('mail_done', { p_id: mail.id, p_ok: true, p_error: null })
        sent++
      } catch (error) {
        failed++
        // What went wrong is kept with the email (never the password: the mail library does not put it in its errors).
        await admin.rpc('mail_done', { p_id: mail.id, p_ok: false, p_error: error instanceof Error ? error.message : String(error) })
      }
    }
    transport.close()
    return reply({ ok: true, sent, failed })
  } catch (error) {
    console.error('[core-mail]', error)
    return reply({ ok: false, code: 'SERVER_ERROR' }, 500)
  }
})
