-- Draughts (international, 10 x 10), the fourth game on the hub. Two players, each with a clock.
--
-- Who decides what:
--   * A move is judged by the draughts-action Edge Function, which plays the stored game through
--     with the rules in supabase/functions/_shared/draughts.ts. The app sends only the squares a
--     piece is to visit. It never sends a result.
--   * This migration stores the game, makes sure only the player whose turn it is can have a move
--     recorded, on the position they were looking at, and keeps the clocks on server time. A
--     player whose time runs out loses. A game nobody starts is called off and stakes go back.
--   * Money: nothing here touches it. A finished game is reported to the core, which settles.

create table public.draughts_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  -- 50 characters, square 1 first: '.' empty, 'w' 'b' men, 'W' 'B' kings.
  board text not null check (board ~ '^[.wWbB]{50}$'),
  turn text not null default 'w' check (turn in ('w', 'b')),
  ply integer not null default 0 check (ply >= 0),
  white_time_ms bigint not null,
  black_time_ms bigint not null,
  increment_ms bigint not null default 0,
  last_move_at timestamptz not null default now(),
  draw_offer_by uuid references public.profiles (id)
);
alter table public.draughts_games enable row level security;

-- The record of the game: every move as the squares the piece visited.
create table public.draughts_moves (
  match_id uuid not null references public.matches (id) on delete restrict,
  ply integer not null check (ply >= 1),
  -- "32-28", or "28x19" for a capture.
  notation text not null,
  path jsonb not null,
  captures jsonb not null default '[]'::jsonb,
  board_after text not null check (board_after ~ '^[.wWbB]{50}$'),
  time_left_ms bigint not null,
  created_at timestamptz not null default now(),
  primary key (match_id, ply)
);
alter table public.draughts_moves enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['draughts_games', 'draughts_moves'] loop
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
    alter publication supabase_realtime add table public.draughts_games;
    alter publication supabase_realtime add table public.draughts_moves;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hooks for the core
