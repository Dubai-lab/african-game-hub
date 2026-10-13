-- Promotions: "register and play N games, the first K players get a reward".
--
-- The hub already records when every player registered and every game they finished. A
-- promotion is only a way of reading that record: a period, how many games are needed, how
-- many winners, and the rules that keep it fair (which games count, how many games against
-- the same opponent count, how long a game must last). Nothing here moves tokens: the reward
-- is given by our team outside the system, and this keeps note of who has been given it, so
-- that nobody is paid twice.
--
-- Game-agnostic: any game on the hub counts unless the promotion names the games.

create table public.promotions (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 3 and 80),
  -- What our team has promised, in their own words (for example "1000 RWF by mobile money"). A note, not money.
  reward text check (char_length(reward) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  games_needed integer not null check (games_needed between 1 and 1000),
  winners integer not null check (winners between 1 and 10000),
  -- Null: every game on the hub counts.
  game_types text[],
  -- Only players who registered after the promotion started.
  new_players_only boolean not null default true,
  -- Two accounts playing each other again and again must not add up: so many games against the same opponents count.
  max_per_opponent integer not null default 1 check (max_per_opponent between 1 and 1000),
  -- A game given up at once is not a game played.
  min_seconds integer not null default 60 check (min_seconds between 0 and 3600),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_period check (ends_at > starts_at)
);
alter table public.promotions enable row level security;
revoke all on table public.promotions from anon, authenticated;
create policy promotions_no_client_access on public.promotions as restrictive for all to anon, authenticated using (false) with check (false);

-- Who has been given the reward.
create table public.promotion_payouts (
  promotion_id bigint not null references public.promotions (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  paid_at timestamptz not null default now(),
  paid_by uuid not null references public.profiles (id) on delete restrict,
  note text check (char_length(note) <= 300),
  primary key (promotion_id, user_id)
);
alter table public.promotion_payouts enable row level security;
revoke all on table public.promotion_payouts from anon, authenticated;
create policy promotion_payouts_no_client_access on public.promotion_payouts as restrictive for all to anon, authenticated using (false) with check (false);

/**
 * Every game finished inside a promotion's period by a player it is open to, with whether the
 * game counts and, when it does, which of the player's counted games it is (1st, 2nd, ...).
 */
create function private.promotion_games(p_promotion_id bigint)
returns table (user_id uuid, match_id uuid, game_type text, started_at timestamptz, finished_at timestamptz, against text, won boolean, counted boolean, nth integer)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select * from public.promotions where id = p_promotion_id
  ), games as (
    select mp.user_id, m.id as match_id, m.game_type, m.started_at, m.finished_at, m.winner_id is not distinct from mp.user_id as won,
           -- The other players at the table, as one key: the same people again is the same opponent.
           coalesce((select string_agg(o.user_id::text, ',' order by o.user_id) from public.match_players o where o.match_id = m.id and o.user_id <> mp.user_id), '') as against,
           m.finished_at - m.started_at >= make_interval(secs => p.min_seconds) as long_enough
      from p
      join public.matches m on m.status = 'finished' and m.started_at >= p.starts_at and m.finished_at <= p.ends_at
                           and (p.game_types is null or m.game_type = any (p.game_types))
      join public.match_players mp on mp.match_id = m.id
      join public.profiles pr on pr.id = mp.user_id
     where (not p.new_players_only or pr.created_at >= p.starts_at)
       and not exists (select 1 from public.admins a where a.user_id = mp.user_id)
  ), ranked as (
    select g.*, row_number() over (partition by g.user_id, g.against, g.long_enough order by g.finished_at, g.match_id) as nth_against
      from games g
  ), marked as (
    select r.*, (r.long_enough and r.nth_against <= (select max_per_opponent from p)) as counted
      from ranked r
  )
  select k.user_id, k.match_id, k.game_type, k.started_at, k.finished_at, k.against, k.won, k.counted,
         case when k.counted then (row_number() over (partition by k.user_id, k.counted order by k.finished_at, k.match_id))::integer end as nth
    from marked k;
$$;
revoke all on function private.promotion_games(bigint) from public, anon, authenticated, service_role;

