import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

// The two narrow keys: what the game server's role and the backup's role can do, and above all
// what they cannot.

let db: TestDb
const users: Record<string, string> = {}
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Runs `fn` as one of the two roles, the way the API does for a token naming that role. */
async function as<T>(role: 'game_server' | 'ledger_backup', fn: () => Promise<T>): Promise<T> {
  await db.pg.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.pg.exec(`reset role`)
  }
}
const one = async <T = Json>(sql: string, params: unknown[] = []) => (await db.rows<{ r: T }>(`select ${sql} as r`, params))[0]!.r

async function pair(game: string, options: Json, pool: string, stake = 0) {
  const n = Object.keys(users).length
  const [a, b] = [`sk${n}a`, `sk${n}b`]
  for (const name of [a, b]) users[name] = await db.createUser(`${name}@example.com`, { username: name, country_code: 'RW', age_confirmed: true })
  await db.pg.query(`select public.join_match_queue($1, $2, $3, $4, $5)`, [users[a], game, stake, JSON.stringify(options), pool])
  const joined = await one<Json>(`public.join_match_queue($1, $2, $3, $4, $5)`, [users[b], game, stake, JSON.stringify(options), pool])
  return { matchId: joined.match_id as string, a, b }
}

beforeAll(async () => {
  db = await createTestDb()
}, 120_000)

afterAll(async () => {
  await db.pg.exec(`select private.finish_match(id, 'aborted', null, 'test_cleanup') from public.matches where status = 'active'`)
  expect(await db.integrityProblems()).toEqual([])
  await db.close()
})

describe('the game server’s key', () => {
  it('reads a game as a player sees it and records moves through the game’s own functions', async () => {
    const chess = await pair('chess', { time_control: '5+0' }, 'blitz')
    const white = (await db.rows<{ user_id: string }>(`select user_id from public.match_players where match_id = $1 and seat = 'white'`, [chess.matchId]))[0]!.user_id
    await as('game_server', async () => {
      expect(await one(`public.chess_move_context($1, $2)`, [chess.matchId, white])).toMatchObject({ status: 'active', color: 'w', ply: 0 })
      expect(await one(`public.chess_apply_move($1, $2, 0, 'e4', 'e2e4', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', null, null)`, [chess.matchId, white])).toMatchObject({ ok: true, ply: 1 })
    })

    const pool = await pair('pool', { variant: '8ball' }, 'eight_ball')
    const ludo = await pair('ludo', { mode: (await one<Json>(`(select options_schema -> 'modes' -> 0 ->> 'id' from public.game_types where id = 'ludo')`)) as unknown as string, players: 2, dice: 2, sides: 2, lay: true }, 'default')
    const stranger = (users.stranger = await db.createUser('stranger@example.com', { username: 'sk_stranger', country_code: 'RW', age_confirmed: true }))
    await as('game_server', async () => {
      expect(await one(`public.pool_shot_context($1, $2)`, [pool.matchId, users[pool.a]])).toMatchObject({ status: 'active', ply: 0, row: { variant: '8ball', shot_no: 0, shot_seconds: 30 } })
      expect(await one(`public.pool_shot_context($1, $2)`, [pool.matchId, stranger])).toBeNull()
      expect(await one(`public.ludo_table_context($1, $2)`, [ludo.matchId, users[ludo.a]])).toMatchObject({ turn_no: 0, phase: 'roll' })
      expect(await one(`public.ludo_table_context($1, $2)`, [ludo.matchId, stranger])).toBeNull()
      expect(await one(`public.ludo_action($1, $2, 'roll', null, 0)`, [ludo.matchId, stranger])).toMatchObject({ ok: false })
    })
  })

  it('is told who may play: not a banned account, not an account that does not exist', async () => {
    const player = (users.admit = await db.createUser('admit@example.com', { username: 'sk_admit', country_code: 'RW', age_confirmed: true }))
    await as('game_server', async () => {
      expect(await one(`public.game_server_admits($1)`, [player])).toBe(true)
      expect(await one(`public.game_server_admits('00000000-0000-0000-0000-000000000000')`)).toBe(false)
    })
    await db.pg.query(`update public.profile_private set is_banned = true where user_id = $1`, [player])
    expect(await as('game_server', () => one(`public.game_server_admits($1)`, [player]))).toBe(false)
  })

  it('cannot read or write any table, touch money, or use anything meant for the server inside Supabase', async () => {
    const someone = Object.values(users)[0]!
    for (const table of ['wallets', 'ledger_entries', 'escrow', 'matches', 'match_players', 'profiles', 'profile_private', 'chess_games', 'pool_games', 'ludo_games', 'admins', 'platform_settings']) {
      await expect(as('game_server', () => db.rows(`select * from public.${table} limit 1`)), table).rejects.toThrow(/permission denied/)
    }
    await expect(as('game_server', () => db.rows(`update public.wallets set cash_balance = 1000000`))).rejects.toThrow(/permission denied/)
    await expect(as('game_server', () => db.rows(`insert into public.ledger_entries (user_id, amount, balance_type, entry_type, balance_after) values ($1, 1000, 'cash', 'adjustment', 1000)`, [someone]))).rejects.toThrow(/permission denied/)
    for (const call of [
      `private.apply_ledger_entry('${someone}', 1000, 'cash', 'adjustment')`,
      `private.finish_match('00000000-0000-0000-0000-000000000000', 'win', '${someone}', 'x')`,
      `private.settle_match('00000000-0000-0000-0000-000000000000')`,
      `public.join_match_queue('${someone}', 'chess', 0, '{}', 'blitz')`,
      `public.chess_game_action('00000000-0000-0000-0000-000000000000', '${someone}', 'resign')`,
      `public.backup_export('wallets')`,
      `public.verify_ledger_integrity()`,
    ]) {
      await expect(as('game_server', () => db.rows(`select ${call}`)), call).rejects.toThrow(/permission denied/)
    }
  })
})

