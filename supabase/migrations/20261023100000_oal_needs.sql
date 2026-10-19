-- One Africa Life: the body's needs, and overstaying.
--
-- Food, rest and health, kept on the game's clock and brought up to date whenever the life is
-- looked at (private.oal_settle), as travel and work are:
--   * Food: a full stomach (100) empties in 25 game hours awake, more slowly asleep.
--   * Rest: spent in about 16 waking hours, faster at work; a night's sleep restores it, at
--     a room, a family's house or a hotel; sleeping rough restores half as well, and costs health.
--   * Health: falls while starving or exhausted, recovers while both are above 30. Below 30 a
--     life is unwell and cannot work. It never falls below 10 from needs alone: someone away
--     from the game comes back weak, not dead. The clinic (3 hours) leaves them healthy.
--   * Eating: a cookshop plate; cooking with groceries where there is a kitchen (one's room,
--     or the family's in the home town); a free meal with family at home, once a day.
-- A life cannot start a day's work too tired (rest under 15) or unwell.
--
-- Overstaying: a visitor still in the country after the date the officer gave, with no visa
-- covering it, pays US$10 a day overstayed at the airport before boarding (oal_board), and it is
-- remembered: more than 30 days of it in a year, and the officer refuses entry next time.

alter table public.oal_lives
  add column hunger numeric(5, 2) not null default 80 check (hunger between 0 and 100),
  add column energy numeric(5, 2) not null default 80 check (energy between 0 and 100),
  add column health numeric(5, 2) not null default 100 check (health between 0 and 100),
  add column needs_at timestamp,
  add column busy_until timestamp,
  add column busy_kind text check (busy_kind in ('sleep_good', 'sleep_rough')),
  add column family_meal_on date;
update public.oal_lives set needs_at = public.oal_game_time();
alter table public.oal_lives alter column needs_at set not null;
alter table public.oal_lives alter column needs_at set default '2026-10-18';
-- A new life's body is reckoned from the moment it begins.
create function private.oal_lives_needs_start() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.needs_at := public.oal_game_time();
  return new;
end;
$$;
create trigger oal_lives_needs_start before insert on public.oal_lives for each row execute function private.oal_lives_needs_start();
alter table public.oal_lives drop constraint oal_lives_state_check;
alter table public.oal_lives add constraint oal_lives_state_check check (state in ('settled', 'in_flight', 'arrivals', 'cleared', 'held', 'working', 'sleeping', 'clinic'));

create table public.oal_overstays (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  country text not null check (country in ('LR', 'GH')),
  days integer not null check (days > 0),
  -- In US cents.
  fine bigint not null check (fine > 0),
  game_at timestamp not null,
  created_at timestamptz not null default now()
);
create index oal_overstays_user on public.oal_overstays (user_id, country, game_at);
alter table public.oal_overstays enable row level security;
revoke all on table public.oal_overstays from public, anon, authenticated;
grant all on table public.oal_overstays to service_role;
grant select on table public.oal_overstays to authenticated;
create policy oal_overstays_deny_client_insert on public.oal_overstays as restrictive for insert to anon, authenticated with check (false);
create policy oal_overstays_deny_client_update on public.oal_overstays as restrictive for update to anon, authenticated using (false) with check (false);
create policy oal_overstays_deny_client_delete on public.oal_overstays as restrictive for delete to anon, authenticated using (false);
create policy oal_overstays_read_own on public.oal_overstays for select to authenticated using (user_id = (select auth.uid()));

/**
 * The body from its last reckoning up to a moment, doing one thing all along: 'awake',
 * 'working', 'sleep_good', 'sleep_rough' or 'clinic'. Food and rest move at that pace (rest
 * rising while asleep); health falls 2 an hour while food or rest is at nothing (never below 10),
 * rises 1 an hour while both are above 30, and sleeping rough costs 1.5 an hour.
 */
create function private.oal_needs_step(p_user_id uuid, p_until timestamp, p_mode text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_hours numeric;
  v_food_rate numeric;
  v_rest_rate numeric;
  v_food numeric;
  v_rest numeric;
  v_health numeric;
  v_empty numeric;
  v_spent numeric;
  v_short numeric;
  v_fine numeric;
begin
  select * into v_life from public.oal_lives l where l.user_id = p_user_id;
  v_hours := extract(epoch from p_until - v_life.needs_at) / 3600;
  if v_hours is null or v_hours <= 0 then
    return;
  end if;
  v_food_rate := case p_mode when 'working' then -5 when 'sleep_good' then -2 when 'sleep_rough' then -2 when 'clinic' then -2 else -4 end;
  v_rest_rate := case p_mode when 'working' then -9 when 'sleep_good' then 12.5 when 'sleep_rough' then 6 when 'clinic' then 2 else -6 end;
  v_food := greatest(0, least(100, v_life.hunger + v_food_rate * v_hours));
  v_rest := greatest(0, least(100, v_life.energy + v_rest_rate * v_hours));
  -- How long food, or rest, was at nothing in this stretch.
  v_empty := greatest(0, v_hours - v_life.hunger / -v_food_rate);
  v_spent := case when v_rest_rate < 0 then greatest(0, v_hours - v_life.energy / -v_rest_rate) else 0 end;
  v_short := greatest(v_empty, v_spent);
  -- And how long both were comfortably above 30 (both start there and stay until the first
  -- drops to 30, or for the whole stretch if neither does).
  if v_life.hunger > 30 and (v_life.energy > 30 or v_rest_rate > 0) then
    v_fine := least(v_hours, (v_life.hunger - 30) / -v_food_rate, case when v_rest_rate < 0 then (v_life.energy - 30) / -v_rest_rate else v_hours end);
  else
    v_fine := 0;
  end if;
  v_health := v_life.health - 2 * v_short + greatest(0, v_fine);
  if p_mode = 'sleep_rough' then
    -- A bench, a doorway: cold, mosquitoes, no proper rest.
    v_health := v_health - 1.5 * v_hours;
  end if;
  v_health := greatest(least(v_life.health, 10), least(100, v_health));
  update public.oal_lives l set hunger = v_food, energy = v_rest, health = v_health, needs_at = p_until where l.user_id = p_user_id;
end;
$$;

/**
 * Brings a life up to the game's present: travel (as before: tickets not used in time are lost,
 * a held traveller's flight leaves, a flight lands), the body (food, rest, health, through what
 * it was doing: working, sleeping, at the clinic; a night or a visit that is over ends), then
 * work: a shift whose time is up is
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
  v_mode text;
  v_end timestamp;
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
  -- The body, up to the end of what it is doing now (a day's work, a night's sleep, a clinic
  -- visit), then what it does after.
  v_mode := case v_life.state when 'working' then 'working' when 'sleeping' then coalesce(v_life.busy_kind, 'sleep_good') when 'clinic' then 'clinic' else 'awake' end;
  v_end := case v_life.state when 'working' then (select s.ends_at from public.oal_shifts s where s.id = v_life.shift_id)
                             when 'sleeping' then v_life.busy_until when 'clinic' then v_life.busy_until else v_now end;
  perform private.oal_needs_step(p_user_id, least(v_now, coalesce(v_end, v_now)), v_mode);
  if v_life.state in ('sleeping', 'clinic') and v_now >= v_life.busy_until then
    if v_life.state = 'clinic' then
      update public.oal_lives l set health = greatest(l.health, 85) where l.user_id = p_user_id;
    end if;
    v_life.state := 'settled';
    update public.oal_lives l set state = 'settled', busy_until = null, busy_kind = null where l.user_id = p_user_id;
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

  -- What is left of the time since, awake.
  perform private.oal_needs_step(p_user_id, v_now, case (select l.state from public.oal_lives l where l.user_id = p_user_id) when 'working' then 'working' when 'sleeping' then 'sleep_good' when 'clinic' then 'clinic' else 'awake' end);

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
 * Eating, sleeping, the clinic, in the town the life is in:
 *   eat_out      a cookshop plate (L$250, GH¢30): food +45
 *   eat_family   with family in the home town, once a game day: free, food +40
 *   cook         groceries (L$150, GH¢15) cooked where there is a kitchen (a room rented in this
 *                town, or the family's in the home town): food +50
 *   sleep        p_hours, 1 to 10: at a room here, the family's in the home town, or a hotel
 *                booked for tonight here; else rough
 *   clinic       L$1,500 or GH¢60, three hours: health to at least 85 at the end
 */
create function public.oal_needs_action(p_user_id uuid, p_action text, p_hours integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_now timestamp := public.oal_game_time();
  v_today date := public.oal_game_time()::date;
  v_local text;
  v_price bigint;
  v_at_home boolean;
  v_kitchen boolean;
  v_bed boolean;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'settled' then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;
  v_local := case v_life.country when 'LR' then 'LRD' else 'GHS' end;
  v_at_home := v_life.place = v_life.home_town and v_life.country = v_life.home_country;
  v_kitchen := v_at_home or exists (
    select 1 from public.oal_leases l join public.oal_rooms r on r.id = l.room_id
     where l.user_id = p_user_id and r.town = v_life.place and r.country = v_life.country and l.starts_on <= v_today and l.ends_on > v_today);
  if p_action = 'eat_out' then
    v_price := case v_life.country when 'LR' then 25000 else 3000 end;
    begin
      perform private.oal_money(p_user_id, v_local, -v_price, 'food');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    update public.oal_lives l set hunger = least(100, l.hunger + 45) where l.user_id = p_user_id;
  elsif p_action = 'eat_family' then
    if not v_at_home then
      return jsonb_build_object('ok', false, 'code', 'NOT_AT_HOME');
    end if;
    if v_life.family_meal_on = v_today then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_ATE_WITH_FAMILY');
    end if;
    update public.oal_lives l set hunger = least(100, l.hunger + 40), family_meal_on = v_today where l.user_id = p_user_id;
  elsif p_action = 'cook' then
    if not v_kitchen then
      return jsonb_build_object('ok', false, 'code', 'NO_KITCHEN');
    end if;
    v_price := case v_life.country when 'LR' then 15000 else 1500 end;
    begin
      perform private.oal_money(p_user_id, v_local, -v_price, 'groceries');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    update public.oal_lives l set hunger = least(100, l.hunger + 50) where l.user_id = p_user_id;
  elsif p_action = 'sleep' then
    if p_hours is null or p_hours not between 1 and 10 then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    v_bed := v_kitchen or exists (
      select 1 from public.oal_bookings b join public.oal_hotels h on h.id = b.hotel_id
       where b.user_id = p_user_id and h.town = v_life.place and h.country = v_life.country and b.from_date <= v_today and b.from_date + b.nights > v_today);
    update public.oal_lives l set state = 'sleeping', busy_until = v_now + make_interval(hours => p_hours), busy_kind = case when v_bed then 'sleep_good' else 'sleep_rough' end
     where l.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'until', v_now + make_interval(hours => p_hours), 'rough', not v_bed);
  elsif p_action = 'clinic' then
    v_price := case v_life.country when 'LR' then 150000 else 6000 end;
    begin
      perform private.oal_money(p_user_id, v_local, -v_price, 'clinic');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    update public.oal_lives l set state = 'clinic', busy_until = v_now + interval '3 hours', busy_kind = null where l.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'until', v_now + interval '3 hours');
  else
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  return jsonb_build_object('ok', true);
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
  if v_life.health < 30 then
    return jsonb_build_object('ok', false, 'code', 'UNWELL');
  end if;
  if v_life.energy < 15 then
    return jsonb_build_object('ok', false, 'code', 'TOO_TIRED');
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
 * Boarding: from the airport's town, three hours to thirty minutes before the flight leaves. A
 * visitor who stayed past the date the officer gave (and no visa covered it) pays US$10 a day
 * overstayed first, or cannot board.
 */
create or replace function public.oal_board(p_user_id uuid, p_ticket_id bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_ticket public.oal_tickets;
  v_flight public.oal_flights;
  v_airport public.oal_airports;
  v_departs timestamp;
  v_now timestamp := public.oal_game_time();
  v_trip bigint;
  v_entry public.oal_border_entries;
  v_days integer;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  select * into v_ticket from public.oal_tickets t where t.id = p_ticket_id and t.user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOUR_TICKET');
  end if;
  if v_ticket.status <> 'booked' then
    return jsonb_build_object('ok', false, 'code', case v_ticket.status when 'missed' then 'TOO_LATE' else 'ALREADY_BOARDED' end);
  end if;
  select * into v_flight from public.oal_flights f where f.code = v_ticket.flight_code;
  select * into v_airport from public.oal_airports a where a.code = v_flight.from_airport;
  if v_life.state <> 'settled' or v_life.place <> v_airport.town or v_life.country <> v_airport.country then
    return jsonb_build_object('ok', false, 'code', 'NOT_AT_AIRPORT_TOWN');
  end if;
  v_departs := private.oal_departure(v_flight, v_ticket.flies_on);
  if v_now < v_departs - interval '3 hours' then
    return jsonb_build_object('ok', false, 'code', 'BOARDING_NOT_OPEN');
  end if;
  if v_now > v_departs - interval '30 minutes' then
    return jsonb_build_object('ok', false, 'code', 'TOO_LATE');
  end if;
  -- Leaving after the date the officer gave, with no visa covering it: US$10 a day overstayed,
  -- paid at the airport before boarding, and remembered.
  select * into v_entry from public.oal_border_entries e
   where e.user_id = p_user_id and e.country = v_life.country and e.decision = 'admitted' order by e.id desc limit 1;
  if v_entry.category = 'ecowas_visitor' and v_entry.permitted_until < v_now::date then
    select (v_now::date - greatest(v_entry.permitted_until, coalesce(max(v.valid_until), v_entry.permitted_until)))::int into v_days
      from public.oal_visas v where v.user_id = p_user_id and v.country = v_life.country and v.issued_on <= v_now::date;
    if v_days > 0 then
      begin
        perform private.oal_money(p_user_id, 'USD', -(v_days * 1000)::bigint, 'overstay_fine');
      exception when sqlstate 'AG003' then
        return jsonb_build_object('ok', false, 'code', 'OVERSTAY_FINE_UNPAID', 'days', v_days, 'fine', v_days * 1000);
      end;
      insert into public.oal_overstays (user_id, country, days, fine, game_at) values (p_user_id, v_life.country, v_days, v_days * 1000, v_now);
    end if;
  end if;
  update public.oal_tickets t set status = 'boarded' where t.id = v_ticket.id;
  insert into public.oal_trips (user_id, kind, ticket_id, flight_code, from_airport, to_airport, departs_at, arrives_at)
  values (p_user_id, 'ticket', v_ticket.id, v_flight.code, v_flight.from_airport, v_flight.to_airport, v_departs, v_departs + make_interval(mins => v_flight.minutes))
  returning id into v_trip;
  update public.oal_lives l set state = 'in_flight', trip_id = v_trip where l.user_id = p_user_id;
  return jsonb_build_object('ok', true, 'trip_id', v_trip);
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
  v_overstayed integer;
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
  select coalesce(sum(o.days), 0)::int into v_overstayed
    from public.oal_overstays o where o.user_id = p_user_id and o.country = v_life.country and o.game_at > v_trip.arrives_at - interval '365 days';
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
    'overstayedDays', v_overstayed,
    'fundsUsd', v_funds));
