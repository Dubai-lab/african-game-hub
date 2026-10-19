-- One Africa Life: a phone and its SIM, a rented room, and a host's phone at the border.
--
-- As in real life:
--   * A phone is bought at a phone shop in town: a basic phone or a smartphone.
--   * A SIM is bought from a network (unregistered, it does nothing), and registered at the
--     network's shop with an identity document, as the law requires in both countries: in Ghana
--     a Ghanaian registers with the Ghana Card (the national identity card), a foreigner with a
--     passport; in Liberia a passport does. Registered, it has a number in its network's real
--     prefixes, and works. One SIM per network: many people carry two.
--   * Airtime is bought with local money.
--   * Every Ghanaian life holds a Ghana Card, as most adults do.
--   * A room is rented the way it is: in Monrovia the rent is in US dollars and landlords ask for
--     six months in advance; in Accra and Kumasi twelve. Until then a life lives with family.
--   * At the border, "staying with family or a friend" is checked by calling the host: the number
--     must be registered, in that country, to someone who is there now and has a phone.
-- The networks' names are invented (the prefixes are real); each is a row, so a real network
-- could take its place with its permission.

-- ---------------------------------------------------------------------------------------------
-- The Ghana Card
-- ---------------------------------------------------------------------------------------------

create table public.oal_id_cards (
  user_id uuid primary key references public.oal_lives (user_id) on delete restrict,
  country text not null check (country = 'GH'),
  -- The Ghana Card's number: GHA-, nine digits, a check digit.
  number text not null unique check (number ~ '^GHA-[0-9]{9}-[0-9]$'),
  issued_on date not null,
  expires_on date not null
);

