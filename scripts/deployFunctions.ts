// Deploys every Edge Function in supabase/functions to the hosted project.
// Usage: npm run functions:deploy            (all)
//        npm run functions:deploy -- name    (one)
// Uses the Supabase CLI through npx, authenticated with SUPABASE_ACCESS_TOKEN from .env.local.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { requireEnv } from './lib/managementApi.ts'

const root = join(process.cwd(), 'supabase', 'functions')
const all = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
const wanted = process.argv.slice(2)
const names = wanted.length > 0 ? wanted : all
const unknown = names.filter((name) => !all.includes(name))
if (unknown.length > 0) throw new Error(`No such function: ${unknown.join(', ')}`)

const result = spawnSync(
  'npx',
  ['--yes', 'supabase@latest', 'functions', 'deploy', ...names, '--project-ref', requireEnv('SUPABASE_PROJECT_REF'), '--use-api'],
  { stdio: 'inherit', shell: true, env: { ...process.env, SUPABASE_ACCESS_TOKEN: requireEnv('SUPABASE_ACCESS_TOKEN') } },
)
process.exit(result.status ?? 1)