/** Our team sets up a promotion, or changes one (p_id given). */
create function public.admin_promotion_save(
  p_admin_id uuid, p_id bigint, p_name text, p_reward text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_games_needed integer, p_winners integer, p_game_types text[], p_new_players_only boolean, p_max_per_opponent integer, p_min_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_reward text := nullif(trim(coalesce(p_reward, '')), '');
  v_games text[] := case when coalesce(cardinality(p_game_types), 0) = 0 then null else p_game_types end;
  v_id bigint;
begin
  if char_length(v_name) not between 3 and 80 or char_length(coalesce(v_reward, '')) > 200
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_games_needed is null or p_games_needed not between 1 and 1000
     or p_winners is null or p_winners not between 1 and 10000
     or coalesce(p_max_per_opponent, 1) not between 1 and 1000
     or coalesce(p_min_seconds, 60) not between 0 and 3600 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if v_games is not null and exists (select 1 from unnest(v_games) g where not exists (select 1 from public.game_types t where t.id = g)) then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;

  if p_id is null then
    insert into public.promotions (name, reward, starts_at, ends_at, games_needed, winners, game_types, new_players_only, max_per_opponent, min_seconds, created_by)
    values (v_name, v_reward, p_starts_at, p_ends_at, p_games_needed, p_winners, v_games, coalesce(p_new_players_only, true), coalesce(p_max_per_opponent, 1), coalesce(p_min_seconds, 60), p_admin_id)
    returning id into v_id;
  else
    update public.promotions pr
       set name = v_name, reward = v_reward, starts_at = p_starts_at, ends_at = p_ends_at, games_needed = p_games_needed, winners = p_winners,
           game_types = v_games, new_players_only = coalesce(p_new_players_only, true), max_per_opponent = coalesce(p_max_per_opponent, 1),
           min_seconds = coalesce(p_min_seconds, 60), updated_at = now()
     where pr.id = p_id
    returning pr.id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'PROMOTION_NOT_FOUND');
    end if;
  end if;
  perform private.audit(p_admin_id, case when p_id is null then 'promotion_created' else 'promotion_changed' end, null, null,
                        jsonb_build_object('promotion_id', v_id, 'name', v_name, 'games_needed', p_games_needed, 'winners', p_winners));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

/** The promotions, newest first, each with how many players have qualified so far. */
create function public.admin_promotions(p_limit integer, p_offset integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.promotions),
    'rows', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc)
                        from (select pr.id, pr.name, pr.reward, pr.starts_at, pr.ends_at, pr.games_needed, pr.winners, pr.game_types,
                                     (select count(*) from private.promotion_games(pr.id) g where g.nth = pr.games_needed) as qualified,
                                     (select count(*) from public.promotion_payouts po where po.promotion_id = pr.id) as paid
                                from public.promotions pr order by pr.id desc
                               limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) h), '[]'::jsonb));
$$;

/**
 * One promotion and where every player stands in it: those who have qualified first, in the
 * order they got there (the moment their last needed game finished), then those still on the way.
 */
