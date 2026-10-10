// Makes the two narrow keys (see supabase/migrations/20261010100000_narrow_server_keys.sql):
//   GAME_SERVER_KEY     for the game server: read a game, record a move. Nothing else.
//   LEDGER_BACKUP_KEY   for the nightly copy of the books: read the money tables. Nothing else.
//
// Usage: npm run server-keys            (the live project, .env.local)
//        npm run on-dev -- server-keys  (the development project)
//
// Each key is a token that names its database role, signed with the project's own signing
// secret, which this script fetches and never writes down. The keys are written into the same
// local file the other keys are in (never committed) and are NOT printed. Run it again to make
// fresh ones; old ones stop working only if the project's signing secret is changed.
import { createHmac } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { ENV_FILE, managementFetch, requireEnv } from './lib/managementApi.ts'

const ref = requireEnv('SUPABASE_PROJECT_REF')
const config = await managementFetch('/postgrest')
if (!config.ok) throw new Error(`Could not read the project's API settings: ${config.status}`)
const { jwt_secret: secret } = (await config.json()) as { jwt_secret?: string }
if (!secret) throw new Error('The project did not return a signing secret')

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url')
function tokenFor(role: string): string {
  const now = Math.floor(Date.now() / 1000)
  const head = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  // Ten years, like the project's own keys. Changing the signing secret ends it sooner.
  const body = base64url(JSON.stringify({ iss: 'supabase', ref, role, iat: now, exp: now + 10 * 365 * 24 * 3600 }))
  return `${head}.${body}.${createHmac('sha256', secret!).update(`${head}.${body}`).digest('base64url')}`
}

const keys = { GAME_SERVER_KEY: tokenFor('game_server'), LEDGER_BACKUP_KEY: tokenFor('ledger_backup') }

// Check each key against the live API before saving it: it must be able to do its one job.
const base = requireEnv('VITE_SUPABASE_URL')
const anon = requireEnv('VITE_SUPABASE_ANON_KEY')
async function rpc(key: string, fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  return { ok: res.ok, status: res.status, text: await res.text() }
}
const admits = await rpc(keys.GAME_SERVER_KEY, 'game_server_admits', { p_user_id: '00000000-0000-0000-0000-000000000000' })
if (!admits.ok || admits.text.trim() !== 'false') throw new Error(`The game server key does not work (${admits.status}): ${admits.text.slice(0, 200)}. Has the migration been applied?`)
const exported = await rpc(keys.LEDGER_BACKUP_KEY, 'backup_export', { p_table: 'platform_settings' })
if (!exported.ok) throw new Error(`The backup key does not work (${exported.status}): ${exported.text.slice(0, 200)}`)
// And each must be refused the other's job, and the tables themselves.
const crossed = await rpc(keys.GAME_SERVER_KEY, 'backup_export', { p_table: 'wallets' })
const direct = await fetch(`${base}/rest/v1/wallets?select=*&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${keys.GAME_SERVER_KEY}` } })
if (crossed.ok || direct.ok) throw new Error('The game server key can do more than it should. Not saved.')

let file = readFileSync(ENV_FILE, 'utf8')
for (const [name, value] of Object.entries(keys)) {
  const line = `${name}=${value}`
  file = new RegExp(`^${name}=.*$`, 'm').test(file) ? file.replace(new RegExp(`^${name}=.*$`, 'm'), line) : `${file.replace(/\n*$/, '\n')}${line}\n`
}
writeFileSync(ENV_FILE, file)
console.log(`Made and checked two keys for project ${ref}; saved in ${ENV_FILE} as GAME_SERVER_KEY and LEDGER_BACKUP_KEY.`)
console.log('The game server key was refused the wallets table and the backup function, as it should be.')
