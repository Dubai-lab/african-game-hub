-- One Africa Life: the birth certificate, step by step as the Ministry of Health does it. The
-- application form (the parents, and an elder who witnesses the birth, as a late registration
-- asks) handed in at Window 1: assessed, a payment slip given. The fee paid at the cashier: a
-- receipt. The receipt handed in at Window 1: lodged, processing, ready the next day (a text).
-- Collected at Window 2 with the receipt.

alter table public.oal_birth_certificates
  add column status text not null default 'lodged' check (status in ('assessed', 'paid', 'lodged')),
  add column witness text check (char_length(witness) between 2 and 60),
  add column witness_relation text check (char_length(witness_relation) between 2 and 30),
  add column receipt text unique,
  add column paid_at timestamp,
  alter column ready_at drop not null;
alter table public.oal_birth_certificates add constraint oal_birth_lodged_ready check ((status = 'lodged') = (ready_at is not null));

/**
 * A government office's counter. Actions:
 *   birth_apply    Window 1 (a Liberian, in Liberia): the form, p_data {father, mother, witness,
 *                  relation}; assessed: the fee to pay at the cashier
 *   birth_pay      the cashier: the fee paid, a receipt
 *   birth_lodge    Window 1: the receipt handed in; ready the next day
 *   birth_collect  Window 2: the certificate, once ready
 */
create or replace function public.oal_office_action(p_user_id uuid, p_action text, p_data jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_cert public.oal_birth_certificates;
  v_now timestamp := public.oal_game_time();
  v_name constant text := '^[[:alpha:]][[:alpha:] .''-]{1,59}$';
  v_father text := btrim(coalesce(p_data ->> 'father', ''));
  v_mother text := btrim(coalesce(p_data ->> 'mother', ''));
  v_witness text := btrim(coalesce(p_data ->> 'witness', ''));
  v_relation text := btrim(coalesce(p_data ->> 'relation', ''));
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
  if v_life.country <> 'LR' or v_life.home_country <> 'LR' then
    return jsonb_build_object('ok', false, 'code', 'NOT_HERE');
  end if;
  select * into v_cert from public.oal_birth_certificates c where c.user_id = p_user_id for update;

  if p_action = 'birth_apply' then
    if v_cert.user_id is not null then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_APPLIED');
    end if;
    if v_father !~ v_name or v_mother !~ v_name or v_witness !~ v_name or v_relation !~ '^[[:alpha:]][[:alpha:] -]{1,29}$' then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    loop
      v_number := 'MOH/VS/' || extract(year from v_now)::int || '/' || lpad(floor(random() * 1000000)::int::text, 6, '0');
      exit when not exists (select 1 from public.oal_birth_certificates c where c.number = v_number);
    end loop;
    insert into public.oal_birth_certificates (user_id, country, number, full_name, sex, born_on, born_in, father, mother, witness, witness_relation, fee, applied_at, ready_at, status)
    values (p_user_id, 'LR', v_number, v_life.game_name, v_life.sex, v_life.born_on, v_life.home_town, v_father, v_mother, v_witness, v_relation, v_fee, v_now, null, 'assessed');
    return jsonb_build_object('ok', true, 'fee', v_fee);
  end if;

  if v_cert.user_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_APPLIED');
  end if;

  if p_action = 'birth_pay' then
    if v_cert.status <> 'assessed' then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_PAID');
    end if;
    begin
      perform private.oal_money(p_user_id, 'LRD', -v_cert.fee, 'documents');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    loop
      v_number := 'R' || lpad(floor(random() * 100000000)::int::text, 8, '0');
      exit when not exists (select 1 from public.oal_birth_certificates c where c.receipt = v_number);
    end loop;
    update public.oal_birth_certificates c set status = 'paid', receipt = v_number, paid_at = v_now where c.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'receipt', v_number);
  end if;

  if p_action = 'birth_lodge' then
    if v_cert.status = 'assessed' then
      return jsonb_build_object('ok', false, 'code', 'NOT_PAID');
    end if;
    if v_cert.status = 'lodged' then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_APPLIED');
    end if;
    update public.oal_birth_certificates c set status = 'lodged', ready_at = v_now + interval '1 day' where c.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'ready_at', v_now + interval '1 day');
  end if;

  if p_action = 'birth_collect' then
    if v_cert.collected_on is not null then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_COLLECTED');
    end if;
    if v_cert.status <> 'lodged' or v_cert.ready_at > v_now then
      return jsonb_build_object('ok', false, 'code', 'NOT_READY');
    end if;
    update public.oal_birth_certificates c set collected_on = v_now::date, notified = true where c.user_id = p_user_id;
    return jsonb_build_object('ok', true, 'number', v_cert.number);
  end if;

  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end;
$$;

-- Only what is lodged is processed and texted about.
create or replace function private.oal_office_notices() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  for c in select * from public.oal_birth_certificates b where not b.notified and b.status = 'lodged' and b.ready_at <= public.oal_game_time() for update skip locked loop
    perform private.oal_office_text(c.user_id, 'MOH LIBERIA',
      format('Dear %s, your birth certificate %s is ready. Bring your receipt %s to Window 2 (Collection), Ministry of Health, Monrovia.', c.full_name, c.number, c.receipt));
    update public.oal_birth_certificates b set notified = true where b.user_id = c.user_id;
  end loop;
end;
$$;
revoke all on function private.oal_office_notices() from public, anon, authenticated, service_role;
