-- Ludo: two corrections to the rules, from the owner playing it.
--
-- 1. Both dice must be played whenever that is possible. A die may not be spent in a way that
--    leaves the other one with nowhere to go. The case that showed it: one piece on the board,
--    a throw of 5 and 5, an opponent five squares ahead. Capturing with the first 5 would lay
--    the piece home and the second 5 would be wasted, so that capture is not allowed: the piece
--    must count the whole ten. The same with 3 and 2, or any throw. (When no way of playing
--    both exists, one die is played and the other is lost, as before.)
--
-- 2. The gate. A piece coming out of the yard captures an opponent standing on its own start
--    square: nobody is safe on someone else's gate from the owner of that gate. A start square
--    still shelters everyone from everybody else, and the stars shelter everyone.
--    With rule 1 this gives what players expect: if the piece coming out is the only one that
--    can use the other die, it must walk that die too (6 and 3: out and on to the third square),
--    so it does not stop on the gate and does not capture there. With another piece already on
--    the board to take the 3, the 6 may capture on the gate.

/**
 * What moving this piece this many squares would do, without doing it: the board afterwards,
 * where the piece lands, how many it captures, and where it ends (home at once if it captured
 * and the game is played with lay). The one place the rules of landing are written down.
 */
create function private.ludo_landing(p_game public.ludo_games, p_color text, p_piece integer, p_steps integer) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_own text[] := array(select jsonb_array_elements_text(p_game.teams -> p_game.turn));
  v_positions jsonb := p_game.positions;
  v_from integer := (p_game.positions -> p_color ->> p_piece)::integer;
  v_landed integer;
  v_to integer;
  v_square integer;
  v_captured integer := 0;
  v_other text;
  v_j integer;
  v_p integer;
begin
  -- Coming out of the yard costs the six; whatever is left of a full count is walked.
  v_landed := case when v_from = -1 then p_steps - 6 else v_from + p_steps end;
  if v_landed <= 50 then
    v_square := (private.ludo_start_square(p_color) + v_landed) % 52;
    -- The stars shelter everyone. A start square shelters everyone except from its owner.
    if v_square not in (8, 21, 34, 47)
       and (v_square not in (0, 13, 26, 39) or v_square = private.ludo_start_square(p_color)) then
      for v_other in select k from jsonb_object_keys(v_positions) k where not (k = any (v_own)) loop
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
  -- Lay: the piece that captured has done its work and goes straight home.
  v_to := case when v_captured > 0 and p_game.capture_home then 56 else v_landed end;
  v_positions := jsonb_set(v_positions, array[p_color, p_piece::text], to_jsonb(v_to));
  return jsonb_build_object('positions', v_positions, 'from', v_from, 'landed', v_landed, 'to', v_to, 'captured', v_captured);
end;
$$;

/** Every piece of the player to move that could take both dice as one move (the full count). */
create function private.ludo_fulls(p_game public.ludo_games) returns table (color text, piece integer, progress integer)
language sql
immutable
set search_path = ''
as $$
  select c.color, i.piece, (p_game.positions -> c.color ->> i.piece)::integer
    from jsonb_array_elements_text(p_game.teams -> p_game.turn) as c (color),
         generate_series(0, p_game.pieces_each - 1) as i (piece)
   where private.ludo_can_full(p_game, c.color, i.piece);
$$;

/**
 * The single-die moves the player to move is allowed to make. With both dice still to play,
 * a move is allowed only if the other die can be played after it, whenever there is some way
 * of playing both (such a move, or the full count). Otherwise it is every move there is.
 */
create function private.ludo_legal(p_game public.ludo_games) returns table (color text, piece integer, die integer, progress integer, ord bigint)
language sql
immutable
set search_path = ''
as $$
  with plays as (
    select p.*,
           jsonb_array_length(p_game.dice) = 2 as both,
           -- The die that would be left after this one is played.
           case when (p_game.dice ->> 0)::integer = p.die then (p_game.dice ->> 1)::integer else (p_game.dice ->> 0)::integer end as other
      from private.ludo_plays(p_game) p
  ),
  judged as (
    select pl.*,
           pl.both and exists (
             select 1 from jsonb_array_elements_text(p_game.teams -> p_game.turn) as c (color)
              where cardinality(private.ludo_movable(private.ludo_landing(p_game, pl.color, pl.piece, pl.die) -> 'positions', c.color, pl.other)) > 0
           ) as leaves_other_playable
      from plays pl
  )
  select j.color, j.piece, j.die, j.progress, j.ord
    from judged j
   where not j.both
      or j.leaves_other_playable
      or not (exists (select 1 from judged x where x.leaves_other_playable) or exists (select 1 from private.ludo_fulls(p_game)));
$$;

