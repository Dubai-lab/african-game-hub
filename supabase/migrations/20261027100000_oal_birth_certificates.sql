-- One Africa Life: the birth certificate, and texts from offices. A Liberian gets their birth
-- certificate at the Ministry of Health, Monrovia (its Vital Statistics office), as in reality
-- the first document (no birth certificate, no passport): at the counter, the form (the
-- parents' names; the name, sex, date and town of birth from the life), the fee paid, then
-- processing; a text when it is ready; collected at the counter. A network texts its welcome
-- when a SIM is registered. Texts from an office or a network have no life sending them.

alter table public.oal_texts alter column from_user drop not null;

/** A text from an office or a network (its name for a number) to the life's registered SIM in
 * the country it is in (none registered there: no text, as in life). */
create function private.oal_office_text(p_user_id uuid, p_from text, p_body text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to text;
begin
  select s.number into v_to from public.oal_sims s join public.oal_networks n on n.id = s.network
  join public.oal_lives l on l.user_id = s.user_id
  where s.user_id = p_user_id and s.number is not null and n.country = l.country
  order by s.registered_on desc
  limit 1;
  if v_to is null then
    return;
  end if;
  insert into public.oal_texts (from_user, to_user, from_number, to_number, body, game_at)
  values (null, p_user_id, p_from, v_to, left(p_body, 160), public.oal_game_time());
end;
$$;

create table public.oal_birth_certificates (
  user_id uuid primary key references public.oal_lives (user_id) on delete restrict,
  country text not null check (country in ('LR', 'GH')),
  number text not null unique,
  full_name text not null,
  sex text not null check (sex in ('male', 'female')),
  born_on date not null,
  born_in text not null,
  father text not null check (char_length(father) between 2 and 60),
  mother text not null check (char_length(mother) between 2 and 60),
  fee bigint not null check (fee >= 0),
  -- On the game's clock: applied, ready, the text sent, collected.
  applied_at timestamp not null,
  ready_at timestamp not null,
  notified boolean not null default false,
  collected_on date,
  check (ready_at > applied_at)
);
create index oal_birth_certificates_waiting on public.oal_birth_certificates (ready_at) where not notified;
alter table public.oal_birth_certificates enable row level security;
revoke all on table public.oal_birth_certificates from public, anon, authenticated;
grant all on table public.oal_birth_certificates to service_role;
grant select on table public.oal_birth_certificates to authenticated;
create policy oal_birth_certificates_read_own on public.oal_birth_certificates for select to authenticated using (user_id = (select auth.uid()));
create policy oal_birth_certificates_deny_client_insert on public.oal_birth_certificates as restrictive for insert to anon, authenticated with check (false);
create policy oal_birth_certificates_deny_client_update on public.oal_birth_certificates as restrictive for update to anon, authenticated using (false) with check (false);
create policy oal_birth_certificates_deny_client_delete on public.oal_birth_certificates as restrictive for delete to anon, authenticated using (false);

/**
 * A government office's counter. Actions:
 *   birth_apply    at the Ministry of Health (a Liberian, in Liberia): p_data {father, mother};
 *                  the fee paid; ready the next day
 *   birth_collect  the certificate, once ready
 */
create function public.oal_office_action(p_user_id uuid, p_action text, p_data jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_cert public.oal_birth_certificates;
  v_now timestamp := public.oal_game_time();
  v_father text := btrim(coalesce(p_data ->> 'father', ''));
  v_mother text := btrim(coalesce(p_data ->> 'mother', ''));
  v_fee bigint := 150000;
  v_number text;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_life.state <> 'settled' then
    return jsonb_build_object('ok', false, 'code', 'BUSY');
  end if;
  select * into v_cert from public.oal_birth_certificates c where c.user_id = p_user_id for update;

  if p_action = 'birth_apply' then
    if v_life.country <> 'LR' or v_life.home_country <> 'LR' then
      return jsonb_build_object('ok', false, 'code', 'NOT_HERE');
    end if;
    if v_cert.user_id is not null then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_APPLIED');
    end if;
    if v_father !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' or v_mother !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    begin
      perform private.oal_money(p_user_id, 'LRD', -v_fee, 'documents');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    loop
      v_number := 'MOH/VS/' || extract(year from v_now)::int || '/' || lpad(floor(random() * 1000000)::int::text, 6, '0');
      exit when not exists (select 1 from public.oal_birth_certificates c where c.number = v_number);
    end loop;
    insert into public.oal_birth_certificates (user_id, country, number, full_name, sex, born_on, born_in, father, mother, fee, applied_at, ready_at)
    values (p_user_id, 'LR', v_number, v_life.game_name, v_life.sex, v_life.born_on, v_life.home_town, v_father, v_mother, v_fee, v_now, v_now + interval '1 day');
    return jsonb_build_object('ok', true, 'ready_at', v_now + interval '1 day');
  end if;

  if p_action = 'birth_collect' then
    if v_cert.user_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_APPLIED');
    end if;
    if v_cert.collected_on is not null then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_COLLECTED');
    end if;
    if v_cert.ready_at > v_now then
      return jsonb_build_object('ok', false, 'code', 'NOT_READY');
    end if;
    update public.oal_birth_certificates c set collected_on = v_now::date, notified = true where c.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'number', v_cert.number);
  end if;

  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end;
$$;
revoke all on function public.oal_office_action(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.oal_office_action(uuid, text, jsonb) to service_role;

/** The offices' texts: a document ready to collect. */
create function private.oal_office_notices() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  for c in select * from public.oal_birth_certificates b where not b.notified and b.ready_at <= public.oal_game_time() for update skip locked loop
    perform private.oal_office_text(c.user_id, 'MOH LIBERIA',
      format('Dear %s, your birth certificate %s is ready. Collect it at the Vital Statistics counter, Ministry of Health, Monrovia.', c.full_name, c.number));
    update public.oal_birth_certificates b set notified = true where b.user_id = c.user_id;
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('oal-office-notices', '30 seconds', 'select private.oal_office_notices()');
  end if;
end;
$$;

-- A SIM registered: the network's welcome text.
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
