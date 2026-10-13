// Sets a project up to send the hub's own emails (see supabase/functions/core-mail).
// Usage: npm run mail:setup                 (the live project)
//        npm run on-dev -- mail:setup       (the development project)
//
// It does three things, all safe to do again:
//   1. makes the key by which the database proves to the sending function that a call is its
//      own, and gives it to both (it is never printed);
//   2. tells the sending function which mailbox to use: the same one the project's sign-up
//      emails already go out through (read from the project's own settings);
//   3. says what is still missing.
// The one thing it cannot do is the mailbox's password: that is entered by the owner, in the
// Supabase dashboard, as the Edge Function secret SMTP_PASS.
import { randomBytes } from 'node:crypto'
import { managementFetch, requireEnv, runSql } from './lib/managementApi.ts'

const url = requireEnv('VITE_SUPABASE_URL').replace(/\/$/, '')
const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY')

async function expectOk(response: Response, what: string) {
  if (!response.ok) throw new Error(`${what} failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
}

// The mailbox the project already sends its sign-up emails through.
const authConfig = await managementFetch('/config/auth')
await expectOk(authConfig, 'Reading the project settings')
const auth = (await authConfig.json()) as { smtp_host?: string | null; smtp_port?: string | number | null; smtp_user?: string | null; smtp_sender_name?: string | null }
if (!auth.smtp_host || !auth.smtp_user) {
  throw new Error('This project has no mailbox set for its sign-up emails (Authentication > Emails > SMTP settings). Set that first.')
}

// A key is kept once made, so that running this again does not break a function that already holds it.
const [existing] = await runSql<{ cron_key: string | null }>(`select cron_key from private.mail_settings`)
const cronKey = existing?.cron_key ?? randomBytes(32).toString('hex')
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`
await runSql(`update private.mail_settings set functions_url = ${literal(`${url}/functions/v1`)}, anon_key = ${literal(anonKey)}, cron_key = ${literal(cronKey)}`)

const secrets = [
  { name: 'MAIL_CRON_KEY', value: cronKey },
  { name: 'SMTP_HOST', value: auth.smtp_host },
  { name: 'SMTP_PORT', value: String(auth.smtp_port ?? 465) },
  { name: 'SMTP_USER', value: auth.smtp_user },
  { name: 'MAIL_FROM_NAME', value: auth.smtp_sender_name || 'African Game Hub' },
]
await expectOk(await managementFetch('/secrets', { method: 'POST', body: JSON.stringify(secrets) }), 'Setting the function secrets')

const listed = await managementFetch('/secrets')
await expectOk(listed, 'Reading the function secrets')
const names = new Set(((await listed.json()) as { name: string }[]).map((secret) => secret.name))
const [cron] = await runSql<{ scheduled: boolean; net: boolean }>(
  `select exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'agh-mail') as scheduled,
          exists (select 1 from pg_extension where extname = 'pg_net') as net`,
)

console.log(`Mailbox: ${auth.smtp_user} at ${auth.smtp_host}:${auth.smtp_port ?? 465}`)
console.log(`Key shared between the database and the sending function: set`)
console.log(`Woken once a minute by the database: ${cron?.scheduled && cron.net ? 'yes' : 'NO (pg_cron or pg_net is missing)'}`)
console.log(names.has('SMTP_PASS') ? 'Mailbox password (SMTP_PASS): set' : 'Mailbox password (SMTP_PASS): NOT SET. Enter it in the Supabase dashboard: Edge Functions > Secrets > add SMTP_PASS. Until then emails wait in the queue; none are lost.')
