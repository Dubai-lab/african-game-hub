-- One Africa Life: travel by road inside a country, and rides across town.
--
-- As it is done:
--   * Up-country from Monrovia you go from a parking station (Red Light, Paynesville): a shared
--     car (a saloon taking five, leaving when full: about an hour after taking a seat, from six
--     in the morning to three in the afternoon) or the bus (once a day, at seven). The fare is
--     paid in cash at the station. Monrovia to Voinjama is about 410 km by Gbarnga, the last part
--     on laterite: the car takes nine hours, the bus twelve. Arrived, the traveller is in the
--     other town. Riding, the body goes on as when awake (food and rest fall).
--   * Across town (from Sinkor to Waterside...): a kekeh (L$100, GH¢10) or a taxi (L$150,
--     GH¢15), paid to the rider; or walking, for nothing. Out to the airport, a taxi: L$3,000 to
--     Roberts International (48 km, at Harbel), GH¢100 to Kotoka. The ride is charged here;
--     where in town the player is stays the player's own.
-- Routes are rows: Ghana's (Accra to Kumasi) come with Ghana's towns.

create table public.oal_road_routes (
  id text primary key,
  country text not null check (country in ('LR', 'GH')),
  from_town text not null,
  to_town text not null,
  mode text not null check (mode in ('car', 'bus')),
  station text not null,
  -- Hundredths of the local money.
  fare bigint not null check (fare > 0),
  currency text not null check (currency in ('LRD', 'GHS')),
  hours numeric not null check (hours > 0),
  -- The bus's departure each day; a shared car leaves when full, an hour after boarding, within
  -- these hours.
  departs time,
  opens time not null default '06:00',
  closes time not null default '15:00',
  km integer not null,
  check (from_town <> to_town)
);
insert into public.oal_road_routes (id, country, from_town, to_town, mode, station, fare, currency, hours, departs, km) values
  ('mon_voi_car', 'LR', 'Monrovia', 'Voinjama', 'car', 'Red Light parking station, Paynesville', 400000, 'LRD', 9, null, 410),
  ('mon_voi_bus', 'LR', 'Monrovia', 'Voinjama', 'bus', 'Red Light parking station, Paynesville', 250000, 'LRD', 12, '07:00', 410),
  ('voi_mon_car', 'LR', 'Voinjama', 'Monrovia', 'car', 'Voinjama parking station', 400000, 'LRD', 9, null, 410),
  ('voi_mon_bus', 'LR', 'Voinjama', 'Monrovia', 'bus', 'Voinjama parking station', 250000, 'LRD', 12, '07:00', 410);
alter table public.oal_road_routes enable row level security;
revoke all on table public.oal_road_routes from public, anon, authenticated;
grant all on table public.oal_road_routes to service_role;
grant select on table public.oal_road_routes to authenticated;
create policy oal_road_routes_read on public.oal_road_routes for select to authenticated using (true);
create policy oal_road_routes_deny_insert on public.oal_road_routes as restrictive for insert to anon, authenticated with check (false);
create policy oal_road_routes_deny_update on public.oal_road_routes as restrictive for update to anon, authenticated using (false) with check (false);
create policy oal_road_routes_deny_delete on public.oal_road_routes as restrictive for delete to anon, authenticated using (false);

create table public.oal_road_trips (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  route_id text not null references public.oal_road_routes (id),
  boarded_at timestamp not null,
  departs_at timestamp not null,
  arrives_at timestamp not null,
  status text not null default 'riding' check (status in ('riding', 'arrived')),
  created_at timestamptz not null default now(),
  check (arrives_at > departs_at and departs_at >= boarded_at)
);
create index oal_road_trips_user on public.oal_road_trips (user_id, id desc);
alter table public.oal_road_trips enable row level security;
revoke all on table public.oal_road_trips from public, anon, authenticated;
grant all on table public.oal_road_trips to service_role;
grant select on table public.oal_road_trips to authenticated;
create policy oal_road_trips_read_own on public.oal_road_trips for select to authenticated using (user_id = (select auth.uid()));
create policy oal_road_trips_deny_insert on public.oal_road_trips as restrictive for insert to anon, authenticated with check (false);
create policy oal_road_trips_deny_update on public.oal_road_trips as restrictive for update to anon, authenticated using (false) with check (false);
create policy oal_road_trips_deny_delete on public.oal_road_trips as restrictive for delete to anon, authenticated using (false);

alter table public.oal_lives add column road_trip_id bigint references public.oal_road_trips (id);
alter table public.oal_lives drop constraint oal_lives_state_check;
alter table public.oal_lives add constraint oal_lives_state_check check (state in ('settled', 'in_flight', 'arrivals', 'cleared', 'held', 'working', 'sleeping', 'clinic', 'on_road'));


/**
 * Arrival by road: a trip whose time has come ends in its town. Called by private.oal_settle
 * (below) before the rest of its work, under the life's row lock.
 */
