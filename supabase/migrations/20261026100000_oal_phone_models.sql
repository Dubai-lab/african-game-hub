-- One Africa Life: the phone shop's phones, model by model. A shop has phones on show to look
-- at, pick up, carry to the counter and pay for: each a make and model (invented, as the game's
-- brands are), its colour, screen, storage, camera and battery. A phone bought is that model.
-- Still a basic (calls, texts, mobile money) or a smartphone (the apps).

alter table public.oal_handsets
  add column brand text,
  add column model text,
  add column colour text check (colour ~ '^#[0-9a-f]{6}$'),
  -- The screen's diagonal in tenths of an inch, storage in GB, the camera in megapixels, the
  -- battery in mAh.
  add column screen smallint check (screen between 10 and 90),
  add column storage smallint check (storage between 0 and 1024),
  add column camera smallint check (camera between 0 and 200),
  add column battery smallint check (battery between 500 and 9000);

update public.oal_handsets set brand = 'Kora', model = 'K1', colour = '#1c1c1c', screen = 18, storage = 0, camera = 0, battery = 1000 where id in ('lr_basic', 'gh_basic');
update public.oal_handsets set brand = 'Sabi', model = 'S3', colour = '#2a5aa8', screen = 65, storage = 64, camera = 13, battery = 5000 where id in ('lr_smart', 'gh_smart');
insert into public.oal_handsets (id, country, kind, price, brand, model, colour, screen, storage, camera, battery) values
  ('lr_basic_plus', 'LR', 'basic', 320000, 'Nyota', '3310i', '#c8281e', 24, 0, 2, 1500),
  ('lr_smart_lite', 'LR', 'smart', 1140000, 'Kora', 'Pop 8', '#e2b62a', 61, 32, 8, 4000),
  ('lr_smart_plus', 'LR', 'smart', 2850000, 'Zuri', 'Note 12', '#2f8a4a', 67, 128, 50, 5000),
  ('lr_smart_pro', 'LR', 'smart', 7600000, 'Nyota', 'X Pro', '#d8d4cc', 68, 256, 108, 5000),
  ('gh_basic_plus', 'GH', 'basic', 25000, 'Nyota', '3310i', '#c8281e', 24, 0, 2, 1500),
  ('gh_smart_lite', 'GH', 'smart', 90000, 'Kora', 'Pop 8', '#e2b62a', 61, 32, 8, 4000),
  ('gh_smart_plus', 'GH', 'smart', 240000, 'Zuri', 'Note 12', '#2f8a4a', 67, 128, 50, 5000),
  ('gh_smart_pro', 'GH', 'smart', 600000, 'Nyota', 'X Pro', '#d8d4cc', 68, 256, 108, 5000);
alter table public.oal_handsets
  alter column brand set not null,
  alter column model set not null,
  alter column colour set not null,
  alter column screen set not null,
  alter column storage set not null,
  alter column camera set not null,
  alter column battery set not null;

-- Which model a phone is (null for the phones bought before models).
alter table public.oal_phones add column handset text references public.oal_handsets (id);

-- ---------------------------------------------------------------------------------------------

/**
 * The phone shop (at its counter, the model carried there), the network's office, the landlord. Actions:
 *   buy_phone     p_target = a handset of the country the life is in
 *   buy_sim       p_target = a network of that country
 *   register_sim  p_target = the network; with the document the law asks for (in Ghana, the
 *                 Ghana Card for a Ghanaian, the passport for anyone else; in Liberia, a passport)
 *   top_up        p_target = the network; p_amount of local money
 *   rent          p_target = a room in the town the life is in; the landlord's advance, paid now
 */
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
    insert into public.oal_phones (user_id, kind, bought_on, handset) values (p_user_id, v_handset.kind, v_today, v_handset.id)
    on conflict (user_id) do update set kind = excluded.kind, bought_on = excluded.bought_on, handset = excluded.handset;
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
