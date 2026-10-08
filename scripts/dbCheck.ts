// Health check of the hosted database. Usage: npm run db:check
//
// Part 1 inspects the database from the inside (as owner).
// Part 2 attacks it from the outside over the real Data API, as a visitor and as a signed-in
// player, the way a cheating client would.
// Exits with code 1 if anything fails.
import { createClient } from '@supabase/supabase-js'
import { requireEnv, runSql } from './lib/managementApi.ts'
import { TEST_PASSWORD } from './lib/testAccounts.ts'

const url = requireEnv('VITE_SUPABASE_URL')
const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY')
const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

let failures = 0
function report(ok: boolean, label: string, detail?: unknown) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''}`)
}
async function expectEmpty(label: string, sql: string) {
  const rows = await runSql(sql)
  report(rows.length === 0, label, rows)
}

const PROTECTED = `array['wallets','ledger_entries','matches','match_players','escrow','match_queue',
  'platform_revenue','payments','player_ratings','chess_games','chess_moves','admins',
  'platform_settings','game_types','countries']`

console.log('--- Inside the database ---')

const [counts] = await runSql<Record<string, number>>(`
  select (select count(*)::int from supabase_migrations.schema_migrations) as migrations,
         (select count(*)::int from public.countries) as countries,
         (select count(*)::int from public.countries where real_money_enabled) as real_money_countries,
         (select count(*)::int from public.countries where token_to_currency_rate is null) as countries_without_rate,
         (select count(*)::int from public.game_types where status = 'live') as live_games,
         (select count(*)::int from public.game_types) as games,
         (select count(*)::int from public.platform_settings) as settings_rows,
         (select count(*)::int from auth.users) as users,
         (select count(*)::int from public.profiles) as profiles,
         (select count(*)::int from public.wallets) as wallets`)
console.log('      ', JSON.stringify(counts))
report(counts!.countries === 54 && counts!.real_money_countries === 0, '54 countries, real money off everywhere')
report(counts!.countries_without_rate === 0, 'every country has a token rate')
report(counts!.games === 5 && counts!.live_games === 3, 'games registry: chess, ludo and pool live, two coming soon')
report(counts!.settings_rows === 1, 'exactly one platform settings row')
report(counts!.users === counts!.profiles && counts!.users === counts!.wallets, 'every account has a profile and a wallet')

await expectEmpty(
  'every table has RLS enabled and at least one policy',
  `select n.nspname || '.' || c.relname as table_name
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind = 'r'
      and (not c.relrowsecurity
           or not exists (select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname))`,
)
await expectEmpty(
  'clients hold no write privilege on money, game or settings tables',
  `select r.role, t.name, p.privilege
     from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(${PROTECTED}) as t(name)
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
    where has_table_privilege(r.role, 'public.' || t.name, p.privilege)`,
)
await expectEmpty(
  'internal functions cannot be executed by any API role',
  `select r.role, p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)
    where n.nspname = 'private' and p.proname not in ('is_match_player', 'is_match_finished')
      and has_function_privilege(r.role, p.oid, 'EXECUTE')`,
)
await expectEmpty(
  'every SECURITY DEFINER function pins its search_path',
  `select n.nspname || '.' || p.proname as fn
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
)

const triggers = await runSql<{ tgname: string }>(
  `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1`,
)
report(
  ['on_auth_user_confirmed', 'on_auth_user_created'].every((t) => triggers.some((r) => r.tgname === t)),
  'signup triggers are attached to auth.users',
  triggers,
)

const guards = await runSql<{ tgname: string; tgenabled: string }>(
  `select tgname, tgenabled from pg_trigger
    where tgrelid in ('public.ledger_entries'::regclass, 'public.wallets'::regclass) and not tgisinternal`,
)
report(guards.length === 5 && guards.every((g) => g.tgenabled === 'O'), 'all five ledger and wallet guards are enabled', guards)

const realtime = await runSql<{ tablename: string }>(
  `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`,
)
report(
  ['chess_games', 'chess_moves', 'matches', 'wallets'].every((t) => realtime.some((r) => r.tablename === t)),
  'Realtime publishes matches, chess_games, chess_moves and wallets',
  realtime,
)

await expectEmpty('ledger integrity: the books balance', `select * from public.verify_ledger_integrity()`)

// The second part signs in as a test player and attacks the API. That needs a test account, so
// it only runs on a development project; on a live project the inside checks above are the audit.
if (process.env.AGH_ENVIRONMENT !== 'development') {
  console.log('\n(Outside attack checks skipped: this is not a development project.)')
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

console.log('\n--- From the outside, over the Data API ---')

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, serviceKey, noSession)
const visitor = createClient(url, anonKey, noSession)
const player = createClient(url, anonKey, noSession)

