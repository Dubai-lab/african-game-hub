-- Tournaments grow in three ways.
--
--   1. A second kind of tournament: BY ROUNDS (Swiss). A fixed number of rounds, however many
--      players enter. Everyone plays each round; the next round starts only when every game of
--      the round is over; the system pairs players (most points first, then closest rating, and
--      nobody meets the same opponent twice while there is someone else to meet). Entry closes
--      when round 1 starts. A player who is not there when paired loses that game and is taken
--      out of the rounds that follow.
--      The first kind (BY TIME, the arena) is unchanged, except that the app now asks for the
--      next game only when the player presses Next.
--
--   2. Watching. Any signed-in player may watch a tournament game while it is being played.
--      Ordinary matches stay private to their players until they are over, as before.
--
--   3. Chat. Players in a tournament (and its creator) can talk in the tournament's own chat.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
alter table public.tournaments
  add column format text not null default 'arena' check (format in ('arena', 'rounds')),
  add column rounds integer check (rounds is null or rounds between 1 and 20),
  add column current_round integer not null default 0 check (current_round >= 0),
  add column round_started_at timestamptz,
  add constraint tournaments_rounds_for_format check ((format = 'rounds') = (rounds is not null));

alter table public.tournament_players
  -- The last time this player's app was heard from, anywhere in the app. (ready_at, for the
  -- arena, says more: "pair me now".)
  add column seen_at timestamptz,
  -- By rounds: taken out of the rounds that follow, after not turning up for a game.
  add column dropped boolean not null default false,
  add column had_bye boolean not null default false;

alter table public.matches add column tournament_round integer;

