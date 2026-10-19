-- One Africa Life: work, and changing money.
--
-- Three first jobs, each done the way it is done in real life:
--   * Market trader. Stock is bought with the trader's own money and the day's market dues paid
--     at the start; at closing most of it has sold, at a markup that changes day to day, and
--     what is left goes cheap. A day at the market is at most twelve hours, 06:00 to 18:00.
--   * Kekeh rider. A commercial licence first (applied for, paid for, ready in two days, good for
--     a year). Then, like most riders, the kekeh is rented: the owner's "balance" for the day and
--     the fuel are paid at the start; fares come in passenger by passenger through the hours
--     chosen (06:00 to 21:00), so a longer day pays better.
--   * Office worker. An application, answered the next day. Monday to Friday, in by 08:30 (from
--     07:00), out at 17:00. The salary is earned day by day and paid at the end of the month.
-- While at work a life is 'working' and cannot board a flight. When a shift ends is decided by
-- time, and applied whenever the life is next looked at (private.oal_settle, as for travel).
-- All chance is the server's (random() at the moment a shift is settled).
--
-- And a money changer: local money for US dollars and back, at a buying and a selling rate
-- around the game's own (oal_settings.usd_lrd, usd_ghs), in the country the life is in.

alter table public.oal_lives drop constraint oal_lives_state_check;
alter table public.oal_lives add constraint oal_lives_state_check check (state in ('settled', 'in_flight', 'arrivals', 'cleared', 'held', 'working'));

create table public.oal_jobs (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  kind text not null check (kind in ('trader', 'kekeh', 'office')),
  country text not null check (country in ('LR', 'GH')),
  town text not null,
  -- Where (the market, the employer): invented names for businesses, real ones for markets.
  place text not null,
  currency text not null check (currency in ('LRD', 'USD', 'GHS')),
  -- The day's window (game time): a shift starts and ends inside it.
  opens time not null,
  closes time not null,
  -- The job's numbers, in hundredths of its currency: market dues; the kekeh's balance, fuel and
  -- fare; the office's monthly salary.
  pay jsonb not null
);
insert into public.oal_jobs values
  ('waterside_trader', 'trader', 'LR', 'Monrovia', 'Waterside Market', 'LRD', '06:00', '18:00', '{"dues": 10000}'),
  ('voinjama_trader', 'trader', 'LR', 'Voinjama', 'Voinjama Market', 'LRD', '06:00', '18:00', '{"dues": 5000}'),
  ('makola_trader', 'trader', 'GH', 'Accra', 'Makola Market', 'GHS', '06:00', '18:00', '{"dues": 500}'),
  ('kejetia_trader', 'trader', 'GH', 'Kumasi', 'Kejetia Market', 'GHS', '06:00', '18:00', '{"dues": 400}'),
  ('monrovia_kekeh', 'kekeh', 'LR', 'Monrovia', 'Monrovia', 'LRD', '06:00', '21:00', '{"balance": 250000, "fuel": 70000, "fare": 5000}'),
  ('voinjama_kekeh', 'kekeh', 'LR', 'Voinjama', 'Voinjama', 'LRD', '06:00', '21:00', '{"balance": 150000, "fuel": 60000, "fare": 4000}'),
  ('kumasi_kekeh', 'kekeh', 'GH', 'Kumasi', 'Kumasi', 'GHS', '06:00', '21:00', '{"balance": 15000, "fuel": 5000, "fare": 400}'),
  ('sinkor_clerk', 'office', 'LR', 'Monrovia', 'Sinkor Logistics', 'USD', '07:00', '17:00', '{"salary": 18000}'),
  ('osu_assistant', 'office', 'GH', 'Accra', 'Osu Trading', 'GHS', '07:00', '17:00', '{"salary": 180000}');

-- Licences (a commercial licence to carry passengers), as issued.
create table public.oal_licences (
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  kind text not null check (kind in ('commercial')),
  country text not null check (country in ('LR', 'GH')),
  number text not null unique,
  issued_on date not null,
  expires_on date not null,
  primary key (user_id, kind, country)
);

