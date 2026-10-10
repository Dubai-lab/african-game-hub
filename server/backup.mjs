// A copy of the books, to keep somewhere that is not the database.
//
//   node server/backup.mjs [folder]         (or: npm run backup:ledger)
//
// Reads every money table through the one function the backup key is allowed to call, and
// writes them into a single compressed file: <folder>/ledger-<date>.json.gz. It also checks the
// copy against itself before calling it good: every wallet must equal the sum of its ledger
// entries. A copy that fails that check is still written (it is evidence), but the script ends
// with an error so whoever runs it nightly is told.
//
// Needs only Node 22: no packages, so it can run on any machine. Configuration:
//   SUPABASE_URL         the project's address
//   SUPABASE_ANON_KEY    the public key
//   LEDGER_BACKUP_KEY    the backup's own key (made by `npm run server-keys`): it can read
//                        these tables and nothing else, and can change nothing.
// The copy holds account ids and usernames, balances and every token movement. It holds no
// emails, phone numbers or passwords. Keep it private all the same.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

if (process.env.AGH_ENV_FILE) process.loadEnvFile(process.env.AGH_ENV_FILE)
else if (!process.env.SUPABASE_URL && !process.env.VITE_SUPABASE_URL) {
  try {
    process.loadEnvFile('.env.local')
  } catch {
    // Not run from the project folder: the environment must carry the settings.
  }
}
const need = (...names) => {
  for (const name of names) if (process.env[name]) return process.env[name]
  throw new Error(`${names[0]} is not set`)
}
const url = need('SUPABASE_URL', 'VITE_SUPABASE_URL')
const anon = need('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
const key = need('LEDGER_BACKUP_KEY')
const folder = process.argv[2] ?? 'backups'

const TABLES = ['platform_settings', 'profiles', 'wallets', 'ledger_entries', 'escrow', 'matches', 'match_players', 'payments', 'platform_revenue', 'tournaments', 'tournament_players', 'tournament_prizes', 'player_ratings']
const PAGE = 2000

async function page(table, after) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${url}/rest/v1/rpc/backup_export`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_table: table, p_after: after, p_limit: PAGE }),
    })
    if (res.ok) return res.json()
    if (attempt >= 4) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 200)}`)
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
  }
}

const startedAt = new Date()
const tables = {}
for (const table of TABLES) {
  const rows = []
  for (;;) {
    const batch = await page(table, rows.length)
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  tables[table] = rows
}

// The copy must agree with itself. (The tables are read one after another while the site is
// live, so an entry written in the few seconds between reading the wallets and reading the
// ledger can show up as a difference: those are listed, and judged below.)
const sums = new Map()
for (const entry of tables.ledger_entries) {
  const id = `${entry.user_id}:${entry.balance_type}`
  sums.set(id, (sums.get(id) ?? 0n) + BigInt(entry.amount))
}
const differences = []
for (const wallet of tables.wallets) {
  for (const kind of ['bonus', 'cash']) {
    const held = BigInt(wallet[`${kind}_balance`])
    const summed = sums.get(`${wallet.user_id}:${kind}`) ?? 0n
    if (held !== summed) differences.push({ user_id: wallet.user_id, kind, wallet: held.toString(), ledger: summed.toString() })
  }
}
// A difference is only excused when that account's ledger moved while the copy was being taken.
const moved = new Set(tables.ledger_entries.filter((entry) => new Date(entry.created_at) >= startedAt).map((entry) => entry.user_id))
const unexplained = differences.filter((difference) => !moved.has(difference.user_id))

const counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]))
const copy = { format: 1, project: url, taken_at: startedAt.toISOString(), counts, check: { wallets_equal_ledger: unexplained.length === 0, differences }, tables }
mkdirSync(folder, { recursive: true })
const file = join(folder, `ledger-${startedAt.toISOString().replace(/[:.]/g, '-')}.json.gz`)
const bytes = gzipSync(JSON.stringify(copy))
writeFileSync(file, bytes)

console.log(JSON.stringify({ time: new Date().toISOString(), event: 'ledger_backup', file, bytes: bytes.length, counts, wallets_equal_ledger: unexplained.length === 0, differences: differences.length }))
if (unexplained.length > 0) {
  console.error(JSON.stringify({ level: 'error', event: 'ledger_backup_mismatch', unexplained }))
  process.exit(2)
}
