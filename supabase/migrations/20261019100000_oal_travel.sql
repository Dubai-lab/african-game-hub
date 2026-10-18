-- One Africa Life: travelling between Liberia and Ghana by air, and crossing the border.
--
-- How it goes, as in real life:
--   1. Every life holds its country's passport (Liberia's lasts 5 years, Ghana's 10).
--   2. A ticket is bought for a scheduled flight on a date (the airlines' fares are in US
--      dollars). A hotel can be booked the same way; its booking reference is what an
--      immigration officer will ask for.
--   3. Boarding is from three hours to thirty minutes before the flight leaves, from the town
--      the airport serves (Roberts International serves Monrovia; Kotoka, Accra). Too late is
--      too late: the ticket is lost.
--   4. The flight takes its real time on the game's clock (about two hours: some four real
--      minutes). On landing the traveller is in the arrivals hall, before immigration.
--   5. The officer (a bot) decides by the rules in supabase/functions/_shared/oalBorder.ts; the
--      oal-travel Edge Function gathers the facts here, decides, and records the decision here.
--      Admitted: through to the landside, then out into the town. Refused: held at the airport
--      and flown back on the next flight home (the airline's duty, at no cost).
--
-- Where a life is (oal_lives.state):
--   settled      in a town (oal_lives.place)
--   in_flight    on a trip (boarded; before take-off they wait at the gate)
--   arrivals     landed, before immigration (place is the airport's code)
--   cleared      through immigration, still inside the airport
--   held         refused entry, waiting for the flight back
-- Changes of state that only time makes (landing, a held traveller's flight leaving, a ticket
-- not used in time) are applied whenever the life is next looked at (private.oal_settle).

alter table public.oal_settings
  add column usd_lrd integer not null default 190 check (usd_lrd > 0),
  add column usd_ghs integer not null default 12 check (usd_ghs > 0);

-- ---------------------------------------------------------------------------------------------
-- What there is: airports, flights, hotels
-- ---------------------------------------------------------------------------------------------

create table public.oal_airports (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  country text not null check (country in ('LR', 'GH')),
  -- The town the airport serves: travellers board from it and arrive into it.
  town text not null
);
insert into public.oal_airports values
  ('ROB', 'Roberts International Airport', 'LR', 'Monrovia'),
  ('ACC', 'Kotoka International Airport', 'GH', 'Accra');

-- The timetable: every flight flies every day, at the same time (game time, GMT, which is the
-- time in both countries). The airlines are invented.
create table public.oal_flights (
  code text primary key check (code ~ '^[A-Z]{2}[0-9]{3}$'),
  airline text not null,
  from_airport text not null references public.oal_airports (code),
  to_airport text not null references public.oal_airports (code),
  departs time not null,
  minutes integer not null check (minutes between 20 and 900),
  -- In US cents.
  fare bigint not null check (fare > 0),
  check (from_airport <> to_airport)
);
insert into public.oal_flights values
  ('CL301', 'Coastline Air', 'ROB', 'ACC', '09:40', 125, 38500),
  ('CL302', 'Coastline Air', 'ACC', 'ROB', '13:05', 125, 38500),
  ('KA714', 'Kente Air', 'ROB', 'ACC', '17:20', 130, 34500),
  ('KA715', 'Kente Air', 'ACC', 'ROB', '06:30', 130, 34500);

-- Hotels (invented names, real neighbourhoods), priced per night in US cents, booked online.
create table public.oal_hotels (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  country text not null check (country in ('LR', 'GH')),
  town text not null,
  name text not null,
  area text not null,
  nightly bigint not null check (nightly > 0)
);
insert into public.oal_hotels values
  ('sinkor_palm', 'LR', 'Monrovia', 'Sinkor Palm Hotel', 'Sinkor, Tubman Boulevard', 9500),
  ('bushrod_lodge', 'LR', 'Monrovia', 'Bushrod Harbour Lodge', 'Bushrod Island', 5500),
  ('congo_town_suites', 'LR', 'Monrovia', 'Congo Town Royal Suites', 'Congo Town', 16000),
  ('lofa_hills', 'LR', 'Voinjama', 'Lofa Hills Guesthouse', 'Voinjama', 3500),
  ('osu_garden', 'GH', 'Accra', 'Osu Garden Lodge', 'Osu', 7000),
  ('airport_residential', 'GH', 'Accra', 'Airport Residential Suites', 'Airport Residential Area', 15000),
  ('kokomlemle_guesthouse', 'GH', 'Accra', 'Kokomlemle Guesthouse', 'Kokomlemle', 4000),
  ('adum_heritage', 'GH', 'Kumasi', 'Adum Heritage Hotel', 'Adum', 6000);

-- ---------------------------------------------------------------------------------------------
-- Where each life is, and its passport
-- ---------------------------------------------------------------------------------------------

alter table public.oal_lives
  add column country text check (country in ('LR', 'GH')),
  add column place text,
  add column state text check (state in ('settled', 'in_flight', 'arrivals', 'cleared', 'held')),
  add column trip_id bigint;
update public.oal_lives set country = home_country, place = home_town, state = 'settled';
alter table public.oal_lives
  alter column country set not null,
  alter column place set not null,
  alter column state set not null;

create table public.oal_passports (
  user_id uuid primary key references public.oal_lives (user_id) on delete restrict,
  country text not null check (country in ('LR', 'GH')),
  number text not null unique check (number ~ '^[RG][0-9]{7}$'),
  issued_on date not null,
  expires_on date not null,
  check (expires_on > issued_on)
);

create table public.oal_tickets (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  flight_code text not null references public.oal_flights (code),
  flies_on date not null,
  fare bigint not null check (fare > 0),
  status text not null default 'booked' check (status in ('booked', 'boarded', 'missed')),
  bought_game_at timestamp not null,
  created_at timestamptz not null default now(),
  unique (user_id, flight_code, flies_on)
);
create index oal_tickets_user on public.oal_tickets (user_id, flies_on);

create table public.oal_trips (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  -- A ticket's flight, or the flight back of a traveller refused entry.
  kind text not null check (kind in ('ticket', 'removal')),
  ticket_id bigint unique references public.oal_tickets (id),
  flight_code text not null references public.oal_flights (code),
  from_airport text not null references public.oal_airports (code),
  to_airport text not null references public.oal_airports (code),
  departs_at timestamp not null,
  arrives_at timestamp not null,
  created_at timestamptz not null default now(),
  check (arrives_at > departs_at),
  check ((kind = 'ticket') = (ticket_id is not null))
);
create index oal_trips_user on public.oal_trips (user_id, id);
alter table public.oal_lives add constraint oal_lives_trip foreign key (trip_id) references public.oal_trips (id);

create table public.oal_bookings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  hotel_id text not null references public.oal_hotels (id),
  reference text not null unique check (reference ~ '^HB-[A-Z0-9]{6}$'),
  from_date date not null,
  nights integer not null check (nights between 1 and 30),
  price bigint not null check (price > 0),
  created_at timestamptz not null default now()
);
create index oal_bookings_user on public.oal_bookings (user_id, from_date);

-- Every border crossing: what was answered, what was decided and why. Once per landing.
create table public.oal_border_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  trip_id bigint not null unique references public.oal_trips (id),
  country text not null check (country in ('LR', 'GH')),
  airport text not null references public.oal_airports (code),
  category text not null check (category in ('citizen', 'ecowas_visitor')),
  decision text not null check (decision in ('admitted', 'refused')),
  permitted_until date,
  answers jsonb,
  reasons text[] not null default '{}',
  game_at timestamp not null,
  created_at timestamptz not null default now()
);
create index oal_border_entries_user on public.oal_border_entries (user_id, id);

