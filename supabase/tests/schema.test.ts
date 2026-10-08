import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testDb'

const MONEY_AND_GAME_TABLES = [
  'wallets',
  'ledger_entries',
  'matches',
  'match_players',
  'escrow',
  'match_queue',
  'platform_revenue',
  'payments',
  'player_ratings',
  'chess_games',
  'chess_moves',
]

let db: TestDb
let amina: string
let kofi: string

beforeAll(async () => {
  db = await createTestDb()
  amina = await db.createUser('amina@example.com', {
    username: 'amina_k',
    country_code: 'rw',
    preferred_language: 'fr',
    age_confirmed: true,
  })
  kofi = await db.createUser('kofi@example.com', { username: 'kofi', country_code: 'GH', age_confirmed: true })
}, 120_000)

afterAll(async () => {
  await db.close()
})

// CLAUDE.md step 9: "The ledger integrity check must pass after every test."
afterEach(async () => {
  expect(await db.integrityProblems()).toEqual([])
})

describe('migrations', () => {
  it('seed the registry: chess, ludo and pool are live, other games are coming soon, real money is off everywhere', async () => {
    const games = await db.rows(`select id, status from public.game_types order by sort_order`)
    expect(games).toEqual([
      { id: 'chess', status: 'live' },
      { id: 'ludo', status: 'live' },
      { id: 'draughts', status: 'coming_soon' },
      { id: 'pool', status: 'live' },
      { id: 'penalty', status: 'coming_soon' },
    ])
    const [countries] = await db.rows<{ total: number; real_money: number }>(
      `select count(*)::int as total, count(*) filter (where real_money_enabled)::int as real_money from public.countries`,
    )
    expect(countries).toEqual({ total: 54, real_money: 0 })
  })

  it('leave no table without RLS or without policies', async () => {
    const unprotected = await db.rows(`
      select n.nspname || '.' || c.relname as table_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind = 'r'
         and (not c.relrowsecurity
              or not exists (select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname))`)
    expect(unprotected).toEqual([])
  })

  it('give clients no write privilege on money or game tables', async () => {
    const leaks = await db.rows(
      `select r.role, t.name, p.privilege
         from unnest(array['anon', 'authenticated']) as r(role)
        cross join unnest($1::text[]) as t(name)
        cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
        where has_table_privilege(r.role, 'public.' || t.name, p.privilege)`,
      [MONEY_AND_GAME_TABLES],
    )
    expect(leaks).toEqual([])
  })

  it('keep internal money functions out of reach of every API role', async () => {
    const callable = await db.rows(`
      select r.role, p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)
       where n.nspname = 'private'
         and p.proname not in ('is_match_player', 'is_match_finished')
         and has_function_privilege(r.role, p.oid, 'EXECUTE')`)
    expect(callable).toEqual([])
  })
})

