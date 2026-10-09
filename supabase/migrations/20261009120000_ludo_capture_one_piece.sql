-- Ludo: a capture sends ONE piece home.
--
-- Until now, landing on a square where an opponent had several pieces stacked sent every one of
-- them back to the yard. Play-testing called that wrong: one piece lands, so one piece is
-- captured. The others on the square stay where they are and play on.
--
-- (Only the four star squares shelter; that is unchanged.)

create or replace function private.ludo_landing(p_game public.ludo_games, p_color text, p_piece integer, p_steps integer) returns jsonb
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
    -- Only the stars shelter. On every other square of the track, gates included, landing on
    -- an opponent captures: one piece, however many are standing there.
    if v_square not in (8, 21, 34, 47) then
      <<hunt>>
      for v_other in select k from jsonb_object_keys(v_positions) k where not (k = any (v_own)) order by k loop
        for v_j in 0 .. jsonb_array_length(v_positions -> v_other) - 1 loop
          v_p := (v_positions -> v_other ->> v_j)::integer;
          if v_p between 0 and 50 and (private.ludo_start_square(v_other) + v_p) % 52 = v_square then
            v_positions := jsonb_set(v_positions, array[v_other, v_j::text], '-1'::jsonb);
            v_captured := 1;
            exit hunt;
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
