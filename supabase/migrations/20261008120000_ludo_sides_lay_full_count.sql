-- Ludo, the way it is played in Nigeria and across West Africa. Three additions, each a choice
-- the players make before the game (and are matched on):
--
--   * Both sides. In a two-player game each player may hold two houses, opposite each other:
--     eight pieces instead of four. One throw is played on any of them. Every piece of both
--     houses must come home to win.
--   * Lay. A piece that captures does not walk the rest of the board: it goes straight home,
--     while the captured piece goes back to its yard. (Switched off, the capturing piece simply
--     stays where it landed, as before.)
--   * Full count. With two dice, a player may move one piece by the total in a single move
--     (6 and 4: one piece, ten squares), touching nothing on the way. Playing the dice one at
--     a time, on one piece or two, is still allowed.
--
-- To hold two houses, a seat is no longer the same thing as a colour: `teams` says which
-- colours each seat plays. In a one-side game every seat simply plays its own colour.

alter table public.ludo_games
  add column teams jsonb not null default '{}'::jsonb,
  add column capture_home boolean not null default false;
update public.ludo_games g
   set teams = (select jsonb_object_agg(k, jsonb_build_array(k)) from jsonb_object_keys(g.positions) k)
 where g.teams = '{}'::jsonb;

alter table public.ludo_moves
  drop constraint ludo_moves_die_check,
  add constraint ludo_moves_die_check check (die between 1 and 12),
  add column color text,
  add column full_count boolean not null default false;

update public.game_types
   set options_schema = options_schema || '{"sides": [2, 1], "lay": [true, false]}'::jsonb
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
  v_sides integer;
  v_players integer;
  v_positions jsonb := '{}'::jsonb;
  v_teams jsonb := '{}'::jsonb;
  v_seat text;
  v_colors text[];
  v_color text;
begin
  select g.options_schema into v_schema from public.game_types g where g.id = 'ludo';
  select m into v_mode from jsonb_array_elements(v_schema -> 'modes') as m where m ->> 'id' = p_options ->> 'mode';
  if v_mode is null then
    raise exception 'LUDO_UNKNOWN_MODE' using errcode = 'AG002';
  end if;
  v_pieces := (v_mode ->> 'pieces')::integer;
  -- Matches made before these choices existed carry none: one die, one side, no lay.
  v_dice := coalesce((p_options ->> 'dice')::integer, 1);
  v_sides := coalesce((p_options ->> 'sides')::integer, 1);
  select count(*) into v_players from public.match_players mp where mp.match_id = p_match_id;
  if v_dice not in (1, 2) or v_sides not in (1, 2) or (v_sides = 2 and v_players <> 2) then
    raise exception 'LUDO_UNKNOWN_OPTIONS' using errcode = 'AG002';
  end if;

  -- Two players sit opposite each other (or, holding both sides, take alternate corners);
  -- three or four go round the board in order.
  update public.match_players mp
     set seat = case
       when v_players = 2 and v_sides = 2 then case mp.seat when '1' then 'red' else 'green' end
       when v_players = 2 then case mp.seat when '1' then 'red' else 'yellow' end
       else (array['red', 'green', 'yellow', 'blue'])[mp.seat::integer]
     end
   where mp.match_id = p_match_id;

  for v_seat in select mp.seat from public.match_players mp where mp.match_id = p_match_id loop
    v_colors := case when v_sides = 2 then case v_seat when 'red' then array['red', 'yellow'] else array['green', 'blue'] end else array[v_seat] end;
    v_teams := v_teams || jsonb_build_object(v_seat, to_jsonb(v_colors));
    foreach v_color in array v_colors loop
      v_positions := v_positions || jsonb_build_object(v_color, (select jsonb_agg(-1) from generate_series(1, v_pieces)));
    end loop;
  end loop;

  insert into public.ludo_games (match_id, pieces_each, dice_count, capture_home, positions, teams, turn, turn_seconds, deadline)
  values (
    p_match_id, v_pieces, v_dice, coalesce((p_options ->> 'lay')::boolean, false), v_positions, v_teams, 'red',
    coalesce((v_schema ->> 'turn_seconds')::integer, 20),
    -- The opening turn gets the same grace as a first move in any game.
    clock_timestamp() + make_interval(secs => (select s.first_move_abort_seconds from public.platform_settings s))
  );