describe('signup', () => {
  it('creates the profile, private profile, wallet and a signup bonus ledger entry', async () => {
    const [profile] = await db.rows(`select username, country_code from public.profiles where id = $1`, [amina])
    expect(profile).toEqual({ username: 'amina_k', country_code: 'RW' })

    const [priv] = await db.rows<{ preferred_language: string; confirmed: boolean; is_banned: boolean }>(
      `select preferred_language, age_confirmed_at is not null as confirmed, is_banned
         from public.profile_private where user_id = $1`,
      [amina],
    )
    expect(priv).toEqual({ preferred_language: 'fr', confirmed: true, is_banned: false })

    const [wallet] = await db.rows(
      `select bonus_balance::int as bonus, cash_balance::int as cash from public.wallets where user_id = $1`,
      [amina],
    )
    expect(wallet).toEqual({ bonus: 1000, cash: 0 })

    const ledger = await db.rows(
      `select amount::int as amount, balance_type, entry_type, balance_after::int as balance_after
         from public.ledger_entries where user_id = $1`,
      [amina],
    )
    expect(ledger).toEqual([{ amount: 1000, balance_type: 'bonus', entry_type: 'signup_bonus', balance_after: 1000 }])
  })

  it('never fails on bad or hostile metadata: it falls back to safe values', async () => {
    const id = await db.createUser('odd@example.com', {
      username: "x'; drop table wallets; --",
      country_code: 'ZZ',
      preferred_language: 'klingon',
      age_confirmed: 'yes',
      is_admin: true,
      bonus_balance: 999999,
    })
    const [row] = await db.rows<Record<string, unknown>>(
      `select p.username, p.country_code, pp.preferred_language, pp.age_confirmed_at, w.bonus_balance::int as bonus,
              exists (select 1 from public.admins a where a.user_id = p.id) as is_admin
         from public.profiles p
         join public.profile_private pp on pp.user_id = p.id
         join public.wallets w on w.user_id = p.id
        where p.id = $1`,
      [id],
    )
    expect(row!.username).toMatch(/^player_[0-9a-f]{12}$/)
    expect(row).toMatchObject({
      country_code: null,
      preferred_language: 'en',
      age_confirmed_at: null,
      bonus: 1000,
      is_admin: false,
    })
  })

  it('gives a second player with the same username (any letter case) a generated one', async () => {
    const id = await db.createUser('copycat@example.com', { username: 'AMINA_K' })
    const [row] = await db.rows<{ username: string }>(`select username from public.profiles where id = $1`, [id])
    expect(row!.username).toMatch(/^player_/)
    const [check] = await db.rows(
      `select public.is_username_available('Amina_K') as taken_name, public.is_username_available('free_name') as free_name,
              public.is_username_available('no') as too_short`,
    )
    expect(check).toEqual({ taken_name: false, free_name: true, too_short: false })
  })

  it('pays the signup bonus only once', async () => {
    await expect(
      db.pg.query(`select private.apply_ledger_entry($1, 1000, 'bonus', 'signup_bonus')`, [amina]),
    ).rejects.toThrow(/ledger_entries_one_signup_bonus/)
    const [wallet] = await db.rows(`select bonus_balance::int as bonus from public.wallets where user_id = $1`, [amina])
    expect(wallet).toEqual({ bonus: 1000 })
  })

  it('makes the listed email an admin only once the address is confirmed', async () => {
    const id = await db.createUser('EG8217178@gmail.com', { username: 'owner' }, false)
    expect(await db.rows(`select 1 from public.admins where user_id = $1`, [id])).toEqual([])

    await db.pg.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id])
    expect(await db.rows(`select 1 from public.admins where user_id = $1`, [id])).toHaveLength(1)
    expect(await db.rows(`select 1 from public.admins where user_id in ($1, $2)`, [amina, kofi])).toEqual([])
  })
})

