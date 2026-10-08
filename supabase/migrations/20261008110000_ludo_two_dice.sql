-- Ludo with two dice (the default from now on), or one die when the players choose it.
--
-- How two dice are played:
--   * Both are thrown together. Each die is a move of its own: on two different pieces, or one
--     after the other on the same piece. The player chooses which die to play first.
--   * A six on either die can bring a piece out of the yard.
--   * A die that no piece can use is lost. If neither can be used, the turn passes.
--   * A double (both dice the same) earns another throw; so does a capture, and so does bringing
--     a piece home. Three doubles in a row and the turn is lost.
-- With one die nothing changes: a six plays the part of the double.
--
-- The number of dice is part of what players are matched on, so everyone at a table plays the
-- same game.

alter table public.ludo_games
  drop constraint ludo_games_die_when_moving,
  add column dice_count smallint not null default 1 check (dice_count in (1, 2)),
  -- The throw as it fell, and the dice from it that are still to be played.
  add column rolled jsonb not null default '[]'::jsonb,
  add column dice jsonb not null default '[]'::jsonb,
  -- This throw has earned another one (a double, a capture, or a piece brought home).
  add column extra boolean not null default false;
comment on column public.ludo_games.die is 'While a move is being chosen: the first die that can be played. Kept for convenience; `dice` is the full picture.';

update public.game_types
   set options_schema = options_schema || '{"dice": [2, 1]}'::jsonb
 where id = 'ludo';

