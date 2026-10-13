// Sets a project up to send the hub's own emails and its notifications to phones
// (see supabase/functions/core-mail).
// Usage: npm run mail:setup                 (the live project)
//        npm run on-dev -- mail:setup       (the development project)
//
// It does these things, all safe to do again:
//   1. makes the key by which the database proves to the sending function that a call is its
//      own, and gives it to both (it is never printed);
//   2. tells the sending function which mailbox to use: the same one the project's sign-up
//      emails already go out through (read from the project's own settings);
//   3. makes the pair of keys that signs messages to phones: the private half goes to the
//      sending function, the public half into this project's env file (the app is built with it);
//   4. says what is still missing.
// The one thing it cannot do is the mailbox's password: that is the Edge Function secret SMTP_PASS.
import { createECDH, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { ENV_FILE, managementFetch, requireEnv, runSql } from './lib/managementApi.ts'

const url = requireEnv('VITE_SUPABASE_URL').replace(/\/$/, '')
const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY')

async function expectOk(response: Response, what: string) {
  if (!response.ok) throw new Error(`${what} failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
}
const secretNames = async () => {
  const listed = await managementFetch('/secrets')
  await expectOk(listed, 'Reading the function secrets')
  return new Set(((await listed.json()) as { name: string }[]).map((secret) => secret.name))
}
const setSecrets = async (secrets: { name: string; value: string }[]) => expectOk(await managementFetch('/secrets', { method: 'POST', body: JSON.stringify(secrets) }), 'Setting the function secrets')

// 1. The key shared by the database and the function. Kept once made, so that running this
// again does not break a function that already holds it.
const [existing] = await runSql<{ cron_key: string | null }>(`select cron_key from private.mail_settings`)
const cronKey = existing?.cron_key ?? randomBytes(32).toString('hex')
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`
await runSql(`update private.mail_settings set functions_url = ${literal(`${url}/functions/v1`)}, anon_key = ${literal(anonKey)}, cron_key = ${literal(cronKey)}`)
await setSecrets([{ name: 'MAIL_CRON_KEY', value: cronKey }])
console.log('Key shared between the database and the sending function: set')

// 2. The mailbox the project already sends its sign-up emails through.
const authConfig = await managementFetch('/config/auth')
await expectOk(authConfig, 'Reading the project settings')
const auth = (await authConfig.json()) as { smtp_host?: string | null; smtp_port?: string | number | null; smtp_user?: string | null; smtp_sender_name?: string | null }
if (auth.smtp_host && auth.smtp_user) {
  await setSecrets([
    { name: 'SMTP_HOST', value: auth.smtp_host },
    { name: 'SMTP_PORT', value: String(auth.smtp_port ?? 465) },
    { name: 'SMTP_USER', value: auth.smtp_user },
    { name: 'MAIL_FROM_NAME', value: auth.smtp_sender_name || 'African Game Hub' },
  ])
  console.log(`Mailbox: ${auth.smtp_user} at ${auth.smtp_host}:${auth.smtp_port ?? 465}`)
} else {
  console.log('Mailbox: none. This project has no mailbox set for its sign-up emails, so the hub\'s own emails wait in the queue and are not sent. (As it should be on a development project.)')
}

// 3. The keys for phones. The public half is in the env file; if it is there and the function
// holds a private half, they are a pair made here before and are left alone.
const envText = readFileSync(ENV_FILE, 'utf8')
const hasPublic = /^VITE_VAPID_PUBLIC_KEY=.+$/m.test(envText)
if (hasPublic && (await secretNames()).has('VAPID_PRIVATE_KEY')) {
  console.log('Keys for phone notifications: already set')
} else {
  const pair = createECDH('prime256v1')
  pair.generateKeys()
  const publicKey = pair.getPublicKey().toString('base64url')
  await setSecrets([
    { name: 'VAPID_PUBLIC_KEY', value: publicKey },
    { name: 'VAPID_PRIVATE_KEY', value: pair.getPrivateKey().toString('base64url') },
  ])
  const line = `VITE_VAPID_PUBLIC_KEY=${publicKey}`
  writeFileSync(ENV_FILE, /^VITE_VAPID_PUBLIC_KEY=.*$/m.test(envText) ? envText.replace(/^VITE_VAPID_PUBLIC_KEY=.*$/m, line) : `${envText.replace(/\n*$/, '\n')}\n# The public half of the key that signs notifications to phones (made by npm run mail:setup).\n${line}\n`)
  console.log(`Keys for phone notifications: made. The public half is now in ${ENV_FILE}; the site must be built again to use it.`)
}

// 4. What is still missing.
const names = await secretNames()
const [cron] = await runSql<{ scheduled: boolean; net: boolean }>(
  `select exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'agh-mail') as scheduled,
          exists (select 1 from pg_extension where extname = 'pg_net') as net`,
)
console.log(`Woken by the database: ${cron?.scheduled && cron.net ? 'yes' : 'NO (pg_cron or pg_net is missing)'}`)
if (auth.smtp_host) console.log(names.has('SMTP_PASS') ? 'Mailbox password (SMTP_PASS): set' : 'Mailbox password (SMTP_PASS): NOT SET. Until it is, emails wait in the queue; none are lost.')
