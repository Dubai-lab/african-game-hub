// Applies every migration that has not been applied yet to the hosted database, in order.
// Usage: npm run db:push          (apply)
//        npm run db:push -- --dry (only list what would run)
//
// Each migration runs in its own transaction together with its history row, so a failure leaves
// the database exactly as it was before that file. History is kept in the same table the
// Supabase CLI uses.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSql } from './lib/managementApi.ts'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')
const dryRun = process.argv.includes('--dry')

await runSql(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  );`)

const applied = new Set(
  (await runSql<{ version: string }>(`select version from supabase_migrations.schema_migrations`)).map((r) => r.version),
)

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort()
const pending = files.filter((f) => !applied.has(f.slice(0, 14)))

if (pending.length === 0) {
  console.log(`Database is up to date (${files.length} migrations applied).`)
  process.exit(0)
}

for (const file of pending) {
  if (dryRun) {
    console.log(`pending  ${file}`)
    continue
  }
  const version = file.slice(0, 14)
  const name = file.slice(15, -4)
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  try {
    await runSql(
      `begin;\n${sql}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');\ncommit;`,
    )
    console.log(`applied  ${file}`)
  } catch (err) {
    console.error(`FAILED   ${file}\n         ${(err as Error).message}`)
    console.error('Nothing from this file was kept. Later migrations were not attempted.')
    process.exit(1)
  }
}
