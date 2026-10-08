-- Staking through the shared core: escrow when a match is made, settlement when it ends
-- (payout, rake, refunds, ratings). Nothing in here knows about chess; it works unchanged for
-- any game that reports a result through private.finish_match().
--
-- The money rules, all enforced here:
--   * Stakes leave both wallets and enter escrow in the same transaction that creates the match.
--     If either player cannot pay, no match is made and no token moves.
--   * Bonus tokens are spent before cash.
--   * A result is settled in the same transaction that records it, exactly once.
--   * Win: the winner receives the pot less the rake (rounded down). Draw or abort: every
--     player gets their own stake back, to the balance it came from, with no rake.
--   * Winnings funded by bonus tokens stay bonus tokens (platform_settings.bonus_winnings_policy),
--     so free tokens cannot be turned into cash by two accounts losing to each other.

-- Decided with the owner: no rake on draws. A setting nobody implements is a trap, so it goes.
alter table public.platform_settings drop column rake_on_draws;

-- Rake taken in bonus tokens is not income; only the cash-funded part is. Kept separately so
-- revenue reports are honest. (It can be negative under the 'cash' winnings policy, where the
-- platform pays cash for bonus-funded winnings.)
alter table public.platform_revenue add column cash_amount bigint not null default 0;

-- ---------------------------------------------------------------------------------------------
-- Escrow
-- ---------------------------------------------------------------------------------------------

/** Moves a player's stake from their wallet into escrow for a match. Bonus first, then cash. */
create function private.take_stake(p_match_id uuid, p_user_id uuid, p_amount bigint) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bonus bigint;
  v_cash bigint;
  v_from_bonus bigint;
  v_from_cash bigint;
begin
  if p_amount <= 0 then
    return;
  end if;

  select w.bonus_balance, w.cash_balance into v_bonus, v_cash
    from public.wallets w where w.user_id = p_user_id for update;
  if not found or v_bonus + v_cash < p_amount then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'AG001';
  end if;

  v_from_bonus := least(v_bonus, p_amount);
  v_from_cash := p_amount - v_from_bonus;

  if v_from_bonus > 0 then
    perform private.apply_ledger_entry(p_user_id, -v_from_bonus, 'bonus', 'stake', p_match_id);
    insert into public.escrow (match_id, user_id, amount, balance_type) values (p_match_id, p_user_id, v_from_bonus, 'bonus');
  end if;
  if v_from_cash > 0 then
    perform private.apply_ledger_entry(p_user_id, -v_from_cash, 'cash', 'stake', p_match_id);
    insert into public.escrow (match_id, user_id, amount, balance_type) values (p_match_id, p_user_id, v_from_cash, 'cash');
  end if;
end;
$$;

create function private.wallet_total(p_user_id uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select w.bonus_balance + w.cash_balance from public.wallets w where w.user_id = p_user_id), 0);
$$;

-- ---------------------------------------------------------------------------------------------
-- Matchmaking, now with stakes
-- ---------------------------------------------------------------------------------------------
create or replace function public.join_match_queue(
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
  v_skipped uuid[] := '{}';
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

  -- Already in a game (for example after reopening the app): send them back to it.
  v_existing := private.active_match_of(p_user_id);
  if v_existing is not null then
    delete from public.match_queue q where q.user_id = p_user_id;
    return jsonb_build_object('status', 'matched', 'match_id', v_existing);
  end if;

  if p_stake > 0 then
    -- Playing for tokens is for adults who have said so.
    if not exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.age_confirmed_at is not null) then
      return jsonb_build_object('status', 'error', 'code', 'AGE_NOT_CONFIRMED');
    end if;
    if private.wallet_total(p_user_id) < p_stake then
      delete from public.match_queue q where q.user_id = p_user_id;
      return jsonb_build_object('status', 'error', 'code', 'INSUFFICIENT_BALANCE');
    end if;
  end if;

  select coalesce(
           (select r.rating from public.player_ratings r
             where r.user_id = p_user_id and r.game_type = p_game_type and r.pool = p_rating_pool),
           1200)
    into v_rating;

  perform pg_advisory_xact_lock(
    hashtextextended('agh:queue:' || p_game_type || ':' || p_stake || ':' || p_rating_pool || ':' || p_options::text, 0));

  -- Closest rating first, then longest wait. A candidate who cannot be used is skipped and the
  -- next one tried (a handful of times at most).
  for i in 1..8 loop
    select q.* into v_opponent
      from public.match_queue q
     where q.game_type = p_game_type
       and q.stake_amount = p_stake
       and q.rating_pool = p_rating_pool
       and q.options = p_options
       and q.user_id <> p_user_id
       and q.user_id <> all (v_skipped)
       and q.heartbeat_at > now() - interval '45 seconds'
     order by abs(q.rating - v_rating), q.joined_at
     limit 1
       for update skip locked;
    exit when not found;

    -- Take the opponent's own lock too, without waiting: if they are in the middle of another
    -- request, leave them alone. This is what stops a player landing in two games.
    if not pg_try_advisory_xact_lock(hashtextextended('agh:user:' || v_opponent.user_id::text, 0))
       or private.active_match_of(v_opponent.user_id) is not null then
      v_skipped := v_skipped || v_opponent.user_id;
      continue;
    end if;

    -- They could afford it when they queued; if they no longer can, they leave the queue.
    if p_stake > 0 and private.wallet_total(v_opponent.user_id) < p_stake then
      delete from public.match_queue q where q.user_id = v_opponent.user_id;
      continue;
    end if;

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

    -- Both stakes go into escrow here. Both balances were just checked while holding both
    -- players' locks, so this cannot fail; if it somehow did, the exception would undo the
    -- whole request (match, seats and any stake already taken) and nothing would be left behind.
    perform private.take_stake(v_match_id, p_user_id, p_stake);
    perform private.take_stake(v_match_id, v_opponent.user_id, p_stake);

    -- The game module creates its own starting state in this same transaction.
    execute format('select private.%I($1, $2)', p_game_type || '_init_match') using v_match_id, p_options;

    return jsonb_build_object('status', 'matched', 'match_id', v_match_id);
  end loop;

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

