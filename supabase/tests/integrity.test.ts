import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { buildBundle } from '../../scripts/bundleMigrations'
import { createTestDb, migrationFiles, SUPABASE_STUB, type TestDb } from './testDb'

// This file corrupts the books on purpose (by switching the guards off, which only a
// database superuser can do) to prove the integrity check notices each kind of damage.

let db: TestDb
let user: string

beforeAll(async () => {
  db = await createTestDb()
  user = await db.createUser('victim@example.com', { username: 'victim' })
}, 120_000)

afterAll(async () => {
  await db.close()
})

describe('verify_ledger_integrity', () => {
  it('reports nothing when the books balance', async () => {
    expect(await db.integrityProblems()).toEqual([])
    await db.pg.query(`select public.assert_ledger_integrity()`)
  })

  it('catches a wallet that was changed behind the ledger’s back', async () => {
    await db.pg.exec(`alter table public.wallets disable trigger wallets_write_guard`)
    await db.pg.query(`update public.wallets set cash_balance = 500 where user_id = $1`, [user])
    await db.pg.exec(`alter table public.wallets enable trigger wallets_write_guard`)

    const problems = await db.integrityProblems()
    expect(problems.map((p) => p.check_name)).toEqual(['wallet_ledger_mismatch'])
    expect(problems[0]!.user_id).toBe(user)
    await expect(db.pg.query(`select public.assert_ledger_integrity()`)).rejects.toThrow(/LEDGER_INTEGRITY_FAILED/)

    await db.pg.exec(`alter table public.wallets disable trigger wallets_write_guard`)
    await db.pg.query(`update public.wallets set cash_balance = 0 where user_id = $1`, [user])
    await db.pg.exec(`alter table public.wallets enable trigger wallets_write_guard`)
    expect(await db.integrityProblems()).toEqual([])
  })

  it('catches staked tokens that vanished instead of sitting in escrow', async () => {
    const [match] = await db.rows<{ id: string }>(
      `insert into public.matches (game_type, stake_amount, status, started_at)
       values ('chess', 100, 'active', now()) returning id`,
    )
    // A stake leaves the wallet but no escrow row is written: 100 tokens are unaccounted for.
    await db.pg.query(`select private.apply_ledger_entry($1, -100, 'bonus', 'stake', $2)`, [user, match!.id])
    expect((await db.integrityProblems()).map((p) => p.check_name)).toEqual(['escrow_conservation'])

    await db.pg.query(
      `insert into public.escrow (match_id, user_id, amount, balance_type) values ($1, $2, 100, 'bonus')`,
      [match!.id, user],
    )
    expect(await db.integrityProblems()).toEqual([])
  })

  it('catches a ledger entry whose balance_after was forged', async () => {
    await db.pg.exec(`alter table public.ledger_entries disable trigger ledger_entries_no_update_delete`)
    await db.pg.query(
      `update public.ledger_entries set balance_after = balance_after + 7 where user_id = $1 and entry_type = 'signup_bonus'`,
      [user],
    )
    await db.pg.exec(`alter table public.ledger_entries enable trigger ledger_entries_no_update_delete`)
    expect((await db.integrityProblems()).map((p) => p.check_name)).toContain('balance_after_mismatch')
  })
})

describe('SQL editor bundle', () => {
  it('applies cleanly on a blank project and refuses to run a second time', async () => {
    const pg = new PGlite()
    try {
      await pg.exec(SUPABASE_STUB)
      const bundle = buildBundle()
      await pg.exec(bundle)
      const applied = await pg.query<{ n: number }>(
        `select count(*)::int as n from supabase_migrations.schema_migrations`,
      )
      expect(applied.rows[0]!.n).toBe(migrationFiles().length)

      await expect(pg.exec(bundle)).rejects.toThrow(/already applied/)
      await pg.exec('rollback')
      const games = await pg.query<{ n: number }>(`select count(*)::int as n from public.game_types`)
      expect(games.rows[0]!.n).toBe(5)
    } finally {
      await pg.close()
    }
  })
})

describe('existing accounts', () => {
  it('are provisioned by the migration when they signed up before the tables existed', async () => {
    const early = await createTestDb({
      beforeMigrations: `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
                         values ('early@example.com', '{"username": "early_bird"}', now())`,
    })
    try {
      const rows = await early.rows(
        `select p.username, w.bonus_balance::int as bonus
           from public.profiles p join public.wallets w on w.user_id = p.id`,
      )
      expect(rows).toEqual([{ username: 'early_bird', bonus: 1000 }])
      expect(await early.integrityProblems()).toEqual([])
    } finally {
      await early.close()
    }
  })
})