create function public.admin_promotion(p_promotion_id bigint) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select * from public.promotions where id = p_promotion_id
  ), per as (
    select g.user_id,
           count(*) filter (where g.counted) as games,
           count(*) as games_played,
           count(distinct g.against) filter (where g.counted) as opponents,
           min(g.finished_at) filter (where g.nth = (select games_needed from p)) as qualified_at
      from private.promotion_games(p_promotion_id) g
     group by g.user_id
  ), placed as (
    select per.*, case when per.qualified_at is not null then row_number() over (partition by per.qualified_at is not null order by per.qualified_at, per.user_id) end as place
      from per
  ), shown as (
    select d.user_id, pr.username, pr.display_name, pr.country_code, pr.created_at as registered_at,
           u.email, pp.phone_e164 as phone, pp.is_banned as banned,
           d.games, d.games_played, d.opponents, d.qualified_at, d.place,
           coalesce(d.place <= (select winners from p), false) as winner,
           po.paid_at, po.note as paid_note, (select a.username from public.profiles a where a.id = po.paid_by) as paid_by
      from placed d
      join public.profiles pr on pr.id = d.user_id
      join public.profile_private pp on pp.user_id = d.user_id
      left join auth.users u on u.id = d.user_id
      left join public.promotion_payouts po on po.promotion_id = p_promotion_id and po.user_id = d.user_id
     order by d.place nulls last, d.games desc, d.user_id
     limit 500
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'promotion', (select to_jsonb(p) - 'created_by' || jsonb_build_object('created_by', (select a.username from public.profiles a where a.id = p.created_by)) from p),
    'qualified', (select count(*) from per where qualified_at is not null),
    'playing', (select count(*) from per where qualified_at is null),
    'paid', (select count(*) from public.promotion_payouts po where po.promotion_id = p_promotion_id),
    -- Registered in the period, whether or not they have played yet.
    'registered', (select count(*) from public.profiles pr, p where pr.created_at >= p.starts_at and pr.created_at <= p.ends_at),
    'rows', coalesce((select jsonb_agg(to_jsonb(s) order by s.place nulls last, s.games desc, s.user_id) from shown s), '[]'::jsonb)) end;
$$;

/** One player's games in a promotion's period, newest last: who they played, how long, and whether each counts. */
create function public.admin_promotion_player(p_promotion_id bigint, p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'match_id', g.match_id, 'game_type', g.game_type, 'started_at', g.started_at, 'finished_at', g.finished_at,
           'seconds', floor(extract(epoch from g.finished_at - g.started_at))::integer,
           'won', g.won, 'counted', g.counted, 'nth', g.nth,
           'against', (select coalesce(jsonb_agg(jsonb_build_object('user_id', o.user_id, 'username', pr.username) order by pr.username), '[]'::jsonb)
                         from public.match_players o join public.profiles pr on pr.id = o.user_id
                        where o.match_id = g.match_id and o.user_id <> p_user_id)) order by g.finished_at, g.match_id), '[]'::jsonb)
    from private.promotion_games(p_promotion_id) g
   where g.user_id = p_user_id;
$$;

/** Our team notes that a winner has been given the reward (or takes the note back). Only a player who qualified among the winners can be marked. */
create function public.admin_promotion_mark_paid(p_admin_id uuid, p_promotion_id bigint, p_user_id uuid, p_paid boolean, p_note text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_promotion public.promotions;
  v_place bigint;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_promotion from public.promotions where id = p_promotion_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROMOTION_NOT_FOUND');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;

  if not coalesce(p_paid, true) then
    delete from public.promotion_payouts po where po.promotion_id = p_promotion_id and po.user_id = p_user_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_MARKED_PAID');
    end if;
    perform private.audit(p_admin_id, 'promotion_unpaid', p_user_id, null, jsonb_build_object('promotion_id', p_promotion_id, 'reason', v_note));
    return jsonb_build_object('ok', true);
  end if;

  if exists (select 1 from public.promotion_payouts po where po.promotion_id = p_promotion_id and po.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PAID');
  end if;
  select q.place into v_place
    from (select g.user_id, row_number() over (order by g.finished_at, g.user_id) as place
            from private.promotion_games(p_promotion_id) g
           where g.nth = v_promotion.games_needed) q
   where q.user_id = p_user_id;
  if v_place is null or v_place > v_promotion.winners then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_WINNER');
  end if;
  insert into public.promotion_payouts (promotion_id, user_id, paid_by, note) values (p_promotion_id, p_user_id, p_admin_id, v_note);
  perform private.audit(p_admin_id, 'promotion_paid', p_user_id, null, jsonb_build_object('promotion_id', p_promotion_id, 'place', v_place, 'reason', v_note));
  return jsonb_build_object('ok', true, 'place', v_place);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_promotion_save(uuid, bigint, text, text, timestamptz, timestamptz, integer, integer, text[], boolean, integer, integer)',
    'public.admin_promotions(integer, integer)',
    'public.admin_promotion(bigint)',
    'public.admin_promotion_player(bigint, uuid)',
    'public.admin_promotion_mark_paid(uuid, bigint, uuid, boolean, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
