-- Row level security and grants.
--
-- Rule: clients (the anon and authenticated roles) may READ what is theirs and nothing more.
-- Every change to money or game state goes through Edge Functions (service role) or
-- SECURITY DEFINER functions. Privileges are revoked AND restrictive deny policies are added,
-- so a mistake in one layer is still caught by the other.

-- Helpers used inside policies. SECURITY DEFINER so a policy on match_players can look at
-- match_players without recursing into itself.
create function private.is_match_player(p_match_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match_id and mp.user_id = (select auth.uid())
  );
$$;

create function private.is_match_finished(p_match_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'finished');
$$;

revoke all on function private.is_match_player(uuid) from public, anon;
revoke all on function private.is_match_finished(uuid) from public, anon;
grant execute on function private.is_match_player(uuid) to authenticated, service_role;
grant execute on function private.is_match_finished(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Start from nothing: no client privilege on any table, and explicit deny policies for writes.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
  op text;
  -- Tables where the owner may update a few of their own columns (granted further down).
  owner_updatable constant text[] := array['profiles', 'profile_private'];
  all_tables constant text[] := array[
    'countries', 'platform_settings', 'profiles', 'profile_private', 'admins', 'game_types',
    'player_ratings', 'wallets', 'payments', 'matches', 'match_players', 'ledger_entries',
    'escrow', 'match_queue', 'platform_revenue', 'chess_games', 'chess_moves'
  ];
begin
  foreach t in array all_tables loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);

    foreach op in array array['insert', 'update', 'delete'] loop
      continue when op = 'update' and t = any (owner_updatable);
      execute format(
        'create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
        t || '_deny_client_' || op,
        t,
        op,
        case op
          when 'insert' then 'with check (false)'
          when 'delete' then 'using (false)'
          else 'using (false) with check (false)'
        end
      );
    end loop;
  end loop;
end;
$$;

revoke all on table private.admin_emails from public, anon, authenticated;
create policy admin_emails_deny_all on private.admin_emails as restrictive for all to public using (false) with check (false);

-- ---------------------------------------------------------------------------------------------
-- Reference data anyone may read (the landing page shows it before login).
-- ---------------------------------------------------------------------------------------------
grant select on public.countries to anon, authenticated;
create policy countries_select_active on public.countries
  for select to anon, authenticated using (is_active);

grant select on public.game_types to anon, authenticated;
create policy game_types_select_visible on public.game_types
  for select to anon, authenticated using (status <> 'disabled');

-- Rake and signup bonus are public terms of play, not secrets.
grant select on public.platform_settings to anon, authenticated;
create policy platform_settings_select on public.platform_settings
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------------------------
-- Public profile fields only (username, name, avatar, country): safe for any signed-in player.
grant select on public.profiles to authenticated;
create policy profiles_select_signed_in on public.profiles
  for select to authenticated using (true);

-- Column grant: username and country cannot be changed by a plain update.
grant update (display_name, avatar_url) on public.profiles to authenticated;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.profile_private to authenticated;
create policy profile_private_select_own on public.profile_private
  for select to authenticated using (user_id = (select auth.uid()));

-- Column grant: is_banned, phone and age confirmation are out of reach.
grant update (preferred_language) on public.profile_private to authenticated;
create policy profile_private_update_own on public.profile_private
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select on public.admins to authenticated;
create policy admins_select_own on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

-- Ratings are public among players (leaderboards).
grant select on public.player_ratings to authenticated;
create policy player_ratings_select_signed_in on public.player_ratings
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- Money: read your own, change nothing.
-- ---------------------------------------------------------------------------------------------
grant select on public.wallets to authenticated;
create policy wallets_select_own on public.wallets
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.ledger_entries to authenticated;
create policy ledger_entries_select_own on public.ledger_entries
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.escrow to authenticated;
create policy escrow_select_own on public.escrow
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.payments to authenticated;
create policy payments_select_own on public.payments
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.match_queue to authenticated;
create policy match_queue_select_own on public.match_queue
  for select to authenticated using (user_id = (select auth.uid()));

-- Platform revenue: no client access of any kind.
create policy platform_revenue_deny_client_select on public.platform_revenue
  as restrictive for select to anon, authenticated using (false);

-- ---------------------------------------------------------------------------------------------
-- Matches and game state: players see their own games; finished games are open for replay.
-- Games in progress are hidden from everyone else (no live spectating, which helps cheats).
-- ---------------------------------------------------------------------------------------------
grant select on public.matches to authenticated;
create policy matches_select_player_or_finished on public.matches
  for select to authenticated
  using (status = 'finished' or private.is_match_player(id));

grant select on public.match_players to authenticated;
create policy match_players_select_player_or_finished on public.match_players
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_match_player(match_id)
    or private.is_match_finished(match_id)
  );

grant select on public.chess_games to authenticated;
create policy chess_games_select_player_or_finished on public.chess_games
  for select to authenticated
  using (private.is_match_player(match_id) or private.is_match_finished(match_id));

grant select on public.chess_moves to authenticated;
create policy chess_moves_select_player_or_finished on public.chess_moves
  for select to authenticated
  using (private.is_match_player(match_id) or private.is_match_finished(match_id));

-- ---------------------------------------------------------------------------------------------
-- Realtime: live updates for the tables clients watch. Realtime applies the SELECT policies above.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.matches, public.chess_games, public.chess_moves, public.wallets;
  end if;
end;
$$;
