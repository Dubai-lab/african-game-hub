-- One Africa Life: a new phone comes in its box, its battery flat. Bought at the counter, the
-- seller boxes it; taken home, unboxed there and put on charge (an hour); then it works. The
-- phones had before this keep working.

alter table public.oal_phones
  add column unboxed boolean not null default true,
  add column charge text not null default 'charged' check (charge in ('flat', 'charging', 'charged')),
  -- Charging: full at this time on the game's clock.
  add column charged_at timestamp;

/** A phone that works: out of its box, its battery charged. */
create function private.oal_phone_ready(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.oal_phones ph where ph.user_id = p_user_id and ph.unboxed
    and (ph.charge = 'charged' or (ph.charge = 'charging' and ph.charged_at <= public.oal_game_time())));
$$;

/** At home: in the family's house in the home town, or a room rented in the town the life is in. */
create function private.oal_at_home(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.oal_lives l where l.user_id = p_user_id and l.place = l.home_town and l.country = l.home_country)
    or exists (select 1 from public.oal_leases le join public.oal_rooms r on r.id = le.room_id join public.oal_lives l on l.user_id = le.user_id
               where le.user_id = p_user_id and le.ends_on >= public.oal_game_time()::date and r.town = l.place and r.country = l.country);
$$;

/** The new phone at home: out of its box (unbox), on charge (charge). */
create function public.oal_phone_box_action(p_user_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_phone public.oal_phones;
  v_now timestamp := public.oal_game_time();
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'settled' then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;
  select * into v_phone from public.oal_phones ph where ph.user_id = p_user_id for update;
  if v_phone.user_id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_PHONE');
  end if;
  if not private.oal_at_home(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AT_HOME');
  end if;
  if p_action = 'unbox' then
    if v_phone.unboxed then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_UNBOXED');
    end if;
    update public.oal_phones ph set unboxed = true where ph.user_id = p_user_id;
    return jsonb_build_object('ok', true);
  end if;
  if p_action = 'charge' then
    if not v_phone.unboxed then
      return jsonb_build_object('ok', false, 'code', 'STILL_BOXED');
    end if;
    if v_phone.charge <> 'flat' then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_CHARGED');
    end if;
    update public.oal_phones ph set charge = 'charging', charged_at = v_now + interval '1 hour' where ph.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'charged_at', v_now + interval '1 hour');
  end if;
  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end;
$$;
revoke all on function public.oal_phone_box_action(uuid, text) from public, anon, authenticated;
grant execute on function public.oal_phone_box_action(uuid, text) to service_role;

-- A phone bought: boxed, flat.
create or replace function public.oal_home_action(p_user_id uuid, p_action text, p_target text, p_amount bigint) returns jsonb
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
    insert into public.oal_phones (user_id, kind, bought_on, handset, unboxed, charge, charged_at) values (p_user_id, v_handset.kind, v_today, v_handset.id, false, 'flat', null)
    on conflict (user_id) do update set kind = excluded.kind, bought_on = excluded.bought_on, handset = excluded.handset, unboxed = false, charge = 'flat', charged_at = null;
    return jsonb_build_object('ok', true, 'kind', v_handset.kind, 'handset', v_handset.id);
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
    perform private.oal_office_text(p_user_id, upper(split_part(v_network.name, ' ', 1)),
      format('Welcome to %s! Your SIM is registered to %s. Your number is %s. Dial *124# for your balance.', v_network.name, v_life.game_name, v_number));
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

-- Texts and mobile money: only on a phone that works.
create or replace function public.oal_phone_action(p_user_id uuid, p_action text, p_number text, p_body text, p_amount bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_sim public.oal_sims;
  v_to public.oal_sims;
  v_to_country text;
  v_number text;
  v_body text := trim(coalesce(p_body, ''));
  v_cost bigint;
  v_local text;
  v_wallet text;
  v_fee bigint;
  v_least bigint;
  v_now timestamp := public.oal_game_time();
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if p_action = 'read' then
    update public.oal_texts t set read_at = now() where t.to_user = p_user_id and t.read_at is null;
    return jsonb_build_object('ok', true);
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;
  if not exists (select 1 from public.oal_phones ph where ph.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'NO_PHONE');
  end if;
  if not private.oal_phone_ready(p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'PHONE_NOT_READY');
  end if;
  select s.* into v_sim from public.oal_sims s join public.oal_networks n on n.id = s.network
   where s.user_id = p_user_id and s.number is not null and n.country = v_life.country order by s.id limit 1 for update of s;
  if v_sim.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_REGISTERED');
  end if;
  v_local := case v_life.country when 'LR' then 'LRD' else 'GHS' end;
  v_wallet := case v_life.country when 'LR' then 'LRM' else 'GHM' end;
  v_least := case v_life.country when 'LR' then 500 else 50 end;

  if p_action in ('text', 'send') then
    v_number := private.oal_full_number(p_number, v_life.country);
    select s.* into v_to from public.oal_sims s where s.number = v_number;
    select n.country into v_to_country from public.oal_sims s join public.oal_networks n on n.id = s.network where s.number = v_number;
    if v_to.id is null then
      return jsonb_build_object('ok', false, 'code', 'NUMBER_NOT_FOUND');
    end if;
    if v_to.user_id = p_user_id then
      return jsonb_build_object('ok', false, 'code', 'OWN_NUMBER');
    end if;
    if private.is_blocked_pair(p_user_id, v_to.user_id) then
      return jsonb_build_object('ok', false, 'code', 'NOT_DELIVERED');
    end if;
  end if;

  if p_action = 'text' then
    if char_length(v_body) < 1 or char_length(v_body) > 160 then
      return jsonb_build_object('ok', false, 'code', 'BAD_TEXT');
    end if;
    if (select count(*) from public.oal_texts t where t.from_user = p_user_id and t.created_at > now() - interval '1 minute') >= 20 then
      return jsonb_build_object('ok', false, 'code', 'SLOW_DOWN');
    end if;
    -- L$5 or 10 pesewas; abroad, ten times that.
    v_cost := (case v_life.country when 'LR' then 500 else 10 end) * (case when v_to_country = v_life.country then 1 else 10 end);
    if v_sim.airtime < v_cost then
      return jsonb_build_object('ok', false, 'code', 'NO_AIRTIME');
    end if;
    update public.oal_sims s set airtime = s.airtime - v_cost where s.id = v_sim.id;
    insert into public.oal_texts (from_user, to_user, from_number, to_number, body, game_at)
    values (p_user_id, v_to.user_id, v_sim.number, v_number, v_body, v_now);
    return jsonb_build_object('ok', true, 'airtime', v_sim.airtime - v_cost);
  end if;

  if p_amount is null or p_amount < 100 or p_amount > 10000000000 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;

  if p_action = 'cash_in' then
    begin
      perform private.oal_money(p_user_id, v_local, -p_amount, 'momo_cash_in');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    perform private.oal_money(p_user_id, v_wallet, p_amount, 'momo_cash_in');
    return jsonb_build_object('ok', true);
  end if;

  v_fee := greatest(v_least, p_amount / 100);
  if p_action = 'cash_out' then
    begin
      perform private.oal_money(p_user_id, v_wallet, -(p_amount + v_fee), 'momo_cash_out');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    perform private.oal_money(p_user_id, v_local, p_amount, 'momo_cash_out');
    return jsonb_build_object('ok', true, 'fee', v_fee);
  end if;

  if p_action = 'send' then
    if v_to_country <> v_life.country then
      return jsonb_build_object('ok', false, 'code', 'WRONG_COUNTRY');
    end if;
    if (select count(*) from public.oal_money_entries e where e.user_id = p_user_id and e.kind = 'momo_send' and e.created_at > now() - interval '1 minute') >= 10 then
      return jsonb_build_object('ok', false, 'code', 'SLOW_DOWN');
    end if;
    begin
      perform private.oal_money(p_user_id, v_wallet, -(p_amount + v_fee), 'momo_send');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    perform private.oal_money(v_to.user_id, v_wallet, p_amount, 'momo_received');
    return jsonb_build_object('ok', true, 'fee', v_fee, 'to', v_number);
  end if;

  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end;
$$;
