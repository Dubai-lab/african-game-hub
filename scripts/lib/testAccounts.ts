// The fixed accounts the live tests play with, and a way to put them back to a known state.
// Accounts are never deleted (they own ledger rows), so tests reuse these.
import { createClient } from '@supabase/supabase-js'
import { requireDevelopmentProject, requireEnv, runSql } from './managementApi.ts'

/** The test accounts' password: from .env.local, never written in the code. */
export const TEST_PASSWORD = requireEnv('E2E_TEST_PASSWORD')
export const TEST_ACCOUNTS = [
  { email: 'e2e-player@example.com', username: 'e2e_player', country: 'RW' },
  { email: 'e2e-player-2@example.com', username: 'e2e_player2', country: 'NG' },
  // Extra players for the concurrency tests, which need several matches at once.
  { email: 'e2e-player-3@example.com', username: 'e2e_player3', country: 'KE' },
  { email: 'e2e-player-4@example.com', username: 'e2e_player4', country: 'GH' },
  { email: 'e2e-player-5@example.com', username: 'e2e_player5', country: 'ZA' },
  { email: 'e2e-player-6@example.com', username: 'e2e_player6', country: 'SN' },
] as const

const emails = TEST_ACCOUNTS.map((a) => `'${a.email}'`).join(', ')
const theirIds = `(select id from auth.users where email in (${emails}))`

/** Creates the test accounts if they do not exist yet (confirmed, so no email is sent). */
export async function ensureTestAccounts() {
  requireDevelopmentProject('create test accounts')
  const admin = createClient(requireEnv('VITE_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const account of TEST_ACCOUNTS) {
    const { error } = await admin.auth.admin.createUser({
      email: account.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { username: account.username, age_confirmed: true, country_code: account.country },
    })
    if (error && error.code !== 'email_exists') throw error
  }
  // Accounts made earlier keep whatever password they were made with: bring them into line.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const wanted = new Set<string>(TEST_ACCOUNTS.map((a) => a.email))
  for (const user of data.users) {
    if (!user.email || !wanted.has(user.email)) continue
    const updated = await admin.auth.admin.updateUserById(user.id, { password: TEST_PASSWORD })
    if (updated.error) throw updated.error
  }
}

/**
 * Back to a clean start: out of the queue, no game in progress (stakes refunded through the
 * normal settlement), default ratings, and wallets at 1,000 bonus / 0 cash. Wallets are reset
 * with ledger adjustments like any other balance change, so the books still balance afterwards.
 * Free test matches are removed; staked ones stay, because ledger rows point at them.
 * Friendships and messages between the test accounts are cleared.
 */
export async function resetTestAccounts() {
  requireDevelopmentProject('reset test accounts')
  await runSql(`
    delete from public.match_queue where user_id in ${theirIds};

    select private.finish_match(m.id, 'aborted', null, 'test_cleanup')
      from public.matches m
     where m.status = 'active'
       and exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.user_id in ${theirIds});

    -- Invitations and tournaments involving the test accounts are closed: a prize still held
    -- goes back to its creator (or is paid out) through the normal settlement.
    delete from public.challenges where from_user in ${theirIds} or to_user in ${theirIds};
    update public.tournaments
       set starts_at = least(starts_at, now() - interval '2 hours'), ends_at = now() - interval '1 second'
     where status in ('scheduled', 'running')
       and (created_by in ${theirIds} or id in (select tp.tournament_id from public.tournament_players tp where tp.user_id in ${theirIds}));
    select private.tournament_advance(t.id) from public.tournaments t where t.status in ('scheduled', 'running') and t.ends_at < now();
    update public.tournament_pairings p set result = 'void', resolved_at = now()
      from public.tournaments t
     where t.id = p.tournament_id and t.status = 'running' and t.format = 'rounds' and t.ends_at < now() and p.result is null;
    update public.tournaments set rounds = greatest(current_round, 1) where status = 'running' and format = 'rounds' and ends_at < now();
    select private.tournament_advance(t.id) from public.tournaments t where t.status = 'running' and t.format = 'rounds' and t.ends_at < now();
    delete from public.tournament_messages where sender_id in ${theirIds};

    with gone as (
           select distinct mp.match_id from public.match_players mp
            where mp.user_id in ${theirIds}
              and not exists (select 1 from public.ledger_entries l where l.match_id = mp.match_id)),
         chat as (delete from public.match_messages where match_id in (select match_id from gone)),
         offers as (delete from public.rematch_offers where match_id in (select match_id from gone) or new_match_id in (select match_id from gone)),
         a as (delete from public.chess_moves where match_id in (select match_id from gone)),
         ps as (delete from public.pool_shots where match_id in (select match_id from gone)),
         pg as (delete from public.pool_games where match_id in (select match_id from gone)),
         lm as (delete from public.ludo_moves where match_id in (select match_id from gone)),
         lg as (delete from public.ludo_games where match_id in (select match_id from gone)),
         b as (delete from public.chess_games where match_id in (select match_id from gone)),
         c as (delete from public.match_players where match_id in (select match_id from gone))
    delete from public.matches where id in (select match_id from gone);

    delete from public.player_ratings where user_id in ${theirIds};

    -- Social state between the test accounts: no friendships, no messages, live chat back on.
    delete from public.direct_messages where sender_id in ${theirIds} and recipient_id in ${theirIds};
    delete from public.friendships where requester_id in ${theirIds} and addressee_id in ${theirIds};
    update public.profile_private set match_chat_enabled = true where user_id in ${theirIds} and not match_chat_enabled;
    update public.profile_private set preferences = preferences - array['ludoDice', 'ludoBoard3d', 'ludoBoard', 'ludoSides', 'ludoLay', 'poolCloth', 'poolGuide', 'poolCue'] where user_id in ${theirIds} and preferences ?| array['ludoDice', 'ludoBoard3d', 'ludoBoard', 'ludoSides', 'ludoLay', 'poolCloth', 'poolGuide', 'poolCue'];
    delete from public.reports where reporter_id in ${theirIds} and reported_id in ${theirIds};
    delete from public.blocks where blocker_id in ${theirIds} and blocked_id in ${theirIds};
    update public.profile_private set is_banned = false, ban_reason = null where user_id in ${theirIds} and is_banned;
    -- A test account is never left holding admin rights or a sign-in factor (see e2e/admin.spec.ts).
    delete from public.admins where user_id in ${theirIds};
    delete from auth.mfa_factors where user_id in ${theirIds};

    select private.apply_ledger_entry(w.user_id, 1000 - w.bonus_balance, 'bonus', 'adjustment')
      from public.wallets w where w.user_id in ${theirIds} and w.bonus_balance <> 1000;
    select private.apply_ledger_entry(w.user_id, -w.cash_balance, 'cash', 'adjustment')
      from public.wallets w where w.user_id in ${theirIds} and w.cash_balance <> 0;`)
}
