-- Matches with more than two players, and Ludo for two, three or four.
--
-- Core (any game):
--   * Matchmaking gathers as many players as the game asks for (2 by default) before it makes a
--     match. Everyone's stake goes into escrow in that one transaction, or nobody's does.
--   * Ratings work for any number of players with one winner.
--   * Settlement needed no change: the winner already receives the whole pot less the rake.
--
-- Ludo, as decided with the owner:
--   * A staked game ends the moment the first player brings every piece home. That player takes
--     the pot; everyone else loses their stake. A pot is never shared.
--   * A free game also has its winner (and its rating change) at that moment, but the others
--     may play on for second and third place if they wish. Nothing rides on it.
--   * A player who resigns or misses three turns in a row leaves the table (and, in a staked
--     game, their stake stays in the pot). The game goes on while two or more remain.

-- ---------------------------------------------------------------------------------------------
-- Core: matchmaking for any number of players
-- ---------------------------------------------------------------------------------------------
drop function public.join_match_queue(uuid, text, bigint, jsonb, text);

create function public.join_match_queue(
  p_user_id uuid,
  p_game_type text,
  p_stake bigint,
  p_options jsonb,
  p_rating_pool text,
  p_players integer default 2
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.game_types;
  v_existing uuid;
  v_rating integer;
  v_country text;
  v_candidate public.match_queue;
  v_others uuid[] := '{}';
  v_everyone uuid[];
  v_match_id uuid;
  v_who uuid;
begin
  -- One request at a time per player, and one at a time per queue "bucket", so players who tap
  -- Find match in the same instant still see each other.
  perform pg_advisory_xact_lock(hashtextextended('agh:user:' || p_user_id::text, 0));

  select p.country_code into v_country from public.profiles p where p.id = p_user_id;
  if not found then
    return jsonb_build_object('status', 'error', 'code', 'PROFILE_NOT_FOUND');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;

  select * into v_game from public.game_types g where g.id = p_game_type;
  if not found or v_game.status <> 'live' then
    return jsonb_build_object('status', 'error', 'code', 'GAME_NOT_AVAILABLE');
  end if;
  if not (p_stake = any (v_game.stake_levels)) then
    return jsonb_build_object('status', 'error', 'code', 'STAKE_NOT_ALLOWED');
  end if;
  if not (p_rating_pool = any (v_game.rating_pools)) then
    return jsonb_build_object('status', 'error', 'code', 'BAD_RATING_POOL');
  end if;
  if p_players is null or p_players < v_game.min_players or p_players > v_game.max_players then
    return jsonb_build_object('status', 'error', 'code', 'OPTIONS_NOT_ALLOWED');
  end if;

  -- Already in a game (for example after reopening the app): send them back to it.
  v_existing := private.active_match_of(p_user_id);
  if v_existing is not null then
    delete from public.match_queue q where q.user_id = p_user_id;
    return jsonb_build_object('status', 'matched', 'match_id', v_existing);
  end if;

  if p_stake > 0 then
    -- Playing for tokens is for adults who have said so.
    if not exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.age_confirmed_at is not null) then
      return jsonb_build_object('status', 'error', 'code', 'AGE_NOT_CONFIRMED');
    end if;
    if private.wallet_total(p_user_id) < p_stake then
      delete from public.match_queue q where q.user_id = p_user_id;
      return jsonb_build_object('status', 'error', 'code', 'INSUFFICIENT_BALANCE');
    end if;
  end if;

  select coalesce(
           (select r.rating from public.player_ratings r
             where r.user_id = p_user_id and r.game_type = p_game_type and r.pool = p_rating_pool),
           1200)
    into v_rating;

  perform pg_advisory_xact_lock(
    hashtextextended('agh:queue:' || p_game_type || ':' || p_stake || ':' || p_rating_pool || ':' || p_players || ':' || p_options::text, 0));

  -- Gather the other players: closest rating first, then longest wait. Anyone who cannot be
  -- used is passed over.
  for v_candidate in
    select q.*
      from public.match_queue q
     where q.game_type = p_game_type
       and q.stake_amount = p_stake
       and q.rating_pool = p_rating_pool
       and q.options = p_options
       and q.user_id <> p_user_id
       and q.heartbeat_at > now() - interval '45 seconds'
     order by abs(q.rating - v_rating), q.joined_at
     limit 24
       for update skip locked
  loop
    exit when cardinality(v_others) = p_players - 1;

    -- Take the candidate's own lock too, without waiting: if they are in the middle of another
    -- request, leave them alone. This is what stops a player landing in two games.
    if not pg_try_advisory_xact_lock(hashtextextended('agh:user:' || v_candidate.user_id::text, 0))
       or private.active_match_of(v_candidate.user_id) is not null then
      continue;
    end if;
    -- They could afford it when they queued; if they no longer can, they leave the queue.
    if p_stake > 0 and private.wallet_total(v_candidate.user_id) < p_stake then
      delete from public.match_queue q where q.user_id = v_candidate.user_id;
      continue;
    end if;
    v_others := v_others || v_candidate.user_id;
  end loop;

  if cardinality(v_others) = p_players - 1 then
    v_everyone := v_others || p_user_id;
    delete from public.match_queue q where q.user_id = any (v_everyone);

    insert into public.matches (game_type, stake_amount, options, rating_pool, status, started_at)
    values (p_game_type, p_stake, p_options, p_rating_pool, 'active', now())
    returning id into v_match_id;

    -- Seats are dealt at random.
    insert into public.match_players (match_id, user_id, seat, rating_before)
    select v_match_id, u.id, (row_number() over (order by random()))::text,
           coalesce((select r.rating from public.player_ratings r
                      where r.user_id = u.id and r.game_type = p_game_type and r.pool = p_rating_pool), 1200)
      from unnest(v_everyone) as u (id);

    -- Every stake goes into escrow here. Every balance was just checked while holding that
    -- player's lock, so this cannot fail; if it somehow did, the exception would undo the whole
    -- request (match, seats and any stake already taken) and nothing would be left behind.
    foreach v_who in array v_everyone loop
      perform private.take_stake(v_match_id, v_who, p_stake);
    end loop;

    -- The game module creates its own starting state in this same transaction.
    execute format('select private.%I($1, $2)', p_game_type || '_init_match') using v_match_id, p_options;

    return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
  end if;

  insert into public.match_queue as q
    (user_id, game_type, stake_amount, options, rating, country_code, rating_pool, joined_at, heartbeat_at)
  values
    (p_user_id, p_game_type, p_stake, p_options, v_rating, v_country, p_rating_pool, now(), now())
  on conflict (user_id) do update
    set joined_at = case
          when (q.game_type, q.stake_amount, q.options, q.rating_pool)
               is not distinct from (excluded.game_type, excluded.stake_amount, excluded.options, excluded.rating_pool)
          then q.joined_at else now() end,
        game_type = excluded.game_type,
        stake_amount = excluded.stake_amount,
        options = excluded.options,
        rating = excluded.rating,
        country_code = excluded.country_code,
        rating_pool = excluded.rating_pool,
        heartbeat_at = now();

  return jsonb_build_object('status', 'queued');
