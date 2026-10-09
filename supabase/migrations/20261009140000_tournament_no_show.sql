-- Tournaments: a player who never makes their first move loses the game.
--
-- Until now a game that nobody started was called off whatever kind of game it was, and in a
-- tournament that meant it counted for nothing: the player who was there and waiting got no
-- points for it. In a tournament game it is now a loss for the player who did not move, and a
-- win for the opponent ("no_show").
--
-- Outside tournaments nothing changes: a game nobody starts is still called off, with no
-- result, and any stakes go back in full.
--
-- How it works: every game already reports such a game to the core as
-- finish_match(..., 'aborted', null, 'no_first_move'). The core now asks the game one question,
-- "whose move was it?" (private.<game>_to_move), and, in a two-player tournament game, records a
-- win for the other player instead. A game that has no such function is called off as before.

create function private.chess_to_move(p_match_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.chess_player_of(p_match_id, g.turn) from public.chess_games g where g.match_id = p_match_id;
$$;

create function private.draughts_to_move(p_match_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.draughts_player_of(p_match_id, g.turn) from public.draughts_games g where g.match_id = p_match_id;
$$;

-- Pool and Ludo name the turn by seat, as the players are seated.
create function private.pool_to_move(p_match_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.user_id from public.pool_games g join public.match_players mp on mp.match_id = g.match_id and mp.seat = g.turn where g.match_id = p_match_id;
$$;

create function private.ludo_to_move(p_match_id uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.user_id from public.ludo_games g join public.match_players mp on mp.match_id = g.match_id and mp.seat = g.turn where g.match_id = p_match_id;
$$;

revoke all on function private.chess_to_move(uuid) from public, anon, authenticated, service_role;
revoke all on function private.draughts_to_move(uuid) from public, anon, authenticated, service_role;
revoke all on function private.pool_to_move(uuid) from public, anon, authenticated, service_role;
revoke all on function private.ludo_to_move(uuid) from public, anon, authenticated, service_role;

-- Recording a result and settling it are one transaction: either both happen or neither does.
create or replace function private.finish_match(
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
  v_result text := p_result;
  v_winner uuid := p_winner_id;
  v_reason text := p_end_reason;
  v_match public.matches;
  v_absent uuid;
  v_present uuid;
begin
  -- A tournament game that one player never started: that player loses it.
  if p_result = 'aborted' and p_end_reason = 'no_first_move' then
    select * into v_match from public.matches m where m.id = p_match_id and m.status in ('waiting', 'active') for update;
    if found
       and v_match.tournament_id is not null
       and (select count(*) from public.match_players mp where mp.match_id = p_match_id) = 2
       and to_regprocedure(format('private.%I(uuid)', v_match.game_type || '_to_move')) is not null then
      execute format('select private.%I($1)', v_match.game_type || '_to_move') into v_absent using p_match_id;
      select mp.user_id into v_present from public.match_players mp where mp.match_id = p_match_id and mp.user_id is distinct from v_absent;
      if v_absent is not null and v_present is not null then
        v_result := 'win';
        v_winner := v_present;
        v_reason := 'no_show';
      end if;
    end if;
  end if;

  update public.matches m
     set status = case when v_result = 'aborted' then 'aborted' else 'finished' end,
         result = v_result,
         winner_id = case when v_result = 'win' then v_winner end,
         end_reason = v_reason,
         finished_at = now()
   where m.id = p_match_id and m.status in ('waiting', 'active')
  returning m.game_type into v_game_type;

  if not found then
    return false;
  end if;

  execute format('select private.%I($1)', v_game_type || '_on_finish') using p_match_id;
  perform private.settle_match(p_match_id);
  return true;
end;
$$;
