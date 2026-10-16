// Refuses to publish a secret. Called by deploy.sh before anything is uploaded:
//
//   node scripts/checkBuildSecrets.ts dist
//
// Only the public anon key belongs in a website. If any server-side secret from .env.local has
// found its way into the built files, exit with an error so nothing reaches the internet.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

const dist = process.argv[2]
if (!dist || !existsSync(dist)) {
  console.error(`Nothing to check: ${dist ?? '(no folder given)'} does not exist`)
  process.exit(1)
}

const secrets = new Map<string, string>()
const envFile = join(import.meta.dirname, '..', '.env.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN|SMTP_PASS|GAME_SERVER_KEY|LEDGER_BACKUP_KEY)\s*=\s*(.+)$/)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (value.length >= 8) secrets.set(m[1], value)
  }
}

const textExtensions = new Set(['.js', '.html', '.css', '.json', '.map', '.webmanifest', '.txt'])
const files: string[] = []
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (textExtensions.has(extname(entry.name))) files.push(path)
  }
}
walk(dist)

const stop = (message: string): never => {
  console.error(`STOP: ${message}. Nothing was uploaded.`)
  process.exit(1)
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const [name, value] of secrets) {
    if (text.includes(value)) stop(`${name} is inside ${file}`)
  }
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) stop(`a Supabase secret key is inside ${file}`)
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    const payload = Buffer.from(m[1], 'base64url').toString('utf8')
    // The only key a website may carry is the public one. Any other role is a server's key.
    const role = payload.match(/"role"\s*:\s*"(service_role|game_server|ledger_backup)"/)
    if (role) stop(`a ${role[1]} key is inside ${file}`)
  }
}
console.log(`${files.length} files checked, no secrets found`)
