// Sends what the hub has to send by itself: its own emails, and its notifications on to
// players' phones. It is woken by the database (never by a player), once a minute while
// anything waits and at once when a notification is written. Each time it:
//   * takes the next few emails out of the queue, sends each through the hub's mailbox, and
//     writes down what became of it (one that cannot be sent stays queued and is tried again);
//   * takes the notifications not yet sent on, and sends each to the browsers its player has
//     said may receive them. That is best effort: a phone that is off simply gets it later
//     from the push service, and a browser that no longer exists is forgotten.
//
// It needs these secrets on the project:
//   MAIL_CRON_KEY   proves a call comes from our own database (set by scripts/setupMail.ts)
//   SMTP_HOST, SMTP_PORT, SMTP_USER   the mailbox to send from (set by scripts/setupMail.ts)
//   SMTP_PASS       that mailbox's password
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   the pair that signs messages to phones (set by scripts/setupMail.ts)
// and may be given:
//   MAIL_SITE_URL, MAIL_SUPPORT_ADDRESS, MAIL_FROM_NAME
import nodemailer from 'npm:nodemailer@6'
import webpush from 'npm:web-push@3'
import { admin } from '../_shared/http.ts'
import { type MailData, type MailTemplate, renderMail } from '../_shared/mailTemplates.ts'
import { pushWords } from '../_shared/notificationWords.ts'

type Queued = { id: number; to_email: string; reply_to: string | null; template: MailTemplate; language: string; data: MailData }
type Phone = { id: number; endpoint: string; p256dh: string; auth: string; language: string }
type ToPush = { id: number; kind: string; data: Record<string, unknown>; to: Phone[] | null }

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** Compares two secrets without giving away, by how long it takes, how much of a guess was right. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

const siteUrl = () => (Deno.env.get('MAIL_SITE_URL') ?? 'https://africangamehub.com').replace(/\/$/, '')
const supportAddress = () => Deno.env.get('MAIL_SUPPORT_ADDRESS') ?? 'support@africangamehub.com'

async function sendEmails(): Promise<Record<string, unknown>> {
  const claimed = await admin.rpc('mail_claim', { p_limit: null })
  if (claimed.error) throw claimed.error
  const queue = (claimed.data ?? []) as Queued[]
  if (queue.length === 0) return { sent: 0 }

  const host = Deno.env.get('SMTP_HOST')
  const user = Deno.env.get('SMTP_USER')
  const pass = Deno.env.get('SMTP_PASS')
  const port = Number(Deno.env.get('SMTP_PORT') ?? '465')
  if (!host || !user || !pass) {
    // Not set up yet: nothing is lost, and nothing is counted as a failed try.
    await admin.rpc('mail_release', { p_ids: queue.map((mail) => mail.id) })
    return { code: 'NOT_CONFIGURED', waiting: queue.length }
  }

  const context = { siteUrl: siteUrl(), supportAddress: supportAddress() }
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
  return { sent, failed }
}

async function sendToPhones(): Promise<Record<string, unknown>> {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const configured = Boolean(publicKey && privateKey)
  if (configured) webpush.setVapidDetails(`mailto:${supportAddress()}`, publicKey!, privateKey!)

  const ok: number[] = []
  const gone: number[] = []
  let failed = 0
  const started = Date.now()
  // A few at a time, until none wait or this call has run long enough (an announcement to
  // every player is finished by the calls of the following minutes).
  while (Date.now() - started < 40_000) {
    // Taken (and so marked as dealt with) whether or not they can be sent on: a notification is
    // always in the app; reaching the phone as well is extra.
    const claimed = await admin.rpc('push_claim', { p_limit: 100 })
    if (claimed.error) throw claimed.error
    const waiting = (claimed.data ?? []) as ToPush[]
    if (waiting.length === 0) break
    if (!configured) return { code: 'PUSH_NOT_CONFIGURED' }

    const sends = waiting.flatMap((notification) =>
      (notification.to ?? []).map(async (phone) => {
        const words = pushWords(notification.kind, notification.data, phone.language)
        if (!words) return
        try {
          await webpush.sendNotification(
            { endpoint: phone.endpoint, keys: { p256dh: phone.p256dh, auth: phone.auth } },
            JSON.stringify({ ...words, id: notification.id }),
            // Kept for the phone for an hour, and replaced by a newer one of the same sort.
            { TTL: 3600, topic: words.tag, urgency: 'normal', timeout: 10_000 },
          )
          ok.push(phone.id)
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode
          // The browser has thrown the subscription away (the app was removed, permission taken back).
          if (status === 404 || status === 410) gone.push(phone.id)
          else failed++
        }
      }),
    )
    await Promise.all(sends)
  }
  if (ok.length > 0 || gone.length > 0) await admin.rpc('push_result', { p_ok: ok, p_gone: gone })
  return { pushed: ok.length, gone: gone.length, failed }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405)
  const key = Deno.env.get('MAIL_CRON_KEY') ?? ''
  if (key.length < 20 || !same(request.headers.get('x-mail-key') ?? '', key)) return reply({ ok: false, code: 'FORBIDDEN' }, 403)

  // Each half stands alone: trouble with the mailbox must not stop the phones, nor the other way about.
  const outcome: Record<string, unknown> = { ok: true }
  try {
    outcome.phones = await sendToPhones()
  } catch (error) {
    console.error('[core-mail] phones', error)
    outcome.phones = { code: 'SERVER_ERROR' }
  }
  // Woken for a notification just written: the emails keep to their own minute, so that
  // notifications never make the mailbox send faster than its pace.
  const phonesOnly = await request
    .json()
    .then((body) => (body as { phones_only?: unknown } | null)?.phones_only === true)
    .catch(() => false)
  if (!phonesOnly) {
    try {
      outcome.mail = await sendEmails()
    } catch (error) {
      console.error('[core-mail] mail', error)
      outcome.mail = { code: 'SERVER_ERROR' }
    }
  }
  return reply(outcome)
})