end;
$$;

revoke all on function public.join_match_queue(uuid, text, bigint, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.join_match_queue(uuid, text, bigint, jsonb, text, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Core: ratings for any number of players
-- ---------------------------------------------------------------------------------------------
-- Elo, generalised. Each player's expected share of the win is their expected score against
-- every other player, scaled so that the shares add up to one. The winner scored 1 and the rest
-- 0 (a draw: equal shares). For two players this is ordinary Elo, to the point.
create or replace function private.update_ratings(p_match_id uuid, p_game_type text, p_pool text, p_winner_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_row record;
begin
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
-- Ludo for two, three or four
-- ---------------------------------------------------------------------------------------------
update public.game_types
   set max_players = 4,
       options_schema = '{"modes": [{"id": "quick", "pieces": 2}, {"id": "classic", "pieces": 4}], "players": [2, 3, 4], "turn_seconds": 20}'::jsonb
 where id = 'ludo';

alter table public.ludo_games
  -- Seats in the order they brought every piece home: first is the winner.
  add column places jsonb not null default '[]'::jsonb,
  -- Seats that resigned or ran out of time.
  add column gone jsonb not null default '[]'::jsonb;

/** The seats still playing, clockwise from red. */
create function private.ludo_active(p_game public.ludo_games) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(s order by array_position(array['red', 'green', 'yellow', 'blue'], s)), '{}')
    from jsonb_object_keys(p_game.positions) s
   where not p_game.places ? s and not p_game.gone ? s;
$$;

drop function private.ludo_next_seat(jsonb, text);
/** Whose turn follows this seat's: the next seat clockwise that is still playing. */
create function private.ludo_next_seat(p_game public.ludo_games, p_seat text) returns text
language sql
immutable
set search_path = ''
as $$
  select s from unnest(array['red', 'green', 'yellow', 'blue', 'red', 'green', 'yellow', 'blue']) with ordinality as o (s, n)
   where s = any (private.ludo_active(p_game)) and n > array_position(array['red', 'green', 'yellow', 'blue'], p_seat)
   order by n limit 1;
$$;

/**
 * After a seat has finished or left: closes the table when fewer than two are still playing,
 * otherwise hands the turn to the next player.
 */
create function private.ludo_close_or_pass(p_match_id uuid, p_from_seat text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_active text[];
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id;
  if v_game.phase = 'over' then
    return;
  end if;
  v_active := private.ludo_active(v_game);
  if cardinality(v_active) <= 1 then
    update public.ludo_games g
       set phase = 'over', die = null, deadline = null,
           -- The last one still playing takes the next place.
           places = case when cardinality(v_active) = 1 and jsonb_array_length(g.places) > 0 then g.places || to_jsonb(v_active[1]) else g.places end
     where g.match_id = p_match_id;
  else
    update public.ludo_games g
       set turn = private.ludo_next_seat(v_game, p_from_seat), phase = 'roll', die = null, sixes = 0
     where g.match_id = p_match_id;
  end if;
end;
$$;

create or replace function private.ludo_on_finish(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_game public.ludo_games;
begin
  select * into v_match from public.matches m where m.id = p_match_id;
  select * into v_game from public.ludo_games g where g.match_id = p_match_id;
  -- A free game that has its winner: the others may play on for the places.
  if v_match.result = 'win' and v_match.end_reason = 'all_home' and v_match.stake_amount = 0
     and cardinality(private.ludo_active(v_game)) >= 2 then
    return;
  end if;
  update public.ludo_games g set phase = 'over', die = null, deadline = null, updated_at = now() where g.match_id = p_match_id;
end;
$$;

/** A seat leaves the table (resigned, or missed three turns). Their pieces come off the board. */
create function private.ludo_leave(p_match_id uuid, p_seat text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_active text[];
  v_winner uuid;
begin
  update public.ludo_games g
     set gone = g.gone || to_jsonb(p_seat),
         positions = jsonb_set(g.positions, array[p_seat], (select jsonb_agg(-1) from generate_series(1, g.pieces_each))),
         last_event = jsonb_build_object('seat', p_seat, 'left', p_reason)
   where g.match_id = p_match_id
  returning * into v_game;
  v_active := private.ludo_active(v_game);

  -- No winner yet and one player left standing: they win.
  if cardinality(v_active) = 1 and exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_active[1];
    perform private.finish_match(p_match_id, 'win', v_winner, p_reason);
    return;
  end if;
  if v_game.turn = p_seat or cardinality(v_active) <= 1 then
    perform private.ludo_close_or_pass(p_match_id, p_seat);
  end if;
end;
$$;

create or replace function private.ludo_step(p_match_id uuid, p_action text, p_piece integer, p_auto boolean) returns void
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
         set turn = private.ludo_next_seat(v_game, v_game.turn), phase = 'roll', die = null, sixes = 0,
             last_event = v_event || jsonb_build_object('forfeit', true)
       where g.match_id = p_match_id;
      return;
    end if;

    if cardinality(v_movable) = 0 then
      insert into public.ludo_moves (match_id, seq, seat, die, auto) values (p_match_id, v_seq, v_game.turn, v_die, p_auto);
      update public.ludo_games g
         set turn = case when v_die = 6 then v_game.turn else private.ludo_next_seat(v_game, v_game.turn) end,
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

  -- Every piece home: this player is done. The first to do it has won the match.
  if not exists (select 1 from jsonb_array_elements_text(v_positions -> v_game.turn) e where e::integer <> 56) then
    update public.ludo_games g
       set positions = v_positions, places = g.places || to_jsonb(v_game.turn), last_event = v_event || jsonb_build_object('finished', true)
     where g.match_id = p_match_id;
    if jsonb_array_length(v_game.places) = 0 then
      select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_game.turn;
      perform private.finish_match(p_match_id, 'win', v_winner, 'all_home');
    end if;
    perform private.ludo_close_or_pass(p_match_id, v_game.turn);
    return;
  end if;

  v_again := v_die = 6 or v_captured > 0 or v_to = 56;
  update public.ludo_games g
     set positions = v_positions,
         turn = case when v_again then v_game.turn else private.ludo_next_seat(v_game, v_game.turn) end,
         phase = 'roll', die = null,
         sixes = case when v_die = 6 then v_game.sixes + 1 else 0 end,
         last_event = v_event
   where g.match_id = p_match_id;
end;
$$;

create or replace function private.ludo_check_clock(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_seat text;
  v_misses integer;
  v_piece integer;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id for update;
  if not found or v_game.phase = 'over' or v_game.deadline is null or v_game.deadline > clock_timestamp() then
    return;
  end if;
  v_seat := v_game.turn;

  -- Before every player has played once, an absent player calls the whole game off.
  if exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active')
     and (select count(*) from jsonb_object_keys(v_game.acted)) < (select count(*) from jsonb_object_keys(v_game.positions)) then
    perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
    return;
  end if;

  v_misses := coalesce((v_game.misses ->> v_seat)::integer, 0) + 1;
  if v_misses >= 3 then
    perform private.ludo_leave(p_match_id, v_seat, 'timeout');
  else
    if v_game.phase = 'roll' then
      perform private.ludo_step(p_match_id, 'roll', null, true);
      select * into v_game from public.ludo_games g where g.match_id = p_match_id;
    end if;
    if v_game.phase = 'move' and v_game.turn = v_seat then
      select m into v_piece from unnest(private.ludo_movable(v_game.positions, v_seat, v_game.die)) m
       order by (v_game.positions -> v_seat ->> m)::integer desc limit 1;
      perform private.ludo_step(p_match_id, 'move', v_piece, true);
    end if;
  end if;

  update public.ludo_games g
     set misses = g.misses || jsonb_build_object(v_seat, v_misses),
         turn_no = g.turn_no + 1,
         deadline = case when g.phase = 'over' then null else clock_timestamp() + make_interval(secs => g.turn_seconds) end,
         updated_at = now()
   where g.match_id = p_match_id;
end;
$$;

create or replace function public.ludo_action(p_match_id uuid, p_user_id uuid, p_action text, p_piece integer, p_turn_no integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_seat text;
  v_active boolean;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'GAME_NOT_FOUND');
  end if;
  select mp.seat into v_seat from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id;
  if v_seat is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  -- The table stays open after a free game has its winner, for those playing on.
  if v_game.phase = 'over' then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;
  v_active := exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active');

  if p_action = 'claim' then
    perform private.ludo_check_clock(p_match_id);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'resign' then
    if v_active and (select count(*) from jsonb_object_keys(v_game.acted)) < (select count(*) from jsonb_object_keys(v_game.positions)) then
      -- Leaving before every player has played once simply calls the game off.
      perform private.finish_match(p_match_id, 'aborted', null, 'aborted_by_player');
      return jsonb_build_object('ok', true);
    end if;
    if v_seat = any (private.ludo_active(v_game)) then
      perform private.ludo_leave(p_match_id, v_seat, 'resignation');
      update public.ludo_games g
         set turn_no = g.turn_no + 1,
             deadline = case when g.phase = 'over' then null when g.turn <> v_game.turn then clock_timestamp() + make_interval(secs => g.turn_seconds) else g.deadline end,
             updated_at = now()
       where g.match_id = p_match_id;
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

revoke all on function private.ludo_active(public.ludo_games) from public, anon, authenticated, service_role;
revoke all on function private.ludo_next_seat(public.ludo_games, text) from public, anon, authenticated, service_role;
revoke all on function private.ludo_close_or_pass(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.ludo_leave(uuid, text, text) from public, anon, authenticated, service_role;

-- The sweep keeps the turn clock running on any open Ludo table, including one being played on
-- after its match has been decided.
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
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;