create function private.oal_issue_ghana_card(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.oal_game_time()::date;
  v_number text;
begin
  loop
    v_number := 'GHA-' || lpad(floor(random() * 1000000000)::bigint::text, 9, '0') || '-' || floor(random() * 10)::int::text;
    exit when not exists (select 1 from public.oal_id_cards c where c.number = v_number);
  end loop;
  insert into public.oal_id_cards (user_id, country, number, issued_on, expires_on)
  values (p_user_id, 'GH', v_number, v_today, (v_today + interval '10 years')::date) on conflict do nothing;
end;
$$;

do $$
declare
  l record;
begin
  for l in select user_id from public.oal_lives where home_country = 'GH' loop
    perform private.oal_issue_ghana_card(l.user_id);
  end loop;
end;
$$;

-- A new Ghanaian life starts with its Ghana Card too.
create function private.oal_lives_ghana_card() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.home_country = 'GH' then
    perform private.oal_issue_ghana_card(new.user_id);
  end if;
  return new;
end;
$$;
create trigger oal_lives_ghana_card after insert on public.oal_lives for each row execute function private.oal_lives_ghana_card();

-- ---------------------------------------------------------------------------------------------
-- Phones, networks, SIMs
-- ---------------------------------------------------------------------------------------------

create table public.oal_networks (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  country text not null check (country in ('LR', 'GH')),
  name text not null,
  colour text not null check (colour ~ '^#[0-9a-f]{6}$'),
  -- The national prefixes its numbers start with (after the country code), e.g. '88'.
  prefixes text[] not null,
  -- A SIM's price, in hundredths of the local money.
  sim_price bigint not null check (sim_price >= 0)
);
insert into public.oal_networks values
  ('lr_starline', 'LR', 'Starline Mobile', '#f2c200', array['88', '55'], 10000),
  ('lr_citrus', 'LR', 'Citrus Mobile', '#ff7900', array['77', '78'], 10000),
  ('gh_sika', 'GH', 'Sika Mobile', '#ffcc00', array['24', '54', '55', '59'], 500),
  ('gh_volta', 'GH', 'Volta Telecom', '#d6001c', array['20', '50'], 500),
  ('gh_kasa', 'GH', 'Kasa Networks', '#1d4ed8', array['27', '57'], 500);

-- The phones a shop sells, by country, in hundredths of the local money.
create table public.oal_handsets (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  country text not null check (country in ('LR', 'GH')),
  kind text not null check (kind in ('basic', 'smart')),
  price bigint not null check (price > 0)
);
insert into public.oal_handsets values
  ('lr_basic', 'LR', 'basic', 200000),
  ('lr_smart', 'LR', 'smart', 1520000),
  ('gh_basic', 'GH', 'basic', 15000),
  ('gh_smart', 'GH', 'smart', 120000);

create table public.oal_phones (
  user_id uuid primary key references public.oal_lives (user_id) on delete restrict,
  kind text not null check (kind in ('basic', 'smart')),
  bought_on date not null
);

create table public.oal_sims (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  network text not null references public.oal_networks (id),
  -- Given at registration, in international form: +231 or +233 and nine digits.
  number text unique check (number ~ '^\+23[13][0-9]{9}$'),
  registered_on date,
  -- The document it was registered with.
  id_kind text check (id_kind in ('passport', 'ghana_card')),
  id_number text,
  -- Airtime, in hundredths of the local money.
  airtime bigint not null default 0 check (airtime >= 0),
  bought_on date not null,
  unique (user_id, network),
  check ((number is null) = (registered_on is null))
);

-- ---------------------------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------------------------

create table public.oal_rooms (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  country text not null check (country in ('LR', 'GH')),
  town text not null,
  area text not null,
  kind text not null check (kind in ('single', 'chamber_hall', 'self_contained')),
  currency text not null check (currency in ('LRD', 'USD', 'GHS')),
  -- A month's rent, in hundredths; and how many months a landlord asks for at once.
  rent bigint not null check (rent > 0),
  advance integer not null check (advance between 1 and 24)
);
insert into public.oal_rooms values
  ('paynesville_single', 'LR', 'Monrovia', 'Paynesville', 'single', 'USD', 2500, 6),
  ('sinkor_single', 'LR', 'Monrovia', 'Sinkor', 'single', 'USD', 4000, 6),
  ('sinkor_chamber', 'LR', 'Monrovia', 'Sinkor', 'chamber_hall', 'USD', 8000, 6),
  ('voinjama_single', 'LR', 'Voinjama', 'Voinjama', 'single', 'LRD', 250000, 3),
  ('nima_single', 'GH', 'Accra', 'Nima', 'single', 'GHS', 40000, 12),
  ('osu_self', 'GH', 'Accra', 'Osu', 'self_contained', 'GHS', 150000, 12),
  ('kumasi_single', 'GH', 'Kumasi', 'Asafo', 'single', 'GHS', 25000, 12);

create table public.oal_leases (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  room_id text not null references public.oal_rooms (id),
  starts_on date not null,
  ends_on date not null,
  paid bigint not null check (paid > 0),
  created_at timestamptz not null default now(),
  check (ends_on > starts_on)
);
create index oal_leases_user on public.oal_leases (user_id, ends_on);

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['oal_id_cards', 'oal_networks', 'oal_handsets', 'oal_phones', 'oal_sims', 'oal_rooms', 'oal_leases'] loop
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
  foreach t in array array['oal_networks', 'oal_handsets', 'oal_rooms'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
  foreach t in array array['oal_id_cards', 'oal_phones', 'oal_sims', 'oal_leases'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_read_own', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Buying, registering, topping up, renting
-- ---------------------------------------------------------------------------------------------

/**
 * The phone shop, the network's shop, the landlord. Actions:
 *   buy_phone     p_target = a handset of the country the life is in
 *   buy_sim       p_target = a network of that country
 *   register_sim  p_target = the network; with the document the law asks for (in Ghana, the
 *                 Ghana Card for a Ghanaian, the passport for anyone else; in Liberia, a passport)
 *   top_up        p_target = the network; p_amount of local money
 *   rent          p_target = a room in the town the life is in; the landlord's advance, paid now
 */
create function public.oal_home_action(p_user_id uuid, p_action text, p_target text, p_amount bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_today date := public.oal_game_time()::date;
  v_local text;
  v_handset public.oal_handsets;
  v_network public.oal_networks;
  v_sim public.oal_sims;
  v_room public.oal_rooms;
  v_doc_kind text;
  v_doc_number text;
  v_number text;
  v_from date;
  v_price bigint;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'settled' then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;
  v_local := case v_life.country when 'LR' then 'LRD' else 'GHS' end;

  if p_action = 'buy_phone' then
    select * into v_handset from public.oal_handsets h where h.id = p_target and h.country = v_life.country;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    begin
      perform private.oal_money(p_user_id, v_local, -v_handset.price, 'phone');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    -- A new phone replaces the old one.
    insert into public.oal_phones (user_id, kind, bought_on) values (p_user_id, v_handset.kind, v_today)
    on conflict (user_id) do update set kind = excluded.kind, bought_on = excluded.bought_on;
    return jsonb_build_object('ok', true, 'kind', v_handset.kind);
  end if;

  select * into v_network from public.oal_networks n where n.id = p_target;
  if p_action in ('buy_sim', 'register_sim', 'top_up') and (v_network.id is null or v_network.country <> v_life.country) then
    return jsonb_build_object('ok', false, 'code', 'WRONG_COUNTRY');
  end if;

  if p_action = 'buy_sim' then
    if exists (select 1 from public.oal_sims s where s.user_id = p_user_id and s.network = p_target) then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_HAVE_SIM');
    end if;
    begin
      perform private.oal_money(p_user_id, v_local, -v_network.sim_price, 'sim');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    insert into public.oal_sims (user_id, network, bought_on) values (p_user_id, p_target, v_today);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'register_sim' then
    select * into v_sim from public.oal_sims s where s.user_id = p_user_id and s.network = p_target for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NO_SIM');
    end if;
    if v_sim.number is not null then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_REGISTERED');
    end if;
    -- The document the law asks for.
    if v_life.country = 'GH' and v_life.home_country = 'GH' then
      v_doc_kind := 'ghana_card';
      select c.number into v_doc_number from public.oal_id_cards c where c.user_id = p_user_id and c.expires_on > v_today;
    else
      v_doc_kind := 'passport';
      select p.number into v_doc_number from public.oal_passports p where p.user_id = p_user_id and p.expires_on > v_today;
    end if;
    if v_doc_number is null then
      return jsonb_build_object('ok', false, 'code', 'NO_DOCUMENT');
    end if;
    loop
      v_number := '+' || (case v_life.country when 'LR' then '231' else '233' end)
        || v_network.prefixes[1 + floor(random() * array_length(v_network.prefixes, 1))::int]
        || lpad(floor(random() * 10000000)::int::text, 7, '0');
      exit when not exists (select 1 from public.oal_sims s where s.number = v_number);
    end loop;
    update public.oal_sims s set number = v_number, registered_on = v_today, id_kind = v_doc_kind, id_number = v_doc_number where s.id = v_sim.id;
    return jsonb_build_object('ok', true, 'number', v_number, 'document', v_doc_kind);
  end if;

  if p_action = 'top_up' then
    select * into v_sim from public.oal_sims s where s.user_id = p_user_id and s.network = p_target for update;
    if not found or v_sim.number is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_REGISTERED');
    end if;
    if p_amount is null or p_amount < 100 or p_amount > 100000000 then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    begin
      perform private.oal_money(p_user_id, v_local, -p_amount, 'airtime');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    update public.oal_sims s set airtime = s.airtime + p_amount where s.id = v_sim.id;
    return jsonb_build_object('ok', true, 'airtime', v_sim.airtime + p_amount);
  end if;

  if p_action = 'rent' then
    select * into v_room from public.oal_rooms r where r.id = p_target;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    if v_room.town <> v_life.place or v_room.country <> v_life.country then
      return jsonb_build_object('ok', false, 'code', 'WRONG_TOWN');
    end if;
    -- A new lease starts when the one there ends (renewing), or today.
    select max(l.ends_on) into v_from from public.oal_leases l where l.user_id = p_user_id and l.room_id = p_target and l.ends_on > v_today;
    if exists (select 1 from public.oal_leases l where l.user_id = p_user_id and l.room_id <> p_target and l.ends_on > v_today) then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_RENTING');
    end if;
    v_from := coalesce(v_from, v_today);
    v_price := v_room.rent * v_room.advance;
    begin
      perform private.oal_money(p_user_id, v_room.currency, -v_price, 'rent');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    insert into public.oal_leases (user_id, room_id, starts_on, ends_on, paid)
    values (p_user_id, p_target, v_from, (v_from + make_interval(months => v_room.advance))::date, v_price);
    return jsonb_build_object('ok', true, 'until', (v_from + make_interval(months => v_room.advance))::date);
  end if;

  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The border: the host's phone
-- ---------------------------------------------------------------------------------------------

-- The facts now include, when a host's number is given, what calling it finds.
drop function public.oal_border_facts(uuid, text);

/**
 * What the immigration officer can check about a traveller in an arrivals hall: the shape of
 * BorderFacts in supabase/functions/_shared/oalBorder.ts, plus the trip. The booking is looked
 * up by the reference the traveller gives; a host by the number given (registered in this
 * country? to the traveller? is its owner here now, with a phone?).
 */
create function public.oal_border_facts(p_user_id uuid, p_reference text, p_phone text) returns jsonb
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
    'fundsUsd', v_funds));
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['public.oal_home_action(uuid, text, text, bigint)', 'public.oal_border_facts(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array['private.oal_issue_ghana_card(uuid)', 'private.oal_lives_ghana_card()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;