describe('ledger and wallet guards (they bind every role, including the owner)', () => {
  it('rejects updates, deletes and truncation of the ledger', async () => {
    await expect(db.pg.query(`update public.ledger_entries set amount = 5000 where user_id = $1`, [amina])).rejects.toThrow(
      /append-only/,
    )
    await expect(db.pg.query(`delete from public.ledger_entries where user_id = $1`, [amina])).rejects.toThrow(/append-only/)
    await expect(db.pg.exec(`truncate public.ledger_entries`)).rejects.toThrow(/append-only/)
  })

  it('rejects a balance change that has no ledger entry, and a ledger entry with no balance change', async () => {
    await expect(db.pg.query(`update public.wallets set cash_balance = 1000000 where user_id = $1`, [amina])).rejects.toThrow(
      /apply_ledger_entry/,
    )
    await expect(
      db.pg.query(
        `insert into public.ledger_entries (user_id, amount, balance_type, entry_type, balance_after)
         values ($1, 500, 'cash', 'adjustment', 500)`,
        [amina],
      ),
    ).rejects.toThrow(/apply_ledger_entry/)
    await expect(db.pg.query(`delete from public.wallets where user_id = $1`, [amina])).rejects.toThrow(/cannot be deleted/)
  })

  it('never lets a balance go negative', async () => {
    await expect(
      db.pg.query(`select private.apply_ledger_entry($1, -1001, 'bonus', 'adjustment')`, [kofi]),
    ).rejects.toThrow(/INSUFFICIENT_BALANCE/)
    await expect(db.pg.query(`select private.apply_ledger_entry($1, -1, 'cash', 'adjustment')`, [kofi])).rejects.toThrow(
      /INSUFFICIENT_BALANCE/,
    )
    await expect(db.pg.query(`select private.apply_ledger_entry($1, 0, 'cash', 'adjustment')`, [kofi])).rejects.toThrow(
      /LEDGER_ZERO_AMOUNT/,
    )
    const [wallet] = await db.rows(
      `select bonus_balance::int as bonus, cash_balance::int as cash from public.wallets where user_id = $1`,
      [kofi],
    )
    expect(wallet).toEqual({ bonus: 1000, cash: 0 })
  })

  it('records every movement with the balance after it', async () => {
    await db.pg.query(`select private.apply_ledger_entry($1, 300, 'cash', 'adjustment')`, [kofi])
    await db.pg.query(`select private.apply_ledger_entry($1, -120, 'cash', 'adjustment')`, [kofi])
    const entries = await db.rows(
      `select amount::int as amount, balance_after::int as balance_after
         from public.ledger_entries where user_id = $1 and balance_type = 'cash' order by id`,
      [kofi],
    )
    expect(entries).toEqual([
      { amount: 300, balance_after: 300 },
      { amount: -120, balance_after: 180 },
    ])
    const [wallet] = await db.rows(`select cash_balance::int as cash from public.wallets where user_id = $1`, [kofi])
    expect(wallet).toEqual({ cash: 180 })
  })

  it('rejects a repeated idempotency key, so a retried request cannot pay twice', async () => {
    await db.pg.query(`select private.apply_ledger_entry($1, 50, 'cash', 'adjustment', null, null, 'retry-1')`, [kofi])
    await expect(
      db.pg.query(`select private.apply_ledger_entry($1, 50, 'cash', 'adjustment', null, null, 'retry-1')`, [kofi]),
    ).rejects.toThrow(/idempotency_key/)
    const [wallet] = await db.rows(`select cash_balance::int as cash from public.wallets where user_id = $1`, [kofi])
    expect(wallet).toEqual({ cash: 230 })
  })
})

