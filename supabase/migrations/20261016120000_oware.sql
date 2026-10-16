-- Oware (Abapa), the sowing game of Ghana and the wider region. Two players, each with a clock.
--
-- Who decides what:
--   * A move is judged by the oware-action Edge Function, which plays the stored game through
--     with the rules in supabase/functions/_shared/oware.ts. The app sends only the pit it wants
--     to play. It never sends a result.
--   * This migration stores the game, makes sure only the player whose turn it is can have a move
--     recorded, on the position they were looking at, keeps every seed accounted for, and keeps
--     the clocks on server time. A player whose time runs out loses. A game nobody starts is
--     called off and stakes go back.
--   * Money: nothing here touches it. A finished game is reported to the core, which settles.

/** All the seeds in a row of pits. Used by the rule that no seed is ever made or lost. */
create function private.oware_seed_total(p_pits smallint[]) returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(p), 0)::integer from unnest(p_pits) as p;
$$;

create table public.oware_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  -- Twelve counts, pit 0 first: South owns 0-5, North 6-11, sown in that order round the board.
  pits smallint[] not null check (cardinality(pits) = 12 and 0 <= all (pits)),
  store_south smallint not null default 0 check (store_south >= 0),
  store_north smallint not null default 0 check (store_north >= 0),
  turn text not null default 's' check (turn in ('s', 'n')),
  ply integer not null default 0 check (ply >= 0),
  south_time_ms bigint not null,
  north_time_ms bigint not null,
  increment_ms bigint not null default 0,
  last_move_at timestamptz not null default now(),
  draw_offer_by uuid references public.profiles (id),
  -- Every one of the 48 seeds is on the board or in a player's store, always.
  constraint oware_games_seeds check (private.oware_seed_total(pits) + store_south + store_north = 48)
);
alter table public.oware_games enable row level security;