create function private.oal_road_step(p_user_id uuid, p_now timestamp) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.oal_road_trips;
  v_route public.oal_road_routes;
begin
  select t.* into v_trip from public.oal_lives l join public.oal_road_trips t on t.id = l.road_trip_id
   where l.user_id = p_user_id and l.state = 'on_road';
  if v_trip.id is null or p_now < v_trip.arrives_at then
    return;
  end if;
  -- The body rode until the trip ended, awake.
  perform private.oal_needs_step(p_user_id, v_trip.arrives_at, 'awake');
  select * into v_route from public.oal_road_routes r where r.id = v_trip.route_id;
  update public.oal_road_trips t set status = 'arrived' where t.id = v_trip.id;
  update public.oal_lives l set state = 'settled', place = v_route.to_town, country = v_route.country, road_trip_id = null where l.user_id = p_user_id;
end;
$$;

-- oal_settle as before, with the road's arrivals first. (Wrapped, not copied: the road step
-- runs, then the settle all else depends on.)
alter function private.oal_settle(uuid) rename to oal_settle_core;
create function private.oal_settle(p_user_id uuid) returns public.oal_lives
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.oal_lives l where l.user_id = p_user_id and l.state = 'on_road') then
    perform 1 from public.oal_lives l where l.user_id = p_user_id for update;
    perform private.oal_road_step(p_user_id, public.oal_game_time());
  end if;
  return private.oal_settle_core(p_user_id);
end;
$$;

/**
 * Travel by road:
 *   ride     p_target a route from the town the life is in: the fare paid in cash at the
 *            station; the shared car leaves within the hour (06:00 to 15:00), the bus at its
 *            hour (boarding from an hour and a half before; after it, the next day's)
 *   town     p_target 'kekeh', 'taxi' or 'walk': a ride across town, paid to the rider;
 *            'airport': a taxi out to the airport
 */
create function public.oal_road_action(p_user_id uuid, p_action text, p_target text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_route public.oal_road_routes;
  v_now timestamp := public.oal_game_time();
  v_departs timestamp;
  v_fare bigint;
  v_trip bigint;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'settled' then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;

  if p_action = 'town' then
    if p_target = 'walk' then
      return jsonb_build_object('ok', true, 'fare', 0);
    end if;
    v_fare := case
      when p_target = 'airport' then (case v_life.country when 'LR' then 300000 else 10000 end)
      else (case p_target when 'kekeh' then 100 when 'taxi' then 150 end) * (case v_life.country when 'LR' then 100 else 10 end)
    end;
    if v_fare is null then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    begin
      perform private.oal_money(p_user_id, case v_life.country when 'LR' then 'LRD' else 'GHS' end, -v_fare, 'transport');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    return jsonb_build_object('ok', true, 'fare', v_fare);
  end if;

  if p_action <> 'ride' then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  select * into v_route from public.oal_road_routes r where r.id = p_target;
  if v_route.id is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if v_route.from_town <> v_life.place or v_route.country <> v_life.country then
    return jsonb_build_object('ok', false, 'code', 'NOT_HERE');
  end if;
  if v_route.mode = 'car' then
    if v_now::time < v_route.opens or v_now::time > v_route.closes then
      return jsonb_build_object('ok', false, 'code', 'NO_CARS_NOW');
    end if;
    v_departs := v_now + interval '1 hour';
  else
    v_departs := v_now::date + v_route.departs;
    if v_now > v_departs then
      v_departs := v_departs + interval '1 day';
    end if;
    if v_departs - v_now > interval '90 minutes' then
      return jsonb_build_object('ok', false, 'code', 'BUS_NOT_BOARDING', 'departs', to_char(v_departs, 'YYYY-MM-DD HH24:MI'));
    end if;
  end if;
  begin
    perform private.oal_money(p_user_id, v_route.currency, -v_route.fare, 'transport');
  exception when sqlstate 'AG003' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
  end;
  insert into public.oal_road_trips (user_id, route_id, boarded_at, departs_at, arrives_at)
  values (p_user_id, v_route.id, v_now, v_departs, v_departs + make_interval(mins => (v_route.hours * 60)::int))
  returning id into v_trip;
  update public.oal_lives l set state = 'on_road', road_trip_id = v_trip where l.user_id = p_user_id;
  return jsonb_build_object('ok', true, 'trip', v_trip, 'departs', to_char(v_departs, 'YYYY-MM-DD HH24:MI'), 'arrives', to_char(v_departs + make_interval(mins => (v_route.hours * 60)::int), 'YYYY-MM-DD HH24:MI'));
end;
$$;

revoke all on function public.oal_road_action(uuid, text, text) from public, anon, authenticated;
grant execute on function public.oal_road_action(uuid, text, text) to service_role;
revoke all on function private.oal_road_step(uuid, timestamp) from public, anon, authenticated, service_role;
revoke all on function private.oal_settle(uuid) from public, anon, authenticated, service_role;
revoke all on function private.oal_settle_core(uuid) from public, anon, authenticated, service_role;