describe('row level security', () => {
  it('lets a player read their own wallet and ledger, and nobody else’s', async () => {
    await db.as('authenticated', amina, async () => {
      expect(await db.rows(`select user_id from public.wallets`)).toEqual([{ user_id: amina }])
      const owners = await db.rows(`select distinct user_id from public.ledger_entries`)
      expect(owners).toEqual([{ user_id: amina }])
      expect(await db.rows(`select user_id from public.profile_private`)).toEqual([{ user_id: amina }])
    })
  })

  it('blocks every client write to money and game tables', async () => {
    const attempts = [
      `update public.wallets set cash_balance = 999999`,
      `insert into public.wallets (user_id) values ('${amina}')`,
      `delete from public.wallets`,
      `insert into public.ledger_entries (user_id, amount, balance_type, entry_type, balance_after) values ('${amina}', 5, 'cash', 'adjustment', 5)`,
      `insert into public.matches (game_type, stake_amount) values ('chess', 0)`,
      `update public.matches set winner_id = '${amina}'`,
      `insert into public.match_players (match_id, user_id, seat) values (gen_random_uuid(), '${amina}', 'white')`,
      `insert into public.escrow (match_id, user_id, amount, balance_type) values (gen_random_uuid(), '${amina}', 5, 'cash')`,
      `insert into public.match_queue (user_id, game_type, stake_amount, rating) values ('${amina}', 'chess', 0, 3000)`,
      `insert into public.chess_games (match_id, fen, white_time_ms, black_time_ms) values (gen_random_uuid(), 'x', 1, 1)`,
      `insert into public.chess_moves (match_id, ply, san, uci, fen_after, time_left_ms) values (gen_random_uuid(), 1, 'e4', 'e2e4', 'x', 1)`,
      `update public.player_ratings set rating = 3000`,
      `insert into public.player_ratings (user_id, game_type, rating) values ('${amina}', 'chess', 3000)`,
      `insert into public.platform_revenue (match_id, amount) values (gen_random_uuid(), 1)`,
      `select * from public.platform_revenue`,
      `update public.platform_settings set signup_bonus_amount = 1000000`,
      `update public.game_types set status = 'live'`,
      `update public.countries set real_money_enabled = true`,
      `insert into public.admins (user_id) values ('${amina}')`,
      `update public.profiles set username = 'admin'`,
      `update public.profiles set country_code = 'NG'`,
      `update public.profile_private set is_banned = false`,
      `update public.profile_private set age_confirmed_at = now()`,
      `select private.apply_ledger_entry('${amina}', 1000000, 'cash', 'adjustment')`,
      `select * from private.admin_emails`,
      `select * from public.verify_ledger_integrity()`,
    ]
    for (const role of ['authenticated', 'anon'] as const) {
      await db.as(role, role === 'authenticated' ? amina : null, async () => {
        for (const sql of attempts) {
          await expect(db.pg.query(sql), `${role}: ${sql}`).rejects.toThrow(/permission denied|row-level security/)
        }
      })
    }
  })

  it('lets a player edit their own display name and language, but not another player’s', async () => {
    await db.as('authenticated', amina, async () => {
      await db.pg.query(`update public.profiles set display_name = 'Amina K.'`)
      await db.pg.query(`update public.profile_private set preferred_language = 'en'`)
    })
    const names = await db.rows(`select id, display_name from public.profiles where id in ($1, $2) order by username`, [
      amina,
      kofi,
    ])
    expect(names).toEqual([
      { id: amina, display_name: 'Amina K.' },
      { id: kofi, display_name: null },
    ])
  })

  it('shows visitors the reference data and nothing personal', async () => {
    await db.as('anon', null, async () => {
      expect(await db.rows(`select id from public.game_types where status = 'live' order by sort_order`)).toEqual([{ id: 'chess' }, { id: 'ludo' }, { id: 'pool' }])
      expect(await db.rows(`select count(*)::int as n from public.countries`)).toEqual([{ n: 54 }])
      for (const table of ['profiles', 'profile_private', 'wallets', 'ledger_entries', 'matches', 'player_ratings']) {
        await expect(db.pg.query(`select * from public.${table}`), table).rejects.toThrow(/permission denied/)
      }
    })
  })

  it('hides a game in progress from outsiders and opens it once finished', async () => {
    const outsider = await db.createUser('outsider@example.com', { username: 'outsider' })
    const [match] = await db.rows<{ id: string }>(
      `insert into public.matches (game_type, stake_amount, status, started_at)
       values ('chess', 0, 'active', now()) returning id`,
    )
    await db.pg.query(
      `insert into public.match_players (match_id, user_id, seat) values ($1, $2, 'white'), ($1, $3, 'black')`,
      [match!.id, amina, kofi],
    )
    await db.pg.query(
      `insert into public.chess_games (match_id, fen, white_time_ms, black_time_ms)
       values ($1, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 300000, 300000)`,
      [match!.id],
    )

    const visible = async (userId: string) =>
      db.as('authenticated', userId, async () => ({
        matches: (await db.rows(`select id from public.matches`)).length,
        players: (await db.rows(`select user_id from public.match_players`)).length,
        games: (await db.rows(`select match_id from public.chess_games`)).length,
      }))

    expect(await visible(amina)).toEqual({ matches: 1, players: 2, games: 1 })
    expect(await visible(outsider)).toEqual({ matches: 0, players: 0, games: 0 })

    await db.pg.query(
      `update public.matches set status = 'finished', result = 'draw', finished_at = now() where id = $1`,
      [match!.id],
    )
    expect(await visible(outsider)).toEqual({ matches: 1, players: 2, games: 1 })
  })

  it('lets a player set a missing country once, and only once', async () => {
    const id = await db.createUser('nocountry@example.com', { username: 'nocountry' })
    await db.as('authenticated', id, async () => {
      await expect(db.pg.query(`select public.set_my_country('ZZ')`)).rejects.toThrow(/UNKNOWN_COUNTRY/)
      await db.pg.query(`select public.set_my_country('ke')`)
      await expect(db.pg.query(`select public.set_my_country('NG')`)).rejects.toThrow(/COUNTRY_ALREADY_SET/)
    })
    expect(await db.rows(`select country_code from public.profiles where id = $1`, [id])).toEqual([{ country_code: 'KE' }])
  })
})
