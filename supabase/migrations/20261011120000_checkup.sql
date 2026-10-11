-- Check Up: the shape-matching card game played across Nigeria and West Africa. The fifth game
-- on the hub, and the first with something to hide: a player's cards.
--
-- Who decides what:
--   * Every card played is judged by the checkup-action Edge Function, with the rules in
--     supabase/functions/_shared/checkup.ts. The app sends only "this card" or "to market".
--   * The pack is shuffled and dealt HERE, in the database, when the match is made, from the
--     database's own source of chance. No app and no function chooses a card.
--   * This migration stores the game, lets a new position be recorded only on top of the one it
--     was worked out from, keeps the turn clock on server time, and puts out of the game a
--     player nobody has heard from.
--   * Money: nothing here touches it. A finished game is reported to the core, which settles.
--
-- What each player may see:
--   * checkup_games    the table as everyone sees it: the card on top, whose turn, how many
--                      cards each player holds. Never which cards.
--   * checkup_hands    one row per player: their own cards. A player can read their own row
--                      and nobody else's, even after the game.
--   * checkup_markets  the cards still to be drawn, in order. No player can read it, ever.

create table public.checkup_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  -- Everyone who sat down, in the order of play, and those who have since left.
  seats text[] not null,
  out_seats text[] not null default '{}',
  -- How many cards each player holds: {"1": 6, "2": 5}.
  counts jsonb not null,
  market_count integer not null check (market_count >= 0),
  top text not null,
  -- After a Whot card: the shape that must follow.
  called text check (called in ('c', 't', 'x', 's', 'r')),
  turn text not null,
  -- Cards waiting to be picked: which number put them there (2 or 5) and how many.
  pending_number smallint check (pending_number in (2, 5)),
  pending_count integer not null default 0 check (pending_count >= 0),
  -- Turns in a row each player has let run out.
  missed jsonb not null default '{}'::jsonb,
  move_no integer not null default 0 check (move_no >= 0),
  -- What just happened, for the table to show. Never names a card that was drawn.
  last_event jsonb,
  phase text not null default 'play' check (phase in ('play', 'over')),
  -- Once it is over: why, who won, and what everyone held (the cards are shown at the end).
  result jsonb,
  deadline timestamptz not null,
  constraint checkup_pending_whole check ((pending_number is null) = (pending_count = 0))
);
alter table public.checkup_games enable row level security;

create table public.checkup_hands (
  match_id uuid not null references public.matches (id) on delete restrict,
  seat text not null,
  user_id uuid not null references public.profiles (id) on delete restrict,
  cards text[] not null default '{}',
  primary key (match_id, seat)
);
create index checkup_hands_user_idx on public.checkup_hands (user_id, match_id);
alter table public.checkup_hands enable row level security;

create table public.checkup_markets (
  match_id uuid primary key references public.matches (id) on delete restrict,
  -- The next card drawn is the LAST in the list.
  cards text[] not null default '{}'
);
alter table public.checkup_markets enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['checkup_games', 'checkup_hands', 'checkup_markets'] loop
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
  grant select on table public.checkup_games to authenticated;
  create policy checkup_games_select_player_or_finished on public.checkup_games for select to authenticated
    using (private.is_match_player(match_id) or private.is_match_finished(match_id));
  create policy checkup_games_select_tournament on public.checkup_games for select to authenticated
    using (private.is_tournament_match(match_id));

  -- A hand: its owner only.
  grant select on table public.checkup_hands to authenticated;
  create policy checkup_hands_select_own on public.checkup_hands for select to authenticated
    using (user_id = (select auth.uid()));

  -- The market: nobody. (Said outright, so the table is not left with no rule for reading.)
  create policy checkup_markets_select_nobody on public.checkup_markets for select to anon, authenticated using (false);

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.checkup_games;
    alter publication supabase_realtime add table public.checkup_hands;
  end if;
end;
$$;

-- How long a player has for each turn.
create function private.checkup_turn_seconds() returns integer
language sql
immutable
set search_path = ''
as $$ select 30; $$;

/** The whole pack, in a fixed order. Must match DECK in supabase/functions/_shared/checkup.ts. */
create function private.checkup_deck() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array(select 'c' || n from unnest(array[1,2,3,4,5,7,8,10,11,12,13,14]) with ordinality as t (n, o) order by o)
      || array(select 't' || n from unnest(array[1,2,3,4,5,7,8,10,11,12,13,14]) with ordinality as t (n, o) order by o)
      || array(select 'x' || n from unnest(array[1,2,3,5,7,10,11,13,14]) with ordinality as t (n, o) order by o)
      || array(select 's' || n from unnest(array[1,2,3,5,7,10,11,13,14]) with ordinality as t (n, o) order by o)
      || array(select 'r' || n from unnest(array[1,2,3,4,5,7,8]) with ordinality as t (n, o) order by o)
      || array['w20', 'w20', 'w20', 'w20', 'w20'];
$$;