end;
$$;

-- Where a life is now now also says how its body is.
create or replace function public.oal_travel_state(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_trip public.oal_trips;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  select * into v_trip from public.oal_trips t where t.id = v_life.trip_id;
  return jsonb_build_object('ok', true, 'state', v_life.state, 'place', v_life.place, 'country', v_life.country,
    'game_now', public.oal_game_time(),
    'body', jsonb_build_object('food', round(v_life.hunger), 'rest', round(v_life.energy), 'health', round(v_life.health),
      'busy_until', v_life.busy_until, 'rough', v_life.busy_kind = 'sleep_rough', 'family_meal_on', v_life.family_meal_on),
    'trip', case when v_trip.id is null then null else jsonb_build_object('id', v_trip.id, 'kind', v_trip.kind, 'flight', v_trip.flight_code,
      'from', v_trip.from_airport, 'to', v_trip.to_airport, 'departs_at', v_trip.departs_at, 'arrives_at', v_trip.arrives_at) end);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.oal_needs_action(uuid, text, integer)', 'public.oal_start_shift(uuid, text, integer, bigint)', 'public.oal_board(uuid, bigint)',
    'public.oal_border_facts(uuid, text, text)', 'public.oal_travel_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array['private.oal_needs_step(uuid, timestamp, text)', 'private.oal_settle(uuid)', 'private.oal_lives_needs_start()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;