end;
$$;

/** The seats still playing, clockwise from red. */
create or replace function private.ludo_active(p_game public.ludo_games) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(s order by array_position(array['red', 'green', 'yellow', 'blue'], s)), '{}')
    from jsonb_object_keys(p_game.teams) s
   where not p_game.places ? s and not p_game.gone ? s;
$$;

/** Every single-die move open to the player whose turn it is: which colour, piece and die. */
create function private.ludo_plays(p_game public.ludo_games) returns table (color text, piece integer, die integer, progress integer, ord bigint)
language sql
immutable
set search_path = ''
as $$
  select c.color, m.piece, d.v, (p_game.positions -> c.color ->> m.piece)::integer, d.o
    from jsonb_array_elements_text(p_game.teams -> p_game.turn) as c (color),
         (select distinct on (x.v::integer) x.v::integer as v, x.o
            from jsonb_array_elements_text(p_game.dice) with ordinality as x (v, o)
           order by x.v::integer, x.o) d,
         unnest(private.ludo_movable(p_game.positions, c.color, d.v)) as m (piece);
$$;

/** Whether this piece may take both dice as one move: the full count. */
create function private.ludo_can_full(p_game public.ludo_games, p_color text, p_piece integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_array_length(p_game.dice) = 2
     and case
       -- From the yard a six is needed to come out; the other die is then walked.
       when f.at = -1 then p_game.dice @> '6'::jsonb
       else f.at between 0 and 56 - ((p_game.dice ->> 0)::integer + (p_game.dice ->> 1)::integer)
     end
    from (select (p_game.positions -> p_color ->> p_piece)::integer as at) f
   where f.at is not null;
$$;

drop function private.ludo_move_piece(uuid, integer, integer, boolean);
/**
 * Moves one piece: by one die, or by both at once (the full count). Captures, lays if the game
 * is played that way, records the move and takes the dice used out of the throw. Returns true
 * when it brought home the last piece of everything this player holds.
 */
create function private.ludo_move_piece(p_match_id uuid, p_color text, p_piece integer, p_die integer, p_full boolean, p_auto boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_own text[];
  v_positions jsonb;
  v_steps integer;
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
  v_own := array(select jsonb_array_elements_text(v_game.teams -> v_game.turn));
  select coalesce(max(m.seq), 0) + 1 into v_seq from public.ludo_moves m where m.match_id = p_match_id;

  v_from := (v_positions -> p_color ->> p_piece)::integer;
  v_steps := case when p_full then (v_game.dice ->> 0)::integer + (v_game.dice ->> 1)::integer else p_die end;
  -- Coming out of the yard costs the six; whatever is left of a full count is walked.
  v_to := case when v_from = -1 then v_steps - 6 else v_from + v_steps end;

  -- Landing on other players' pieces sends them back to their yard, except on a safe square.
  if v_to <= 50 then
    v_square := (private.ludo_start_square(p_color) + v_to) % 52;
    if v_square not in (0, 8, 13, 21, 26, 34, 39, 47) then
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

  v_event := jsonb_build_object('seat', v_game.turn, 'color', p_color, 'dice', v_game.rolled, 'die', v_steps, 'piece', p_piece,
                                'from', v_from, 'to', v_to, 'captured', v_captured, 'full', p_full);
  -- Lay: the piece that captured has done its work and goes straight home.
  if v_captured > 0 and v_game.capture_home then
    v_event := v_event || jsonb_build_object('lay', true, 'at', v_to);
    v_to := 56;
  end if;
  v_positions := jsonb_set(v_positions, array[p_color, p_piece::text], to_jsonb(v_to));

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
     set positions = v_positions, dice = v_left,
         extra = g.extra or v_captured > 0 or v_to = 56,
         last_event = v_event
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
begin
  loop
    select * into v_game from public.ludo_games g where g.match_id = p_match_id;
    exit when v_game.phase = 'over';

    if not exists (select 1 from private.ludo_plays(v_game)) then
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

    -- A real choice is left to the player: more than one die to play, pieces that would end up
    -- in different places, or the chance to take both dice on one piece.
    if (select count(distinct p.die) from private.ludo_plays(v_game) p) > 1
       or (select count(*) from (select distinct p.color, p.progress from private.ludo_plays(v_game) p) x) > 1
       or exists (select 1 from jsonb_array_elements_text(v_game.teams -> v_game.turn) c (color), generate_series(0, v_game.pieces_each - 1) i
                   where private.ludo_can_full(v_game, c.color, i)) then
      update public.ludo_games g
         set phase = 'move', die = (select p.die from private.ludo_plays(v_game) p order by p.ord limit 1)
       where g.match_id = p_match_id;
      return;
    end if;

    -- Nothing to choose: play it.
    select p.color, p.piece, p.die into v_play from private.ludo_plays(v_game) p order by p.ord, p.piece limit 1;
    exit when private.ludo_move_piece(p_match_id, v_play.color, v_play.piece, v_play.die, false, p_auto);
  end loop;
end;
$$;

drop function private.ludo_step(uuid, text, integer, integer, boolean);
/** One step for the player whose turn it is: a throw, or a move (one die, or the full count). */
create function private.ludo_step(p_match_id uuid, p_action text, p_color text, p_piece integer, p_die integer, p_full boolean, p_auto boolean) returns void
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
    if private.ludo_move_piece(p_match_id, p_color, p_piece, p_die, p_full, p_auto) then
      return;
    end if;
  end if;

  perform private.ludo_settle_throw(p_match_id, p_auto);
end;
$$;

create or replace function private.ludo_leave(p_match_id uuid, p_seat text, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.ludo_games;
  v_active text[];
  v_winner uuid;
  v_color text;
begin
  select * into v_game from public.ludo_games g where g.match_id = p_match_id;
  -- Everything they held comes off the board.
  for v_color in select jsonb_array_elements_text(v_game.teams -> p_seat) loop
    v_game.positions := jsonb_set(v_game.positions, array[v_color], (select jsonb_agg(-1) from generate_series(1, v_game.pieces_each)));
  end loop;
  update public.ludo_games g
     set gone = g.gone || to_jsonb(p_seat), positions = v_game.positions,
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
      select p.color, p.piece, p.die into v_play from private.ludo_plays(v_game) p order by p.ord, p.progress desc limit 1;
      exit when v_play is null;
      perform private.ludo_step(p_match_id, 'move', v_play.color, v_play.piece, v_play.die, false, true);
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

drop function public.ludo_action(uuid, uuid, text, integer, integer, integer);
/**
 * Everything a player can ask for: 'roll'; 'move' (a piece of one of their colours, with one of
 * the dice, or with both as a full count); 'resign'; or 'claim' (the clock has run out).
 * Called by the ludo-action Edge Function, which has identified the player.
 */
create function public.ludo_action(
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
        select p.die into v_die from private.ludo_plays(v_game) p where p.color = v_color and p.piece = p_piece order by p.ord limit 1;
      end if;
      if not exists (select 1 from private.ludo_plays(v_game) p where p.color = v_color and p.piece = p_piece and p.die = v_die) then
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

revoke all on function private.ludo_plays(public.ludo_games) from public, anon, authenticated, service_role;
revoke all on function private.ludo_can_full(public.ludo_games, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.ludo_move_piece(uuid, text, integer, integer, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function private.ludo_step(uuid, text, text, integer, integer, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.ludo_action(uuid, uuid, text, integer, integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.ludo_action(uuid, uuid, text, integer, integer, integer, text, boolean) to service_role;