-- By rounds: who plays whom in each round. A pairing exists before its game does (the game
-- starts when both players are there), and says how it ended.
create table public.tournament_pairings (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments (id) on delete restrict,
  round integer not null check (round >= 1),
  player_a uuid not null references public.profiles (id) on delete restrict,
  -- Null: player_a has no opponent this round (an odd number of players) and is given the win.
  player_b uuid references public.profiles (id) on delete restrict,
  match_id uuid references public.matches (id) on delete set null,
  -- played: the game was played. forfeit_a / forfeit_b: that player did not turn up.
  -- double_forfeit: neither did. bye: no opponent. void: the game was called off before it began.
  result text check (result in ('played', 'forfeit_a', 'forfeit_b', 'double_forfeit', 'bye', 'void')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint tournament_pairings_not_self check (player_b is null or player_b <> player_a)
);
create index tournament_pairings_round_idx on public.tournament_pairings (tournament_id, round);
create index tournament_pairings_match_idx on public.tournament_pairings (match_id) where match_id is not null;
alter table public.tournament_pairings enable row level security;

create table public.tournament_messages (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments (id) on delete restrict,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index tournament_messages_idx on public.tournament_messages (tournament_id, id desc);
alter table public.tournament_messages enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['tournament_pairings', 'tournament_messages'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;
create policy tournament_pairings_select_all on public.tournament_pairings for select to authenticated using (true);
create policy tournament_messages_select_all on public.tournament_messages for select to authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- Watching: a tournament game can be read by any signed-in player while it is being played.
-- (These are added to the existing rules; a policy can only open access, never close it.)
-- ---------------------------------------------------------------------------------------------
create function private.is_tournament_match(p_match_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.matches m where m.id = p_match_id and m.tournament_id is not null);
$$;
revoke all on function private.is_tournament_match(uuid) from public, anon;
grant execute on function private.is_tournament_match(uuid) to authenticated, service_role;

create policy matches_select_tournament on public.matches for select to authenticated using (tournament_id is not null);
create policy match_players_select_tournament on public.match_players for select to authenticated using (private.is_tournament_match(match_id));
do $$
declare
  t text;
begin
  -- Every game's own state and move tables.
  foreach t in array array['chess_games', 'chess_moves', 'ludo_games', 'ludo_moves', 'pool_games', 'pool_shots'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_tournament_match(match_id))', t || '_select_tournament', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- By rounds: pairing
-- ---------------------------------------------------------------------------------------------

/**
 * Starts the next round: fixes who plays whom. Players are taken in order of points, then
 * rating, and each is paired with the next one down they have not yet met (or, when they have
 * met everyone left, simply the next one down). With an odd number, the lowest player who has
 * not had one gets a bye: no game, and the points of a win. Games themselves start in
 * tournament_round_progress, as the players turn up.
 */
create function private.tournament_start_round(p_tournament_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_round integer;
  v_ids uuid[];
  v_n integer;
  v_used boolean[];
  v_bye uuid;
  v_pick integer;
  i integer;
  j integer;
begin
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  v_round := v_t.current_round + 1;
  update public.tournaments t set current_round = v_round, round_started_at = now() where t.id = p_tournament_id;

  select array_agg(s.user_id order by s.points desc, s.rating desc, s.user_id)
    into v_ids
    from (
      select tp.user_id, tp.points, coalesce(r.rating, 1200) as rating
        from public.tournament_players tp
        left join public.player_ratings r on r.user_id = tp.user_id and r.game_type = v_t.game_type and r.pool = v_t.rating_pool
       where tp.tournament_id = p_tournament_id and not tp.dropped
    ) s;
  v_n := coalesce(array_length(v_ids, 1), 0);

  if v_n % 2 = 1 then
    -- From the bottom up: the first player who has not had a bye yet (or, failing that, the last).
    select u into v_bye
      from unnest(v_ids) with ordinality as x (u, ord)
      join public.tournament_players tp on tp.tournament_id = p_tournament_id and tp.user_id = x.u
     order by tp.had_bye, x.ord desc
     limit 1;
    v_ids := array_remove(v_ids, v_bye);
    v_n := v_n - 1;
    insert into public.tournament_pairings (tournament_id, round, player_a, player_b, result, resolved_at)
    values (p_tournament_id, v_round, v_bye, null, 'bye', now());
    update public.tournament_players tp
       set points = tp.points + 2, wins = tp.wins + 1, games = tp.games + 1, had_bye = true
     where tp.tournament_id = p_tournament_id and tp.user_id = v_bye;
  end if;
  if v_n = 0 then
    return;
  end if;

  v_used := array_fill(false, array[v_n]);
  for i in 1 .. v_n loop
    continue when v_used[i];
    v_pick := null;
    for j in i + 1 .. v_n loop
      if not v_used[j] and not exists (
        select 1 from public.tournament_pairings p
         where p.tournament_id = p_tournament_id
           and ((p.player_a = v_ids[i] and p.player_b = v_ids[j]) or (p.player_a = v_ids[j] and p.player_b = v_ids[i]))) then
        v_pick := j;
        exit;
      end if;
    end loop;
    if v_pick is null then
      for j in i + 1 .. v_n loop
        if not v_used[j] then
          v_pick := j;
          exit;
        end if;
      end loop;
    end if;
    v_used[i] := true;
    v_used[v_pick] := true;
    insert into public.tournament_pairings (tournament_id, round, player_a, player_b)
    values (p_tournament_id, v_round, v_ids[i], v_ids[v_pick]);
  end loop;
end;
$$;

/**
 * Moves the current round along. A pairing whose two players are both here (heard from in the
 * last 20 seconds, and not in some other game) has its game started. A pairing still without a
 * game a minute after the round began is decided without one: the player who is here gets the
 * win, and whoever is not is dropped from the rounds that follow. When every pairing of the
 * round has ended, the next round starts, or, after the last round (or when fewer than two
 * players are left), the tournament is settled.
 */
create function private.tournament_round_progress(p_tournament_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_p public.tournament_pairings;
  v_a_here boolean;
  v_b_here boolean;
  v_who uuid;
  v_match uuid;
begin
  select * into v_t from public.tournaments t where t.id = p_tournament_id;

  for v_p in
    select * from public.tournament_pairings p
     where p.tournament_id = p_tournament_id and p.round = v_t.current_round and p.result is null and p.match_id is null
     order by p.id
  loop
    -- Both players' own locks, always in the same order (matchmaking takes these too).
    for v_who in select u from unnest(array[v_p.player_a, v_p.player_b]) u order by u::text loop
      perform pg_advisory_xact_lock(hashtextextended('agh:user:' || v_who::text, 0));
    end loop;
    select coalesce(tp.seen_at > now() - interval '20 seconds', false) and private.active_match_of(tp.user_id) is null
           and not exists (select 1 from public.profile_private pp where pp.user_id = tp.user_id and pp.is_banned)
      into v_a_here from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.user_id = v_p.player_a;
    select coalesce(tp.seen_at > now() - interval '20 seconds', false) and private.active_match_of(tp.user_id) is null
           and not exists (select 1 from public.profile_private pp where pp.user_id = tp.user_id and pp.is_banned)
      into v_b_here from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.user_id = v_p.player_b;

    if v_a_here and v_b_here then
      v_match := private.start_match_between(v_t.game_type, 0, v_t.options, v_t.rating_pool, v_p.player_a, v_p.player_b, p_tournament_id);
      update public.matches m set tournament_round = v_t.current_round where m.id = v_match;
      update public.tournament_pairings p set match_id = v_match where p.id = v_p.id;
      update public.tournament_players tp
         set last_opponent = case when tp.user_id = v_p.player_a then v_p.player_b else v_p.player_a end
       where tp.tournament_id = p_tournament_id and tp.user_id in (v_p.player_a, v_p.player_b);
    elsif v_t.round_started_at < now() - interval '60 seconds' then
      update public.tournament_pairings p
         set result = case when v_a_here then 'forfeit_b' when v_b_here then 'forfeit_a' else 'double_forfeit' end, resolved_at = now()
       where p.id = v_p.id;
      -- Whoever is here takes the win; whoever is not takes the loss and plays no further round.
      update public.tournament_players tp
         set games = tp.games + 1,
             wins = tp.wins + (case when (tp.user_id = v_p.player_a and v_a_here) or (tp.user_id = v_p.player_b and v_b_here) then 1 else 0 end),
             points = tp.points + (case when (tp.user_id = v_p.player_a and v_a_here) or (tp.user_id = v_p.player_b and v_b_here) then 2 else 0 end),
             losses = tp.losses + (case when (tp.user_id = v_p.player_a and not v_a_here) or (tp.user_id = v_p.player_b and not v_b_here) then 1 else 0 end),
             dropped = tp.dropped or (tp.user_id = v_p.player_a and not v_a_here) or (tp.user_id = v_p.player_b and not v_b_here)
       where tp.tournament_id = p_tournament_id and tp.user_id in (v_p.player_a, v_p.player_b);
    end if;
  end loop;

  if exists (select 1 from public.tournament_pairings p where p.tournament_id = p_tournament_id and p.round = v_t.current_round and p.result is null) then
    return;
  end if;
  if v_t.current_round >= v_t.rounds
     or (select count(*) from public.tournament_players tp where tp.tournament_id = p_tournament_id and not tp.dropped) < 2 then
    perform private.tournament_settle(p_tournament_id);
  else
    perform private.tournament_start_round(p_tournament_id);
  end if;
end;
$$;

revoke all on function private.tournament_start_round(uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournament_round_progress(uuid) from public, anon, authenticated, service_role;

/** The result of a tournament game goes onto both players' scores: 2 for a win, 1 for a draw. */
create or replace function private.tournament_record(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches m where m.id = p_match_id;
  if v_match.tournament_id is null then
    return;
  end if;
  if v_match.result in ('win', 'draw') then
    update public.tournament_players tp
       set games = tp.games + 1,
           wins = tp.wins + (case when v_match.result = 'win' and tp.user_id = v_match.winner_id then 1 else 0 end),
           losses = tp.losses + (case when v_match.result = 'win' and tp.user_id <> v_match.winner_id then 1 else 0 end),
           draws = tp.draws + (case when v_match.result = 'draw' then 1 else 0 end),
           points = tp.points + (case when v_match.result = 'draw' then 1 when tp.user_id = v_match.winner_id then 2 else 0 end)
     where tp.tournament_id = v_match.tournament_id
       and tp.user_id in (select mp.user_id from public.match_players mp where mp.match_id = p_match_id);
  end if;
  -- By rounds: the pairing this game belonged to is over. A game called off before it really
  -- began scores nothing for either player, and the round moves on without it.
  update public.tournament_pairings p
     set result = case when v_match.result in ('win', 'draw') then 'played' else 'void' end, resolved_at = now()
   where p.match_id = p_match_id and p.result is null;
end;
$$;

/**
 * Moves a tournament on when its time has come.
 *   scheduled -> running at the start time (by rounds: round 1 is paired; with fewer than two
 *                players there is no tournament and any prize goes back);
 *   by time:   running -> finished once the end time has passed and its last game is over;
 *   by rounds: games are started and rounds follow one another (tournament_round_progress).
 */
create or replace function private.tournament_advance(p_tournament_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
begin
  select * into v_t from public.tournaments t where t.id = p_tournament_id for update;
  if v_t.id is null then
    return null;
  end if;
  if v_t.status = 'scheduled' and v_t.starts_at <= now() then
    update public.tournaments t set status = 'running' where t.id = p_tournament_id;
    v_t.status := 'running';
    if v_t.format = 'rounds' then
      if (select count(*) from public.tournament_players tp where tp.tournament_id = p_tournament_id) < 2 then
        perform private.tournament_settle(p_tournament_id);
        return 'finished';
      end if;
      perform private.tournament_start_round(p_tournament_id);
    end if;
  end if;
  if v_t.status = 'running' and v_t.format = 'rounds' then
    perform private.tournament_round_progress(p_tournament_id);
    return (select t.status from public.tournaments t where t.id = p_tournament_id);
  end if;
  if v_t.status = 'running' and v_t.ends_at <= now()
     and not exists (select 1 from public.matches m where m.tournament_id = p_tournament_id and m.status in ('waiting', 'active')) then
    perform private.tournament_settle(p_tournament_id);
    return 'finished';
  end if;
  return v_t.status;
end;
$$;

/** Called every few seconds: tournaments start, pair, move from round to round and end on time. */
create or replace function private.tournaments_tick() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select t.id from public.tournaments t
     where (t.status = 'scheduled' and t.starts_at <= now())
        or (t.status = 'running' and (t.format = 'rounds' or t.ends_at <= now()))
  loop
    perform private.tournament_advance(v_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Creating, joining, and "I am here"
-- ---------------------------------------------------------------------------------------------
drop function public.tournament_create(uuid, text, text, jsonb, text, integer, timestamptz, integer, bigint);

/**
 * Creates a tournament, by time (`p_format` 'arena', lasting `p_minutes`) or by rounds
 * ('rounds', `p_rounds` of them). The prize (if any) leaves the creator's wallet now, bonus
 * tokens first, and is held until the tournament is settled or cancelled.
 * Replies { status: 'created', id } or { status: 'error', code }.
 */
create function public.tournament_create(
  p_user_id uuid,
  p_game_type text,
  p_name text,
  p_options jsonb,
  p_rating_pool text,
  p_players integer,
  p_starts_at timestamptz,
  p_format text,
  p_minutes integer,
  p_rounds integer,
  p_prize bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.game_types;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_starts timestamptz := greatest(coalesce(p_starts_at, now()), now());
  v_ends timestamptz;
  v_id uuid;
  v_bonus bigint;
  v_cash bigint;
  v_from_bonus bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('agh:user:' || p_user_id::text, 0));

  select * into v_game from public.game_types g where g.id = p_game_type;
  if v_game.id is null or v_game.status <> 'live' or p_players <> 2 then
    return jsonb_build_object('status', 'error', 'code', 'GAME_NOT_AVAILABLE');
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 60 then
    return jsonb_build_object('status', 'error', 'code', 'BAD_TOURNAMENT_NAME');
  end if;
  if v_starts > now() + interval '14 days' or p_format is null or p_format not in ('arena', 'rounds') then
    return jsonb_build_object('status', 'error', 'code', 'BAD_TOURNAMENT_TIME');
  end if;
  if p_format = 'arena' then
    if p_minutes is null or p_minutes not in (15, 30, 45, 60, 90, 120) then
      return jsonb_build_object('status', 'error', 'code', 'BAD_TOURNAMENT_TIME');
    end if;
    v_ends := v_starts + make_interval(mins => p_minutes);
  else
    if p_rounds is null or p_rounds not in (3, 5, 7, 9) then
      return jsonb_build_object('status', 'error', 'code', 'BAD_TOURNAMENT_TIME');
    end if;
    -- A rounds tournament ends when its last round does; this is only an outer limit.
    v_ends := v_starts + interval '1 day';
  end if;
  if p_prize is null or p_prize < 0 or p_prize > 10000000 then
    return jsonb_build_object('status', 'error', 'code', 'BAD_PRIZE');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;
  -- A player runs a few tournaments at a time, not hundreds.
  if (select count(*) from public.tournaments t where t.created_by = p_user_id and t.status in ('scheduled', 'running')) >= 3 then
    return jsonb_build_object('status', 'error', 'code', 'TOO_MANY_TOURNAMENTS');
  end if;

  insert into public.tournaments (game_type, name, created_by, options, rating_pool, starts_at, ends_at, prize_amount, format, rounds)
  values (p_game_type, v_name, p_user_id, p_options, p_rating_pool, v_starts, v_ends, p_prize, p_format, case when p_format = 'rounds' then p_rounds end)
  returning id into v_id;

  if p_prize > 0 then
    select w.bonus_balance, w.cash_balance into v_bonus, v_cash from public.wallets w where w.user_id = p_user_id for update;
    if not found or v_bonus + v_cash < p_prize then
      -- Raising undoes the tournament row as well.
      raise exception 'INSUFFICIENT_BALANCE' using errcode = 'AG001';
    end if;
    v_from_bonus := least(v_bonus, p_prize);
    if v_from_bonus > 0 then
      perform private.apply_tournament_entry(p_user_id, -v_from_bonus, 'bonus', 'tournament_prize', v_id);
      insert into public.tournament_prizes (tournament_id, user_id, amount, balance_type) values (v_id, p_user_id, v_from_bonus, 'bonus');
    end if;
    if p_prize - v_from_bonus > 0 then
      perform private.apply_tournament_entry(p_user_id, -(p_prize - v_from_bonus), 'cash', 'tournament_prize', v_id);
      insert into public.tournament_prizes (tournament_id, user_id, amount, balance_type) values (v_id, p_user_id, p_prize - v_from_bonus, 'cash');
    end if;
  end if;

  return jsonb_build_object('status', 'created', 'id', v_id);
exception
  when sqlstate 'AG001' then
    return jsonb_build_object('status', 'error', 'code', 'INSUFFICIENT_BALANCE');
end;
$$;
revoke all on function public.tournament_create(uuid, text, text, jsonb, text, integer, timestamptz, text, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.tournament_create(uuid, text, text, jsonb, text, integer, timestamptz, text, integer, integer, bigint) to service_role;

/** Enters a tournament. By time: any time before it ends. By rounds: only before round 1. Free. */
create or replace function public.tournament_join(p_user_id uuid, p_tournament_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_format text;
begin
  v_status := private.tournament_advance(p_tournament_id);
  if v_status is null then
    return jsonb_build_object('status', 'error', 'code', 'TOURNAMENT_NOT_FOUND');
  end if;
  if v_status not in ('scheduled', 'running') then
    return jsonb_build_object('status', 'error', 'code', 'TOURNAMENT_OVER');
  end if;
  select t.format into v_format from public.tournaments t where t.id = p_tournament_id;
  if v_format = 'rounds' and v_status <> 'scheduled'
     and not exists (select 1 from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.user_id = p_user_id) then
    return jsonb_build_object('status', 'error', 'code', 'TOURNAMENT_STARTED');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;
  insert into public.tournament_players (tournament_id, user_id, seen_at) values (p_tournament_id, p_user_id, now())
  on conflict (tournament_id, user_id) do nothing;
  return jsonb_build_object('status', 'joined');
end;
$$;

/**
 * "I am here." Called every few seconds by a player's app, wherever they are in the app, while
 * they are in a tournament that has not ended. It is how the server knows who can be given a
 * game. By time, `p_ready` true also means "find me my next game now": if another player is
 * asking too, the two are paired there and then (closest on points, and not the opponent just
 * played unless there is nobody else). By rounds the system pairs; nobody asks.
 * Replies { status: 'scheduled' | 'waiting' | 'paused' | 'dropped' | 'finished' | 'cancelled' }
 *      or { status: 'playing', match_id }   (a game of this tournament is under way)
 *      or { status: 'busy' }                (the player is in some other game)
 *      or { status: 'error', code }.
 */
create or replace function public.tournament_ready(p_user_id uuid, p_tournament_id uuid, p_ready boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_t public.tournaments;
  v_me public.tournament_players;
  v_active uuid;
  v_other uuid;
  v_who uuid;
  v_match uuid;
begin
  -- One request at a time per tournament.
  perform pg_advisory_xact_lock(hashtextextended('agh:tournament:' || p_tournament_id::text, 0));
  -- Heard from: recorded before the round is moved along, so that this very call can start the player's game.
  update public.tournament_players tp set seen_at = now() where tp.tournament_id = p_tournament_id and tp.user_id = p_user_id;
  v_status := private.tournament_advance(p_tournament_id);
  if v_status is null then
    return jsonb_build_object('status', 'error', 'code', 'TOURNAMENT_NOT_FOUND');
  end if;
  select * into v_t from public.tournaments t where t.id = p_tournament_id;
  select * into v_me from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.user_id = p_user_id;
  if v_me.user_id is null then
    return jsonb_build_object('status', 'error', 'code', 'NOT_JOINED');
  end if;

  -- A game already under way comes first, whatever else is true.
  v_active := private.active_match_of(p_user_id);
  if v_active is not null then
    update public.tournament_players tp set ready_at = null where tp.tournament_id = p_tournament_id and tp.user_id = p_user_id;
    if exists (select 1 from public.matches m where m.id = v_active and m.tournament_id = p_tournament_id) then
      return jsonb_build_object('status', 'playing', 'match_id', v_active);
    end if;
    return jsonb_build_object('status', 'busy');
  end if;
  if v_status <> 'running' then
    return jsonb_build_object('status', v_status);
  end if;

  if v_t.format = 'rounds' then
    return jsonb_build_object('status', case when v_me.dropped then 'dropped' else 'waiting' end);
  end if;

  if not p_ready then
    update public.tournament_players tp set ready_at = null where tp.tournament_id = p_tournament_id and tp.user_id = p_user_id;
    return jsonb_build_object('status', 'paused');
  end if;
  -- No new games once the time is up; the tournament ends when the last game does.
  if v_t.ends_at <= now() then
    return jsonb_build_object('status', 'waiting');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;

  update public.tournament_players tp set ready_at = now() where tp.tournament_id = p_tournament_id and tp.user_id = p_user_id;

  select tp.user_id into v_other
    from public.tournament_players tp
   where tp.tournament_id = p_tournament_id
     and tp.user_id <> p_user_id
     and tp.ready_at > now() - interval '25 seconds'
     and private.active_match_of(tp.user_id) is null
     and not private.is_blocked_pair(p_user_id, tp.user_id)
     and not exists (select 1 from public.profile_private pp where pp.user_id = tp.user_id and pp.is_banned)
   order by (tp.user_id is not distinct from v_me.last_opponent)::int, abs(tp.points - v_me.points), tp.ready_at
   limit 1;
  if v_other is null then
    return jsonb_build_object('status', 'waiting');
  end if;

  -- Both players' own locks, always in the same order (matchmaking takes these too).
  for v_who in select u from unnest(array[p_user_id, v_other]) u order by u::text loop
    perform pg_advisory_xact_lock(hashtextextended('agh:user:' || v_who::text, 0));
  end loop;
  if private.active_match_of(p_user_id) is not null or private.active_match_of(v_other) is not null then
    return jsonb_build_object('status', 'waiting');
  end if;

  v_match := private.start_match_between(v_t.game_type, 0, v_t.options, v_t.rating_pool, p_user_id, v_other, p_tournament_id);
  update public.tournament_players tp
     set ready_at = null, last_opponent = case when tp.user_id = p_user_id then v_other else p_user_id end
   where tp.tournament_id = p_tournament_id and tp.user_id in (p_user_id, v_other);
  return jsonb_build_object('status', 'playing', 'match_id', v_match);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------------------------

/**
 * Says something in a tournament's chat, as the signed-in player. Only its players and its
 * creator may write; anyone signed in may read. One message every two seconds at most.
 */
create function public.send_tournament_message(p_tournament_id uuid, p_body text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  v_id bigint;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not exists (select 1 from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.user_id = v_me)
     and not exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.created_by = v_me) then
    return jsonb_build_object('ok', false, 'code', 'NOT_JOINED');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = v_me and pp.is_banned) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;
  -- While it is on, and for an hour afterwards.
  if not exists (
    select 1 from public.tournaments t
     where t.id = p_tournament_id and (t.status in ('scheduled', 'running') or t.settled_at > now() - interval '1 hour')) then
    return jsonb_build_object('ok', false, 'code', 'CHAT_CLOSED');
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 300 then
    return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
  end if;
  if exists (
    select 1 from public.tournament_messages m
     where m.tournament_id = p_tournament_id and m.sender_id = v_me and m.created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'code', 'TOO_FAST');
  end if;
  insert into public.tournament_messages (tournament_id, sender_id, body) values (p_tournament_id, v_me, v_body) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.send_tournament_message(uuid, text) from public, anon;
grant execute on function public.send_tournament_message(uuid, text) to authenticated, service_role;
