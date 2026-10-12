-- Ludo with two dice: a piece that captures with one die does not count the other.
--
-- The rule the players play by: "you cannot kill and count with the same piece". When one die
-- captures, the other die of that throw must be played by a different piece. So:
--   * 5 and 2, and a piece captures with the 5: the 2 is played by another piece.
--   * 6 and 3 at the start, an opponent on the gate, nothing else on the board: there is no
--     other piece to play the 3, so the capture is not on. The piece comes out and counts the
--     whole nine, passing the piece on the gate.
--   * The same throw with another piece on the board: out with the 6, capturing on the gate,
--     and the 3 is played by the other piece (the player's choice when there are several).
-- A capture made with the whole throw (both dice counted on one piece, landing on an opponent)
-- stands: nothing is left to count afterwards.
--
-- With lay this was already so, because the piece that captures goes straight home. This makes
-- it so without lay as well, where the piece stays on the board and until now could walk on.
--
-- Which piece captured is read from the game's own record of its last move: during a throw,
-- with one die still lying there, the last thing that happened is the move made with the other.

/** Every single-die move open to the player whose turn it is: which colour, piece and die. */
create or replace function private.ludo_plays(p_game public.ludo_games) returns table (color text, piece integer, die integer, progress integer, ord bigint)
language sql
immutable
set search_path = ''
as $$
  select c.color, m.piece, d.v, (p_game.positions -> c.color ->> m.piece)::integer, d.o
    from jsonb_array_elements_text(p_game.teams -> p_game.turn) as c (color),
         (select distinct on (x.v::integer) x.v::integer as v, x.o
            from jsonb_array_elements_text(p_game.dice) with ordinality as x (v, o)
           order by x.v::integer, x.o) d,
         unnest(private.ludo_movable(p_game.positions, c.color, d.v)) as m (piece)
   -- The piece that captured with the first die of this throw sits the second one out.
   where not (
           jsonb_array_length(p_game.dice) = 1
       and jsonb_array_length(p_game.rolled) = 2
       and coalesce((p_game.last_event ->> 'captured')::integer, 0) > 0
       and p_game.last_event ->> 'seat' = p_game.turn
       and p_game.last_event ? 'piece'
       and coalesce(p_game.last_event ->> 'color', p_game.turn) = c.color
       and (p_game.last_event ->> 'piece')::integer = m.piece
     );
$$;

/**
 * The single-die moves the player to move is allowed to make. With both dice still to play,
 * a move is allowed only if the other die can be played after it, whenever there is some way
 * of playing both (such a move, or the full count). After a capture, "can be played" means by
 * another piece. Otherwise it is every move there is.
 */
create or replace function private.ludo_legal(p_game public.ludo_games) returns table (color text, piece integer, die integer, progress integer, ord bigint)
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
  landed as (
    select pl.*, private.ludo_landing(p_game, pl.color, pl.piece, pl.die) as land
      from plays pl
  ),
  judged as (
    select l.color, l.piece, l.die, l.progress, l.ord, l.both,
           l.both and exists (
             select 1
               from jsonb_array_elements_text(p_game.teams -> p_game.turn) as c (color),
                    unnest(private.ludo_movable(l.land -> 'positions', c.color, l.other)) as m (piece)
              where not ((l.land ->> 'captured')::integer > 0 and c.color = l.color and m.piece = l.piece)
           ) as leaves_other_playable
      from landed l
  )
  select j.color, j.piece, j.die, j.progress, j.ord
    from judged j
   where not j.both
      or j.leaves_other_playable
      or not (exists (select 1 from judged x where x.leaves_other_playable) or exists (select 1 from private.ludo_fulls(p_game)));
$$;
