-- Online play: matchmaking, server-side moves and clocks, game end.
--
-- Every function here that changes anything is callable by the service role only. Clients reach
-- them through Edge Functions, which authenticate the player and (for chess moves) validate the
-- move with chess.js before asking the database to record it.
--
-- How a game plugs into the core, at the database level. For a game type `xyz` the core calls:
--   private.xyz_init_match(match_id, options)  when a match is created, inside the same transaction
--   private.xyz_on_finish(match_id)            when a match ends
-- The core seats players as '1', '2', ... in random order; init_match may rename the seats.

-- ---------------------------------------------------------------------------------------------
-- Core
-- ---------------------------------------------------------------------------------------------

-- A queue entry only counts while its owner keeps checking in, so nobody is paired with a
-- player who closed the app.
alter table public.match_queue add column heartbeat_at timestamptz not null default now();

-- Lets a waiting player hear about their new match the moment it is created.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.match_players;
  end if;
end;
$$;

-- Clients measure their offset from server time with this, to draw clocks from server values.
create function public.server_now() returns timestamptz
language sql
stable
set search_path = ''
as $$ select clock_timestamp(); $$;

revoke all on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated, service_role;

create function private.active_match_of(p_user_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
    from public.matches m
    join public.match_players mp on mp.match_id = m.id
   where mp.user_id = p_user_id and m.status in ('waiting', 'active')
   order by m.created_at desc
   limit 1;
$$;

/**
 * Joins the queue, or pairs the player at once if someone compatible is waiting.
 * Same game, same stake, same options, same rating pool; closest rating first, then longest wait.
 * Calling it again while waiting refreshes the heartbeat. Returns
 *   {status: 'matched', match_id} | {status: 'queued'} | {status: 'error', code}
 */
create function public.join_match_queue(
  p_user_id uuid,
  p_game_type text,
  p_stake bigint,
  p_options jsonb,
  p_rating_pool text
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
  v_opponent public.match_queue;
  v_match_id uuid;
  v_first uuid;
  v_second uuid;
begin
  -- One request at a time per player, and one at a time per queue "bucket", so two players who
  -- tap Find match in the same instant still see each other.
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
  -- Staked matches need escrow, which arrives with the staking step. Until then only free play.
  if p_stake <> 0 then
    return jsonb_build_object('status', 'error', 'code', 'STAKES_NOT_OPEN');
  end if;

  -- Already in a game (for example after reopening the app): send them back to it.
  v_existing := private.active_match_of(p_user_id);
  if v_existing is not null then
    delete from public.match_queue q where q.user_id = p_user_id;
    return jsonb_build_object('status', 'matched', 'match_id', v_existing);
  end if;

  select coalesce(
           (select r.rating from public.player_ratings r
             where r.user_id = p_user_id and r.game_type = p_game_type and r.pool = p_rating_pool),
           1200)
    into v_rating;

  perform pg_advisory_xact_lock(
    hashtextextended('agh:queue:' || p_game_type || ':' || p_stake || ':' || p_rating_pool || ':' || p_options::text, 0));

  select q.* into v_opponent
    from public.match_queue q
   where q.game_type = p_game_type
     and q.stake_amount = p_stake
     and q.rating_pool = p_rating_pool
     and q.options = p_options
     and q.user_id <> p_user_id
     and q.heartbeat_at > now() - interval '45 seconds'
   order by abs(q.rating - v_rating), q.joined_at
   limit 1
     for update skip locked;

  -- Take the opponent's own lock too, without waiting: if they are in the middle of another
  -- request, leave them alone and queue instead. This is what stops a player landing in two games.
  if found
     and pg_try_advisory_xact_lock(hashtextextended('agh:user:' || v_opponent.user_id::text, 0))
     and private.active_match_of(v_opponent.user_id) is null then

    delete from public.match_queue q where q.user_id in (p_user_id, v_opponent.user_id);

    insert into public.matches (game_type, stake_amount, options, rating_pool, status, started_at)
    values (p_game_type, p_stake, p_options, p_rating_pool, 'active', now())
    returning id into v_match_id;

    -- Seats are dealt at random.
    if random() < 0.5 then
      v_first := p_user_id; v_second := v_opponent.user_id;
    else
      v_first := v_opponent.user_id; v_second := p_user_id;
    end if;
    insert into public.match_players (match_id, user_id, seat, rating_before)
    values
      (v_match_id, v_first, '1', case when v_first = p_user_id then v_rating else v_opponent.rating end),
      (v_match_id, v_second, '2', case when v_second = p_user_id then v_rating else v_opponent.rating end);

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

create function public.leave_match_queue(p_user_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.match_queue q where q.user_id = p_user_id;
$$;

/**
 * Ends a match. Returns false if it was already over, so a result can never be recorded twice.
 * p_result: 'win' (p_winner_id set), 'draw', or 'aborted'.
 */
create function private.finish_match(
  p_match_id uuid,
  p_result text,
  p_winner_id uuid,
  p_end_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_type text;
begin
  update public.matches m
     set status = case when p_result = 'aborted' then 'aborted' else 'finished' end,
         result = p_result,
         winner_id = case when p_result = 'win' then p_winner_id end,
         end_reason = p_end_reason,
         finished_at = now()
   where m.id = p_match_id and m.status in ('waiting', 'active')
  returning m.game_type into v_game_type;

  if not found then
    return false;
  end if;

  execute format('select private.%I($1)', v_game_type || '_on_finish') using p_match_id;
  -- Settlement (payouts, rake, ratings) is added here by the staking step.
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Chess module
-- ---------------------------------------------------------------------------------------------

create function private.chess_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control jsonb;
begin
  select tc into v_control
    from public.game_types g, jsonb_array_elements(g.options_schema -> 'time_controls') as tc
   where g.id = 'chess' and tc ->> 'id' = p_options ->> 'time_control';
  if v_control is null then
    raise exception 'CHESS_UNKNOWN_TIME_CONTROL' using errcode = 'AG002';
  end if;

  update public.match_players mp
     set seat = case mp.seat when '1' then 'white' else 'black' end
   where mp.match_id = p_match_id;

  insert into public.chess_games (match_id, fen, turn, ply, white_time_ms, black_time_ms, increment_ms, last_move_at)
  values (
    p_match_id,
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
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
 * Time left for one side at a given moment. A player's clock only runs once both players have
 * made their first move (plies 0 and 1 are covered by the first-move abort window instead).
 */
create function private.chess_remaining_ms(p_game public.chess_games, p_color text, p_at timestamptz) returns bigint
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

/**
 * Whether a side still has enough pieces to deliver mate. Used only to decide a timeout: if the
 * player with time left could never mate, the game is drawn (a lone king, or king and one minor piece).
 */
create function private.chess_can_mate(p_fen text, p_color text) returns boolean
language sql
immutable
set search_path = ''
as $$
  with board as (select split_part(p_fen, ' ', 1) as b),
  counts as (
    select
      length(b) - length(replace(b, case p_color when 'w' then 'P' else 'p' end, '')) as pawns,
      length(b) - length(replace(b, case p_color when 'w' then 'R' else 'r' end, '')) as rooks,
      length(b) - length(replace(b, case p_color when 'w' then 'Q' else 'q' end, '')) as queens,
      length(b) - length(replace(b, case p_color when 'w' then 'B' else 'b' end, ''))
        + length(b) - length(replace(b, case p_color when 'w' then 'N' else 'n' end, '')) as minors
    from board
  )
  select pawns + rooks + queens > 0 or minors >= 2 from counts;
$$;

create function private.chess_on_finish(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.chess_games;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_game from public.chess_games g where g.match_id = p_match_id for update;
  if not found then
    return;
  end if;
  -- Freeze the clocks where they stood and write the game record.
  update public.chess_games g
     set white_time_ms = greatest(0, private.chess_remaining_ms(v_game, 'w', v_now)),
         black_time_ms = greatest(0, private.chess_remaining_ms(v_game, 'b', v_now)),
         last_move_at = v_now,
         draw_offer_by = null,
         pgn = coalesce((
           select string_agg(
                    case when mv.ply % 2 = 1 then ((mv.ply + 1) / 2)::text || '. ' else '' end || mv.san,
                    ' ' order by mv.ply)
             from public.chess_moves mv where mv.match_id = p_match_id), '')
   where g.match_id = p_match_id;
end;
$$;

create function private.chess_color_of(p_match_id uuid, p_user_id uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case mp.seat when 'white' then 'w' when 'black' then 'b' end
    from public.match_players mp
   where mp.match_id = p_match_id and mp.user_id = p_user_id;
$$;

create function private.chess_player_of(p_match_id uuid, p_color text) returns uuid
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
create function private.chess_check_clock(p_match_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.chess_games;
  v_now timestamptz := clock_timestamp();
  v_abort_after interval;
  v_flagged text;
  v_other text;
begin
  select * into v_game from public.chess_games g where g.match_id = p_match_id for update;
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

  v_flagged := v_game.turn;
  if private.chess_remaining_ms(v_game, v_flagged, v_now) > 0 then
    return 'none';
  end if;

  v_other := case v_flagged when 'w' then 'b' else 'w' end;
  if private.chess_can_mate(v_game.fen, v_other) then
    perform private.finish_match(p_match_id, 'win', private.chess_player_of(p_match_id, v_other), 'timeout');
  else
    perform private.finish_match(p_match_id, 'draw', null, 'timeout');
  end if;
  return 'timeout';
end;
$$;

/** Everything the move validator needs, in one round trip. Null when the player is not in the match. */
create function public.chess_move_context(p_match_id uuid, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status', m.status,
           'color', private.chess_color_of(p_match_id, p_user_id),
           'fen', g.fen,
           'ply', g.ply,
           'turn', g.turn,
           'sans', coalesce((select jsonb_agg(mv.san order by mv.ply)
                               from public.chess_moves mv where mv.match_id = p_match_id), '[]'::jsonb))
    from public.matches m
    join public.chess_games g on g.match_id = m.id
   where m.id = p_match_id
     and private.chess_color_of(p_match_id, p_user_id) is not null;
$$;

/**
 * Records a move that the Edge Function has already validated with chess.js.
 * Under a row lock it re-checks everything that could have changed since: the game is still on,
 * it is this player's turn, the position has not moved on (p_expected_ply), and the player has
 * time left by the server's clock. Returns {ok: true, ...clock values} or {ok: false, code}.
 */
create function public.chess_apply_move(
  p_match_id uuid,
  p_user_id uuid,
  p_expected_ply integer,
  p_san text,
  p_uci text,
  p_fen_after text,
  p_end_reason text,
  p_winner text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.chess_games;
  v_color text;
  v_now timestamptz;
  v_left bigint;
  v_abort_after interval;
  v_white bigint;
  v_black bigint;
begin
  select * into v_game from public.chess_games g where g.match_id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;

  v_color := private.chess_color_of(p_match_id, p_user_id);
  if v_color is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  if v_game.turn <> v_color then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOUR_TURN');
  end if;
  if v_game.ply <> p_expected_ply then
    return jsonb_build_object('ok', false, 'code', 'OUT_OF_SYNC');
  end if;

  -- Server time only. The client's idea of the time is never asked for.
  v_now := clock_timestamp();

  if v_game.ply < 2 then
    select make_interval(secs => s.first_move_abort_seconds) into v_abort_after from public.platform_settings s;
    if v_now - v_game.last_move_at > v_abort_after then
      perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
      return jsonb_build_object('ok', false, 'code', 'ABORTED');
    end if;
    v_left := private.chess_remaining_ms(v_game, v_color, v_now);
  else
    v_left := private.chess_remaining_ms(v_game, v_color, v_now);
    if v_left <= 0 then
      perform private.chess_check_clock(p_match_id);
      return jsonb_build_object('ok', false, 'code', 'TIME_OUT');
    end if;
    v_left := v_left + v_game.increment_ms;
  end if;

  v_white := case when v_color = 'w' then v_left else v_game.white_time_ms end;
  v_black := case when v_color = 'b' then v_left else v_game.black_time_ms end;

  insert into public.chess_moves (match_id, ply, san, uci, fen_after, time_left_ms)
  values (p_match_id, v_game.ply + 1, p_san, p_uci, p_fen_after, v_left);

  update public.chess_games g
     set fen = p_fen_after,
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
      case when p_winner is null then null else private.chess_player_of(p_match_id, p_winner) end,
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
create function public.chess_game_action(p_match_id uuid, p_user_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.chess_games;
  v_color text;
  v_opponent uuid;
  v_clock text;
begin
  v_color := private.chess_color_of(p_match_id, p_user_id);
  if v_color is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;

  if p_action = 'claim' then
    v_clock := private.chess_check_clock(p_match_id);
    return jsonb_build_object('ok', true, 'clock', v_clock);
  end if;

  select * into v_game from public.chess_games g where g.match_id = p_match_id for update;
  if not exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'GAME_OVER');
  end if;
  v_opponent := private.chess_player_of(p_match_id, case v_color when 'w' then 'b' else 'w' end);

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
    update public.chess_games g set draw_offer_by = p_user_id where g.match_id = p_match_id;
  elsif p_action = 'accept_draw' then
    if v_game.draw_offer_by is distinct from v_opponent then
      return jsonb_build_object('ok', false, 'code', 'NO_OFFER');
    end if;
    perform private.finish_match(p_match_id, 'draw', null, 'agreement');
  elsif p_action = 'decline_draw' then
    if v_game.draw_offer_by is distinct from v_opponent then
      return jsonb_build_object('ok', false, 'code', 'NO_OFFER');
    end if;
    update public.chess_games g set draw_offer_by = null where g.match_id = p_match_id;
  else
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ACTION');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Background sweep: ends games whose clock ran out while nobody was watching (both players gone),
-- and clears queue entries whose owner stopped checking in.
-- ---------------------------------------------------------------------------------------------
create function private.sweep() returns void
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
end;
$$;

-- Lock everything down: only the service role may call the public entry points.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.join_match_queue(uuid, text, bigint, jsonb, text)',
    'public.leave_match_queue(uuid)',
    'public.chess_move_context(uuid, uuid)',
    'public.chess_apply_move(uuid, uuid, integer, text, text, text, text, text)',
    'public.chess_game_action(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'private.active_match_of(uuid)',
    'private.finish_match(uuid, text, uuid, text)',
    'private.chess_init_match(uuid, jsonb)',
    'private.chess_remaining_ms(public.chess_games, text, timestamptz)',
    'private.chess_can_mate(text, text)',
    'private.chess_on_finish(uuid)',
    'private.chess_color_of(uuid, uuid)',
    'private.chess_player_of(uuid, text)',
    'private.chess_check_clock(uuid)',
    'private.sweep()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;

-- Run the sweep every ten seconds where pg_cron is available (it is on Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('agh-sweep', '10 seconds', 'select private.sweep()');
  end if;
end;
$$;