-- The record of the game: the pit played each move, and what it did.
create table public.oware_moves (
  match_id uuid not null references public.matches (id) on delete restrict,
  ply integer not null check (ply >= 1),
  pit smallint not null check (pit between 0 and 11),
  -- "c" for South's third pit, "C" for North's.
  notation text not null check (notation ~ '^[a-fA-F]$'),
  taken smallint not null default 0 check (taken >= 0),
  pits_after smallint[] not null check (cardinality(pits_after) = 12 and 0 <= all (pits_after)),
  time_left_ms bigint not null,
  created_at timestamptz not null default now(),
  primary key (match_id, ply)
);
alter table public.oware_moves enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['oware_games', 'oware_moves'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format(
        'create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
        t || '_deny_client_' || op, t, op,
        case op when 'insert' then 'with check (false)' when 'delete' then 'using (false)' else 'using (false) with check (false)' end);
    end loop;
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_match_player(match_id) or private.is_match_finished(match_id))',
      t || '_select_player_or_finished', t);
    -- Anyone signed in may watch a tournament game.
    execute format('create policy %I on public.%I for select to authenticated using (private.is_tournament_match(match_id))', t || '_select_tournament', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.oware_games;
    alter publication supabase_realtime add table public.oware_moves;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hooks for the core
-- ---------------------------------------------------------------------------------------------
create function private.oware_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control jsonb;
begin
  select tc into v_control
    from public.game_types g, jsonb_array_elements(g.options_schema -> 'time_controls') as tc
   where g.id = 'oware' and tc ->> 'id' = p_options ->> 'time_control';
  if v_control is null then
    raise exception 'OWARE_UNKNOWN_TIME_CONTROL' using errcode = 'AG002';
  end if;
  if (select count(*) from public.match_players mp where mp.match_id = p_match_id) <> 2 then
    raise exception 'OWARE_TWO_PLAYERS' using errcode = 'AG002';
  end if;

  -- Seat 1 sits on the south side of the board and moves first.
  update public.match_players mp
     set seat = case mp.seat when '1' then 'south' else 'north' end
   where mp.match_id = p_match_id;

  insert into public.oware_games (match_id, pits, turn, ply, south_time_ms, north_time_ms, increment_ms, last_move_at)
  values (
    p_match_id,
    array_fill(4::smallint, array[12]),
    's',
    0,
    (v_control ->> 'base_ms')::bigint,
    (v_control ->> 'base_ms')::bigint,
    (v_control ->> 'increment_ms')::bigint,
    clock_timestamp()
  );
end;
$$;

/**
 * Time left for one side at a given moment. A clock only runs once both players have made
 * their first move (before that, the first-move window applies instead).
 */
create function private.oware_remaining_ms(p_game public.oware_games, p_side text, p_at timestamptz) returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_game.turn = p_side and p_game.ply >= 2
      then (case p_side when 's' then p_game.south_time_ms else p_game.north_time_ms end)
           - floor(extract(epoch from (p_at - p_game.last_move_at)) * 1000)::bigint
    else (case p_side when 's' then p_game.south_time_ms else p_game.north_time_ms end)
  end;
$$;

create function private.oware_on_finish(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.oware_games;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_game from public.oware_games g where g.match_id = p_match_id for update;
  if not found then
    return;
  end if;
  -- Freeze the clocks where they stood.
  update public.oware_games g
     set south_time_ms = greatest(0, private.oware_remaining_ms(v_game, 's', v_now)),
         north_time_ms = greatest(0, private.oware_remaining_ms(v_game, 'n', v_now)),
         last_move_at = v_now,
         draw_offer_by = null
   where g.match_id = p_match_id;
end;
$$;

create function private.oware_side_of(p_match_id uuid, p_user_id uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case mp.seat when 'south' then 's' when 'north' then 'n' end
    from public.match_players mp
   where mp.match_id = p_match_id and mp.user_id = p_user_id;
$$;

create function private.oware_player_of(p_match_id uuid, p_side text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.user_id
    from public.match_players mp
   where mp.match_id = p_match_id and mp.seat = case p_side when 's' then 'south' else 'north' end;
$$;

-- Tournaments: whose first move it was, when nobody started the game.
create function private.oware_to_move(p_match_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.oware_player_of(p_match_id, g.turn) from public.oware_games g where g.match_id = p_match_id;
$$;

/**
 * Looks at the clock of an active game and ends it if time is up. Safe to call at any time by
 * anyone (a player's claim, or the background sweep): it only ever acts on server time.
 * Returns 'none', 'aborted' or 'timeout'.
 */
create function private.oware_check_clock(p_match_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.oware_games;
  v_now timestamptz := clock_timestamp();
  v_abort_after interval;
begin
  select * into v_game from public.oware_games g where g.match_id = p_match_id for update;
  if not found or not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return 'none';
  end if;

  if v_game.ply < 2 then
    select make_interval(secs => s.first_move_abort_seconds) into v_abort_after from public.platform_settings s;
    if v_now - v_game.last_move_at > v_abort_after then
      perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
      return 'aborted';
    end if;
    return 'none';
  end if;

  if private.oware_remaining_ms(v_game, v_game.turn, v_now) > 0 then
    return 'none';
  end if;
  perform private.finish_match(
    p_match_id, 'win',
    private.oware_player_of(p_match_id, case v_game.turn when 's' then 'n' else 's' end),
    'timeout');
  return 'timeout';
end;
$$;

/** Everything the move judge needs, in one round trip. Null when the player is not in the match. */
create function public.oware_move_context(p_match_id uuid, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status', m.status,
           'side', private.oware_side_of(p_match_id, p_user_id),
           'pits', to_jsonb(g.pits),
           'store_south', g.store_south,
           'store_north', g.store_north,
           'ply', g.ply,
           'turn', g.turn,
           'moves', coalesce((select jsonb_agg(mv.pit order by mv.ply)
                                from public.oware_moves mv where mv.match_id = p_match_id), '[]'::jsonb))
    from public.matches m
    join public.oware_games g on g.match_id = m.id
   where m.id = p_match_id
     and private.oware_side_of(p_match_id, p_user_id) is not null;
$$;

/**
 * Records a move that the Edge Function has already judged legal. Under a row lock it re-checks
 * everything that could have changed since: the game is still on, it is this player's turn, the
 * position has not moved on (p_expected_ply), and the player has time left by the server's
 * clock. Seeds are counted again: the board after the move, plus both stores, must hold all 48,
 * and no store may go down. Returns {ok: true, ...clock values} or {ok: false, code}.
 */
create function public.oware_apply_move(
  p_match_id uuid,
  p_user_id uuid,
  p_expected_ply integer,
  p_pit integer,
  p_notation text,
  p_taken integer,
  p_pits_after smallint[],
  p_store_south integer,
  p_store_north integer,
  p_end_reason text,
  p_winner text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.oware_games;
  v_side text;
  v_now timestamptz;
  v_left bigint;
  v_abort_after interval;
  v_south bigint;
  v_north bigint;
begin
  select * into v_game from public.oware_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'GAME_NOT_FOUND');
  end if;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;

  v_side := private.oware_side_of(p_match_id, p_user_id);
  if v_side is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  if v_game.turn <> v_side then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOUR_TURN');
  end if;
  if v_game.ply <> p_expected_ply then
    return jsonb_build_object('ok', false, 'code', 'OUT_OF_SYNC');
  end if;
  -- The pit is the mover's own, it held seeds, and every seed is still accounted for.
  if p_pit is null or p_pit not between (case v_side when 's' then 0 else 6 end) and (case v_side when 's' then 5 else 11 end)
     or v_game.pits[p_pit + 1] = 0
     or cardinality(p_pits_after) <> 12
     or p_store_south < v_game.store_south or p_store_north < v_game.store_north
     or private.oware_seed_total(p_pits_after) + p_store_south + p_store_north <> 48 then
    return jsonb_build_object('ok', false, 'code', 'ILLEGAL_MOVE');
  end if;

  -- Server time only. The app's idea of the time is never asked for.
  v_now := clock_timestamp();

  if v_game.ply < 2 then
    select make_interval(secs => s.first_move_abort_seconds) into v_abort_after from public.platform_settings s;
    if v_now - v_game.last_move_at > v_abort_after then
      perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
      return jsonb_build_object('ok', false, 'code', 'ABORTED');
    end if;
    v_left := private.oware_remaining_ms(v_game, v_side, v_now);
  else
    v_left := private.oware_remaining_ms(v_game, v_side, v_now);
    if v_left <= 0 then
      perform private.oware_check_clock(p_match_id);
      return jsonb_build_object('ok', false, 'code', 'TIME_OUT');
    end if;
    v_left := v_left + v_game.increment_ms;
  end if;

  v_south := case when v_side = 's' then v_left else v_game.south_time_ms end;
  v_north := case when v_side = 'n' then v_left else v_game.north_time_ms end;

  insert into public.oware_moves (match_id, ply, pit, notation, taken, pits_after, time_left_ms)
  values (p_match_id, v_game.ply + 1, p_pit, p_notation, p_taken, p_pits_after, v_left);

  update public.oware_games g
     set pits = p_pits_after,
         store_south = p_store_south,
         store_north = p_store_north,
         turn = case v_side when 's' then 'n' else 's' end,
         ply = v_game.ply + 1,
         south_time_ms = v_south,
         north_time_ms = v_north,
         last_move_at = v_now,
         -- Playing on declines any draw offer.
         draw_offer_by = null
   where g.match_id = p_match_id;

  if p_end_reason is not null then
    perform private.finish_match(
      p_match_id,
      case when p_winner is null then 'draw' else 'win' end,
      case when p_winner is null then null else private.oware_player_of(p_match_id, p_winner) end,
      p_end_reason);
  end if;

  return jsonb_build_object(
    'ok', true,
    'ply', v_game.ply + 1,
    'south_time_ms', v_south,
    'north_time_ms', v_north,
    'last_move_at', v_now,
    'finished', p_end_reason is not null);
end;
$$;

/** Resign, offer / accept / decline a draw, or ask the server to look at the clock. */
create function public.oware_game_action(p_match_id uuid, p_user_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.oware_games;
  v_side text;
  v_opponent uuid;
  v_clock text;
begin
  v_side := private.oware_side_of(p_match_id, p_user_id);
  if v_side is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;

  if p_action = 'claim' then
    v_clock := private.oware_check_clock(p_match_id);
    return jsonb_build_object('ok', true, 'clock', v_clock);
  end if;

  select * into v_game from public.oware_games g where g.match_id = p_match_id for update;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;
  v_opponent := private.oware_player_of(p_match_id, case v_side when 's' then 'n' else 's' end);

  if p_action = 'resign' then
    -- Before both sides have moved there is nothing to lose: the game is simply called off.
    if v_game.ply < 2 then
      perform private.finish_match(p_match_id, 'aborted', null, 'aborted_by_player');
    else
      perform private.finish_match(p_match_id, 'win', v_opponent, 'resignation');
    end if;
  elsif p_action = 'offer_draw' then
    if v_game.ply < 2 then
      return jsonb_build_object('ok', false, 'code', 'TOO_EARLY');
    end if;
    if v_game.draw_offer_by is not null then
      return jsonb_build_object('ok', false, 'code', 'OFFER_PENDING');
    end if;
    update public.oware_games g set draw_offer_by = p_user_id where g.match_id = p_match_id;
  elsif p_action = 'accept_draw' then
    if v_game.draw_offer_by is distinct from v_opponent then
      return jsonb_build_object('ok', false, 'code', 'NO_OFFER');
    end if;
    perform private.finish_match(p_match_id, 'draw', null, 'agreement');
  elsif p_action = 'decline_draw' then
    if v_game.draw_offer_by is distinct from v_opponent then
      return jsonb_build_object('ok', false, 'code', 'NO_OFFER');
    end if;
    update public.oware_games g set draw_offer_by = null where g.match_id = p_match_id;
  else
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ACTION');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.oware_move_context(uuid, uuid)',
    'public.oware_apply_move(uuid, uuid, integer, integer, text, integer, smallint[], integer, integer, text, text)',
    'public.oware_game_action(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    -- (The seed count is used by the table's own check, which runs as the database functions' owner.)
    'private.oware_seed_total(smallint[])',
    'private.oware_init_match(uuid, jsonb)',
    'private.oware_remaining_ms(public.oware_games, text, timestamptz)',
    'private.oware_on_finish(uuid)',
    'private.oware_side_of(uuid, uuid)',
    'private.oware_player_of(uuid, text)',
    'private.oware_to_move(uuid)',
    'private.oware_check_clock(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;

-- The background sweep watches the Oware clocks too.
create or replace function private.sweep() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
begin
  delete from public.match_queue q where q.heartbeat_at < now() - interval '2 minutes';

  for v_match in
    select g.match_id
      from public.chess_games g
      join public.matches m on m.id = g.match_id and m.status = 'active'
     where (g.ply < 2 and g.last_move_at < now() - interval '5 seconds')
        or (g.ply >= 2 and g.last_move_at + make_interval(secs => greatest(g.white_time_ms, g.black_time_ms) / 1000.0) < now())
  loop
    perform private.chess_check_clock(v_match);
  end loop;

  for v_match in
    select g.match_id from public.ludo_games g where g.phase <> 'over' and g.deadline < now()
  loop
    perform private.ludo_check_clock(v_match);
  end loop;

  for v_match in
    select g.match_id from public.pool_games g where g.phase <> 'over' and g.deadline < now()
  loop
    perform private.pool_check_clock(v_match);
  end loop;

  for v_match in
    select g.match_id
      from public.draughts_games g
      join public.matches m on m.id = g.match_id and m.status = 'active'
     where (g.ply < 2 and g.last_move_at < now() - interval '5 seconds')
        or (g.ply >= 2 and g.last_move_at + make_interval(secs => greatest(g.white_time_ms, g.black_time_ms) / 1000.0) < now())
  loop
    perform private.draughts_check_clock(v_match);
  end loop;

  for v_match in
    select g.match_id from public.checkup_games g where g.phase <> 'over' and g.deadline + interval '20 seconds' < now()
  loop
    perform private.checkup_check_clock(v_match);
  end loop;

  for v_match in
    select g.match_id from public.words_games g where g.phase <> 'over' and g.deadline + interval '20 seconds' < now()
  loop
    perform private.words_check_clock(v_match);
  end loop;

  for v_match in
    select g.match_id
      from public.oware_games g
      join public.matches m on m.id = g.match_id and m.status = 'active'
     where (g.ply < 2 and g.last_move_at < now() - interval '5 seconds')
        or (g.ply >= 2 and g.last_move_at + make_interval(secs => greatest(g.south_time_ms, g.north_time_ms) / 1000.0) < now())
  loop
    perform private.oware_check_clock(v_match);
  end loop;

  for v_match in
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;

-- Oware goes on the hub: two players, the same stakes as chess, one rating, quick clocks.
insert into public.game_types (id, name, status, sort_order, min_players, max_players, stake_levels, rating_pools, options_schema)
select 'oware', 'Oware', 'live', 35, 2, 2, c.stake_levels, '{default}', '{
         "time_controls": [
           {"id": "3+2", "base_ms": 180000, "increment_ms": 2000},
           {"id": "5+3", "base_ms": 300000, "increment_ms": 3000},
           {"id": "10+5", "base_ms": 600000, "increment_ms": 5000}
         ]
       }'::jsonb
  from public.game_types c where c.id = 'chess';
