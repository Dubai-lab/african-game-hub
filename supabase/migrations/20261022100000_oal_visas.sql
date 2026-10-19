-- One Africa Life: the visa office.
--
-- Liberia and Ghana are both in ECOWAS: their citizens visit each other's country without a
-- visa for up to 90 days. To stay longer, or to work, a visa (or permit) is needed, applied for
-- before travelling, as in real life:
--   * a long stay: 4 to 12 months; US$100; at least US$300 held; the passport valid past it.
--   * work: a year; US$300 for Ghana, US$250 for Liberia; a job in that country that has taken
--     the applicant on (office jobs can now be applied for from anywhere, as people do online).
-- The answer comes in thirty game hours (about one real hour). At the border the visa lets the
-- holder stay until it ends and, if it is for work, come to work (supabase/functions/_shared/
-- oalBorder.ts); and any job in a country not one's own needs a work visa.
-- Citizens never need a visa for their own country.

alter table public.oal_applications drop constraint oal_applications_kind_check;
alter table public.oal_applications add constraint oal_applications_kind_check check (kind in ('licence', 'job', 'visa'));

create table public.oal_visas (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  country text not null check (country in ('LR', 'GH')),
  kind text not null check (kind in ('long_visit', 'work')),
  number text not null unique check (number ~ '^[GL]V[0-9]{7}$'),
  issued_on date not null,
  valid_until date not null,
  application_id bigint not null unique references public.oal_applications (id),
  check (valid_until > issued_on)
);
create index oal_visas_user on public.oal_visas (user_id, country, valid_until);
alter table public.oal_visas enable row level security;
revoke all on table public.oal_visas from public, anon, authenticated;
grant all on table public.oal_visas to service_role;
grant select on table public.oal_visas to authenticated;
create policy oal_visas_deny_client_insert on public.oal_visas as restrictive for insert to anon, authenticated with check (false);
create policy oal_visas_deny_client_update on public.oal_visas as restrictive for update to anon, authenticated using (false) with check (false);
create policy oal_visas_deny_client_delete on public.oal_visas as restrictive for delete to anon, authenticated using (false);
create policy oal_visas_read_own on public.oal_visas for select to authenticated using (user_id = (select auth.uid()));

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
    if v_app.kind = 'visa' then
      -- Documents were checked when applying; the visa is issued, valid from today.
      update public.oal_applications a set status = 'approved' where a.id = v_app.id;
      insert into public.oal_visas (user_id, country, kind, number, issued_on, valid_until, application_id)
      values (p_user_id, split_part(v_app.target, ':', 1), split_part(v_app.target, ':', 2),
              (case split_part(v_app.target, ':', 1) when 'GH' then 'GV' else 'LV' end) || lpad(v_app.id::text, 7, '0'),
              v_app.ready_at::date, (v_app.ready_at::date + make_interval(months => split_part(v_app.target, ':', 3)::int))::date, v_app.id);
    elsif v_app.kind = 'licence' then
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

/**
 * An application: for the commercial licence of the country the life is in; for an office job
 * (from anywhere: people apply from abroad); or for a visa to the other country
 * (p_target = 'GH:long_visit:6' or 'GH:work'): a long stay of 4 to 12 months (US$100; US$300
 * held; the passport valid past its end) or a year's work (US$300 for Ghana, US$250 for
 * Liberia; a job there that has taken the applicant on). Answered in thirty game hours (about
 * one real hour).
 */
create or replace function public.oal_apply(p_user_id uuid, p_kind text, p_target text) returns jsonb
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
  v_parts text[];
  v_country text;
  v_kind text;
  v_months integer;
  v_passport public.oal_passports;
  v_funds bigint;
  v_settings public.oal_settings;
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
    if exists (select 1 from public.oal_employments e where e.user_id = p_user_id and e.job_id = p_target) then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_EMPLOYED');
    end if;
    -- Turned down: try again after a week.
    if exists (select 1 from public.oal_applications a where a.user_id = p_user_id and a.kind = 'job' and a.target = p_target and a.status = 'refused' and a.ready_at > v_now - interval '7 days') then
      return jsonb_build_object('ok', false, 'code', 'TRY_LATER');
    end if;
    insert into public.oal_applications (user_id, kind, target, applied_at, ready_at) values (p_user_id, 'job', p_target, v_now, v_now + interval '1 day') returning id into v_id;
  elsif p_kind = 'visa' then
    v_parts := string_to_array(p_target, ':');
    v_country := v_parts[1];
    v_kind := v_parts[2];
    v_months := case v_kind when 'work' then 12 else coalesce(nullif(v_parts[3], '')::int, 0) end;
    if v_country not in ('LR', 'GH') or v_kind not in ('long_visit', 'work') or v_months not between 4 and 12 then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    if v_country = v_life.home_country then
      return jsonb_build_object('ok', false, 'code', 'CITIZEN_NO_VISA');
    end if;
    select * into v_passport from public.oal_passports p where p.user_id = p_user_id;
    if v_passport.user_id is null or v_passport.expires_on < (v_now::date + make_interval(months => v_months + 1))::date then
      return jsonb_build_object('ok', false, 'code', 'PASSPORT_TOO_SHORT');
    end if;
    if v_kind = 'work' and not exists (
      select 1 from public.oal_employments e join public.oal_jobs j on j.id = e.job_id where e.user_id = p_user_id and j.country = v_country) then
      return jsonb_build_object('ok', false, 'code', 'NO_JOB_OFFER');
    end if;
    if v_kind = 'long_visit' then
      select * into v_settings from public.oal_settings;
      select coalesce(sum(case b.currency when 'USD' then b.amount when 'LRD' then b.amount / v_settings.usd_lrd when 'GHS' then b.amount / v_settings.usd_ghs end), 0)
        into v_funds from public.oal_balances b where b.user_id = p_user_id;
      if v_funds < 30000 + 10000 then
        return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_FUNDS_SHOWN');
      end if;
    end if;
    v_fee := case when v_kind = 'long_visit' then 10000 when v_country = 'GH' then 30000 else 25000 end;
    begin
      perform private.oal_money(p_user_id, 'USD', -v_fee, 'visa_fee');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    insert into public.oal_applications (user_id, kind, target, applied_at, ready_at)
    values (p_user_id, 'visa', v_country || ':' || v_kind || ':' || v_months, v_now, v_now + interval '30 hours') returning id into v_id;
  else
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  return jsonb_build_object('ok', true, 'application_id', v_id);
end;
$$;

