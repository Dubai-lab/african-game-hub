-- Street basketball online: one against one and two against two, run by the game server.
--
-- Who decides what (CLAUDE.md, section 2, the exception of 17 October 2026):
--   * Basketball is a real-time game. The game server runs the match itself, sixty times a
--     second, with the rules in supabase/functions/_shared/basketball.ts, from the buttons each
--     player presses; it decides baskets and the score. The app sends only buttons.
--   * This migration stores each match's line-up and result, gives the game server what it needs
--     to start a match (who plays, on which side, the random seed), takes the result from it once,
--     and calls off a match the game server has stopped looking after.
--   * Money: nothing here touches it. Matches are free for now (the only stake level is 0); a
--     finished match is reported to the core, which settles and rates as for any game.
--   * Two against two counts toward no rating yet: the core's ratings know one winner, and a
--     side of two has two. Its matches are kept in the "unrated" pool, which the core skips.

create table public.basketball_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  -- Players a side: 1 or 2.
  team_size smallint not null check (team_size in (1, 2)),
  -- The game's random seed: every bounce off the rim comes from it.
  seed integer not null,
  score_a smallint not null default 0 check (score_a >= 0),
  score_b smallint not null default 0 check (score_b >= 0),
  winning_side text check (winning_side in ('a', 'b')),
  -- When every player had arrived and play began; and the last time the game server said it
  -- still had the match (it says so every few seconds while it plays).
  started_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.basketball_games enable row level security;

do $$
declare
  op text;
begin
  revoke all on table public.basketball_games from public, anon, authenticated;
  grant all on table public.basketball_games to service_role;
  grant select on table public.basketball_games to authenticated;
  foreach op in array array['insert', 'update', 'delete'] loop
    execute format(
      'create policy %I on public.basketball_games as restrictive for %s to anon, authenticated %s',
      'basketball_games_deny_client_' || op, op,
      case op when 'insert' then 'with check (false)' when 'delete' then 'using (false)' else 'using (false) with check (false)' end);
  end loop;
  create policy basketball_games_select_player_or_finished on public.basketball_games
    for select to authenticated using (private.is_match_player(match_id) or private.is_match_finished(match_id));
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.basketball_games;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hooks for the core
-- ---------------------------------------------------------------------------------------------

/**
 * A new match: two sides, the seats dealt at random by the core are turned into places on a
 * side ("a1", "b1", and in two against two "a2", "b2"), and the game gets its seed.
 */
create function private.basketball_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_players integer;
begin
  select count(*) into v_players from public.match_players mp where mp.match_id = p_match_id;
  if v_players not in (2, 4) or v_players <> coalesce((p_options ->> 'players')::integer, 2) then
    raise exception 'BASKETBALL_PLAYERS' using errcode = 'AG002';
  end if;

  -- Seats 1 and 3 make side a, 2 and 4 side b.
  update public.match_players mp
     set seat = (case when mp.seat::integer % 2 = 1 then 'a' else 'b' end) || ((mp.seat::integer + 1) / 2)::text
   where mp.match_id = p_match_id;

  insert into public.basketball_games (match_id, team_size, seed)
  values (p_match_id, v_players / 2, floor(random() * 2147483647)::integer);
end;
$$;

create function private.basketball_on_finish(p_match_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.basketball_games g set finished_at = coalesce(g.finished_at, now()) where g.match_id = p_match_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- For the game server
-- ---------------------------------------------------------------------------------------------

/**
 * What the game server needs to run a match, asked when a player arrives: the match, its sides
 * and seed, and every player in it. Null when the player is not in this match.
 */
create function public.basketball_court_context(p_match_id uuid, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status', m.status,
           'team_size', g.team_size,
           'seed', g.seed,
           'seat', (select mp.seat from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id),
           'players', (select jsonb_agg(jsonb_build_object('user_id', mp.user_id, 'seat', mp.seat, 'username', p.username, 'country_code', p.country_code) order by mp.seat)
                         from public.match_players mp join public.profiles p on p.id = mp.user_id
                        where mp.match_id = p_match_id))
    from public.matches m
    join public.basketball_games g on g.match_id = m.id
   where m.id = p_match_id
     and exists (select 1 from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id);
$$;

/**
 * The game server still has the match (said every few seconds while it plays). The first time
 * every player is there, play has begun.
 */
create function public.basketball_alive(p_match_id uuid, p_started boolean) returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.basketball_games g
     set seen_at = now(),
         started_at = case when p_started then coalesce(g.started_at, now()) else g.started_at end
   where g.match_id = p_match_id
     and exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active')
  returning true;
$$;

/**
 * The result, from the game server, taken once. A game played out must have been won the way the
 * rules say (the winners reached 11 and are ahead); a game ended because a side left may stand at
 * any score. Returns {ok: true} or {ok: false, code}.
 */
create function public.basketball_finish(p_match_id uuid, p_winning_side text, p_score_a integer, p_score_b integer, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.basketball_games;
  v_winner uuid;
begin
  select * into v_game from public.basketball_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'MATCH_NOT_FOUND');
  end if;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'MATCH_NOT_ACTIVE');
  end if;
  if p_winning_side not in ('a', 'b') or p_score_a < 0 or p_score_b < 0 or p_score_a > 40 or p_score_b > 40 then
    return jsonb_build_object('ok', false, 'code', 'BAD_RESULT');
  end if;
  if p_reason = 'played' then
    if (p_winning_side = 'a' and (p_score_a < 11 or p_score_a <= p_score_b)) or (p_winning_side = 'b' and (p_score_b < 11 or p_score_b <= p_score_a)) then
      return jsonb_build_object('ok', false, 'code', 'BAD_RESULT');
    end if;
  elsif p_reason <> 'abandoned' then
    return jsonb_build_object('ok', false, 'code', 'BAD_RESULT');
  end if;

  update public.basketball_games g
     set score_a = p_score_a, score_b = p_score_b, winning_side = p_winning_side, finished_at = now()
   where g.match_id = p_match_id;

  -- The core knows one winner: the first player of the winning side. (In two against two, the
  -- side is in basketball_games.winning_side and the seats.)
  select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = p_winning_side || '1';
  perform private.finish_match(p_match_id, 'win', v_winner, p_reason);
  return jsonb_build_object('ok', true);