-- Players read what there is, and their own papers, tickets, trips, bookings and crossings;
-- nobody writes any of it from the app.
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['oal_airports', 'oal_flights', 'oal_hotels', 'oal_passports', 'oal_tickets', 'oal_trips', 'oal_bookings', 'oal_border_entries'] loop
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
  foreach t in array array['oal_airports', 'oal_flights', 'oal_hotels'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
  foreach t in array array['oal_passports', 'oal_tickets', 'oal_trips', 'oal_bookings', 'oal_border_entries'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_read_own', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Passports
-- ---------------------------------------------------------------------------------------------

/** A passport for a life: a new number, valid from today for its country's term. */
create function private.oal_issue_passport(p_user_id uuid, p_country text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.oal_game_time()::date;
  v_number text;
begin
  loop
    v_number := (case p_country when 'LR' then 'R' else 'G' end) || lpad(floor(random() * 10000000)::int::text, 7, '0');
    exit when not exists (select 1 from public.oal_passports p where p.number = v_number);
  end loop;
  insert into public.oal_passports (user_id, country, number, issued_on, expires_on)
  values (p_user_id, p_country, v_number, v_today, (v_today + make_interval(years => case p_country when 'LR' then 5 else 10 end))::date);
end;
$$;

do $$
declare
  l record;
begin
  for l in select user_id, home_country from public.oal_lives loop
    perform private.oal_issue_passport(l.user_id, l.home_country);
  end loop;
end;
$$;

-- A new life now also starts where it lives, with its passport.
create or replace function public.oal_start_life(
  p_user_id uuid,
  p_game_name text,
  p_sex text,
  p_age integer,
  p_home_country text,
  p_home_town text,
  p_appearance jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.oal_settings;
  v_today date := public.oal_game_time()::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('agh:oal:' || p_user_id::text, 0));
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;
  if exists (select 1 from public.oal_lives l where l.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_LIVING');
  end if;
  if p_age not between 18 and 60 or p_sex not in ('male', 'female') or p_appearance ->> 'sex' is distinct from p_sex
     or not ((p_home_country = 'LR' and p_home_town in ('Monrovia', 'Voinjama')) or (p_home_country = 'GH' and p_home_town in ('Accra', 'Kumasi'))) then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;

  insert into public.oal_lives (user_id, game_name, sex, born_on, home_country, home_town, appearance, country, place, state)
  values (p_user_id, p_game_name, p_sex, (v_today - make_interval(years => p_age))::date, p_home_country, p_home_town, p_appearance,
          p_home_country, p_home_town, 'settled');
  perform private.oal_issue_passport(p_user_id, p_home_country);

  -- What a new life starts with: a little money in the home currency, and a few US dollars.
  select * into v_settings from public.oal_settings;
  if p_home_country = 'LR' then
    perform private.oal_money(p_user_id, 'LRD', v_settings.start_lrd, 'start');
  else
    -- About the same value in cedis (the rates are the game's own; see the design document).
    perform private.oal_money(p_user_id, 'GHS', v_settings.start_lrd / 16, 'start');
  end if;
  perform private.oal_money(p_user_id, 'USD', v_settings.start_usd, 'start');
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Time's changes
-- ---------------------------------------------------------------------------------------------

/** When a flight leaves on a date (game time). */
create function private.oal_departure(p_flight public.oal_flights, p_on date) returns timestamp
language sql
immutable
set search_path = ''
as $$
  select p_on + p_flight.departs;
$$;

/**
 * Brings a life up to the game's present: tickets not used in time are lost, a held traveller's
 * flight leaves, a flight lands. Takes the life's row lock; returns the life as it now is.
 */
create function private.oal_settle(p_user_id uuid) returns public.oal_lives
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_trip public.oal_trips;
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
    update public.oal_lives l set state = v_life.state, place = v_life.place, country = v_life.country where l.user_id = p_user_id;
  end if;
  return v_life;
end;
$$;

/** Where a life is now (after time's changes), for the app. */
create function public.oal_travel_state(p_user_id uuid) returns jsonb
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
    'trip', case when v_trip.id is null then null else jsonb_build_object('id', v_trip.id, 'kind', v_trip.kind, 'flight', v_trip.flight_code,
      'from', v_trip.from_airport, 'to', v_trip.to_airport, 'departs_at', v_trip.departs_at, 'arrives_at', v_trip.arrives_at) end);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tickets, boarding, hotels
-- ---------------------------------------------------------------------------------------------

/** A ticket for a flight on a date, paid in US dollars. Up to 90 game days ahead. */
create function public.oal_book_flight(p_user_id uuid, p_flight text, p_on date) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_flight public.oal_flights;
  v_now timestamp := public.oal_game_time();
  v_id bigint;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  select * into v_flight from public.oal_flights f where f.code = p_flight;
  if not found or p_on is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if private.oal_departure(v_flight, p_on) < v_now + interval '1 hour' then
    return jsonb_build_object('ok', false, 'code', 'TOO_LATE');
  end if;
  if p_on > v_now::date + 90 then
    return jsonb_build_object('ok', false, 'code', 'TOO_FAR_AHEAD');
  end if;
  if exists (select 1 from public.oal_tickets t where t.user_id = p_user_id and t.flight_code = p_flight and t.flies_on = p_on) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_BOOKED');
  end if;
  begin
    perform private.oal_money(p_user_id, 'USD', -v_flight.fare, 'flight_ticket');
  exception when sqlstate 'AG003' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
  end;
  insert into public.oal_tickets (user_id, flight_code, flies_on, fare, bought_game_at)
  values (p_user_id, p_flight, p_on, v_flight.fare, v_now) returning id into v_id;
  return jsonb_build_object('ok', true, 'ticket_id', v_id);
end;
$$;

/** Boarding: from the airport's town, three hours to thirty minutes before the flight leaves. */
create function public.oal_board(p_user_id uuid, p_ticket_id bigint) returns jsonb
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
  update public.oal_tickets t set status = 'boarded' where t.id = v_ticket.id;
  insert into public.oal_trips (user_id, kind, ticket_id, flight_code, from_airport, to_airport, departs_at, arrives_at)
  values (p_user_id, 'ticket', v_ticket.id, v_flight.code, v_flight.from_airport, v_flight.to_airport, v_departs, v_departs + make_interval(mins => v_flight.minutes))
  returning id into v_trip;
  update public.oal_lives l set state = 'in_flight', trip_id = v_trip where l.user_id = p_user_id;
  return jsonb_build_object('ok', true, 'trip_id', v_trip);
end;
$$;

/** A hotel booked for nights from a date, paid in US dollars; its reference is the proof. */
create function public.oal_book_hotel(p_user_id uuid, p_hotel text, p_from date, p_nights integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_hotel public.oal_hotels;
  v_today date := public.oal_game_time()::date;
  v_reference text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  select * into v_hotel from public.oal_hotels h where h.id = p_hotel;
  if not found or p_from is null or p_nights is null or p_nights not between 1 and 30 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if p_from < v_today or p_from > v_today + 90 then
    return jsonb_build_object('ok', false, 'code', 'BAD_DATES');
  end if;
  begin
    perform private.oal_money(p_user_id, 'USD', -(v_hotel.nightly * p_nights), 'hotel_booking');
  exception when sqlstate 'AG003' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
  end;
  loop
    v_reference := 'HB-' || (select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.oal_bookings b where b.reference = v_reference);
  end loop;
  insert into public.oal_bookings (user_id, hotel_id, reference, from_date, nights, price)
  values (p_user_id, p_hotel, v_reference, p_from, p_nights, v_hotel.nightly * p_nights);
  return jsonb_build_object('ok', true, 'reference', v_reference);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The border
-- ---------------------------------------------------------------------------------------------

/**
 * What the immigration officer can check about a traveller in an arrivals hall: the shape of
 * BorderFacts in supabase/functions/_shared/oalBorder.ts, plus the trip. The booking is looked
 * up by the reference the traveller gives (null when it is not theirs, or not in this country).
 */
create function public.oal_border_facts(p_user_id uuid, p_reference text) returns jsonb
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
  v_funds bigint;
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
    'fundsUsd', v_funds));
end;
$$;

/**
 * The officer's decision on a landing, recorded once. Admitted: through to the landside.
 * Refused: held, and put on the next flight back to where they came from (at least an hour
 * away), at the airline's cost.
 */
create function public.oal_border_record(p_user_id uuid, p_trip_id bigint, p_category text, p_decision text, p_permitted_until date, p_answers jsonb, p_reasons text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_trip public.oal_trips;
  v_now timestamp := public.oal_game_time();
  v_back public.oal_flights;
  v_departs timestamp;
  v_removal bigint;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'arrivals' or v_life.trip_id is distinct from p_trip_id then
    return jsonb_build_object('ok', false, 'code', 'NOT_AT_ARRIVALS');
  end if;
  if p_decision not in ('admitted', 'refused') or p_category not in ('citizen', 'ecowas_visitor')
     or (p_decision = 'refused' and p_category = 'citizen') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  select * into v_trip from public.oal_trips t where t.id = p_trip_id;
  insert into public.oal_border_entries (user_id, trip_id, country, airport, category, decision, permitted_until, answers, reasons, game_at)
  values (p_user_id, p_trip_id, v_life.country, v_trip.to_airport, p_category, p_decision, p_permitted_until, p_answers, coalesce(p_reasons, '{}'), v_now);

  if p_decision = 'admitted' then
    update public.oal_lives l set state = 'cleared' where l.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'decision', 'admitted', 'permitted_until', p_permitted_until);
  end if;

  -- The next flight back, whichever airline, at least an hour from now.
  select f.* into v_back
    from public.oal_flights f
   cross join lateral (select (v_now::date + k) as on_date from generate_series(0, 2) k) d
   where f.from_airport = v_trip.to_airport and f.to_airport = v_trip.from_airport
     and private.oal_departure(f, d.on_date) >= v_now + interval '1 hour'
   order by private.oal_departure(f, d.on_date)
   limit 1;
  select min(private.oal_departure(f, (v_now::date + k)))
    into v_departs
    from public.oal_flights f, generate_series(0, 2) k
   where f.code = v_back.code and private.oal_departure(f, (v_now::date + k)) >= v_now + interval '1 hour';
  insert into public.oal_trips (user_id, kind, flight_code, from_airport, to_airport, departs_at, arrives_at)
  values (p_user_id, 'removal', v_back.code, v_back.from_airport, v_back.to_airport, v_departs, v_departs + make_interval(mins => v_back.minutes))
  returning id into v_removal;
  update public.oal_lives l set state = 'held', trip_id = v_removal where l.user_id = p_user_id;
  return jsonb_build_object('ok', true, 'decision', 'refused', 'reasons', to_jsonb(coalesce(p_reasons, '{}')), 'flight_back', v_back.code, 'departs_at', v_departs);
end;
$$;

/** Out of the airport, cleared, into the town it serves. */
create function public.oal_leave_airport(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_town text;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'cleared' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CLEARED');
  end if;
  select a.town into v_town from public.oal_airports a where a.code = v_life.place;
  update public.oal_lives l set state = 'settled', place = v_town, trip_id = null where l.user_id = p_user_id;
  return jsonb_build_object('ok', true, 'place', v_town);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- An admin's correction of a life's money (testing, mistakes): an entry like any other, audited.
-- ---------------------------------------------------------------------------------------------

create function public.admin_oal_adjust(p_admin_id uuid, p_user_id uuid, p_currency text, p_amount bigint, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_after bigint;
begin
  if v_reason is null or char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000000 or p_currency not in ('LRD', 'USD', 'GHS') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if not exists (select 1 from public.oal_lives l where l.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  begin
    v_after := private.oal_money(p_user_id, p_currency, p_amount, 'adjustment');
  exception when sqlstate 'AG003' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
  end;
  perform private.audit(p_admin_id, 'oal_adjust', p_user_id, null, jsonb_build_object('currency', p_currency, 'amount', p_amount, 'reason', v_reason, 'balance_after', v_after));
  return jsonb_build_object('ok', true, 'balance_after', v_after);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.oal_travel_state(uuid)',
    'public.oal_book_flight(uuid, text, date)',
    'public.oal_board(uuid, bigint)',
    'public.oal_book_hotel(uuid, text, date, integer)',
    'public.oal_border_facts(uuid, text)',
    'public.oal_border_record(uuid, bigint, text, text, date, jsonb, text[])',
    'public.oal_leave_airport(uuid)',
    'public.admin_oal_adjust(uuid, uuid, text, bigint, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array['private.oal_issue_passport(uuid, text)', 'private.oal_settle(uuid)', 'private.oal_departure(public.oal_flights, date)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;
