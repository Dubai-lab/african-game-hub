-- Narrow keys for the two programs that reach the database from outside Supabase.
--
-- Until now the game server held the service role key, which can do anything: read every email,
-- write any wallet. A machine on the internet should hold no such thing. From here on:
--
--   * `game_server` can do exactly what a game server needs: read a game as a player sees it,
--     record a move through the game's own function, and ask whether a player is banned.
--     It cannot read or write a single table directly, and cannot touch money at all. If that
--     machine were broken into, the intruder could tamper with moves in live games (which is
--     bad, and is why the machine is locked down) but could not empty a wallet, read personal
--     details, or make themselves an admin.
--   * `ledger_backup` can read the money tables through one function, a page at a time, and
--     nothing else. It exists so a copy of the books can be taken every night and kept
--     somewhere that is not this database.
--
-- A key for each is made by scripts/makeServerKeys.ts (a token that names the role). The Edge
-- Functions are unaffected: they keep using the service role, inside Supabase.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'game_server') then
    create role game_server nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'ledger_backup') then
    create role ledger_backup nologin noinherit;
  end if;
  -- The API signs in as `authenticator` and then becomes the role the token names.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant game_server to authenticator;
    grant ledger_backup to authenticator;
  end if;
end;
$$;

grant usage on schema public to game_server, ledger_backup;

-- ---------------------------------------------------------------------------------------------
-- What the game server may ask
-- ---------------------------------------------------------------------------------------------

/** Whether a player may be let in to play: false for a banned account, or one that does not exist. */
create function public.game_server_admits(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_user_id)
     and not exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned);
$$;

/** A pool game as one of its players sees it; null when they are not in the match. */
create function public.pool_shot_context(p_match_id uuid, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status', case when g.phase = 'over' then 'finished' else m.status end,
           'seat', mp.seat,
           'ply', g.shot_no,
           'row', jsonb_build_object(
             'variant', g.variant, 'balls', g.balls, 'turn', g.turn, 'break_shot', g.break_shot,
             'ball_in_hand', g.ball_in_hand, 'solids_seat', g.solids_seat, 'fouls', g.fouls,
             'shot_no', g.shot_no, 'phase', g.phase, 'shot_seconds', g.shot_seconds))
    from public.matches m
    join public.pool_games g on g.match_id = m.id
    join public.match_players mp on mp.match_id = m.id and mp.user_id = p_user_id
   where m.id = p_match_id;
$$;

/** A Ludo table as one of its players sees it; null when they are not at it. */
create function public.ludo_table_context(p_match_id uuid, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'positions', g.positions, 'teams', g.teams, 'capture_home', g.capture_home, 'turn', g.turn,
           'phase', g.phase, 'dice', g.dice, 'rolled', g.rolled, 'dice_count', g.dice_count,
           'turn_no', g.turn_no, 'deadline', g.deadline, 'last_event', g.last_event,
           'places', g.places, 'gone', g.gone)
    from public.ludo_games g
    join public.match_players mp on mp.match_id = g.match_id and mp.user_id = p_user_id
   where g.match_id = p_match_id;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.game_server_admits(uuid)',
    'public.pool_shot_context(uuid, uuid)',
    'public.ludo_table_context(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  -- Everything the game server calls, and nothing more.
  foreach fn in array array[
    'public.game_server_admits(uuid)',
    'public.chess_move_context(uuid, uuid)',
    'public.chess_apply_move(uuid, uuid, integer, text, text, text, text, text)',
    'public.draughts_move_context(uuid, uuid)',
    'public.draughts_apply_move(uuid, uuid, integer, text, jsonb, jsonb, text, text, text)',
    'public.pool_shot_context(uuid, uuid)',
    'public.pool_apply_shot(uuid, uuid, integer, jsonb, jsonb, jsonb)',
    'public.ludo_table_context(uuid, uuid)',
    'public.ludo_action(uuid, uuid, text, integer, integer, integer, text, boolean)'
  ] loop
    execute format('grant execute on function %s to game_server', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The nightly copy of the books
-- ---------------------------------------------------------------------------------------------

/**
 * One page of one money table, oldest rows first, as JSON. `p_after` is how many rows have
 * already been read. Only the tables listed here can be read this way; they hold no emails,
 * phone numbers or passwords (accounts are known by their id and username).
 */
create function public.backup_export(p_table text, p_after bigint default 0, p_limit integer default 1000) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order text;
  v_rows jsonb;
begin
  v_order := case p_table
    when 'ledger_entries' then 'id'
    when 'wallets' then 'user_id'
    when 'escrow' then 'match_id, user_id'
    when 'matches' then 'created_at, id'
    when 'match_players' then 'match_id, user_id'
    when 'payments' then 'created_at, id'
    when 'platform_revenue' then 'match_id'
    when 'tournaments' then 'created_at, id'
    when 'tournament_players' then 'tournament_id, user_id'
    when 'tournament_prizes' then 'tournament_id, user_id'
    when 'player_ratings' then 'user_id, game_type, pool'
    when 'profiles' then 'id'
    when 'platform_settings' then '1'
    else null end;
  if v_order is null then
    raise exception 'BACKUP_TABLE_NOT_ALLOWED' using errcode = 'AG002';
  end if;
  if p_limit < 1 or p_limit > 5000 or p_after < 0 then
    raise exception 'BACKUP_BAD_PAGE' using errcode = 'AG002';
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from public.%I order by %s offset $1 limit $2) x',
    p_table, v_order)
    into v_rows using p_after, p_limit;
  return v_rows;
end;
$$;

revoke all on function public.backup_export(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.backup_export(text, bigint, integer) to service_role, ledger_backup;
