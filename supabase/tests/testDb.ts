import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

// The parts of a Supabase project our migrations rely on: its roles, auth.users, auth.uid(),
// the Realtime publication, and the old "grant everything to API roles" defaults. The defaults
// are deliberately the permissive ones, so the tests prove our migrations lock things down
// themselves instead of relying on the platform.
export const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb,
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create publication supabase_realtime;
`

export type TestDb = Awaited<ReturnType<typeof createTestDb>>

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** A fresh in-memory Postgres with every migration applied, in order. */
export async function createTestDb(options: { beforeMigrations?: string } = {}) {
  const pg = new PGlite()
  await pg.exec(SUPABASE_STUB)
  if (options.beforeMigrations) await pg.exec(options.beforeMigrations)
  for (const file of migrationFiles()) {
    try {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    }
  }

  async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await pg.query<T>(sql, params)).rows
  }

  async function createUser(
    email: string,
    meta: Record<string, unknown> = {},
    confirmed = true,
  ): Promise<string> {
    const [row] = await rows<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
       values ($1, $2::jsonb, case when $3::boolean then now() end) returning id`,
      [email, JSON.stringify(meta), confirmed],
    )
    return row!.id
  }

  /** Runs `fn` the way the Data API would for that caller: as a role, with a JWT subject. */
  async function as<T>(role: 'anon' | 'authenticated' | 'service_role', userId: string | null, fn: () => Promise<T>) {
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role })
    await pg.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
    await pg.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await pg.exec(`reset role`)
      await pg.query(`select set_config('request.jwt.claims', '', false)`)
    }
  }

  async function integrityProblems() {
    return rows<{ check_name: string; user_id: string | null; detail: string }>(
      `select * from public.verify_ledger_integrity()`,
    )
  }

  return { pg, rows, createUser, as, integrityProblems, close: () => pg.close() }
}
