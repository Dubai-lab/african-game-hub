-- Two more ways into a game, for every game on the hub:
--
--   1. Challenges ("play a friend"): one player invites a friend, or anyone holding the link,
--      to a game with chosen options and an optional stake. Accepting starts a normal match:
--      both stakes go into escrow and are settled exactly as for a match found by matchmaking.
--
--   2. Tournaments (arena): open for a set time. Players join when they like, are paired again
--      and again while it runs, and score 2 points for a win and 1 for a draw. The creator may
--      put up a prize, taken from their wallet when the tournament is created and held until
--      it ends; the top three share it 50% / 30% / 20%. Joining is free.
--
-- Both are part of the shared core: nothing here knows any game's rules. A game takes part
-- simply by being a two-player game with the usual <game>_init_match hook.
--
-- Money rules kept:
--   - every token movement is a ledger entry (three new entry types, all tied to a tournament);
--   - a prize keeps its kind: bonus tokens put up as a prize are paid out as bonus tokens, cash
--     as cash, so a tournament can never turn free bonus tokens into withdrawable cash;
--   - a tournament is settled exactly once (the `settled` flag is the gate, as for matches);
--   - no rake is taken on a prize the creator put up, so nothing is created or lost.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  game_type text not null references public.game_types (id),
  name text not null check (char_length(name) between 3 and 60),
  created_by uuid not null references public.profiles (id) on delete restrict,
  options jsonb not null default '{}'::jsonb,
  rating_pool text not null default 'default' check (rating_pool ~ '^[a-z][a-z0-9_]{0,30}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  prize_amount bigint not null default 0 check (prize_amount >= 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'finished', 'cancelled')),
  settled boolean not null default false,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tournaments_ends_after_start check (ends_at > starts_at),
  constraint tournaments_settled_only_when_over check (not settled or status in ('finished', 'cancelled')),
  constraint tournaments_settled_at_set check (settled = (settled_at is not null))
);
create index tournaments_open_idx on public.tournaments (game_type, starts_at) where status in ('scheduled', 'running');
create index tournaments_creator_idx on public.tournaments (created_by, created_at desc);
alter table public.tournaments enable row level security;

