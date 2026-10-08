-- Ludo: the second game on the hub. Two players for now (the core pairs two); the board and the
-- seat names are already those of the four-player game, so more seats can be added later.
--
-- Everything about the game is decided here, on the server: the dice, which pieces may move,
-- captures, extra turns, the turn timer and the winner. The app only asks ("roll", "move piece
-- 2") and shows what the database says.
--
-- The board, as numbers:
--   * The outer track has 52 squares, numbered clockwise. Red starts on square 0, green on 13,
--     yellow on 26, blue on 39.
--   * A piece's place is its `progress`: -1 in the yard, 0 on its own start square, up to 50
--     along the track, 51-55 in its home column, 56 home. So a piece walks 56 steps in all.
--   * Its square on the shared track is (start + progress) mod 52, while progress <= 50.
--   * Safe squares (no capture there): the four start squares and the four stars, 8 squares
--     after each start.
-- Rules:
--   * A six brings a piece out of the yard. A six, a capture, or bringing a piece home earns
--     another roll. Three sixes in a row and the turn is lost.
--   * Home needs the exact number. No legal move: the turn passes.
--   * First to bring all their pieces home wins.

create table public.ludo_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  pieces_each smallint not null check (pieces_each between 1 and 4),
  -- {"red": [-1, -1, ...], "yellow": [...]}
  positions jsonb not null,
  turn text not null check (turn in ('red', 'green', 'yellow', 'blue')),
  phase text not null default 'roll' check (phase in ('roll', 'move', 'over')),
  die smallint check (die between 1 and 6),
  sixes smallint not null default 0,
  -- Goes up by one with everything that happens; the app says which number it last saw.
  turn_no integer not null default 0,
  turn_seconds smallint not null,
  deadline timestamptz,
  -- Turns in a row each player let the clock play for them, and who has played at all yet.
  misses jsonb not null default '{}'::jsonb,
  acted jsonb not null default '{}'::jsonb,
  -- What just happened, for the app to animate: {"seat","die","piece","from","to","captured"}.
  last_event jsonb,
  updated_at timestamptz not null default now(),
  constraint ludo_games_die_when_moving check ((phase = 'move') = (die is not null) or phase = 'over')
);
alter table public.ludo_games enable row level security;

-- The record of the game, one row per roll.
create table public.ludo_moves (
  match_id uuid not null references public.matches (id) on delete restrict,
  seq integer not null,
  seat text not null,
  die smallint not null check (die between 1 and 6),
  -- Null when the roll moved nothing (no legal move, or a third six).
  piece smallint,
  from_progress smallint,
  to_progress smallint,
  captured smallint not null default 0,
  -- True when the clock played the turn for an absent player.
  auto boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, seq)
);
alter table public.ludo_moves enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['ludo_games', 'ludo_moves'] loop
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
    alter publication supabase_realtime add table public.ludo_games;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The pieces of the rules
-- ---------------------------------------------------------------------------------------------

/**
 * One throw of a fair die. Built on gen_random_uuid(), which draws from the operating system's
 * secure random source (random() does not), and throws away the few byte values that would
 * make some faces very slightly likelier than others.
 */
create function private.ludo_roll() returns smallint
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_byte integer;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    -- Bytes 0 to 5 of a random UUID are entirely random (the fixed bits sit in bytes 6 and 8).
    for i in 0..5 loop
      v_byte := get_byte(v_bytes, i);
      if v_byte < 252 then
        return (v_byte % 6 + 1)::smallint;
      end if;
    end loop;
  end loop;
end;
$$;

create function private.ludo_start_square(p_seat text) returns integer
language sql
immutable
set search_path = ''
as $$ select case p_seat when 'red' then 0 when 'green' then 13 when 'yellow' then 26 when 'blue' then 39 end; $$;

/** Which of a player's pieces may move with this throw (their numbers, from 0). */
create function private.ludo_movable(p_positions jsonb, p_seat text, p_die integer) returns integer[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t.i - 1 order by t.i), '{}')
    from jsonb_array_elements_text(p_positions -> p_seat) with ordinality as t (progress, i)
   where (t.progress::int = -1 and p_die = 6)
      or (t.progress::int between 0 and 56 - p_die);
$$;

