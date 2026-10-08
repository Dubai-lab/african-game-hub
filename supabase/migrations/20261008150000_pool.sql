-- Pool: 8-ball and 9-ball, the third game on the hub. Two players.
--
-- Who decides what:
--   * A shot is played out by the pool-action Edge Function, which runs the physics and the
--     rules (supabase/functions/_shared/pool.ts) on the position stored here. The app sends only
--     what the player asked for: a direction, a power, some spin, and where to put the cue ball
--     when they have it in hand. It never sends a result.
--   * This migration stores the game, makes sure only the player whose turn it is can have a
--     shot recorded, on the position they were looking at, and keeps the shot clock. A player
--     who lets the clock run out gives the opponent ball in hand; the third time in a row they
--     lose. A game that nobody starts is called off and the stakes go back.
--   * Money: nothing here touches it. A finished game is reported to the core, which settles.

create table public.pool_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  variant text not null check (variant in ('8ball', '9ball')),
  -- [{ "n": 0, "x": 635, "y": 635, "in": false }, ...]. Empty until the break: the rack is
  -- always the same arrangement, which both the server and the app know.
  balls jsonb not null default '[]'::jsonb,
  -- Seats are '1' and '2' as dealt; '1' breaks.
  turn text not null default '1' check (turn in ('1', '2')),
  break_shot boolean not null default true,
  ball_in_hand boolean not null default true,
  -- 8-ball: which seat has the solids; null while the table is open.
  solids_seat text check (solids_seat in ('1', '2')),
  -- Fouls in a row by each seat (9-ball: three lose), and turns in a row each let the clock take.
  fouls jsonb not null default '{"1": 0, "2": 0}'::jsonb,
  misses jsonb not null default '{}'::jsonb,
  acted jsonb not null default '{}'::jsonb,
  -- Goes up by one with every shot and every turn the clock takes; the app says which it saw.
  shot_no integer not null default 0,
  shot_seconds smallint not null,
  deadline timestamptz,
  phase text not null default 'play' check (phase in ('play', 'over')),
  -- The last shot, for the other player's app to play back: what was asked, the position it
  -- was played from, and what the rules made of it.
  last_shot jsonb,
  updated_at timestamptz not null default now()
);
alter table public.pool_games enable row level security;

-- The record of the game: every shot as it was asked for, and its result.
create table public.pool_shots (
  match_id uuid not null references public.matches (id) on delete restrict,
  shot_no integer not null,
  seat text not null,
  shot jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, shot_no)
);
alter table public.pool_shots enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['pool_games', 'pool_shots'] loop
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
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pool_games;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hooks for the core
-- ---------------------------------------------------------------------------------------------
create function private.pool_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schema jsonb;
begin
  select g.options_schema into v_schema from public.game_types g where g.id = 'pool';
  if not (v_schema -> 'variants') ? (p_options ->> 'variant') then
    raise exception 'POOL_UNKNOWN_VARIANT' using errcode = 'AG002';
  end if;
  if (select count(*) from public.match_players mp where mp.match_id = p_match_id) <> 2 then
    raise exception 'POOL_TWO_PLAYERS' using errcode = 'AG002';
  end if;
  insert into public.pool_games (match_id, variant, shot_seconds, deadline)
  values (
    p_match_id, p_options ->> 'variant',
    coalesce((v_schema ->> 'shot_seconds')::integer, 30),
    -- The break gets the same grace as a first move in any game.
    clock_timestamp() + make_interval(secs => (select s.first_move_abort_seconds from public.platform_settings s))
  );
end;
$$;