create table public.tournament_players (
  tournament_id uuid not null references public.tournaments (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  -- 2 for a win, 1 for a draw.
  points integer not null default 0 check (points >= 0),
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  -- The last time this player's app said "I am here and free to be paired". Null: not waiting.
  ready_at timestamptz,
  last_opponent uuid references public.profiles (id),
  -- Set when the tournament is settled.
  place integer,
  prize bigint not null default 0 check (prize >= 0),
  joined_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create index tournament_players_user_idx on public.tournament_players (user_id, joined_at desc);
alter table public.tournament_players enable row level security;

-- A prize held while its tournament runs. Like escrow, it may be part bonus and part cash.
create table public.tournament_prizes (
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount bigint not null check (amount > 0),
  balance_type text not null check (balance_type in ('bonus', 'cash')),
  status text not null default 'held' check (status in ('held', 'paid_out', 'refunded')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (tournament_id, balance_type),
  constraint tournament_prizes_released_at_set check ((status = 'held') = (released_at is null))
);
alter table public.tournament_prizes enable row level security;

-- A game played inside a tournament says so.
alter table public.matches add column tournament_id uuid references public.tournaments (id) on delete restrict;
create index matches_tournament_idx on public.matches (tournament_id) where tournament_id is not null;

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  game_type text not null references public.game_types (id),
  from_user uuid not null references public.profiles (id) on delete restrict,
  -- Null: anyone who has the link may accept.
  to_user uuid references public.profiles (id) on delete restrict,
  stake_amount bigint not null check (stake_amount >= 0),
  options jsonb not null default '{}'::jsonb,
  rating_pool text not null default 'default' check (rating_pool ~ '^[a-z][a-z0-9_]{0,30}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  match_id uuid references public.matches (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  responded_at timestamptz,
  constraint challenges_not_to_self check (to_user is null or to_user <> from_user),
  constraint challenges_match_when_accepted check ((status = 'accepted') = (match_id is not null))
);
-- One open invitation per player at a time.
create unique index challenges_one_pending on public.challenges (from_user) where status = 'pending';
create index challenges_incoming_idx on public.challenges (to_user, created_at desc) where status = 'pending';
alter table public.challenges enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Access. Players read; only the server functions below write.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['tournaments', 'tournament_players', 'tournament_prizes', 'challenges'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

grant select on public.tournaments to authenticated;
create policy tournaments_select_all on public.tournaments for select to authenticated using (true);

grant select on public.tournament_players to authenticated;
create policy tournament_players_select_all on public.tournament_players for select to authenticated using (true);

grant select on public.tournament_prizes to authenticated;
create policy tournament_prizes_select_own on public.tournament_prizes for select to authenticated using (user_id = (select auth.uid()));

grant select on public.challenges to authenticated;
create policy challenges_select_involved on public.challenges for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()) or to_user is null);

-- ---------------------------------------------------------------------------------------------
-- The ledger learns about tournaments.
-- ---------------------------------------------------------------------------------------------
alter table public.ledger_entries add column tournament_id uuid references public.tournaments (id) on delete restrict;
create index ledger_entries_tournament_idx on public.ledger_entries (tournament_id) where tournament_id is not null;

alter table public.ledger_entries drop constraint ledger_entries_entry_type_check;
alter table public.ledger_entries add constraint ledger_entries_entry_type_check
  check (entry_type in ('signup_bonus', 'stake', 'stake_refund', 'win_payout', 'deposit', 'withdrawal', 'adjustment',
                        'tournament_prize', 'tournament_payout', 'tournament_refund'));

alter table public.ledger_entries drop constraint ledger_entries_sign;
alter table public.ledger_entries add constraint ledger_entries_sign check (
  case entry_type
    when 'stake' then amount < 0
    when 'withdrawal' then amount < 0
    when 'tournament_prize' then amount < 0
    when 'adjustment' then true
    else amount > 0
  end
);
alter table public.ledger_entries add constraint ledger_entries_tournament_ref
  check ((entry_type in ('tournament_prize', 'tournament_payout', 'tournament_refund')) = (tournament_id is not null));

/**
 * A token movement that belongs to a tournament. The same steps as private.apply_ledger_entry
 * (lock the wallet, change the balance, write the ledger row, all in the caller's transaction),
 * with the tournament recorded on the row.
 */
create function private.apply_tournament_entry(
  p_user_id uuid,
  p_amount bigint,
  p_balance_type text,
  p_entry_type text,
  p_tournament_id uuid
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_entry_id bigint;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'LEDGER_ZERO_AMOUNT' using errcode = 'AG002';
  end if;
  if p_balance_type is null or p_balance_type not in ('bonus', 'cash') or p_tournament_id is null
     or p_entry_type not in ('tournament_prize', 'tournament_payout', 'tournament_refund') then
    raise exception 'LEDGER_BAD_ARGUMENTS' using errcode = 'AG002';
  end if;

  select case p_balance_type when 'bonus' then w.bonus_balance else w.cash_balance end
    into v_balance
    from public.wallets w
   where w.user_id = p_user_id
     for update;
  if not found then
    raise exception 'WALLET_NOT_FOUND' using errcode = 'AG003';
  end if;

  v_balance := v_balance + p_amount;
  if v_balance < 0 then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'AG001';
  end if;

  perform set_config('agh.ledger_write', '1', true);
  update public.wallets w
     set bonus_balance = case when p_balance_type = 'bonus' then v_balance else w.bonus_balance end,
         cash_balance = case when p_balance_type = 'cash' then v_balance else w.cash_balance end,
         updated_at = now()
   where w.user_id = p_user_id;
  insert into public.ledger_entries (user_id, amount, balance_type, entry_type, tournament_id, balance_after)
  values (p_user_id, p_amount, p_balance_type, p_entry_type, p_tournament_id, v_balance)
  returning id into v_entry_id;
  perform set_config('agh.ledger_write', '', true);

  return v_entry_id;
end;
$$;
revoke all on function private.apply_tournament_entry(uuid, bigint, text, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Starting a game between two named players (a challenge accepted, or a tournament pairing).
-- The caller has already locked both players and checked that both are free and can pay.
-- ---------------------------------------------------------------------------------------------
create function private.start_match_between(
  p_game_type text,
  p_stake bigint,
  p_options jsonb,
  p_rating_pool text,
  p_a uuid,
  p_b uuid,
  p_tournament_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
  v_first uuid := p_a;
  v_second uuid := p_b;
begin
  -- Who goes first is the server's coin toss, from a secure source.
  if get_byte(uuid_send(gen_random_uuid()), 0) < 128 then
    v_first := p_b;
    v_second := p_a;
  end if;

  delete from public.match_queue q where q.user_id in (p_a, p_b);

  insert into public.matches (game_type, stake_amount, options, rating_pool, status, started_at, tournament_id)
  values (p_game_type, p_stake, p_options, p_rating_pool, 'active', now(), p_tournament_id)
  returning id into v_match;

  insert into public.match_players (match_id, user_id, seat, rating_before)
  select v_match, x.user_id, x.seat,
         coalesce((select r.rating from public.player_ratings r
                    where r.user_id = x.user_id and r.game_type = p_game_type and r.pool = p_rating_pool), 1200)
    from (values (v_first, '1'), (v_second, '2')) as x (user_id, seat);

  perform private.take_stake(v_match, p_a, p_stake);
  perform private.take_stake(v_match, p_b, p_stake);

  execute format('select private.%I($1, $2)', p_game_type || '_init_match') using v_match, p_options;
  return v_match;
end;
$$;
revoke all on function private.start_match_between(text, bigint, jsonb, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Challenges
-- ---------------------------------------------------------------------------------------------

/**
 * Invites a friend (by username), or anyone with the link (no username), to a game. Any earlier
 * invitation by this player that is still open is withdrawn. The Edge Function has already
 * checked the options with the game's adapter and says how many players the game needs.
 * Replies { status: 'pending', id } or { status: 'error', code }.
 */
create function public.challenge_create(
  p_user_id uuid,
  p_game_type text,
  p_to_username text,
  p_stake bigint,
  p_options jsonb,
  p_rating_pool text,
  p_players integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.game_types;
  v_to uuid;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('agh:user:' || p_user_id::text, 0));

  select * into v_game from public.game_types g where g.id = p_game_type;
  if v_game.id is null or v_game.status <> 'live' or p_players <> 2 then
    return jsonb_build_object('status', 'error', 'code', 'GAME_NOT_AVAILABLE');
  end if;
  if p_stake is null or not (p_stake = any (v_game.stake_levels)) then
    return jsonb_build_object('status', 'error', 'code', 'BAD_STAKE');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;
  if private.active_match_of(p_user_id) is not null then
    return jsonb_build_object('status', 'error', 'code', 'ALREADY_PLAYING');
  end if;
  if p_stake > 0 and private.wallet_total(p_user_id) < p_stake then
    return jsonb_build_object('status', 'error', 'code', 'INSUFFICIENT_BALANCE');
  end if;

  if p_to_username is not null then
    select p.id into v_to from public.profiles p where lower(p.username) = lower(p_to_username);
    -- Only friends can be invited by name; the same answer whether or not the name exists.
    if v_to is null or v_to = p_user_id or not private.are_friends(p_user_id, v_to) or private.is_blocked_pair(p_user_id, v_to) then
      return jsonb_build_object('status', 'error', 'code', 'NOT_A_FRIEND');
    end if;
  end if;

  update public.challenges c set status = 'cancelled', responded_at = now()
   where c.from_user = p_user_id and c.status = 'pending';

  insert into public.challenges (game_type, from_user, to_user, stake_amount, options, rating_pool)
  values (p_game_type, p_user_id, v_to, p_stake, p_options, p_rating_pool)
  returning id into v_id;
  return jsonb_build_object('status', 'pending', 'id', v_id);
end;
$$;

/**
 * 'accept', 'decline' or 'cancel' an invitation.
 * Replies { status: 'matched', match_id } | { status: 'declined' | 'cancelled' } | { status: 'error', code }.
 */
create function public.challenge_respond(p_user_id uuid, p_challenge_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.challenges;
  v_game public.game_types;
  v_who uuid;
  v_match uuid;
begin
  -- One answer at a time per invitation: two taps cannot start two games.
  perform pg_advisory_xact_lock(hashtextextended('agh:challenge:' || p_challenge_id::text, 0));
  select * into v_c from public.challenges c where c.id = p_challenge_id;
  if v_c.id is null then
    return jsonb_build_object('status', 'error', 'code', 'CHALLENGE_NOT_FOUND');
  end if;

  if v_c.status = 'accepted' then
    -- A repeated request from one of the two players gets the same answer as the first.
    if exists (select 1 from public.match_players mp where mp.match_id = v_c.match_id and mp.user_id = p_user_id) then
      return jsonb_build_object('status', 'matched', 'match_id', v_c.match_id);
    end if;
    return jsonb_build_object('status', 'error', 'code', 'CHALLENGE_CLOSED');
  end if;
  if v_c.status <> 'pending' then
    return jsonb_build_object('status', 'error', 'code', 'CHALLENGE_CLOSED');
  end if;

  if p_action = 'cancel' then
    if v_c.from_user <> p_user_id then
      return jsonb_build_object('status', 'error', 'code', 'NOT_ALLOWED');
    end if;
    update public.challenges c set status = 'cancelled', responded_at = now() where c.id = p_challenge_id;
    return jsonb_build_object('status', 'cancelled');
  end if;

  if p_action = 'decline' then
    if v_c.to_user is distinct from p_user_id then
      return jsonb_build_object('status', 'error', 'code', 'NOT_ALLOWED');
    end if;
    update public.challenges c set status = 'declined', responded_at = now() where c.id = p_challenge_id;
    return jsonb_build_object('status', 'declined');
  end if;

  if p_action <> 'accept' then
    return jsonb_build_object('status', 'error', 'code', 'BAD_REQUEST');
  end if;
  if v_c.from_user = p_user_id or (v_c.to_user is not null and v_c.to_user <> p_user_id) then
    return jsonb_build_object('status', 'error', 'code', 'NOT_ALLOWED');
  end if;
  if v_c.expires_at <= now() then
    update public.challenges c set status = 'cancelled', responded_at = now() where c.id = p_challenge_id;
    return jsonb_build_object('status', 'error', 'code', 'CHALLENGE_CLOSED');
  end if;

  -- From here on a game may start, so everything matchmaking checks is checked again.
  select * into v_game from public.game_types g where g.id = v_c.game_type;
  if v_game.status <> 'live' or not (v_c.stake_amount = any (v_game.stake_levels)) then
    return jsonb_build_object('status', 'error', 'code', 'GAME_NOT_AVAILABLE');
  end if;
  if private.is_blocked_pair(p_user_id, v_c.from_user) then
    return jsonb_build_object('status', 'error', 'code', 'CANNOT_CONTACT');
  end if;

  -- Both players' own locks, always in the same order (matchmaking takes these too).
  for v_who in select u from unnest(array[p_user_id, v_c.from_user]) u order by u::text loop
    perform pg_advisory_xact_lock(hashtextextended('agh:user:' || v_who::text, 0));
  end loop;

  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;
  if private.active_match_of(p_user_id) is not null then
    return jsonb_build_object('status', 'error', 'code', 'ALREADY_PLAYING');
  end if;
  if v_c.stake_amount > 0 and private.wallet_total(p_user_id) < v_c.stake_amount then
    return jsonb_build_object('status', 'error', 'code', 'INSUFFICIENT_BALANCE');
  end if;
  -- The player who invited may have moved on, been banned, or spent the stake since.
  if exists (select 1 from public.profile_private pp where pp.user_id = v_c.from_user and pp.is_banned)
     or private.active_match_of(v_c.from_user) is not null
     or (v_c.stake_amount > 0 and private.wallet_total(v_c.from_user) < v_c.stake_amount) then
    update public.challenges c set status = 'cancelled', responded_at = now() where c.id = p_challenge_id;
    return jsonb_build_object('status', 'error', 'code', 'OPPONENT_UNAVAILABLE');
  end if;

  v_match := private.start_match_between(v_c.game_type, v_c.stake_amount, v_c.options, v_c.rating_pool, v_c.from_user, p_user_id, null);
  update public.challenges c
     set status = 'accepted', match_id = v_match, to_user = p_user_id, responded_at = now()
   where c.id = p_challenge_id;
  return jsonb_build_object('status', 'matched', 'match_id', v_match);
end;
$$;

revoke all on function public.challenge_create(uuid, text, text, bigint, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.challenge_create(uuid, text, text, bigint, jsonb, text, integer) to service_role;
revoke all on function public.challenge_respond(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.challenge_respond(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Tournaments
-- ---------------------------------------------------------------------------------------------

/** Gives back a prize that was never won (tournament cancelled, or too few players). */
create function private.tournament_refund(p_tournament_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_held record;
begin
  for v_held in
    select p.id, p.user_id, p.amount, p.balance_type from public.tournament_prizes p
     where p.tournament_id = p_tournament_id and p.status = 'held' order by p.id
  loop
    perform private.apply_tournament_entry(v_held.user_id, v_held.amount, v_held.balance_type, 'tournament_refund', p_tournament_id);
  end loop;
  update public.tournament_prizes p set status = 'refunded', released_at = now()
   where p.tournament_id = p_tournament_id and p.status = 'held';
end;
$$;

/**
 * Ends a running tournament: fixes the final places and pays the prize. Returns false if it
 * was already settled (or is not running), so a retry can never pay twice.
 *
 * Places: most points, then most wins, then fewest games, then who joined first. Only players
 * who finished at least one game are placed. With fewer than two such players nobody has won
 * anything and the prize goes back to whoever put it up. Otherwise the top three share it
 * 50% / 30% / 20% (with only two placed, the third share goes to the winner); each kind of
 * token (bonus, cash) is split separately and the rounding always falls to first place, so
 * exactly what was held is paid out.
 */
create function private.tournament_settle(p_tournament_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
  v_placed integer;
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_held record;
  v_p2 bigint;
  v_p3 bigint;
begin
  -- The one gate: only the request that flips `settled` goes any further.
  update public.tournaments t
     set status = 'finished', settled = true, settled_at = now()
   where t.id = p_tournament_id and not t.settled and t.status = 'running'
  returning * into v_t;
  if not found then
    return false;
  end if;

  with ranked as (
    select tp.user_id, row_number() over (order by tp.points desc, tp.wins desc, tp.games asc, tp.joined_at asc, tp.user_id) as place
      from public.tournament_players tp
     where tp.tournament_id = p_tournament_id and tp.games > 0
  )
  update public.tournament_players tp set place = r.place
    from ranked r where tp.tournament_id = p_tournament_id and tp.user_id = r.user_id;

  select count(*) into v_placed from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.place is not null;
  if v_placed < 2 then
    perform private.tournament_refund(p_tournament_id);
    return true;
  end if;

  select tp.user_id into v_first from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.place = 1;
  select tp.user_id into v_second from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.place = 2;
  select tp.user_id into v_third from public.tournament_players tp where tp.tournament_id = p_tournament_id and tp.place = 3;

  for v_held in
    select p.id, p.amount, p.balance_type from public.tournament_prizes p
     where p.tournament_id = p_tournament_id and p.status = 'held' order by p.id
  loop
    v_p2 := (v_held.amount * 30) / 100;
    v_p3 := case when v_third is null then 0 else (v_held.amount * 20) / 100 end;
    -- First place takes what is left, so the three shares always add up to what was held.
    perform private.apply_tournament_entry(v_first, v_held.amount - v_p2 - v_p3, v_held.balance_type, 'tournament_payout', p_tournament_id);
    update public.tournament_players tp set prize = tp.prize + v_held.amount - v_p2 - v_p3
     where tp.tournament_id = p_tournament_id and tp.user_id = v_first;
    if v_p2 > 0 then
      perform private.apply_tournament_entry(v_second, v_p2, v_held.balance_type, 'tournament_payout', p_tournament_id);
      update public.tournament_players tp set prize = tp.prize + v_p2 where tp.tournament_id = p_tournament_id and tp.user_id = v_second;
    end if;
    if v_p3 > 0 then
      perform private.apply_tournament_entry(v_third, v_p3, v_held.balance_type, 'tournament_payout', p_tournament_id);
      update public.tournament_players tp set prize = tp.prize + v_p3 where tp.tournament_id = p_tournament_id and tp.user_id = v_third;
    end if;
  end loop;
  update public.tournament_prizes p set status = 'paid_out', released_at = now()
   where p.tournament_id = p_tournament_id and p.status = 'held';
  return true;
end;
$$;

/**
 * Moves a tournament on when its time has come: scheduled -> running at the start time, and
 * running -> finished (and settled) once the end time has passed and its last game is over.
 */
create function private.tournament_advance(p_tournament_id uuid) returns text
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
  end if;
  if v_t.status = 'running' and v_t.ends_at <= now()
     and not exists (select 1 from public.matches m where m.tournament_id = p_tournament_id and m.status in ('waiting', 'active')) then
    perform private.tournament_settle(p_tournament_id);
    return 'finished';
  end if;
  return v_t.status;
end;
$$;

/** Called every few seconds: starts and ends tournaments on time even when nobody is looking. */
create function private.tournaments_tick() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select t.id from public.tournaments t
     where (t.status = 'scheduled' and t.starts_at <= now()) or (t.status = 'running' and t.ends_at <= now())
  loop
    perform private.tournament_advance(v_id);
  end loop;
end;
$$;

/** The result of a tournament game goes onto both players' scores: 2 for a win, 1 for a draw. */
create function private.tournament_record(p_match_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches m where m.id = p_match_id;
  if v_match.tournament_id is null or v_match.result not in ('win', 'draw') then
    return;
  end if;
  update public.tournament_players tp
     set games = tp.games + 1,
         wins = tp.wins + (case when v_match.result = 'win' and tp.user_id = v_match.winner_id then 1 else 0 end),
         losses = tp.losses + (case when v_match.result = 'win' and tp.user_id <> v_match.winner_id then 1 else 0 end),
         draws = tp.draws + (case when v_match.result = 'draw' then 1 else 0 end),
         points = tp.points + (case when v_match.result = 'draw' then 1 when tp.user_id = v_match.winner_id then 2 else 0 end)
   where tp.tournament_id = v_match.tournament_id
     and tp.user_id in (select mp.user_id from public.match_players mp where mp.match_id = p_match_id);
end;
$$;

/**
 * Creates a tournament. The prize (if any) leaves the creator's wallet now, bonus tokens first,
 * and is held until the tournament is settled or cancelled.
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
  p_minutes integer,
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
  if p_minutes is null or p_minutes not in (15, 30, 45, 60, 90, 120) or v_starts > now() + interval '14 days' then
    return jsonb_build_object('status', 'error', 'code', 'BAD_TOURNAMENT_TIME');
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

  insert into public.tournaments (game_type, name, created_by, options, rating_pool, starts_at, ends_at, prize_amount)
  values (p_game_type, v_name, p_user_id, p_options, p_rating_pool, v_starts, v_starts + make_interval(mins => p_minutes), p_prize)
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

/** The creator calls a tournament off before it starts. The prize goes back in full. */
create function public.tournament_cancel(p_user_id uuid, p_tournament_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tournaments t
     set status = 'cancelled', settled = true, settled_at = now()
   where t.id = p_tournament_id and t.created_by = p_user_id and t.status = 'scheduled' and not t.settled and t.starts_at > now();
  if not found then
    return jsonb_build_object('status', 'error', 'code', 'TOURNAMENT_NOT_CANCELLABLE');
  end if;
  perform private.tournament_refund(p_tournament_id);
  return jsonb_build_object('status', 'cancelled');
end;
$$;

/** Enters a tournament that has not ended. Free; entering twice changes nothing. */
create function public.tournament_join(p_user_id uuid, p_tournament_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  v_status := private.tournament_advance(p_tournament_id);
  if v_status is null then
    return jsonb_build_object('status', 'error', 'code', 'TOURNAMENT_NOT_FOUND');
  end if;
  if v_status not in ('scheduled', 'running') then
    return jsonb_build_object('status', 'error', 'code', 'TOURNAMENT_OVER');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;
  insert into public.tournament_players (tournament_id, user_id) values (p_tournament_id, p_user_id)
  on conflict (tournament_id, user_id) do nothing;
  return jsonb_build_object('status', 'joined');
end;
$$;

/**
 * "I am here and free to play." Called every few seconds by a player's app while they wait in
 * a running tournament; `p_ready` false means they are stepping away. If another player is
 * waiting too, the two are paired there and then: closest on points, and not the opponent just
 * played unless there is nobody else.
 * Replies { status: 'scheduled' | 'waiting' | 'paused' | 'finished' | 'cancelled' }
 *      or { status: 'playing', match_id } or { status: 'error', code }.
 */
create function public.tournament_ready(p_user_id uuid, p_tournament_id uuid, p_ready boolean) returns jsonb
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
  -- Pairing in one tournament happens one request at a time.
  perform pg_advisory_xact_lock(hashtextextended('agh:tournament:' || p_tournament_id::text, 0));
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
    return jsonb_build_object('status', 'playing', 'match_id', v_active);
  end if;
  if v_status <> 'running' then
    return jsonb_build_object('status', v_status);
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

revoke all on function private.tournament_refund(uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournament_settle(uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournament_advance(uuid) from public, anon, authenticated, service_role;
revoke all on function private.tournaments_tick() from public, anon, authenticated, service_role;
revoke all on function private.tournament_record(uuid) from public, anon, authenticated, service_role;
revoke all on function public.tournament_create(uuid, text, text, jsonb, text, integer, timestamptz, integer, bigint) from public, anon, authenticated;
grant execute on function public.tournament_create(uuid, text, text, jsonb, text, integer, timestamptz, integer, bigint) to service_role;
revoke all on function public.tournament_cancel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tournament_cancel(uuid, uuid) to service_role;
revoke all on function public.tournament_join(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tournament_join(uuid, uuid) to service_role;
revoke all on function public.tournament_ready(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.tournament_ready(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Settlement of a match now also records a tournament game. (The rest is unchanged.)
-- ---------------------------------------------------------------------------------------------
create or replace function private.settle_match(p_match_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_settings public.platform_settings;
  v_pot bigint;
  v_pot_bonus bigint;
  v_rake bigint;
  v_payout bigint;
  v_payout_bonus bigint;
  v_payout_cash bigint;
  v_held record;
begin
  -- The one gate: only the request that flips `settled` goes any further.
  update public.matches m
     set settled = true, settled_at = now()
   where m.id = p_match_id and not m.settled and m.status in ('finished', 'aborted')
  returning * into v_match;
  if not found then
    return false;
  end if;

  select coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.balance_type = 'bonus'), 0)
    into v_pot, v_pot_bonus
    from public.escrow e where e.match_id = p_match_id and e.status = 'held';

  if v_match.result = 'win' and v_pot > 0 then
    select * into v_settings from public.platform_settings;
    -- Integer division rounds the rake down: no token is ever invented.
    v_rake := (v_pot * v_settings.rake_bps) / 10000;
    v_payout := v_pot - v_rake;

    v_payout_bonus := case v_settings.bonus_winnings_policy
      when 'cash' then 0
      when 'bonus_stake_returned' then least(v_payout, coalesce((
        select sum(e.amount) from public.escrow e
         where e.match_id = p_match_id and e.user_id = v_match.winner_id and e.balance_type = 'bonus' and e.status = 'held'), 0))
      else (v_payout * v_pot_bonus) / v_pot
    end;
    v_payout_cash := v_payout - v_payout_bonus;

    if v_payout_bonus > 0 then
      perform private.apply_ledger_entry(v_match.winner_id, v_payout_bonus, 'bonus', 'win_payout', p_match_id);
    end if;
    if v_payout_cash > 0 then
      perform private.apply_ledger_entry(v_match.winner_id, v_payout_cash, 'cash', 'win_payout', p_match_id);
    end if;

    update public.match_players mp
       set tokens_change = (case when mp.user_id = v_match.winner_id then v_payout else 0 end)
                           - coalesce((select sum(e.amount) from public.escrow e
                                        where e.match_id = p_match_id and e.user_id = mp.user_id and e.status = 'held'), 0)
     where mp.match_id = p_match_id;

    update public.escrow e set status = 'paid_out', released_at = now()
     where e.match_id = p_match_id and e.status = 'held';

    -- The primary key on match_id is a second lock on "rake is taken once".
    insert into public.platform_revenue (match_id, amount, cash_amount)
    values (p_match_id, v_rake, (v_pot - v_pot_bonus) - v_payout_cash);
  else
    -- Draw, abort, or nothing staked: everyone gets back exactly what they put in, where it came from.
    for v_held in
      select e.id, e.user_id, e.amount, e.balance_type from public.escrow e
       where e.match_id = p_match_id and e.status = 'held' order by e.id
    loop
      perform private.apply_ledger_entry(v_held.user_id, v_held.amount, v_held.balance_type, 'stake_refund', p_match_id);
    end loop;
    update public.escrow e set status = 'refunded', released_at = now()
     where e.match_id = p_match_id and e.status = 'held';
    update public.match_players mp set tokens_change = 0 where mp.match_id = p_match_id;
  end if;

  -- An aborted game never started, so it does not count toward anyone's rating.
  if v_match.result in ('win', 'draw') then
    perform private.update_ratings(p_match_id, v_match.game_type, v_match.rating_pool, v_match.winner_id);
  end if;

  -- A tournament game goes onto the tournament's scores, in this same transaction.
  if v_match.tournament_id is not null then
    perform private.tournament_record(p_match_id);
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The integrity check learns two more questions:
--   tournament_conservation : prizes taken, paid, refunded and still held do not add up to zero
--   tournament_prize_stuck  : a settled tournament still holds a prize
-- ---------------------------------------------------------------------------------------------
create or replace function public.verify_ledger_integrity()
returns table (check_name text, user_id uuid, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  with sums as (
    select l.user_id as uid,
           coalesce(sum(l.amount) filter (where l.balance_type = 'bonus'), 0) as bonus,
           coalesce(sum(l.amount) filter (where l.balance_type = 'cash'), 0) as cash
      from public.ledger_entries l
     group by l.user_id
  ),
  running as (
    select l.id, l.user_id as uid, l.balance_type, l.balance_after,
           sum(l.amount) over (partition by l.user_id, l.balance_type order by l.id) as expected
      from public.ledger_entries l
  ),
  flows as (
    select
      (select coalesce(sum(l.amount), 0) from public.ledger_entries l
        where l.entry_type in ('stake', 'stake_refund', 'win_payout')) as moved,
      (select coalesce(sum(e.amount), 0) from public.escrow e where e.status = 'held') as held,
      (select coalesce(sum(r.amount), 0) from public.platform_revenue r) as rake
  ),
  prizes as (
    select
      (select coalesce(sum(l.amount), 0) from public.ledger_entries l
        where l.entry_type in ('tournament_prize', 'tournament_payout', 'tournament_refund')) as moved,
      (select coalesce(sum(p.amount), 0) from public.tournament_prizes p where p.status = 'held') as held
  )
  select 'wallet_ledger_mismatch', w.user_id,
         format('wallet bonus=%s cash=%s but ledger bonus=%s cash=%s',
                w.bonus_balance, w.cash_balance, coalesce(s.bonus, 0), coalesce(s.cash, 0))
    from public.wallets w
    left join sums s on s.uid = w.user_id
   where w.bonus_balance <> coalesce(s.bonus, 0) or w.cash_balance <> coalesce(s.cash, 0)
  union all
  select 'ledger_without_wallet', s.uid, 'ledger entries exist but there is no wallet'
    from sums s
   where not exists (select 1 from public.wallets w where w.user_id = s.uid)
  union all
  select 'balance_after_mismatch', r.uid,
         format('entry %s (%s) has balance_after=%s, expected %s', r.id, r.balance_type, r.balance_after, r.expected)
    from running r
   where r.balance_after <> r.expected
  union all
  select 'escrow_conservation', null::uuid,
         format('stake flows=%s, held escrow=%s, rake=%s: these should add up to zero', f.moved, f.held, f.rake)
    from flows f
   where f.moved + f.held + f.rake <> 0
  union all
  select 'escrow_stuck_after_settlement', e.user_id,
         format('match %s is settled but still holds %s %s tokens', e.match_id, e.amount, e.balance_type)
    from public.escrow e
    join public.matches m on m.id = e.match_id
   where e.status = 'held' and m.settled
  union all
  select 'match_unsettled', null::uuid,
         format('match %s is %s but has not been settled', m.id, m.status)
    from public.matches m
   where not m.settled and m.status in ('finished', 'aborted') and m.finished_at < now() - interval '1 minute'
  union all
  select 'tournament_conservation', null::uuid,
         format('prize flows=%s, held prizes=%s: these should add up to zero', p.moved, p.held)
    from prizes p
   where p.moved + p.held <> 0
  union all
  select 'tournament_prize_stuck', tp.user_id,
         format('tournament %s is settled but still holds %s %s tokens', tp.tournament_id, tp.amount, tp.balance_type)
    from public.tournament_prizes tp
    join public.tournaments t on t.id = tp.tournament_id
   where tp.status = 'held' and t.settled;
$$;

-- ---------------------------------------------------------------------------------------------
-- Background job: tournaments start and end on time even when nobody has the page open.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('agh-tournaments', '10 seconds', 'select private.tournaments_tick()');
  end if;
end;
$$;
