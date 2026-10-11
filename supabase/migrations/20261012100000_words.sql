-- Word Battle: the crossword game of letter tiles. The sixth game on the hub. Like Check Up it
-- has something to hide: a player's rack of tiles, and the bag.
--
-- Who decides what:
--   * Every turn is judged by the words-action Edge Function, with the rules in
--     supabase/functions/_shared/words.ts and the word list beside it. The app sends only
--     "these tiles on these squares", "swap these", or "pass". It never sends a score.
--   * The bag is shuffled and the racks are drawn HERE, in the database, when the match is
--     made, from the database's own source of chance.
--   * This migration stores the game, lets a new position be recorded only on top of the one
--     it was worked out from, keeps the turn clock on server time, and puts out of the game a
--     player nobody has heard from.
--   * Money: nothing here touches it. A finished game is reported to the core, which settles.
--
-- What each player may see:
--   * words_games  the table as everyone sees it: the board, the scores, whose turn, how many
--                  tiles each player holds and how many are left in the bag. Never which.
--   * words_racks  one row per player: their own tiles. Readable by its owner only.
--   * words_bags   the tiles still to be drawn, in order. No player can read it, ever.

create table public.words_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  -- Everyone who sat down, in the order of play, and those who have since left.
  seats text[] not null,
  out_seats text[] not null default '{}',
  -- 225 characters, row by row: '.' empty, a small letter a tile, a CAPITAL a blank standing for it.
  board text not null check (board ~ '^[.a-zA-Z]{225}$'),
  scores jsonb not null,
  -- How many tiles each player holds: {"1": 7, "2": 7}.
  counts jsonb not null,
  bag_count integer not null check (bag_count >= 0),
  turn text not null,
  -- Turns in a row, by anyone, that scored nothing; and turns in a row each player has let run out.
  scoreless integer not null default 0 check (scoreless >= 0),
  missed jsonb not null default '{}'::jsonb,
  move_no integer not null default 0 check (move_no >= 0),
  -- What just happened, for the table to show. Never names a tile that was drawn or swapped.
  last_event jsonb,
  phase text not null default 'play' check (phase in ('play', 'over')),
  -- Once it is over: why, who won, the final scores, and the tiles everyone was left with.
  result jsonb,
  deadline timestamptz not null
);
alter table public.words_games enable row level security;

create table public.words_racks (
  match_id uuid not null references public.matches (id) on delete restrict,
  seat text not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  -- 'a' to 'z', or '?' for a blank.
  tiles text[] not null default '{}',
  primary key (match_id, seat)
);
create index words_racks_user_idx on public.words_racks (user_id, match_id);
alter table public.words_racks enable row level security;

