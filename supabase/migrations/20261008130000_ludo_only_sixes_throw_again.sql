-- Ludo: when a player throws again. Decided with the owner, after playing it: the only thing
-- that earns another throw is every die showing six (a double six with two dice, a six with
-- one). Any other double does not, a capture does not, and bringing a piece home does not, so
-- a player no longer takes two or three turns in a row for those. This is also how Naija Ludo
-- plays. Three such throws in a row still lose the turn.
--
-- Two functions change, by one line each; everything else in them is as it was.

create or replace function private.ludo_move_piece(p_match_id uuid, p_color text, p_piece integer, p_die integer, p_full boolean, p_auto boolean) returns boolean
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
     set positions = v_positions, dice = v_left, last_event = v_event
   where g.match_id = p_match_id;
  return false;
end;
$$;

create or replace function private.ludo_step(p_match_id uuid, p_action text, p_color text, p_piece integer, p_die integer, p_full boolean, p_auto boolean) returns void
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
    -- The one thing that earns another throw: every die showing six.
    v_bonus := (v_throw ->> 0)::integer = 6 and (v_game.dice_count = 1 or (v_throw ->> 1)::integer = 6);

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