-- ---------------------------------------------------------------------------------------------
-- Hooks for the core
-- ---------------------------------------------------------------------------------------------
create function private.checkup_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats text[];
  v_pack text[];
  v_seat text;
  v_counts jsonb := '{}'::jsonb;
  v_missed jsonb := '{}'::jsonb;
  v_top text;
  v_at integer;
  v_each constant integer := 6;
begin
  -- The core has seated the players '1', '2', ... in a random order: that is the order of play.
  select array_agg(mp.seat order by mp.seat::int) into v_seats from public.match_players mp where mp.match_id = p_match_id;
  if v_seats is null or cardinality(v_seats) not between 2 and 4 then
    raise exception 'CHECKUP_TWO_TO_FOUR_PLAYERS' using errcode = 'AG002';
  end if;
  if p_options ? 'players' and (p_options ->> 'players')::int <> cardinality(v_seats) then
    raise exception 'CHECKUP_WRONG_TABLE_SIZE' using errcode = 'AG002';
  end if;

  -- The shuffle: every card given a fresh random number from the database's own source of
  -- chance (gen_random_uuid draws on the operating system's), and the pack laid out in that order.
  select array_agg(c order by gen_random_uuid()) into v_pack from unnest(private.checkup_deck()) as c;

  -- Six cards each, off the end of the pack (the end is the top of the market).
  foreach v_seat in array v_seats loop
    insert into public.checkup_hands (match_id, seat, user_id, cards)
    select p_match_id, v_seat, mp.user_id, v_pack[cardinality(v_pack) - v_each + 1 : cardinality(v_pack)]
      from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_seat;
    v_pack := v_pack[1 : cardinality(v_pack) - v_each];
    v_counts := v_counts || jsonb_build_object(v_seat, v_each);
    v_missed := v_missed || jsonb_build_object(v_seat, 0);
  end loop;

  -- The game starts on a card that does nothing: the first plain one from the top of the market.
  v_at := cardinality(v_pack);
  while substr(v_pack[v_at], 2)::int in (1, 2, 5, 8, 14, 20) loop
    v_at := v_at - 1;
  end loop;
  v_top := v_pack[v_at];
  v_pack := v_pack[1 : v_at - 1] || v_pack[v_at + 1 : cardinality(v_pack)];

  insert into public.checkup_markets (match_id, cards) values (p_match_id, v_pack);
  insert into public.checkup_games (match_id, seats, counts, market_count, top, turn, missed, deadline)
  values (p_match_id, v_seats, v_counts, cardinality(v_pack), v_top, v_seats[1], v_missed,
          clock_timestamp() + make_interval(secs => private.checkup_turn_seconds() + 10));
end;
$$;

/** Nothing to tidy: the game's last position is already stored. Must exist for the core. */
create function private.checkup_on_finish(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checkup_games g set phase = 'over' where g.match_id = p_match_id and g.phase <> 'over';
end;
$$;

/** Whose turn it is, for the core (a tournament game nobody starts). */
create function private.checkup_to_move(p_match_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.user_id from public.checkup_games g join public.match_players mp on mp.match_id = g.match_id and mp.seat = g.turn where g.match_id = p_match_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- For the checkup-action function: read the whole game, record the next position
-- ---------------------------------------------------------------------------------------------

/**
 * The whole game, hidden cards included, for the function that judges a card. Null when the
 * player is not in the match. Only the server may call this.
 */
create function public.checkup_context(p_match_id uuid, p_user_id uuid) returns jsonb
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
             'hands', (select jsonb_object_agg(h.seat, to_jsonb(h.cards)) from public.checkup_hands h where h.match_id = p_match_id),
             'market', (select to_jsonb(k.cards) from public.checkup_markets k where k.match_id = p_match_id),
             'top', g.top,
             'called', g.called,
             'turn', g.turn,
             'pending', case when g.pending_number is null then null else jsonb_build_object('number', g.pending_number, 'count', g.pending_count) end,
             'moveNo', g.move_no,
             'missed', g.missed,
             'over', null))
    from public.matches m
    join public.checkup_games g on g.match_id = m.id
   where m.id = p_match_id
     and exists (select 1 from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id);
$$;

/**
 * Records the position the function has worked out, on top of the one it was worked out from.
 * Under a row lock it checks that the game is still on and has not moved since (p_expected_move):
 * two requests arriving together cannot both be recorded. It also checks that the new position
 * holds no card twice and none that is not in the pack. If the game is over, it is reported to
 * the core in the same transaction.
 */
create function public.checkup_store(p_match_id uuid, p_expected_move integer, p_state jsonb, p_event jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.checkup_games;
  v_status text;
  v_seat text;
  v_all text[];
  v_left text[];
  v_card text;
  v_at integer;
  v_counts jsonb := '{}'::jsonb;
  v_over jsonb := p_state -> 'over';
  v_winner uuid;
begin
  select * into v_game from public.checkup_games g where g.match_id = p_match_id for update;
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

  -- Every card of the pack at most once, and nothing that is not a card.
  select array_agg(c) into v_all from (
    select jsonb_array_elements_text(h.value) as c from jsonb_each(p_state -> 'hands') as h
    union all select jsonb_array_elements_text(p_state -> 'market')
    union all select p_state ->> 'top') as cards;
  v_left := private.checkup_deck();
  foreach v_card in array v_all loop
    v_at := array_position(v_left, v_card);
    if v_at is null then
      raise exception 'CHECKUP_BAD_POSITION' using errcode = 'AG002';
    end if;
    v_left := v_left[1 : v_at - 1] || v_left[v_at + 1 : cardinality(v_left)];
  end loop;

  foreach v_seat in array v_game.seats loop
    update public.checkup_hands h
       set cards = array(select jsonb_array_elements_text(p_state -> 'hands' -> v_seat))
     where h.match_id = p_match_id and h.seat = v_seat;
    v_counts := v_counts || jsonb_build_object(v_seat, jsonb_array_length(p_state -> 'hands' -> v_seat));
  end loop;
  update public.checkup_markets k
     set cards = array(select jsonb_array_elements_text(p_state -> 'market'))
   where k.match_id = p_match_id;

  update public.checkup_games g
     set out_seats = array(select jsonb_array_elements_text(p_state -> 'out')),
         counts = v_counts,
         market_count = jsonb_array_length(p_state -> 'market'),
         top = p_state ->> 'top',
         called = p_state ->> 'called',
         turn = p_state ->> 'turn',
         pending_number = (p_state -> 'pending' ->> 'number')::smallint,
         pending_count = coalesce((p_state -> 'pending' ->> 'count')::int, 0),
         missed = p_state -> 'missed',
         move_no = v_game.move_no + 1,
         last_event = p_event,
         phase = case when v_over is null or v_over = 'null'::jsonb then 'play' else 'over' end,
         -- At the end the cards are laid down: everyone sees what everyone held.
         result = case when v_over is null or v_over = 'null'::jsonb then null else v_over || jsonb_build_object('hands', p_state -> 'hands') end,
         deadline = clock_timestamp() + make_interval(secs => private.checkup_turn_seconds())
   where g.match_id = p_match_id;

  if v_over is not null and v_over <> 'null'::jsonb then
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_over ->> 'winner';
    perform private.finish_match(p_match_id, case when v_winner is null then 'draw' else 'win' end, v_winner, v_over ->> 'reason');
  end if;
  return jsonb_build_object('ok', true, 'move_no', v_game.move_no + 1);
end;
$$;

/**
 * The safety net under the turn clock. The app of any player at the table asks for a turn that
 * has run out to be dealt with (the function then goes to market for the late player). If
 * nobody asks, because nobody is there, this puts the late player out of the game after a
 * further wait, with no card rule involved: their cards are put aside, the turn passes, and the
 * last player left wins. Returns what it did.
 */
create function private.checkup_check_clock(p_match_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.checkup_games;
  v_left text[];
  v_next text;
  v_at integer;
  v_counts jsonb;
  v_winner uuid;
begin
  select * into v_game from public.checkup_games g where g.match_id = p_match_id for update;
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

  update public.checkup_hands h set cards = '{}' where h.match_id = p_match_id and h.seat = v_game.turn;
  v_counts := v_game.counts || jsonb_build_object(v_game.turn, 0);

  if cardinality(v_left) <= 1 then
    update public.checkup_games g
       set out_seats = v_game.out_seats || v_game.turn, counts = v_counts, pending_number = null, pending_count = 0,
           move_no = v_game.move_no + 1, last_event = jsonb_build_object('seat', v_game.turn, 'kind', 'out'), phase = 'over',
           result = jsonb_build_object('reason', 'last_standing', 'winner', v_left[1], 'totals', '{}'::jsonb)
     where g.match_id = p_match_id;
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_left[1];
    perform private.finish_match(p_match_id, case when v_winner is null then 'aborted' else 'win' end, v_winner, 'last_standing');
    return 'finished';
  end if;

  update public.checkup_games g
     set out_seats = v_game.out_seats || v_game.turn, counts = v_counts, turn = v_next, pending_number = null, pending_count = 0,
         move_no = v_game.move_no + 1, last_event = jsonb_build_object('seat', v_game.turn, 'kind', 'out'),
         deadline = clock_timestamp() + make_interval(secs => private.checkup_turn_seconds())
   where g.match_id = p_match_id;
  return 'out';
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.checkup_context(uuid, uuid)',
    'public.checkup_store(uuid, integer, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'private.checkup_turn_seconds()',
    'private.checkup_deck()',
    'private.checkup_init_match(uuid, jsonb)',
    'private.checkup_on_finish(uuid)',
    'private.checkup_to_move(uuid)',
    'private.checkup_check_clock(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;

-- The background sweep watches Check Up's turn clock too.
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
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;

-- Check Up goes on the hub: two to four players, the same stakes as chess, one standing.
insert into public.game_types (id, name, status, sort_order, min_players, max_players, stake_levels, rating_pools, options_schema)
select 'checkup', 'Check Up', 'live', 45, 2, 4, c.stake_levels, '{default}', '{"players": [2, 3, 4]}'::jsonb
  from public.game_types c where c.id = 'chess';