create table public.words_bags (
  match_id uuid primary key references public.matches (id) on delete restrict,
  -- The next tile drawn is the LAST in the list.
  tiles text[] not null default '{}'
);
alter table public.words_bags enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['words_games', 'words_racks', 'words_bags'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format(
        'create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
        t || '_deny_client_' || op, t, op,
        case op when 'insert' then 'with check (false)' when 'delete' then 'using (false)' else 'using (false) with check (false)' end);
    end loop;
  end loop;

  -- The table: its players while it is on, anyone once it is over, anyone for a tournament game.
  grant select on table public.words_games to authenticated;
  create policy words_games_select_player_or_finished on public.words_games for select to authenticated
    using (private.is_match_player(match_id) or private.is_match_finished(match_id));
  create policy words_games_select_tournament on public.words_games for select to authenticated
    using (private.is_tournament_match(match_id));

  -- A rack: its owner only.
  grant select on table public.words_racks to authenticated;
  create policy words_racks_select_own on public.words_racks for select to authenticated
    using (user_id = (select auth.uid()));

  -- The bag: nobody. (Said outright, so the table is not left with no rule for reading.)
  create policy words_bags_select_nobody on public.words_bags for select to anon, authenticated using (false);

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.words_games;
    alter publication supabase_realtime add table public.words_racks;
  end if;
end;
$$;

-- How long a player has for each turn: finding a word takes longer than playing a card.
create function private.words_turn_seconds() returns integer
language sql
immutable
set search_path = ''
as $$ select 90; $$;

/** The whole bag, a hundred tiles. Must match TILE_COUNTS in supabase/functions/_shared/words.ts. */
create function private.words_all_tiles() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(t.tile order by t.o, g.n)
    from (values ('a',9,1),('b',2,2),('c',2,3),('d',4,4),('e',12,5),('f',2,6),('g',3,7),('h',2,8),('i',9,9),('j',1,10),('k',1,11),('l',4,12),('m',2,13),
                 ('n',6,14),('o',8,15),('p',2,16),('q',1,17),('r',6,18),('s',4,19),('t',6,20),('u',4,21),('v',2,22),('w',2,23),('x',1,24),('y',2,25),('z',1,26),('?',2,27)) as t (tile, many, o)
    cross join lateral generate_series(1, t.many) as g (n);
$$;

-- ---------------------------------------------------------------------------------------------
-- Hooks for the core
-- ---------------------------------------------------------------------------------------------
create function private.words_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats text[];
  v_bag text[];
  v_seat text;
  v_counts jsonb := '{}'::jsonb;
  v_zero jsonb := '{}'::jsonb;
  v_each constant integer := 7;
begin
  -- The core has seated the players '1', '2', ... in a random order: that is the order of play.
  select array_agg(mp.seat order by mp.seat::int) into v_seats from public.match_players mp where mp.match_id = p_match_id;
  if v_seats is null or cardinality(v_seats) not between 2 and 4 then
    raise exception 'WORDS_TWO_TO_FOUR_PLAYERS' using errcode = 'AG002';
  end if;
  if p_options ? 'players' and (p_options ->> 'players')::int <> cardinality(v_seats) then
    raise exception 'WORDS_WRONG_TABLE_SIZE' using errcode = 'AG002';
  end if;

  -- The shuffle: every tile given a fresh random number from the database's own source of
  -- chance (gen_random_uuid draws on the operating system's), and the bag laid out in that order.
  select array_agg(t order by gen_random_uuid()) into v_bag from unnest(private.words_all_tiles()) as t;

  -- Seven tiles each, off the end of the bag (the end is the next to be drawn).
  foreach v_seat in array v_seats loop
    insert into public.words_racks (match_id, seat, user_id, tiles)
    select p_match_id, v_seat, mp.user_id, v_bag[cardinality(v_bag) - v_each + 1 : cardinality(v_bag)]
      from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_seat;
    v_bag := v_bag[1 : cardinality(v_bag) - v_each];
    v_counts := v_counts || jsonb_build_object(v_seat, v_each);
    v_zero := v_zero || jsonb_build_object(v_seat, 0);
  end loop;

  insert into public.words_bags (match_id, tiles) values (p_match_id, v_bag);
  insert into public.words_games (match_id, seats, board, scores, counts, bag_count, turn, missed, deadline)
  values (p_match_id, v_seats, repeat('.', 225), v_zero, v_counts, cardinality(v_bag), v_seats[1], v_zero,
          clock_timestamp() + make_interval(secs => private.words_turn_seconds() + 10));
end;
$$;

/** Nothing to tidy: the game's last position is already stored. Must exist for the core. */
create function private.words_on_finish(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.words_games g set phase = 'over' where g.match_id = p_match_id and g.phase <> 'over';
end;
$$;

/** Whose turn it is, for the core (a tournament game nobody starts). */
create function private.words_to_move(p_match_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.user_id from public.words_games g join public.match_players mp on mp.match_id = g.match_id and mp.seat = g.turn where g.match_id = p_match_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- For the words-action function: read the whole game, record the next position
-- ---------------------------------------------------------------------------------------------

/**
 * The whole game, hidden tiles included, for the function that judges a turn. Null when the
 * player is not in the match. Only the server may call this.
 */
create function public.words_context(p_match_id uuid, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status', m.status,
           'seat', (select mp.seat from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id),
           'late', g.deadline < clock_timestamp(),
           'state', jsonb_build_object(
             'seats', to_jsonb(g.seats),
             'out', to_jsonb(g.out_seats),
             'board', g.board,
             'racks', (select jsonb_object_agg(r.seat, to_jsonb(r.tiles)) from public.words_racks r where r.match_id = p_match_id),
             'bag', (select to_jsonb(b.tiles) from public.words_bags b where b.match_id = p_match_id),
             'scores', g.scores,
             'turn', g.turn,
             'scoreless', g.scoreless,
             'moveNo', g.move_no,
             'missed', g.missed,
             'over', null))
    from public.matches m
    join public.words_games g on g.match_id = m.id
   where m.id = p_match_id
     and exists (select 1 from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id);
$$;

/**
 * Records the position the function has worked out, on top of the one it was worked out from.
 * Under a row lock it checks that the game is still on and has not moved since (p_expected_move):
 * two requests arriving together cannot both be recorded. It also checks that the new position
 * holds no tile that is not in the bag's hundred and none too many, and that no tile already
 * on the board has been moved or changed. If the game is over, it is reported to the core in
 * the same transaction.
 */
create function public.words_store(p_match_id uuid, p_expected_move integer, p_state jsonb, p_event jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.words_games;
  v_status text;
  v_seat text;
  v_board text := p_state ->> 'board';
  v_all text[];
  v_left text[];
  v_tile text;
  v_at integer;
  v_counts jsonb := '{}'::jsonb;
  v_over jsonb := p_state -> 'over';
  v_ended boolean;
  v_winner uuid;
begin
  select * into v_game from public.words_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select m.status into v_status from public.matches m where m.id = p_match_id;
  if v_status <> 'active' or v_game.phase = 'over' then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;
  if v_game.move_no <> p_expected_move then
    return jsonb_build_object('ok', false, 'code', 'OUT_OF_SYNC');
  end if;
  v_ended := v_over is not null and v_over <> 'null'::jsonb;

  -- The board: the right size, and every tile that was down is still down, unchanged.
  if v_board is null or v_board !~ '^[.a-zA-Z]{225}$' then
    raise exception 'WORDS_BAD_POSITION' using errcode = 'AG002';
  end if;
  for v_at in 1..225 loop
    if substr(v_game.board, v_at, 1) <> '.' and substr(v_game.board, v_at, 1) <> substr(v_board, v_at, 1) then
      raise exception 'WORDS_BAD_POSITION' using errcode = 'AG002';
    end if;
  end loop;

  -- Every tile of the hundred at most once: the board (a capital is a blank), the racks, the bag.
  select array_agg(c) into v_all from (
    select case when ch between 'A' and 'Z' then '?' else ch end as c from regexp_split_to_table(v_board, '') as ch where ch <> '.'
    union all select jsonb_array_elements_text(r.value) from jsonb_each(p_state -> 'racks') as r
    union all select jsonb_array_elements_text(p_state -> 'bag')) as tiles;
  v_left := private.words_all_tiles();
  foreach v_tile in array coalesce(v_all, '{}') loop
    v_at := array_position(v_left, v_tile);
    if v_at is null then
      raise exception 'WORDS_BAD_POSITION' using errcode = 'AG002';
    end if;
    v_left := v_left[1 : v_at - 1] || v_left[v_at + 1 : cardinality(v_left)];
  end loop;

  foreach v_seat in array v_game.seats loop
    update public.words_racks r
       set tiles = array(select jsonb_array_elements_text(p_state -> 'racks' -> v_seat))
     where r.match_id = p_match_id and r.seat = v_seat;
    v_counts := v_counts || jsonb_build_object(v_seat, jsonb_array_length(p_state -> 'racks' -> v_seat));
  end loop;
  update public.words_bags b
     set tiles = array(select jsonb_array_elements_text(p_state -> 'bag'))
   where b.match_id = p_match_id;

  update public.words_games g
     set out_seats = array(select jsonb_array_elements_text(p_state -> 'out')),
         board = v_board,
         scores = p_state -> 'scores',
         counts = v_counts,
         bag_count = jsonb_array_length(p_state -> 'bag'),
         turn = p_state ->> 'turn',
         scoreless = (p_state ->> 'scoreless')::int,
         missed = p_state -> 'missed',
         move_no = v_game.move_no + 1,
         last_event = p_event,
         phase = case when v_ended then 'over' else 'play' end,
         -- At the end the racks are shown: everyone sees what everyone was left with.
         result = case when v_ended then v_over || jsonb_build_object('racks', p_state -> 'racks') else null end,
         deadline = clock_timestamp() + make_interval(secs => private.words_turn_seconds())
   where g.match_id = p_match_id;

  if v_ended then
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_over ->> 'winner';
    perform private.finish_match(p_match_id, case when v_winner is null then 'draw' else 'win' end, v_winner, v_over ->> 'reason');
  end if;
  return jsonb_build_object('ok', true, 'move_no', v_game.move_no + 1);
end;
$$;

/**
 * The safety net under the turn clock. The app of any player at the table asks for a turn that
 * has run out to be dealt with (the function then passes for the late player). If nobody asks,
 * because nobody is there, this puts the late player out of the game after a further wait,
 * with no rule of the game involved: their tiles are put aside, the turn passes, and the last
 * player left wins. Returns what it did.
 */
create function private.words_check_clock(p_match_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.words_games;
  v_left text[];
  v_next text;
  v_at integer;
  v_counts jsonb;
  v_winner uuid;
begin
  select * into v_game from public.words_games g where g.match_id = p_match_id for update;
  if not found or v_game.phase = 'over' or v_game.deadline + interval '20 seconds' > clock_timestamp() then
    return 'running';
  end if;
  if (select m.status from public.matches m where m.id = p_match_id) <> 'active' then
    return 'running';
  end if;

  -- Who plays after the late player, among those still in.
  v_left := array(select s from unnest(v_game.seats) as s where s <> all (v_game.out_seats) and s <> v_game.turn);
  v_at := array_position(v_game.seats, v_game.turn);
  select s into v_next
    from unnest(v_game.seats || v_game.seats) with ordinality as o (s, n)
   where n > v_at and s = any (v_left)
   order by n limit 1;

  update public.words_racks r set tiles = '{}' where r.match_id = p_match_id and r.seat = v_game.turn;
  v_counts := v_game.counts || jsonb_build_object(v_game.turn, 0);

  if cardinality(v_left) <= 1 then
    update public.words_games g
       set out_seats = v_game.out_seats || v_game.turn, counts = v_counts,
           move_no = v_game.move_no + 1, last_event = jsonb_build_object('seat', v_game.turn, 'kind', 'out'), phase = 'over',
           result = jsonb_build_object('reason', 'last_standing', 'winner', v_left[1], 'scores', v_game.scores)
     where g.match_id = p_match_id;
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_left[1];
    perform private.finish_match(p_match_id, case when v_winner is null then 'aborted' else 'win' end, v_winner, 'last_standing');
    return 'finished';
  end if;

  update public.words_games g
     set out_seats = v_game.out_seats || v_game.turn, counts = v_counts, turn = v_next,
         move_no = v_game.move_no + 1, last_event = jsonb_build_object('seat', v_game.turn, 'kind', 'out'),
         deadline = clock_timestamp() + make_interval(secs => private.words_turn_seconds())
   where g.match_id = p_match_id;
  return 'out';
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.words_context(uuid, uuid)',
    'public.words_store(uuid, integer, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'private.words_turn_seconds()',
    'private.words_all_tiles()',
    'private.words_init_match(uuid, jsonb)',
    'private.words_on_finish(uuid)',
    'private.words_to_move(uuid)',
    'private.words_check_clock(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;

-- The background sweep watches Word Battle's turn clock too.
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
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;

-- Word Battle goes on the hub: two to four players (two unless the players choose more), the
-- same stakes as chess, one standing.
insert into public.game_types (id, name, status, sort_order, min_players, max_players, stake_levels, rating_pools, options_schema)
select 'words', 'Word Battle', 'live', 47, 2, 4, c.stake_levels, '{default}', '{"players": [2, 3, 4]}'::jsonb
  from public.game_types c where c.id = 'chess';