-- Applications (for a licence, for a job): the answer is ready at ready_at (game time).
create table public.oal_applications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  kind text not null check (kind in ('licence', 'job')),
  -- The licence's country, or the job's id.
  target text not null,
  applied_at timestamp not null,
  ready_at timestamp not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  created_at timestamptz not null default now()
);
create index oal_applications_user on public.oal_applications (user_id, id);

-- Who works where (the office): since when, what is owed and not yet paid, the last pay.
create table public.oal_employments (
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  job_id text not null references public.oal_jobs (id),
  since date not null,
  owed bigint not null default 0 check (owed >= 0),
  paid_through date,
  primary key (user_id, job_id)
);

create table public.oal_shifts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  job_id text not null references public.oal_jobs (id),
  starts_at timestamp not null,
  ends_at timestamp not null,
  status text not null default 'running' check (status in ('running', 'done')),
  -- What went in (a trader's stock), what came out, and what was paid (hundredths).
  stock bigint not null default 0 check (stock >= 0),
  spent bigint not null default 0 check (spent >= 0),
  earned bigint not null default 0 check (earned >= 0),
  outcome jsonb,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index oal_shifts_user on public.oal_shifts (user_id, id);
-- One shift at a time.
create unique index oal_shifts_one_running on public.oal_shifts (user_id) where status = 'running';
alter table public.oal_lives add column shift_id bigint references public.oal_shifts (id);

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['oal_jobs', 'oal_licences', 'oal_applications', 'oal_employments', 'oal_shifts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format(
        'create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
        t || '_deny_client_' || op, t, op,
        case op when 'insert' then 'with check (false)' when 'delete' then 'using (false)' else 'using (false) with check (false)' end);
    end loop;
  end loop;
  execute 'create policy oal_jobs_read on public.oal_jobs for select to authenticated using (true)';
  foreach t in array array['oal_licences', 'oal_applications', 'oal_employments', 'oal_shifts'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_read_own', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Settling a shift, applications, pay day
-- ---------------------------------------------------------------------------------------------

/** A shift's result, decided once, at its end: what the day brought in. */
create function private.oal_finish_shift(p_shift public.oal_shifts) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.oal_jobs;
  v_hours numeric := extract(epoch from p_shift.ends_at - p_shift.starts_at) / 3600;
  v_sold numeric;
  v_markup numeric;
  v_earned bigint := 0;
  v_outcome jsonb;
  v_passengers integer := 0;
  v_day integer;
begin
  select * into v_job from public.oal_jobs j where j.id = p_shift.job_id;
  if v_job.kind = 'trader' then
    -- Most of the stock sells (70% to all of it), at a markup of 25% to 55%; what is left goes
    -- at 90% of its cost at closing. A short day sells less.
    v_sold := least(1.0, (0.7 + random() * 0.3) * least(1.0, v_hours / 8));
    v_markup := 0.25 + random() * 0.3;
    v_earned := floor(p_shift.stock * v_sold * (1 + v_markup) + p_shift.stock * (1 - v_sold) * 0.9);
    v_outcome := jsonb_build_object('sold', round(v_sold, 2), 'markup', round(v_markup, 2));
  elsif v_job.kind = 'kekeh' then
    -- Five to eleven passengers an hour, each paying the fare.
    for i in 1 .. ceil(v_hours)::int loop
      v_passengers := v_passengers + floor((5 + random() * 7) * least(1.0, v_hours - (i - 1)))::int;
    end loop;
    v_earned := v_passengers * (v_job.pay ->> 'fare')::bigint;
    v_outcome := jsonb_build_object('passengers', v_passengers);
  else
    -- A day's pay, earned now, paid at the month's end (oal_employments.owed).
    v_day := (v_job.pay ->> 'salary')::bigint / 22;
    update public.oal_employments e set owed = e.owed + v_day where e.user_id = p_shift.user_id and e.job_id = v_job.id;
    v_outcome := jsonb_build_object('owed', v_day);
  end if;
  if v_earned > 0 then
    perform private.oal_money(p_shift.user_id, v_job.currency, v_earned, 'work_' || v_job.kind);
  end if;
  update public.oal_shifts s set status = 'done', earned = v_earned, outcome = v_outcome where s.id = p_shift.id;
end;
$$;

/**
 * Brings a life up to the game's present: travel (as before: tickets not used in time are lost,
 * a held traveller's flight leaves, a flight lands), then work: a shift whose time is up is
 * settled; applications whose answer is ready are answered; on the first day of a month, what an
 * office owes for the month before is paid. Takes the life's row lock; returns the life.
 */
create or replace function private.oal_settle(p_user_id uuid) returns public.oal_lives
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_trip public.oal_trips;
  v_shift public.oal_shifts;
  v_app public.oal_applications;
  v_emp record;
  v_now timestamp := public.oal_game_time();
begin
  select * into v_life from public.oal_lives l where l.user_id = p_user_id for update;
  if not found then
    return null;
  end if;
  update public.oal_tickets t set status = 'missed'
    from public.oal_flights f
   where t.user_id = p_user_id and t.status = 'booked' and f.code = t.flight_code
     and private.oal_departure(f, t.flies_on) - interval '30 minutes' < v_now;
  if v_life.trip_id is not null then
    select * into v_trip from public.oal_trips tr where tr.id = v_life.trip_id;
    if v_life.state = 'held' and v_now >= v_trip.departs_at then
      v_life.state := 'in_flight';
    end if;
    if v_life.state = 'in_flight' and v_now >= v_trip.arrives_at then
      v_life.state := 'arrivals';
      v_life.place := v_trip.to_airport;
      select a.country into v_life.country from public.oal_airports a where a.code = v_trip.to_airport;
    end if;
  end if;
  if v_life.state = 'working' and v_life.shift_id is not null then
    select * into v_shift from public.oal_shifts s where s.id = v_life.shift_id;
    if v_now >= v_shift.ends_at then
      perform private.oal_finish_shift(v_shift);
      v_life.state := 'settled';
      v_life.shift_id := null;
    end if;
  end if;
  update public.oal_lives l set state = v_life.state, place = v_life.place, country = v_life.country, shift_id = v_life.shift_id where l.user_id = p_user_id;

  for v_app in select * from public.oal_applications a where a.user_id = p_user_id and a.status = 'pending' and a.ready_at <= v_now for update loop
    if v_app.kind = 'licence' then
      update public.oal_applications a set status = 'approved' where a.id = v_app.id;
      insert into public.oal_licences (user_id, kind, country, number, issued_on, expires_on)
      values (p_user_id, 'commercial', v_app.target, (case v_app.target when 'LR' then 'CL-' else 'GC-' end) || lpad(v_app.id::text, 6, '0'), v_app.ready_at::date, (v_app.ready_at::date + interval '1 year')::date)
      on conflict (user_id, kind, country) do update set issued_on = excluded.issued_on, expires_on = excluded.expires_on;
    else
      -- Six applicants in ten are taken on.
      if random() < 0.6 then
        update public.oal_applications a set status = 'approved' where a.id = v_app.id;
        insert into public.oal_employments (user_id, job_id, since) values (p_user_id, v_app.target, v_app.ready_at::date) on conflict do nothing;
      else
        update public.oal_applications a set status = 'refused' where a.id = v_app.id;
      end if;
    end if;
  end loop;

  -- Pay day: what was earned before this month began is paid.
  for v_emp in
    select e.*, j.currency from public.oal_employments e join public.oal_jobs j on j.id = e.job_id
     where e.user_id = p_user_id and e.owed > 0 and date_trunc('month', v_now)::date > coalesce(e.paid_through, e.since - 1)
       and exists (select 1 from public.oal_shifts s where s.user_id = p_user_id and s.job_id = e.job_id and s.status = 'done' and s.ends_at < date_trunc('month', v_now))
  loop
    perform private.oal_money(p_user_id, v_emp.currency, v_emp.owed, 'salary');
    update public.oal_employments e set owed = 0, paid_through = (date_trunc('month', v_now) - interval '1 day')::date where e.user_id = p_user_id and e.job_id = v_emp.job_id;
  end loop;
  select * into v_life from public.oal_lives l where l.user_id = p_user_id;
  return v_life;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Applying, working, changing money
-- ---------------------------------------------------------------------------------------------

/** An application: for the commercial licence of the country the life is in, or for a job. */
create function public.oal_apply(p_user_id uuid, p_kind text, p_target text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_now timestamp := public.oal_game_time();
  v_job public.oal_jobs;
  v_fee bigint;
  v_id bigint;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'settled' then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;
  if exists (select 1 from public.oal_applications a where a.user_id = p_user_id and a.kind = p_kind and a.target = p_target and a.status = 'pending') then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_APPLIED');
  end if;
  if p_kind = 'licence' then
    if p_target <> v_life.country then
      return jsonb_build_object('ok', false, 'code', 'WRONG_COUNTRY');
    end if;
    if exists (select 1 from public.oal_licences l where l.user_id = p_user_id and l.country = p_target and l.expires_on > v_now::date) then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_LICENSED');
    end if;
    -- The fee: L$2,500 in Liberia, GH¢150 in Ghana.
    v_fee := case p_target when 'LR' then 250000 else 15000 end;
    begin
      perform private.oal_money(p_user_id, case p_target when 'LR' then 'LRD' else 'GHS' end, -v_fee, 'licence_fee');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    insert into public.oal_applications (user_id, kind, target, applied_at, ready_at) values (p_user_id, 'licence', p_target, v_now, v_now + interval '2 days') returning id into v_id;
  elsif p_kind = 'job' then
    select * into v_job from public.oal_jobs j where j.id = p_target and j.kind = 'office';
    if not found then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    if v_job.town <> v_life.place or v_job.country <> v_life.country then
      return jsonb_build_object('ok', false, 'code', 'WRONG_TOWN');
    end if;
    if exists (select 1 from public.oal_employments e where e.user_id = p_user_id and e.job_id = p_target) then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_EMPLOYED');
    end if;
    -- Turned down: try again after a week.
    if exists (select 1 from public.oal_applications a where a.user_id = p_user_id and a.kind = 'job' and a.target = p_target and a.status = 'refused' and a.ready_at > v_now - interval '7 days') then
      return jsonb_build_object('ok', false, 'code', 'TRY_LATER');
    end if;
    insert into public.oal_applications (user_id, kind, target, applied_at, ready_at) values (p_user_id, 'job', p_target, v_now, v_now + interval '1 day') returning id into v_id;
  else
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  return jsonb_build_object('ok', true, 'application_id', v_id);
end;
$$;

/**
 * Going to work: in the job's town, inside its hours. A trader brings stock (bought now, with the
 * market dues); a kekeh rider needs the licence and pays the day's balance and fuel; an office
 * worker must be employed there, on a weekday, in by 08:30, and works to 17:00.
 */
create function public.oal_start_shift(p_user_id uuid, p_job text, p_hours integer, p_stock bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_job public.oal_jobs;
  v_now timestamp := public.oal_game_time();
  v_ends timestamp;
  v_spent bigint := 0;
  v_id bigint;
  v_least bigint;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'settled' then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;
  select * into v_job from public.oal_jobs j where j.id = p_job;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if v_job.town <> v_life.place or v_job.country <> v_life.country then
    return jsonb_build_object('ok', false, 'code', 'WRONG_TOWN');
  end if;
  if v_now::time < v_job.opens or v_now::time >= v_job.closes then
    return jsonb_build_object('ok', false, 'code', 'CLOSED');
  end if;
  if v_job.kind = 'office' then
    if not exists (select 1 from public.oal_employments e where e.user_id = p_user_id and e.job_id = p_job) then
      return jsonb_build_object('ok', false, 'code', 'NOT_EMPLOYED');
    end if;
    if extract(isodow from v_now) > 5 then
      return jsonb_build_object('ok', false, 'code', 'WEEKEND');
    end if;
    if v_now::time > '08:30' then
      return jsonb_build_object('ok', false, 'code', 'TOO_LATE_FOR_WORK');
    end if;
    if exists (select 1 from public.oal_shifts s where s.user_id = p_user_id and s.job_id = p_job and s.starts_at::date = v_now::date) then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_WORKED_TODAY');
    end if;
    v_ends := v_now::date + v_job.closes;
  else
    if p_hours is null or p_hours not between 1 and 15 then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    v_ends := least(v_now + make_interval(hours => p_hours), v_now::date + v_job.closes);
    if v_job.kind = 'trader' then
      -- Stock worth at least 1,000 Liberian dollars or 60 cedis, and what the trader can afford with the dues.
      v_least := case v_job.currency when 'LRD' then 100000 else 6000 end;
      if p_stock is null or p_stock < v_least or p_stock > 100000000 then
        return jsonb_build_object('ok', false, 'code', 'BAD_STOCK');
      end if;
      v_spent := p_stock + (v_job.pay ->> 'dues')::bigint;
    else
      if not exists (select 1 from public.oal_licences l where l.user_id = p_user_id and l.kind = 'commercial' and l.country = v_job.country and l.expires_on > v_now::date) then
        return jsonb_build_object('ok', false, 'code', 'NO_LICENCE');
      end if;
      v_spent := (v_job.pay ->> 'balance')::bigint + (v_job.pay ->> 'fuel')::bigint;
    end if;
    begin
      perform private.oal_money(p_user_id, v_job.currency, -v_spent, 'work_costs');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
  end if;
  insert into public.oal_shifts (user_id, job_id, starts_at, ends_at, stock, spent)
  values (p_user_id, p_job, v_now, v_ends, coalesce(case when v_job.kind = 'trader' then p_stock end, 0), v_spent)
  returning id into v_id;
  update public.oal_lives l set state = 'working', shift_id = v_id where l.user_id = p_user_id;
  return jsonb_build_object('ok', true, 'shift_id', v_id, 'ends_at', v_ends);
end;
$$;

/**
 * The money changer, in the country the life is in: its money for US dollars (sold at 3% over
 * the game's rate) or US dollars for its money (bought at 3% under). Amount in hundredths of
 * what is handed over.
 */
create function public.oal_exchange(p_user_id uuid, p_from text, p_amount bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_settings public.oal_settings;
  v_local text;
  v_rate numeric;
  v_get bigint;
  v_to text;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state not in ('settled', 'cleared') then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;
  select * into v_settings from public.oal_settings;
  v_local := case v_life.country when 'LR' then 'LRD' else 'GHS' end;
  v_rate := case v_life.country when 'LR' then v_settings.usd_lrd else v_settings.usd_ghs end;
  if p_amount is null or p_amount < 100 or p_amount > 10000000000 or p_from not in (v_local, 'USD') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if p_from = 'USD' then
    v_to := v_local;
    v_get := floor(p_amount * v_rate * 0.97);
  else
    v_to := 'USD';
    v_get := floor(p_amount / (v_rate * 1.03));
  end if;
  if v_get < 1 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  begin
    perform private.oal_money(p_user_id, p_from, -p_amount, 'exchange');
  exception when sqlstate 'AG003' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
  end;
  perform private.oal_money(p_user_id, v_to, v_get, 'exchange');
  return jsonb_build_object('ok', true, 'currency', v_to, 'received', v_get);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.oal_apply(uuid, text, text)',
    'public.oal_start_shift(uuid, text, integer, bigint)',
    'public.oal_exchange(uuid, text, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array['private.oal_finish_shift(public.oal_shifts)', 'private.oal_settle(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;