create function private.ludo_next_seat(p_positions jsonb, p_seat text) returns text
language sql
immutable
set search_path = ''
as $$
  -- Clockwise among the seats in this game.
  select s from unnest(array['red', 'green', 'yellow', 'blue', 'red', 'green', 'yellow', 'blue']) with ordinality as o (s, n)
   where p_positions ? s and n > array_position(array['red', 'green', 'yellow', 'blue'], p_seat)
   order by n limit 1;
$$;

-- ---------------------------------------------------------------------------------------------
-- Hooks for the core
-- ---------------------------------------------------------------------------------------------
create function private.ludo_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schema jsonb;
  v_mode jsonb;
  v_pieces integer;
  v_players integer;
  v_positions jsonb := '{}'::jsonb;
  v_seat text;
begin
  select g.options_schema into v_schema from public.game_types g where g.id = 'ludo';
  select m into v_mode from jsonb_array_elements(v_schema -> 'modes') as m where m ->> 'id' = p_options ->> 'mode';
  if v_mode is null then
    raise exception 'LUDO_UNKNOWN_MODE' using errcode = 'AG002';
  end if;
  v_pieces := (v_mode ->> 'pieces')::integer;

  select count(*) into v_players from public.match_players mp where mp.match_id = p_match_id;
  -- Two players sit opposite each other; three or four go round the board in order.
  update public.match_players mp
     set seat = case
       when v_players = 2 then case mp.seat when '1' then 'red' else 'yellow' end
       else (array['red', 'green', 'yellow', 'blue'])[mp.seat::integer]
     end
   where mp.match_id = p_match_id;

  for v_seat in select mp.seat from public.match_players mp where mp.match_id = p_match_id loop
    v_positions := v_positions || jsonb_build_object(v_seat, (select jsonb_agg(-1) from generate_series(1, v_pieces)));
  end loop;

  insert into public.ludo_games (match_id, pieces_each, positions, turn, turn_seconds, deadline)
  values (
    p_match_id, v_pieces, v_positions, 'red',
    coalesce((v_schema ->> 'turn_seconds')::integer, 20),
    -- The opening turn gets the same grace as a first move in any game.
    clock_timestamp() + make_interval(secs => (select s.first_move_abort_seconds from public.platform_settings s))
  );
end;
$$;