create function private.pool_on_finish(p_match_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.pool_games g set phase = 'over', deadline = null, updated_at = now() where g.match_id = p_match_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Recording a shot (called by the pool-action Edge Function, which has played it out)
-- ---------------------------------------------------------------------------------------------
/**
 * Records a shot and what came of it. Refuses unless the match is in play, it is this player's
 * turn, and the shot was played on the position now stored (`p_shot_no`): two requests at the
 * same instant cannot both be recorded. `p_state` is the game after the shot; `p_result` says
 * who won, if anyone did.
 */
create function public.pool_apply_shot(p_match_id uuid, p_user_id uuid, p_shot_no integer, p_state jsonb, p_shot jsonb, p_result jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.pool_games;
  v_seat text;
  v_winner uuid;
begin
  select * into v_game from public.pool_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'GAME_NOT_FOUND');
  end if;
  select mp.seat into v_seat from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id;
  if v_seat is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  if v_game.phase = 'over' or not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;
  if v_game.turn <> v_seat then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOUR_TURN');
  end if;
  if p_shot_no is distinct from v_game.shot_no then
    return jsonb_build_object('ok', false, 'code', 'OUT_OF_SYNC');
  end if;

  insert into public.pool_shots (match_id, shot_no, seat, shot, result) values (p_match_id, v_game.shot_no, v_seat, p_shot, p_result);

  update public.pool_games g
     set balls = p_state -> 'balls',
         turn = p_state ->> 'turn',
         break_shot = (p_state ->> 'breakShot')::boolean,
         ball_in_hand = (p_state ->> 'ballInHand')::boolean,
         solids_seat = p_state ->> 'solidsSeat',
         fouls = jsonb_build_object('1', p_state -> 'fouls' -> 0, '2', p_state -> 'fouls' -> 1),
         misses = g.misses || jsonb_build_object(v_seat, 0),
         acted = g.acted || jsonb_build_object(v_seat, true),
         last_shot = jsonb_build_object('no', v_game.shot_no, 'seat', v_seat, 'shot', p_shot, 'result', p_result, 'from', p_state -> 'from'),
         shot_no = g.shot_no + 1,
         deadline = clock_timestamp() + make_interval(secs => g.shot_seconds),
         updated_at = now()
   where g.match_id = p_match_id;

  if p_result ->> 'winner' is not null then
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = p_result ->> 'winner';
    perform private.finish_match(p_match_id, 'win', v_winner, p_result ->> 'reason');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

/**
 * The shot clock. Before both players have played, an absent player calls the game off. After
 * that, the turn is lost: the opponent comes to the table with ball in hand, and the third
 * time in a row the absent player loses on time.
 */
create function private.pool_check_clock(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.pool_games;
  v_misses integer;
  v_other text;
  v_winner uuid;
begin
  select * into v_game from public.pool_games g where g.match_id = p_match_id for update;
  if not found or v_game.phase = 'over' or v_game.deadline is null or v_game.deadline > clock_timestamp() then
    return;
  end if;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return;
  end if;
  v_other := case v_game.turn when '1' then '2' else '1' end;

  if (select count(*) from jsonb_object_keys(v_game.acted)) < 2 then
    perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
    return;
  end if;

  v_misses := coalesce((v_game.misses ->> v_game.turn)::integer, 0) + 1;
  if v_misses >= 3 then
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_other;
    perform private.finish_match(p_match_id, 'win', v_winner, 'timeout');
    return;
  end if;

  insert into public.pool_shots (match_id, shot_no, seat, shot, result)
  values (p_match_id, v_game.shot_no, v_game.turn, null, jsonb_build_object('foul', 'time'));
  update public.pool_games g
     set turn = v_other, ball_in_hand = true,
         misses = g.misses || jsonb_build_object(v_game.turn, v_misses),
         last_shot = jsonb_build_object('no', v_game.shot_no, 'seat', v_game.turn, 'shot', null, 'result', jsonb_build_object('foul', 'time')),
         shot_no = g.shot_no + 1,
         deadline = clock_timestamp() + make_interval(secs => g.shot_seconds),
         updated_at = now()
   where g.match_id = p_match_id;
end;
$$;

/** 'resign', or 'claim' (the clock has run out, please act on it). */
create function public.pool_game_action(p_match_id uuid, p_user_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.pool_games;
  v_seat text;
  v_winner uuid;
begin
  select * into v_game from public.pool_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'GAME_NOT_FOUND');
  end if;
  select mp.seat into v_seat from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id;
  if v_seat is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  if v_game.phase = 'over' or not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;

  if p_action = 'claim' then
    perform private.pool_check_clock(p_match_id);
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'resign' then
    -- Leaving before both players have played simply calls the game off.
    if (select count(*) from jsonb_object_keys(v_game.acted)) < 2 then
      perform private.finish_match(p_match_id, 'aborted', null, 'aborted_by_player');
    else
      select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.user_id <> p_user_id;
      perform private.finish_match(p_match_id, 'win', v_winner, 'resignation');
    end if;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end;
$$;

revoke all on function private.pool_init_match(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pool_on_finish(uuid) from public, anon, authenticated, service_role;
revoke all on function private.pool_check_clock(uuid) from public, anon, authenticated, service_role;
revoke all on function public.pool_apply_shot(uuid, uuid, integer, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.pool_apply_shot(uuid, uuid, integer, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.pool_game_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.pool_game_action(uuid, uuid, text) to service_role;

-- The background sweep watches the pool shot clock too.
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
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;

-- Pool goes live: two players, the same stakes as chess, a rating for each of the two games.
update public.game_types
   set status = 'live',
       min_players = 2,
       max_players = 2,
       stake_levels = (select c.stake_levels from public.game_types c where c.id = 'chess'),
       rating_pools = '{eight_ball,nine_ball}',
       options_schema = '{"variants": ["8ball", "9ball"], "shot_seconds": 30}'::jsonb
 where id = 'pool';