end;
$$;

/** Called off by the game server: not every player came, or it cannot go on with the match. */
create function public.basketball_abort(p_match_id uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason not in ('no_show', 'server_lost') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REASON');
  end if;
  if not exists (select 1 from public.matches m join public.basketball_games g on g.match_id = m.id where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'MATCH_NOT_ACTIVE');
  end if;
  perform private.finish_match(p_match_id, 'aborted', null, p_reason);
  return jsonb_build_object('ok', true);
end;
$$;

/**
 * Matches the game server is no longer looking after are called off, so nobody is left in one:
 * never started two minutes after it was made, or not heard of for a minute (the server stopped
 * mid-match; a real-time game cannot be carried on anywhere else).
 */
create function private.basketball_sweep() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
begin
  for v_match in
    select g.match_id
      from public.basketball_games g
      join public.matches m on m.id = g.match_id and m.status = 'active'
     where (g.started_at is null and g.created_at < now() - interval '2 minutes')
        or (g.started_at is not null and g.seen_at < now() - interval '1 minute')
  loop
    perform private.finish_match(v_match, 'aborted', null, case when (select started_at from public.basketball_games where match_id = v_match) is null then 'no_show' else 'server_lost' end);
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('agh-basketball', '20 seconds', 'select private.basketball_sweep()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Core: a pool that counts toward no rating
-- ---------------------------------------------------------------------------------------------
-- Ratings as before (20261008100000_tables_of_four.sql), except for matches in the "unrated"
-- pool, which are recorded and settled but move nobody's rating.
create or replace function private.update_ratings(p_match_id uuid, p_game_type text, p_pool text, p_winner_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_row record;
begin
  if p_pool = 'unrated' then
    return;
  end if;
  select count(*) into v_n from public.match_players mp where mp.match_id = p_match_id;
  if v_n < 2 then
    return;
  end if;

  insert into public.player_ratings (user_id, game_type, pool)
  select mp.user_id, p_game_type, p_pool from public.match_players mp where mp.match_id = p_match_id
  on conflict do nothing;

  -- Always locked in the same order, so matches finishing at once cannot lock each other out.
  perform 1 from public.player_ratings r
    where r.game_type = p_game_type and r.pool = p_pool
      and r.user_id in (select mp.user_id from public.match_players mp where mp.match_id = p_match_id)
    order by r.user_id
      for update;

  for v_row in
    with seated as (
      select r.user_id, r.rating, r.games_played
        from public.player_ratings r
       where r.game_type = p_game_type and r.pool = p_pool
         and r.user_id in (select mp.user_id from public.match_players mp where mp.match_id = p_match_id)
    )
    select a.user_id, a.rating as old,
           greatest(100, round(a.rating
             + (case when a.games_played < 20 then 40 else 20 end)
               * ((case when p_winner_id is null then 1.0 / v_n when a.user_id = p_winner_id then 1 else 0 end)
                  - (select sum(1 / (1 + power(10::numeric, (b.rating - a.rating) / 400.0))) from seated b where b.user_id <> a.user_id)
                    / (v_n * (v_n - 1) / 2.0))))::integer as new
      from seated a
  loop
    update public.player_ratings r
       set rating = v_row.new,
           games_played = r.games_played + 1,
           wins = r.wins + (case when p_winner_id = r.user_id then 1 else 0 end),
           losses = r.losses + (case when p_winner_id is not null and p_winner_id <> r.user_id then 1 else 0 end),
           draws = r.draws + (case when p_winner_id is null then 1 else 0 end),
           updated_at = now()
     where r.user_id = v_row.user_id and r.game_type = p_game_type and r.pool = p_pool;
    update public.match_players mp
       set rating_before = v_row.old, rating_after = v_row.new
     where mp.match_id = p_match_id and mp.user_id = v_row.user_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.basketball_court_context(uuid, uuid)',
    'public.basketball_alive(uuid, boolean)',
    'public.basketball_finish(uuid, text, integer, integer, text)',
    'public.basketball_abort(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
    if exists (select 1 from pg_roles where rolname = 'game_server') then
      execute format('grant execute on function %s to game_server', fn);
    end if;
  end loop;

  foreach fn in array array[
    'private.basketball_init_match(uuid, jsonb)',
    'private.basketball_on_finish(uuid)',
    'private.basketball_sweep()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;

-- Matches can now be found: free only, one against one (rated) or two against two (unrated).
update public.game_types
   set stake_levels = array[0]::bigint[],
       rating_pools = array['default', 'unrated'],
       options_schema = '{"players": [2, 4]}'::jsonb
 where id = 'basketball';
