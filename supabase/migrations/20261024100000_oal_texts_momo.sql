-- One Africa Life: text messages and mobile money between players' phones.
--
-- As on real networks:
--   * A text goes from a registered SIM to a number; it costs airtime (L$5 or 10 pesewas in the
--     country, ten times that abroad). A number that no registered SIM has: not delivered, and
--     not charged. Anyone who knows a number can text it (that is what a number is), but the
--     hub's own safety rules hold: no texts between players who have blocked each other, none
--     from a banned account, and no more than twenty a minute.
--   * Mobile money is a wallet on a registered SIM, in the country's money: cash put in at an
--     agent, taken out (1% fee, at least L$5 or GH¢0.50), sent to another registered number in
--     the same country (1% fee, the same least). The wallets are kept as two more of the game's
--     moneys, 'LRM' (Liberian mobile money) and 'GHM' (Ghanaian), in oal_balances and
--     oal_money_entries: every movement an entry, never changed, the balance their sum.

alter table public.oal_balances drop constraint oal_balances_currency_check;
alter table public.oal_balances add constraint oal_balances_currency_check check (currency in ('LRD', 'USD', 'GHS', 'LRM', 'GHM'));
alter table public.oal_money_entries drop constraint oal_money_entries_currency_check;
alter table public.oal_money_entries add constraint oal_money_entries_currency_check check (currency in ('LRD', 'USD', 'GHS', 'LRM', 'GHM'));

create table public.oal_texts (
  id bigint generated always as identity primary key,
  from_user uuid not null references public.oal_lives (user_id) on delete restrict,
  to_user uuid not null references public.oal_lives (user_id) on delete restrict,
  from_number text not null,
  to_number text not null,
  body text not null check (char_length(body) between 1 and 160),
  game_at timestamp not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index oal_texts_to on public.oal_texts (to_user, id desc);
create index oal_texts_from on public.oal_texts (from_user, id desc);
alter table public.oal_texts enable row level security;
revoke all on table public.oal_texts from public, anon, authenticated;
grant all on table public.oal_texts to service_role;
grant select on table public.oal_texts to authenticated;
create policy oal_texts_deny_client_insert on public.oal_texts as restrictive for insert to anon, authenticated with check (false);
create policy oal_texts_deny_client_update on public.oal_texts as restrictive for update to anon, authenticated using (false) with check (false);
create policy oal_texts_deny_client_delete on public.oal_texts as restrictive for delete to anon, authenticated using (false);
create policy oal_texts_read_own on public.oal_texts for select to authenticated using (from_user = (select auth.uid()) or to_user = (select auth.uid()));

/** A number as typed (+231..., 0 and nine digits in the country the sender is in), in full. */
create function private.oal_full_number(p_number text, p_country text) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(coalesce(p_number, ''), '[^0-9+]', '', 'g') ~ '^0[0-9]{9}$'
      then '+' || (case p_country when 'LR' then '231' else '233' end) || substr(regexp_replace(p_number, '[^0-9+]', '', 'g'), 2)
    else regexp_replace(coalesce(p_number, ''), '[^0-9+]', '', 'g')
  end;
$$;

/**
 * The phone in use: text, cash in, cash out, send money, mark texts read.
 *   text         p_number, p_body (1 to 160 characters)
 *   cash_in      p_amount of local money into the wallet (at an agent)
 *   cash_out     p_amount out of the wallet, as cash (1% fee, at least L$5 or GH¢0.50)
 *   send         p_amount to p_number, registered in this country (the same fee, paid by the
 *                sender)
 *   read         every text received, marked read
 * The phone is the SIM registered in the country the life is in.
 */
create function public.oal_phone_action(p_user_id uuid, p_action text, p_number text, p_body text, p_amount bigint) returns jsonb
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

revoke all on function public.oal_phone_action(uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.oal_phone_action(uuid, text, text, text, bigint) to service_role;
revoke all on function private.oal_full_number(text, text) from public, anon, authenticated, service_role;