create function private.ludo_on_finish(p_match_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.ludo_games g set phase = 'over', die = null, deadline = null, updated_at = now() where g.match_id = p_match_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Playing
-- ---------------------------------------------------------------------------------------------

/**
 * One step of the game for the player whose turn it is: a roll, or moving a piece. The caller
 * holds the row lock and has checked whose turn it is. A roll with exactly one legal move plays
 * that move at once (nothing to choose), and a roll with none passes the turn.
 */
create function private.ludo_step(p_match_id uuid, p_action text, p_piece integer, p_auto boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_die integer;
  v_movable integer[];
  v_from integer;
  v_to integer;
  v_square integer;
  v_captured integer := 0;
  v_positions jsonb;
  v_other text;
  v_j integer;
  v_p integer;
  v_again boolean;
  v_event jsonb;
  v_seq integer;
  v_winner uuid;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id;
  v_positions := v_game.positions;
  select coalesce(max(m.seq), 0) + 1 into v_seq from public.ludo_moves m where m.match_id = p_match_id;

  if p_action = 'roll' then
    v_die := private.ludo_roll();
    v_movable := private.ludo_movable(v_positions, v_game.turn, v_die);
    v_event := jsonb_build_object('seat', v_game.turn, 'die', v_die);

    if v_die = 6 and v_game.sixes = 2 then
      -- Third six in a row: the turn is lost.
      insert into public.ludo_moves (match_id, seq, seat, die, auto) values (p_match_id, v_seq, v_game.turn, v_die, p_auto);
      update public.ludo_games g
         set turn = private.ludo_next_seat(v_positions, v_game.turn), phase = 'roll', die = null, sixes = 0,
             last_event = v_event || jsonb_build_object('forfeit', true)
       where g.match_id = p_match_id;
      return;
    end if;

    if cardinality(v_movable) = 0 then
      insert into public.ludo_moves (match_id, seq, seat, die, auto) values (p_match_id, v_seq, v_game.turn, v_die, p_auto);
      update public.ludo_games g
         set turn = case when v_die = 6 then v_game.turn else private.ludo_next_seat(v_positions, v_game.turn) end,
             phase = 'roll', die = null, sixes = case when v_die = 6 then v_game.sixes + 1 else 0 end,
             last_event = v_event
       where g.match_id = p_match_id;
      return;
    end if;

    if cardinality(v_movable) > 1
       -- Pieces that would do exactly the same thing are not a real choice.
       and (select count(distinct v_positions -> v_game.turn ->> i) from unnest(v_movable) i) > 1 then
      update public.ludo_games g set phase = 'move', die = v_die, last_event = v_event where g.match_id = p_match_id;
      return;
    end if;
    p_piece := v_movable[1];
  else
    v_die := v_game.die;
  end if;

  -- Move the piece.
  v_from := (v_positions -> v_game.turn ->> p_piece)::integer;
  v_to := case when v_from = -1 then 0 else v_from + v_die end;
  v_positions := jsonb_set(v_positions, array[v_game.turn, p_piece::text], to_jsonb(v_to));

  -- Landing on other players' pieces sends them back to their yard, except on a safe square.
  if v_to <= 50 then
    v_square := (private.ludo_start_square(v_game.turn) + v_to) % 52;
    if v_square not in (0, 8, 13, 21, 26, 34, 39, 47) then
      for v_other in select k from jsonb_object_keys(v_positions) k where k <> v_game.turn loop
        for v_j in 0 .. jsonb_array_length(v_positions -> v_other) - 1 loop
          v_p := (v_positions -> v_other ->> v_j)::integer;
          if v_p between 0 and 50 and (private.ludo_start_square(v_other) + v_p) % 52 = v_square then
            v_positions := jsonb_set(v_positions, array[v_other, v_j::text], '-1'::jsonb);
            v_captured := v_captured + 1;
          end if;
        end loop;
      end loop;
    end if;
  end if;

  insert into public.ludo_moves (match_id, seq, seat, die, piece, from_progress, to_progress, captured, auto)
  values (p_match_id, v_seq, v_game.turn, v_die, p_piece, v_from, v_to, v_captured, p_auto);
  v_event := jsonb_build_object('seat', v_game.turn, 'die', v_die, 'piece', p_piece, 'from', v_from, 'to', v_to, 'captured', v_captured);

  -- Every piece home: the game is won.
  if not exists (select 1 from jsonb_array_elements_text(v_positions -> v_game.turn) e where e::integer <> 56) then
    update public.ludo_games g set positions = v_positions, last_event = v_event where g.match_id = p_match_id;
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_game.turn;
    perform private.finish_match(p_match_id, 'win', v_winner, 'all_home');
    return;
  end if;

  v_again := v_die = 6 or v_captured > 0 or v_to = 56;
  update public.ludo_games g
     set positions = v_positions,
         turn = case when v_again then v_game.turn else private.ludo_next_seat(v_positions, v_game.turn) end,
         phase = 'roll', die = null,
         sixes = case when v_die = 6 then v_game.sixes + 1 else 0 end,
         last_event = v_event
   where g.match_id = p_match_id;
end;
$$;

/**
 * The turn clock. When the player to act has let it run out:
 *   * before every player has played once, the game is called off and stakes go back;
 *   * otherwise the turn is played for them (roll, and the piece furthest along), and the third
 *     time in a row they lose on time. A player who has left therefore cannot stall a game.
 */
create function private.ludo_check_clock(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_seat text;
  v_misses integer;
  v_piece integer;
  v_winner uuid;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id for update;
  if not found or v_game.phase = 'over' or v_game.deadline is null or v_game.deadline > clock_timestamp() then
    return;
  end if;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return;
  end if;
  v_seat := v_game.turn;

  if (select count(*) from jsonb_object_keys(v_game.acted)) < (select count(*) from jsonb_object_keys(v_game.positions)) then
    perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
    return;
  end if;

  v_misses := coalesce((v_game.misses ->> v_seat)::integer, 0) + 1;
  if v_misses >= 3 then
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat <> v_seat limit 1;
    perform private.finish_match(p_match_id, 'win', v_winner, 'timeout');
    return;
  end if;

  if v_game.phase = 'roll' then
    perform private.ludo_step(p_match_id, 'roll', null, true);
    select * into v_game from public.ludo_games g where g.match_id = p_match_id;
  end if;
  if v_game.phase = 'move' and v_game.turn = v_seat then
    select m into v_piece from unnest(private.ludo_movable(v_game.positions, v_seat, v_game.die)) m
     order by (v_game.positions -> v_seat ->> m)::integer desc limit 1;
    perform private.ludo_step(p_match_id, 'move', v_piece, true);
  end if;

  update public.ludo_games g
     set misses = g.misses || jsonb_build_object(v_seat, v_misses),
         turn_no = g.turn_no + 1,
         deadline = case when g.phase = 'over' then null else clock_timestamp() + make_interval(secs => g.turn_seconds) end,
         updated_at = now()
   where g.match_id = p_match_id;
end;
$$;

/**
 * Everything a player can ask for: 'roll', 'move' (with a piece number), 'resign', or 'claim'
 * (the clock has run out, please act on it). Called by the ludo-action Edge Function, which has
 * identified the player. Replies { ok: true } or { ok: false, code }.
 */
create function public.ludo_action(p_match_id uuid, p_user_id uuid, p_action text, p_piece integer, p_turn_no integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_seat text;
  v_winner uuid;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id for update;
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
    perform private.ludo_check_clock(p_match_id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'resign' then
    -- Leaving before every player has played once simply calls the game off.
    if (select count(*) from jsonb_object_keys(v_game.acted)) < (select count(*) from jsonb_object_keys(v_game.positions)) then
      perform private.finish_match(p_match_id, 'aborted', null, 'aborted_by_player');
    else
      select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.user_id <> p_user_id limit 1;
      perform private.finish_match(p_match_id, 'win', v_winner, 'resignation');
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if v_game.turn <> v_seat then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOUR_TURN');
  end if;
  if p_turn_no is distinct from v_game.turn_no then
    return jsonb_build_object('ok', false, 'code', 'OUT_OF_SYNC');
  end if;

  if p_action = 'roll' and v_game.phase = 'roll' then
    perform private.ludo_step(p_match_id, 'roll', null, false);
  elsif p_action = 'move' and v_game.phase = 'move' and p_piece = any (private.ludo_movable(v_game.positions, v_seat, v_game.die)) then
    perform private.ludo_step(p_match_id, 'move', p_piece, false);
  else
    return jsonb_build_object('ok', false, 'code', 'ILLEGAL_MOVE');
  end if;

  update public.ludo_games g
     set misses = g.misses || jsonb_build_object(v_seat, 0),
         acted = g.acted || jsonb_build_object(v_seat, true),
         turn_no = g.turn_no + 1,
         deadline = case when g.phase = 'over' then null else clock_timestamp() + make_interval(secs => g.turn_seconds) end,
         updated_at = now()
   where g.match_id = p_match_id;
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'private.ludo_roll()', 'private.ludo_start_square(text)', 'private.ludo_movable(jsonb, text, integer)',
    'private.ludo_next_seat(jsonb, text)', 'private.ludo_init_match(uuid, jsonb)', 'private.ludo_on_finish(uuid)',
    'private.ludo_step(uuid, text, integer, boolean)', 'private.ludo_check_clock(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;
revoke all on function public.ludo_action(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.ludo_action(uuid, uuid, text, integer, integer) to service_role;

-- The background sweep now watches Ludo's turn clocks as well as chess clocks.
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
    select g.match_id
      from public.ludo_games g
      join public.matches m on m.id = g.match_id and m.status = 'active'
     where g.deadline < now()
  loop
    perform private.ludo_check_clock(v_match);
  end loop;

  for v_match in
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;

-- Ludo goes live: two players, the same stakes as chess, one rating.
update public.game_types
   set status = 'live',
       min_players = 2,
       max_players = 2,
       stake_levels = (select c.stake_levels from public.game_types c where c.id = 'chess'),
       rating_pools = '{default}',
       options_schema = '{"modes": [{"id": "quick", "pieces": 2}, {"id": "classic", "pieces": 4}], "turn_seconds": 20}'::jsonb
 where id = 'ludo';