describe('the backup’s key', () => {
  const TABLES = ['ledger_entries', 'wallets', 'escrow', 'matches', 'match_players', 'payments', 'platform_revenue', 'tournaments', 'tournament_players', 'tournament_prizes', 'player_ratings', 'profiles', 'platform_settings']

  it('reads every money table, a page at a time, and the pages add up to the table', async () => {
    for (const table of TABLES) {
      const rows = await as('ledger_backup', () => one<Json[]>(`public.backup_export($1)`, [table]))
      const n = (await db.rows<{ n: number }>(`select count(*)::int as n from public.${table}`))[0]!.n
      expect(rows, table).toHaveLength(Math.min(n, 1000))
    }
    const n = (await db.rows<{ n: number }>(`select count(*)::int as n from public.ledger_entries`))[0]!.n
    expect(n).toBeGreaterThan(2)
    const first = await as('ledger_backup', () => one<Json[]>(`public.backup_export('ledger_entries', 0, 2)`))
    const rest = await as('ledger_backup', () => one<Json[]>(`public.backup_export('ledger_entries', 2, 5000)`))
    expect(first).toHaveLength(2)
    expect([...first, ...rest].map((row) => row.id)).toEqual((await db.rows<{ id: number }>(`select id from public.ledger_entries order by id`)).map((row) => row.id))
  })

  it('carries no emails, phone numbers or bans, and reads nothing it was not given', async () => {
    const profiles = await as('ledger_backup', () => one<Json[]>(`public.backup_export('profiles')`))
    expect(Object.keys(profiles[0]!)).not.toEqual(expect.arrayContaining(['email', 'phone_e164', 'is_banned']))
    for (const table of ['profile_private', 'admins', 'direct_messages', 'match_messages', 'reports', 'pg_authid']) {
      await expect(as('ledger_backup', () => db.rows(`select public.backup_export($1)`, [table])), table).rejects.toThrow(/BACKUP_TABLE_NOT_ALLOWED/)
    }
    await expect(as('ledger_backup', () => db.rows(`select public.backup_export('wallets', 0, 100000)`))).rejects.toThrow(/BACKUP_BAD_PAGE/)
  })

  it('cannot read a table directly, change anything, or act as the game server', async () => {
    await expect(as('ledger_backup', () => db.rows(`select * from public.wallets`))).rejects.toThrow(/permission denied/)
    await expect(as('ledger_backup', () => db.rows(`update public.wallets set cash_balance = 0`))).rejects.toThrow(/permission denied/)
    await expect(as('ledger_backup', () => db.rows(`select public.chess_move_context('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')`))).rejects.toThrow(/permission denied/)
    await expect(as('ledger_backup', () => db.rows(`select public.game_server_admits('00000000-0000-0000-0000-000000000000')`))).rejects.toThrow(/permission denied/)
  })
})