create or replace function private.ludo_init_match(p_match_id uuid, p_options jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schema jsonb;
  v_mode jsonb;
  v_pieces integer;
  v_dice integer;
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
  -- Matches made before two dice existed carry no choice, and were one-die games.
  v_dice := coalesce((p_options ->> 'dice')::integer, 1);
  if v_dice not in (1, 2) then
    raise exception 'LUDO_UNKNOWN_DICE' using errcode = 'AG002';
  end if;

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

  insert into public.ludo_games (match_id, pieces_each, dice_count, positions, turn, turn_seconds, deadline)
  values (
    p_match_id, v_pieces, v_dice, v_positions, 'red',
    coalesce((v_schema ->> 'turn_seconds')::integer, 20),
    -- The opening turn gets the same grace as a first move in any game.
    clock_timestamp() + make_interval(secs => (select s.first_move_abort_seconds from public.platform_settings s))
  );
end;
$$;

/**
 * Plays one die on one piece: moves it, captures, records it, and takes that die out of the
 * throw. Returns true when the move brought the player's last piece home (their game is done).
 */
create function private.ludo_move_piece(p_match_id uuid, p_piece integer, p_die integer, p_auto boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_positions jsonb;
  v_from integer;
  v_to integer;
  v_square integer;
  v_captured integer := 0;
  v_other text;
  v_j integer;
  v_p integer;
  v_event jsonb;
  v_seq integer;
  v_left jsonb;
  v_winner uuid;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id;
  v_positions := v_game.positions;
  select coalesce(max(m.seq), 0) + 1 into v_seq from public.ludo_moves m where m.match_id = p_match_id;

  v_from := (v_positions -> v_game.turn ->> p_piece)::integer;
  v_to := case when v_from = -1 then 0 else v_from + p_die end;
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

  -- One die of that value leaves the throw.
  select coalesce(jsonb_agg(t.v order by t.o), '[]'::jsonb) into v_left
    from jsonb_array_elements(v_game.dice) with ordinality as t (v, o)
   where t.o <> (select min(u.o) from jsonb_array_elements(v_game.dice) with ordinality as u (v, o) where u.v = to_jsonb(p_die));

  insert into public.ludo_moves (match_id, seq, seat, die, piece, from_progress, to_progress, captured, auto)
  values (p_match_id, v_seq, v_game.turn, p_die, p_piece, v_from, v_to, v_captured, p_auto);
  v_event := jsonb_build_object('seat', v_game.turn, 'dice', v_game.rolled, 'die', p_die, 'piece', p_piece, 'from', v_from, 'to', v_to, 'captured', v_captured);

  -- Every piece home: this player is done. The first to do it has won the match.
  if not exists (select 1 from jsonb_array_elements_text(v_positions -> v_game.turn) e where e::integer <> 56) then
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
     set positions = v_positions, dice = v_left,
         extra = g.extra or v_captured > 0 or v_to = 56,
         last_event = v_event
   where g.match_id = p_match_id;
  return false;
end;
$$;

/**
 * After a throw, and after each die is played: plays whatever is forced, stops to ask the
 * player when there is a real choice, and ends the throw when nothing more can be played
 * (another throw if one was earned, otherwise the next player).
 */
create function private.ludo_settle_throw(p_match_id uuid, p_auto boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_values integer[];
  v_pieces integer[];
  v_seq integer;
begin
  loop
    select * into v_game from public.ludo_games g where g.match_id = p_match_id;
    exit when v_game.phase = 'over';

    -- The dice that some piece can use, in the order they lie.
    select coalesce(array_agg(x.v order by x.o), '{}') into v_values
      from (select distinct on (d.v::integer) d.v::integer as v, d.o
              from jsonb_array_elements_text(v_game.dice) with ordinality as d (v, o)
             where cardinality(private.ludo_movable(v_game.positions, v_game.turn, d.v::integer)) > 0
             order by d.v::integer, d.o) x;

    if cardinality(v_values) = 0 then
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

    v_pieces := private.ludo_movable(v_game.positions, v_game.turn, v_values[1]);
    if cardinality(v_values) > 1
       -- Pieces that would do exactly the same thing are not a real choice.
       or (select count(distinct v_game.positions -> v_game.turn ->> i) from unnest(v_pieces) i) > 1 then
      update public.ludo_games g set phase = 'move', die = v_values[1] where g.match_id = p_match_id;
      return;
    end if;

    -- Nothing to choose: play it.
    exit when private.ludo_move_piece(p_match_id, v_pieces[1], v_values[1], p_auto);
  end loop;
end;
$$;

drop function private.ludo_step(uuid, text, integer, boolean);
/** One step for the player whose turn it is: a throw, or playing one die on one piece. */
create function private.ludo_step(p_match_id uuid, p_action text, p_piece integer, p_die integer, p_auto boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_throw jsonb;
  v_bonus boolean;
  v_seq integer;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id;

  if p_action = 'roll' then
    v_throw := case v_game.dice_count
      when 2 then jsonb_build_array(private.ludo_roll(), private.ludo_roll())
      else jsonb_build_array(private.ludo_roll())
    end;
    -- What earns another throw: a double with two dice, a six with one.
    v_bonus := case v_game.dice_count when 2 then v_throw -> 0 = v_throw -> 1 else (v_throw ->> 0)::integer = 6 end;

    if v_bonus and v_game.sixes = 2 then
      -- The third in a row: the turn is lost.
      select coalesce(max(m.seq), 0) + 1 into v_seq from public.ludo_moves m where m.match_id = p_match_id;
      insert into public.ludo_moves (match_id, seq, seat, die, auto) values (p_match_id, v_seq, v_game.turn, (v_throw ->> 0)::integer, p_auto);
      update public.ludo_games g
         set turn = private.ludo_next_seat(v_game, v_game.turn), phase = 'roll', die = null, sixes = 0,
             rolled = v_throw, dice = '[]'::jsonb, extra = false,
             last_event = jsonb_build_object('seat', v_game.turn, 'dice', v_throw, 'die', v_throw -> 0, 'forfeit', true)
       where g.match_id = p_match_id;
      return;
    end if;

    update public.ludo_games g
       set rolled = v_throw, dice = v_throw, extra = v_bonus,
           sixes = case when v_bonus then g.sixes + 1 else 0 end,
           last_event = jsonb_build_object('seat', v_game.turn, 'dice', v_throw, 'die', v_throw -> 0)
     where g.match_id = p_match_id;
  else
    if private.ludo_move_piece(p_match_id, p_piece, p_die, p_auto) then
      return;
    end if;
  end if;

  perform private.ludo_settle_throw(p_match_id, p_auto);
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
  v_die integer;
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
      perform private.ludo_step(p_match_id, 'roll', null, null, true);
    end if;
    -- Whatever is left to choose is chosen for them: the dice as they lie, the piece furthest along.
    for i in 1..4 loop
      select * into v_game from public.ludo_games g where g.match_id = p_match_id;
      exit when v_game.phase <> 'move' or v_game.turn <> v_seat;
      select d.v::integer, m into v_die, v_piece
        from jsonb_array_elements_text(v_game.dice) with ordinality as d (v, o),
             unnest(private.ludo_movable(v_game.positions, v_seat, d.v::integer)) m
       order by d.o, (v_game.positions -> v_seat ->> m)::integer desc
       limit 1;
      exit when v_piece is null;
      perform private.ludo_step(p_match_id, 'move', v_piece, v_die, true);
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

drop function public.ludo_action(uuid, uuid, text, integer, integer);
/**
 * Everything a player can ask for: 'roll', 'move' (a piece, and which die to play on it),
 * 'resign', or 'claim' (the clock has run out, please act on it). Called by the ludo-action
 * Edge Function, which has identified the player. Replies { ok: true } or { ok: false, code }.
 */
create function public.ludo_action(p_match_id uuid, p_user_id uuid, p_action text, p_piece integer, p_turn_no integer, p_die integer default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_seat text;
  v_active boolean;
  v_die integer := p_die;
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
    perform private.ludo_step(p_match_id, 'roll', null, null, false);
  elsif p_action = 'move' and v_game.phase = 'move' then
    -- No die named: the first one lying there that this piece can use.
    if v_die is null then
      select d.v::integer into v_die
        from jsonb_array_elements_text(v_game.dice) with ordinality as d (v, o)
       where p_piece = any (private.ludo_movable(v_game.positions, v_seat, d.v::integer))
       order by d.o limit 1;
    end if;
    if v_die is null or not v_game.dice @> to_jsonb(v_die)
       or not (p_piece = any (private.ludo_movable(v_game.positions, v_seat, v_die))) then
      return jsonb_build_object('ok', false, 'code', 'ILLEGAL_MOVE');
    end if;
    perform private.ludo_step(p_match_id, 'move', p_piece, v_die, false);
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

revoke all on function private.ludo_move_piece(uuid, integer, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function private.ludo_settle_throw(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.ludo_step(uuid, text, integer, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function public.ludo_action(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.ludo_action(uuid, uuid, text, integer, integer, integer) to service_role;