const email = 'e2e-player@example.com'
const password = TEST_PASSWORD
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { username: 'e2e_player', age_confirmed: true, country_code: 'RW' },
})
if (created.error && created.error.code !== 'email_exists') throw created.error

const signIn = await player.auth.signInWithPassword({ email, password })
if (signIn.error || !signIn.data.user) throw signIn.error ?? new Error('sign-in failed')
const me = signIn.data.user.id

{
  const games = await visitor.from('game_types').select('id, status')
  report(!games.error && games.data.length === 5, 'visitor can read the games registry', games.error ?? games.data)
  const countries = await visitor.from('countries').select('country_code')
  report(!countries.error && countries.data.length === 54, 'visitor can read the countries', countries.error)
  for (const table of ['wallets', 'ledger_entries', 'profiles', 'profile_private', 'matches', 'platform_revenue', 'admins']) {
    const res = await visitor.from(table).select('*').limit(1)
    report(res.error !== null, `visitor cannot read ${table}`, res.data)
  }
}

{
  const wallet = await player.from('wallets').select('user_id, bonus_balance, cash_balance')
  report(
    !wallet.error && wallet.data.length === 1 && wallet.data[0]!.user_id === me && wallet.data[0]!.bonus_balance === 1000,
    'signup trigger ran on the live database: player sees only their own wallet, holding the 1,000 bonus',
    wallet.error ?? wallet.data,
  )
  const ledger = await player.from('ledger_entries').select('user_id, entry_type, amount, balance_after')
  report(
    !ledger.error && ledger.data.length >= 1 && ledger.data.every((r) => r.user_id === me),
    'player sees only their own ledger entries',
    ledger.error ?? ledger.data,
  )
  const priv = await player.from('profile_private').select('user_id')
  report(!priv.error && priv.data.length === 1, 'player sees only their own private profile', priv.error ?? priv.data)

  const attacks: [string, PromiseLike<{ error: unknown; data: unknown }>][] = [
    ['give themselves cash', player.from('wallets').update({ cash_balance: 999999 }).eq('user_id', me).select()],
    ['insert a wallet', player.from('wallets').insert({ user_id: me }).select()],
    ['delete their wallet', player.from('wallets').delete().eq('user_id', me).select()],
    [
      'write a ledger entry',
      player
        .from('ledger_entries')
        .insert({ user_id: me, amount: 5000, balance_type: 'cash', entry_type: 'adjustment', balance_after: 5000 })
        .select(),
    ],
    ['create a match', player.from('matches').insert({ game_type: 'chess', stake_amount: 0 }).select()],
    ['join the queue directly', player.from('match_queue').insert({ user_id: me, game_type: 'chess', stake_amount: 0, rating: 3000 }).select()],
    ['set their rating', player.from('player_ratings').insert({ user_id: me, game_type: 'chess', rating: 3000 }).select()],
    ['make themselves admin', player.from('admins').insert({ user_id: me }).select()],
    ['change the signup bonus', player.from('platform_settings').update({ signup_bonus_amount: 1000000 }).eq('id', true).select()],
    ['switch on real money', player.from('countries').update({ real_money_enabled: true }).eq('country_code', 'RW').select()],
    ['change their username', player.from('profiles').update({ username: 'admin' }).eq('id', me).select()],
    ['unban themselves', player.from('profile_private').update({ is_banned: false }).eq('user_id', me).select()],
    ['read platform revenue', player.from('platform_revenue').select('*')],
    ['run the integrity check', player.rpc('verify_ledger_integrity')],
    ['call the internal ledger function', player.rpc('apply_ledger_entry', { p_user_id: me, p_amount: 1000000, p_balance_type: 'cash', p_entry_type: 'adjustment' })],
  ]
  for (const [label, attempt] of attacks) {
    const res = await attempt
    report(res.error !== null, `player cannot ${label}`, res.data)
  }

  const rename = await player.from('profiles').update({ display_name: 'E2E Player' }).eq('id', me).select('display_name')
  report(!rename.error && rename.data.length === 1, 'player can change their own display name', rename.error ?? rename.data)

  const others = await player.from('profiles').update({ display_name: 'hacked' }).neq('id', me).select('id')
  report(!others.error && others.data.length === 0, 'player cannot change anyone else’s display name', others.error ?? others.data)

  const taken = await visitor.rpc('is_username_available', { p_username: 'E2E_PLAYER' })
  const free = await visitor.rpc('is_username_available', { p_username: 'surely_free_name_1' })
  report(taken.data === false && free.data === true, 'username availability check works for visitors', [taken, free])
}

await expectEmpty('ledger integrity after the attacks: the books still balance', `select * from public.verify_ledger_integrity()`)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