-- ---------------------------------------------------------------------------------------------
create function private.draughts_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control jsonb;
begin
  select tc into v_control
    from public.game_types g, jsonb_array_elements(g.options_schema -> 'time_controls') as tc
   where g.id = 'draughts' and tc ->> 'id' = p_options ->> 'time_control';
  if v_control is null then
    raise exception 'DRAUGHTS_UNKNOWN_TIME_CONTROL' using errcode = 'AG002';
  end if;
  if (select count(*) from public.match_players mp where mp.match_id = p_match_id) <> 2 then
    raise exception 'DRAUGHTS_TWO_PLAYERS' using errcode = 'AG002';
  end if;

  -- Seat 1 has the white pieces and moves first.
  update public.match_players mp
     set seat = case mp.seat when '1' then 'white' else 'black' end
   where mp.match_id = p_match_id;

  insert into public.draughts_games (match_id, board, turn, ply, white_time_ms, black_time_ms, increment_ms, last_move_at)
  values (
    p_match_id,
    repeat('b', 20) || repeat('.', 10) || repeat('w', 20),
    'w',
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
create function private.draughts_remaining_ms(p_game public.draughts_games, p_color text, p_at timestamptz) returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_game.turn = p_color and p_game.ply >= 2
      then (case p_color when 'w' then p_game.white_time_ms else p_game.black_time_ms end)
           - floor(extract(epoch from (p_at - p_game.last_move_at)) * 1000)::bigint
    else (case p_color when 'w' then p_game.white_time_ms else p_game.black_time_ms end)
  end;
$$;

create function private.draughts_on_finish(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.draughts_games;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_game from public.draughts_games g where g.match_id = p_match_id for update;
  if not found then
    return;
  end if;
  -- Freeze the clocks where they stood.
  update public.draughts_games g
     set white_time_ms = greatest(0, private.draughts_remaining_ms(v_game, 'w', v_now)),
         black_time_ms = greatest(0, private.draughts_remaining_ms(v_game, 'b', v_now)),
         last_move_at = v_now,
         draw_offer_by = null
   where g.match_id = p_match_id;
end;
$$;

create function private.draughts_color_of(p_match_id uuid, p_user_id uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case mp.seat when 'white' then 'w' when 'black' then 'b' end
    from public.match_players mp
   where mp.match_id = p_match_id and mp.user_id = p_user_id;
$$;

create function private.draughts_player_of(p_match_id uuid, p_color text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.user_id
    from public.match_players mp
   where mp.match_id = p_match_id and mp.seat = case p_color when 'w' then 'white' else 'black' end;
$$;

/**
 * Looks at the clock of an active game and ends it if time is up. Safe to call at any time by
 * anyone (a player's claim, or the background sweep): it only ever acts on server time.
 * Returns 'none', 'aborted' or 'timeout'.
 */
create function private.draughts_check_clock(p_match_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.draughts_games;
  v_now timestamptz := clock_timestamp();
  v_abort_after interval;
begin
  select * into v_game from public.draughts_games g where g.match_id = p_match_id for update;
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

  if private.draughts_remaining_ms(v_game, v_game.turn, v_now) > 0 then
    return 'none';
  end if;
  perform private.finish_match(
    p_match_id, 'win',
    private.draughts_player_of(p_match_id, case v_game.turn when 'w' then 'b' else 'w' end),
    'timeout');
  return 'timeout';
end;
$$;

/** Everything the move judge needs, in one round trip. Null when the player is not in the match. */
create function public.draughts_move_context(p_match_id uuid, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status', m.status,
           'color', private.draughts_color_of(p_match_id, p_user_id),
           'board', g.board,
           'ply', g.ply,
           'turn', g.turn,
           'paths', coalesce((select jsonb_agg(mv.path order by mv.ply)
                                from public.draughts_moves mv where mv.match_id = p_match_id), '[]'::jsonb))
    from public.matches m
    join public.draughts_games g on g.match_id = m.id
   where m.id = p_match_id
     and private.draughts_color_of(p_match_id, p_user_id) is not null;
$$;

/**
 * Records a move that the Edge Function has already judged legal. Under a row lock it re-checks
 * everything that could have changed since: the game is still on, it is this player's turn, the
 * position has not moved on (p_expected_ply), and the player has time left by the server's
 * clock. Returns {ok: true, ...clock values} or {ok: false, code}.
 */
create function public.draughts_apply_move(
  p_match_id uuid,
  p_user_id uuid,
  p_expected_ply integer,
  p_notation text,
  p_path jsonb,
  p_captures jsonb,
  p_board_after text,
  p_end_reason text,
  p_winner text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.draughts_games;
  v_color text;
  v_now timestamptz;
  v_left bigint;
  v_abort_after interval;
  v_white bigint;
  v_black bigint;
begin
  select * into v_game from public.draughts_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'GAME_NOT_FOUND');
  end if;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;

  v_color := private.draughts_color_of(p_match_id, p_user_id);
  if v_color is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  if v_game.turn <> v_color then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOUR_TURN');
  end if;
  if v_game.ply <> p_expected_ply then
    return jsonb_build_object('ok', false, 'code', 'OUT_OF_SYNC');
  end if;

  -- Server time only. The app's idea of the time is never asked for.
  v_now := clock_timestamp();

  if v_game.ply < 2 then
    select make_interval(secs => s.first_move_abort_seconds) into v_abort_after from public.platform_settings s;
    if v_now - v_game.last_move_at > v_abort_after then
      perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
      return jsonb_build_object('ok', false, 'code', 'ABORTED');
    end if;
    v_left := private.draughts_remaining_ms(v_game, v_color, v_now);
  else
    v_left := private.draughts_remaining_ms(v_game, v_color, v_now);
    if v_left <= 0 then
      perform private.draughts_check_clock(p_match_id);
      return jsonb_build_object('ok', false, 'code', 'TIME_OUT');
    end if;
    v_left := v_left + v_game.increment_ms;
  end if;

  v_white := case when v_color = 'w' then v_left else v_game.white_time_ms end;
  v_black := case when v_color = 'b' then v_left else v_game.black_time_ms end;

  insert into public.draughts_moves (match_id, ply, notation, path, captures, board_after, time_left_ms)
  values (p_match_id, v_game.ply + 1, p_notation, p_path, p_captures, p_board_after, v_left);

  update public.draughts_games g
     set board = p_board_after,
         turn = case v_color when 'w' then 'b' else 'w' end,
         ply = v_game.ply + 1,
         white_time_ms = v_white,
         black_time_ms = v_black,
         last_move_at = v_now,
         -- Playing on declines any draw offer.
         draw_offer_by = null
   where g.match_id = p_match_id;

  if p_end_reason is not null then
    perform private.finish_match(
      p_match_id,
      case when p_winner is null then 'draw' else 'win' end,
      case when p_winner is null then null else private.draughts_player_of(p_match_id, p_winner) end,
      p_end_reason);
  end if;

  return jsonb_build_object(
    'ok', true,
    'ply', v_game.ply + 1,
    'white_time_ms', v_white,
    'black_time_ms', v_black,
    'last_move_at', v_now,
    'finished', p_end_reason is not null);
end;
$$;

/** Resign, offer / accept / decline a draw, or ask the server to look at the clock. */
create function public.draughts_game_action(p_match_id uuid, p_user_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.draughts_games;
  v_color text;
  v_opponent uuid;
  v_clock text;
begin
  v_color := private.draughts_color_of(p_match_id, p_user_id);
  if v_color is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;

  if p_action = 'claim' then
    v_clock := private.draughts_check_clock(p_match_id);
    return jsonb_build_object('ok', true, 'clock', v_clock);
  end if;

  select * into v_game from public.draughts_games g where g.match_id = p_match_id for update;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;
  v_opponent := private.draughts_player_of(p_match_id, case v_color when 'w' then 'b' else 'w' end);

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
    update public.draughts_games g set draw_offer_by = p_user_id where g.match_id = p_match_id;
  elsif p_action = 'accept_draw' then
    if v_game.draw_offer_by is distinct from v_opponent then
      return jsonb_build_object('ok', false, 'code', 'NO_OFFER');
    end if;
    perform private.finish_match(p_match_id, 'draw', null, 'agreement');
  elsif p_action = 'decline_draw' then
    if v_game.draw_offer_by is distinct from v_opponent then
      return jsonb_build_object('ok', false, 'code', 'NO_OFFER');
    end if;
    update public.draughts_games g set draw_offer_by = null where g.match_id = p_match_id;
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
    'public.draughts_move_context(uuid, uuid)',
    'public.draughts_apply_move(uuid, uuid, integer, text, jsonb, jsonb, text, text, text)',
    'public.draughts_game_action(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'private.draughts_init_match(uuid, jsonb)',
    'private.draughts_remaining_ms(public.draughts_games, text, timestamptz)',
    'private.draughts_on_finish(uuid)',
    'private.draughts_color_of(uuid, uuid)',
    'private.draughts_player_of(uuid, text)',
    'private.draughts_check_clock(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;

-- The background sweep watches the draughts clocks too.
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
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;

-- Draughts goes live: two players, the same stakes as chess, one rating.
update public.game_types
   set status = 'live',
       min_players = 2,
       max_players = 2,
       stake_levels = (select c.stake_levels from public.game_types c where c.id = 'chess'),
       rating_pools = '{default}',
       options_schema = '{
         "time_controls": [
           {"id": "3+2", "base_ms": 180000, "increment_ms": 2000},
           {"id": "5+3", "base_ms": 300000, "increment_ms": 3000},
           {"id": "10+5", "base_ms": 600000, "increment_ms": 5000},
           {"id": "15+10", "base_ms": 900000, "increment_ms": 10000}
         ]
       }'::jsonb
 where id = 'draughts';