create or replace function private.ludo_move_piece(p_match_id uuid, p_color text, p_piece integer, p_die integer, p_full boolean, p_auto boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_own text[];
  v_land jsonb;
  v_positions jsonb;
  v_steps integer;
  v_from integer;
  v_to integer;
  v_captured integer;
  v_event jsonb;
  v_seq integer;
  v_left jsonb;
  v_winner uuid;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id;
  v_own := array(select jsonb_array_elements_text(v_game.teams -> v_game.turn));
  select coalesce(max(m.seq), 0) + 1 into v_seq from public.ludo_moves m where m.match_id = p_match_id;

  v_steps := case when p_full then (v_game.dice ->> 0)::integer + (v_game.dice ->> 1)::integer else p_die end;
  v_land := private.ludo_landing(v_game, p_color, p_piece, v_steps);
  v_positions := v_land -> 'positions';
  v_from := (v_land ->> 'from')::integer;
  v_to := (v_land ->> 'to')::integer;
  v_captured := (v_land ->> 'captured')::integer;

  v_event := jsonb_build_object('seat', v_game.turn, 'color', p_color, 'dice', v_game.rolled, 'die', v_steps, 'piece', p_piece,
                                'from', v_from, 'to', v_to, 'captured', v_captured, 'full', p_full);
  if v_to <> (v_land ->> 'landed')::integer then
    v_event := v_event || jsonb_build_object('lay', true, 'at', (v_land ->> 'landed')::integer);
  end if;

  if p_full then
    v_left := '[]'::jsonb;
  else
    -- One die of that value leaves the throw.
    select coalesce(jsonb_agg(t.v order by t.o), '[]'::jsonb) into v_left
      from jsonb_array_elements(v_game.dice) with ordinality as t (v, o)
     where t.o <> (select min(u.o) from jsonb_array_elements(v_game.dice) with ordinality as u (v, o) where u.v = to_jsonb(p_die));
  end if;

  insert into public.ludo_moves (match_id, seq, seat, color, die, piece, from_progress, to_progress, captured, full_count, auto)
  values (p_match_id, v_seq, v_game.turn, p_color, v_steps, p_piece, v_from, v_to, v_captured, p_full, p_auto);

  -- Every piece of every house this player holds is home: they are done. First to do it wins.
  if not exists (select 1 from unnest(v_own) c, jsonb_array_elements_text(v_positions -> c) e where e::integer <> 56) then
    update public.ludo_games g
       set positions = v_positions, places = g.places || to_jsonb(v_game.turn), dice = '[]'::jsonb, die = null, extra = false,
           last_event = v_event || jsonb_build_object('finished', true)
     where g.match_id = p_match_id;
    if jsonb_array_length(v_game.places) = 0 then
      select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match_id and mp.seat = v_game.turn;
      perform private.finish_match(p_match_id, 'win', v_winner, 'all_home');
    end if;
    perform private.ludo_close_or_pass(p_match_id, v_game.turn);
    return true;
  end if;

  update public.ludo_games g
     set positions = v_positions, dice = v_left, last_event = v_event
   where g.match_id = p_match_id;
  return false;
end;
$$;

create or replace function private.ludo_settle_throw(p_match_id uuid, p_auto boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_play record;
  v_seq integer;
  v_fulls integer;
begin
  loop
    select * into v_game from public.ludo_games g where g.match_id = p_match_id;
    exit when v_game.phase = 'over';
    -- How many different things a full count could do (pieces standing together count once).
    select count(*) into v_fulls from (select distinct f.color, f.progress from private.ludo_fulls(v_game) f) x;

    if not exists (select 1 from private.ludo_legal(v_game)) then
      if v_fulls = 0 then
        -- A throw that moved nothing at all is still written into the record of the game.
        if jsonb_array_length(v_game.dice) > 0 and v_game.dice = v_game.rolled then
          select coalesce(max(m.seq), 0) + 1 into v_seq from public.ludo_moves m where m.match_id = p_match_id;
          insert into public.ludo_moves (match_id, seq, seat, die, auto) values (p_match_id, v_seq, v_game.turn, (v_game.rolled ->> 0)::integer, p_auto);
        end if;
        update public.ludo_games g
           set turn = case when v_game.extra then v_game.turn else private.ludo_next_seat(v_game, v_game.turn) end,
               sixes = case when v_game.extra then g.sixes else 0 end,
               phase = 'roll', die = null, dice = '[]'::jsonb, extra = false
         where g.match_id = p_match_id;
        return;
      end if;
      -- Only the full count is open. With one piece that can take it, there is nothing to choose.
      if v_fulls = 1 then
        select f.color, f.piece into v_play from private.ludo_fulls(v_game) f order by f.piece limit 1;
        exit when private.ludo_move_piece(p_match_id, v_play.color, v_play.piece, null, true, p_auto);
        continue;
      end if;
      update public.ludo_games g set phase = 'move', die = null where g.match_id = p_match_id;
      return;
    end if;

    -- A real choice is left to the player: more than one die to play, pieces that would end up
    -- in different places, or the chance to take both dice on one piece.
    if (select count(distinct p.die) from private.ludo_legal(v_game) p) > 1
       or (select count(*) from (select distinct p.color, p.progress from private.ludo_legal(v_game) p) x) > 1
       or v_fulls > 0 then
      update public.ludo_games g
         set phase = 'move', die = (select p.die from private.ludo_legal(v_game) p order by p.ord limit 1)
       where g.match_id = p_match_id;
      return;
    end if;

    -- Nothing to choose: play it.
    select p.color, p.piece, p.die into v_play from private.ludo_legal(v_game) p order by p.ord, p.piece limit 1;
    exit when private.ludo_move_piece(p_match_id, v_play.color, v_play.piece, v_play.die, false, p_auto);
  end loop;
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
  v_play record;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id for update;
  if not found or v_game.phase = 'over' or v_game.deadline is null or v_game.deadline > clock_timestamp() then
    return;
  end if;
  v_seat := v_game.turn;

  -- Before every player has played once, an absent player calls the whole game off.
  if exists (select 1 from public.matches m where m.id = p_match_id and m.status = 'active')
     and (select count(*) from jsonb_object_keys(v_game.acted)) < (select count(*) from jsonb_object_keys(v_game.teams)) then
    perform private.finish_match(p_match_id, 'aborted', null, 'no_first_move');
    return;
  end if;

  v_misses := coalesce((v_game.misses ->> v_seat)::integer, 0) + 1;
  if v_misses >= 3 then
    perform private.ludo_leave(p_match_id, v_seat, 'timeout');
  else
    if v_game.phase = 'roll' then
      perform private.ludo_step(p_match_id, 'roll', null, null, null, false, true);
    end if;
    -- Whatever is left to choose is chosen for them: the dice as they lie, the piece furthest along.
    for i in 1..4 loop
      select * into v_game from public.ludo_games g where g.match_id = p_match_id;
      exit when v_game.phase <> 'move' or v_game.turn <> v_seat;
      select p.color, p.piece, p.die into v_play from private.ludo_legal(v_game) p order by p.ord, p.progress desc limit 1;
      if v_play.piece is not null then
        perform private.ludo_step(p_match_id, 'move', v_play.color, v_play.piece, v_play.die, false, true);
      else
        -- Nothing but the full count is open to them.
        select f.color, f.piece into v_play from private.ludo_fulls(v_game) f order by f.progress desc limit 1;
        exit when v_play.piece is null;
        perform private.ludo_step(p_match_id, 'move', v_play.color, v_play.piece, null, true, true);
      end if;
    end loop;
  end if;

  update public.ludo_games g
     set misses = g.misses || jsonb_build_object(v_seat, v_misses),
         turn_no = g.turn_no + 1,
         deadline = case when g.phase = 'over' then null else clock_timestamp() + make_interval(secs => g.turn_seconds) end,
         updated_at = now()
   where g.match_id = p_match_id;
end;
$$;

create or replace function public.ludo_action(
  p_match_id uuid, p_user_id uuid, p_action text, p_piece integer, p_turn_no integer,
  p_die integer default null, p_color text default null, p_full boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_seat text;
  v_active boolean;
  v_die integer := p_die;
  v_color text;
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
    if v_active and (select count(*) from jsonb_object_keys(v_game.acted)) < (select count(*) from jsonb_object_keys(v_game.teams)) then
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
    perform private.ludo_step(p_match_id, 'roll', null, null, null, false, false);
  elsif p_action = 'move' and v_game.phase = 'move' then
    -- A piece of one of the player's own colours only.
    v_color := coalesce(p_color, v_seat);
    if not (v_game.teams -> v_seat) ? v_color then
      return jsonb_build_object('ok', false, 'code', 'ILLEGAL_MOVE');
    end if;
    if coalesce(p_full, false) then
      if not coalesce(private.ludo_can_full(v_game, v_color, p_piece), false) then
        return jsonb_build_object('ok', false, 'code', 'ILLEGAL_MOVE');
      end if;
      perform private.ludo_step(p_match_id, 'move', v_color, p_piece, null, true, false);
    else
      -- No die named: the first one lying there that this piece can use.
      if v_die is null then
        select p.die into v_die from private.ludo_legal(v_game) p where p.color = v_color and p.piece = p_piece order by p.ord limit 1;
      end if;
      if not exists (select 1 from private.ludo_legal(v_game) p where p.color = v_color and p.piece = p_piece and p.die = v_die) then
        return jsonb_build_object('ok', false, 'code', 'ILLEGAL_MOVE');
      end if;
      perform private.ludo_step(p_match_id, 'move', v_color, p_piece, v_die, false, false);
    end if;
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

revoke all on function private.ludo_landing(public.ludo_games, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.ludo_fulls(public.ludo_games) from public, anon, authenticated, service_role;
revoke all on function private.ludo_legal(public.ludo_games) from public, anon, authenticated, service_role;