/**
 * Going to work: in the job's town, inside its hours. A trader brings stock (bought now, with the
 * market dues); a kekeh rider needs the licence and pays the day's balance and fuel; an office
 * worker must be employed there, on a weekday, in by 08:30, and works to 17:00. A foreigner
 * needs a work visa for the country.
 */
create or replace function public.oal_start_shift(p_user_id uuid, p_job text, p_hours integer, p_stock bigint) returns jsonb
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
  -- A foreigner works only with a work visa for the country.
  if v_job.country <> v_life.home_country and not exists (
    select 1 from public.oal_visas v where v.user_id = p_user_id and v.country = v_job.country and v.kind = 'work' and v.valid_until >= v_now::date) then
    return jsonb_build_object('ok', false, 'code', 'NO_WORK_PERMIT');
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
 * What the immigration officer can check about a traveller in an arrivals hall: the shape of
 * BorderFacts in supabase/functions/_shared/oalBorder.ts, plus the trip. The booking is looked
 * up by the reference the traveller gives; a host by the number given (registered in this
 * country? to the traveller? is its owner here now, with a phone?); and the visa the traveller
 * holds for this country, valid on arrival (a work visa first).
 */
create or replace function public.oal_border_facts(p_user_id uuid, p_reference text, p_phone text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_trip public.oal_trips;
  v_passport public.oal_passports;
  v_settings public.oal_settings;
  v_arrival date;
  v_ticket_out date;
  v_booking jsonb;
  v_host jsonb;
  v_funds bigint;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_sim public.oal_sims;
  v_visa jsonb;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'arrivals' then
    return jsonb_build_object('ok', false, 'code', 'NOT_AT_ARRIVALS');
  end if;
  select * into v_trip from public.oal_trips t where t.id = v_life.trip_id;
  select * into v_passport from public.oal_passports p where p.user_id = p_user_id;
  select * into v_settings from public.oal_settings;
  v_arrival := v_trip.arrives_at::date;
  select min(t.flies_on) into v_ticket_out
    from public.oal_tickets t
    join public.oal_flights f on f.code = t.flight_code
    join public.oal_airports a on a.code = f.from_airport
   where t.user_id = p_user_id and t.status = 'booked' and a.country = v_life.country and t.flies_on >= v_arrival;
  select jsonb_build_object('reference', b.reference, 'from', b.from_date, 'nights', b.nights) into v_booking
    from public.oal_bookings b
    join public.oal_hotels h on h.id = b.hotel_id
   where b.user_id = p_user_id and b.reference = upper(trim(coalesce(p_reference, ''))) and h.country = v_life.country;
  if v_phone <> '' then
    -- A local number may be given without the country code (0 and nine digits).
    if v_phone ~ '^0[0-9]{9}$' then
      v_phone := '+' || (case v_life.country when 'LR' then '231' else '233' end) || substr(v_phone, 2);
    end if;
    select s.* into v_sim from public.oal_sims s join public.oal_networks n on n.id = s.network where s.number = v_phone and n.country = v_life.country;
    if v_sim.id is not null then
      v_host := jsonb_build_object(
        'self', v_sim.user_id = p_user_id,
        'here', exists (select 1 from public.oal_lives l where l.user_id = v_sim.user_id and l.country = v_life.country and l.state in ('settled', 'working')),
        'phone', exists (select 1 from public.oal_phones ph where ph.user_id = v_sim.user_id));
    end if;
  end if;
  select jsonb_build_object('kind', v.kind, 'until', v.valid_until, 'number', v.number) into v_visa
    from public.oal_visas v
   where v.user_id = p_user_id and v.country = v_life.country and v.issued_on <= v_arrival and v.valid_until > v_arrival
   order by (v.kind = 'work') desc, v.valid_until desc limit 1;
  select coalesce(sum(case b.currency
                        when 'USD' then b.amount
                        when 'LRD' then b.amount / v_settings.usd_lrd
                        when 'GHS' then b.amount / v_settings.usd_ghs
                      end), 0) / 100
    into v_funds
    from public.oal_balances b where b.user_id = p_user_id;
  return jsonb_build_object('ok', true, 'trip_id', v_trip.id, 'facts', jsonb_build_object(
    'country', v_life.country,
    'nationality', coalesce(v_passport.country, (select l.home_country from public.oal_lives l where l.user_id = p_user_id)),
    'arrival', v_arrival,
    'passport', case when v_passport.user_id is null then null else jsonb_build_object('number', v_passport.number, 'expires', v_passport.expires_on) end,
    'ticketOut', v_ticket_out,
    'booking', v_booking,
    'host', v_host,
    'visa', v_visa,
    'fundsUsd', v_funds));
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['public.oal_apply(uuid, text, text)', 'public.oal_start_shift(uuid, text, integer, bigint)', 'public.oal_border_facts(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  execute 'revoke all on function private.oal_settle(uuid) from public, anon, authenticated, service_role';
end;
$$;