-- ---------------------------------------------------------------------------------------------
-- Ratings (Elo). Two-player matches only; games with more players will bring their own rule.
-- ---------------------------------------------------------------------------------------------
create function private.update_ratings(p_match_id uuid, p_game_type text, p_pool text, p_winner_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a uuid;
  v_b uuid;
  v_ra integer;
  v_rb integer;
  v_ga integer;
  v_gb integer;
  v_expected_a numeric;
  v_score_a numeric;
  v_new_a integer;
  v_new_b integer;
begin
  -- Always in the same order, so two matches finishing at once cannot lock each other out.
  select min(mp.user_id::text)::uuid, max(mp.user_id::text)::uuid into v_a, v_b
    from public.match_players mp where mp.match_id = p_match_id
  having count(*) = 2;
  if v_a is null then
    return;
  end if;

  insert into public.player_ratings (user_id, game_type, pool)
  values (v_a, p_game_type, p_pool), (v_b, p_game_type, p_pool)
  on conflict do nothing;

  select r.rating, r.games_played into v_ra, v_ga from public.player_ratings r
   where r.user_id = v_a and r.game_type = p_game_type and r.pool = p_pool for update;
  select r.rating, r.games_played into v_rb, v_gb from public.player_ratings r
   where r.user_id = v_b and r.game_type = p_game_type and r.pool = p_pool for update;

  v_expected_a := 1 / (1 + power(10::numeric, (v_rb - v_ra) / 400.0));
  v_score_a := case when p_winner_id is null then 0.5 when p_winner_id = v_a then 1 else 0 end;

  -- New players move faster (K = 40 for their first 20 games), then settle down (K = 20).
  v_new_a := greatest(100, round(v_ra + (case when v_ga < 20 then 40 else 20 end) * (v_score_a - v_expected_a)));
  v_new_b := greatest(100, round(v_rb + (case when v_gb < 20 then 40 else 20 end) * ((1 - v_score_a) - (1 - v_expected_a))));

  update public.player_ratings r
     set rating = case r.user_id when v_a then v_new_a else v_new_b end,
         games_played = r.games_played + 1,
         wins = r.wins + (case when p_winner_id = r.user_id then 1 else 0 end),
         losses = r.losses + (case when p_winner_id is not null and p_winner_id <> r.user_id then 1 else 0 end),
         draws = r.draws + (case when p_winner_id is null then 1 else 0 end),
         updated_at = now()
   where r.user_id in (v_a, v_b) and r.game_type = p_game_type and r.pool = p_pool;

  update public.match_players mp
     set rating_before = case mp.user_id when v_a then v_ra else v_rb end,
         rating_after = case mp.user_id when v_a then v_new_a else v_new_b end
   where mp.match_id = p_match_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Settlement
-- ---------------------------------------------------------------------------------------------

/**
 * Settles a finished or aborted match: pays the winner or refunds the players, records the
 * rake, updates ratings. Returns false if the match was already settled (or is not over), so a
 * retry can never pay twice. Runs inside the caller's transaction.
 */
create function private.settle_match(p_match_id uuid) returns boolean
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

  return true;
end;
$$;

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
  perform private.settle_match(p_match_id);
  return true;
end;
$$;

-- The sweep also settles anything that is over but unsettled. That should never exist, since
-- finishing and settling are one transaction; this is a net under the net.
create or replace function private.sweep() returns void
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

  for v_match in
    select m.id from public.matches m where not m.settled and m.status in ('finished', 'aborted')
  loop
    perform private.settle_match(v_match);
  end loop;
end;
$$;

revoke all on function private.take_stake(uuid, uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function private.wallet_total(uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_ratings(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.settle_match(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The integrity check learns two more questions:
--   escrow_stuck_after_settlement : a settled match still holds someone's stake
--   match_unsettled               : a match is over but was never settled
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
   where not m.settled and m.status in ('finished', 'aborted') and m.finished_at < now() - interval '1 minute';
$$;
