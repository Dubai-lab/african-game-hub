-- Signup provisioning, small account RPCs, and the ledger integrity check.

-- ---------------------------------------------------------------------------------------------
-- Creates everything a new account needs: profile, private profile, wallet, signup bonus.
-- The metadata comes from the signup form and is controlled by the player, so every field is
-- re-validated here and bad values fall back to safe defaults. Signup itself must never fail
-- because of bad metadata.
-- ---------------------------------------------------------------------------------------------
create function private.provision_user(
  p_user_id uuid,
  p_meta jsonb,
  p_email text,
  p_email_confirmed_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_username text := v_meta ->> 'username';
  v_fallback_username text := 'player_' || substr(replace(p_user_id::text, '-', ''), 1, 12);
  v_country text;
  v_country_language text;
  v_language text := lower(v_meta ->> 'preferred_language');
  v_bonus bigint;
begin
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return;
  end if;

  select c.country_code, c.default_language
    into v_country, v_country_language
    from public.countries c
   where c.country_code = upper(v_meta ->> 'country_code') and c.is_active;

  if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    v_username := v_fallback_username;
  end if;

  begin
    insert into public.profiles (id, username, country_code) values (p_user_id, v_username, v_country);
  exception when unique_violation then
    -- Someone took the name between the availability check and now.
    insert into public.profiles (id, username, country_code) values (p_user_id, v_fallback_username, v_country);
  end;

  if v_language is null or v_language not in ('en', 'fr', 'pt', 'sw', 'ar', 'rw') then
    v_language := case
      when v_country_language in ('en', 'fr', 'pt', 'sw', 'ar', 'rw') then v_country_language
      else 'en'
    end;
  end if;

  insert into public.profile_private (user_id, preferred_language, age_confirmed_at)
  values (
    p_user_id,
    v_language,
    case when v_meta ->> 'age_confirmed' = 'true' then now() end
  );

  insert into public.wallets (user_id) values (p_user_id);

  select s.signup_bonus_amount into v_bonus from public.platform_settings s;
  if coalesce(v_bonus, 0) > 0 then
    perform private.apply_ledger_entry(p_user_id, v_bonus, 'bonus', 'signup_bonus');
  end if;

  perform private.grant_admin_if_listed(p_user_id, p_email, p_email_confirmed_at);
end;
$$;

-- An account becomes admin only when its email is on the list AND has been confirmed,
-- so nobody can claim the role by signing up with an address they do not control.
create function private.grant_admin_if_listed(
  p_user_id uuid,
  p_email text,
  p_email_confirmed_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email_confirmed_at is not null
     and exists (select 1 from private.admin_emails a where a.email = lower(p_email)) then
    insert into public.admins (user_id) values (p_user_id) on conflict do nothing;
  end if;
end;
$$;

create function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_user(new.id, new.raw_user_meta_data, new.email, new.email_confirmed_at);
  return new;
end;
$$;

create function private.handle_user_confirmed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.grant_admin_if_listed(new.id, new.email, new.email_confirmed_at);
  return new;
end;
$$;

revoke all on function private.provision_user(uuid, jsonb, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.grant_admin_if_listed(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function private.handle_user_confirmed() from public, anon, authenticated, service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.handle_user_confirmed();

-- ---------------------------------------------------------------------------------------------
-- RPCs clients may call.
-- ---------------------------------------------------------------------------------------------

-- Lets the signup form warn about a taken username before submitting. Usernames are public anyway.
create function public.is_username_available(p_username text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_username ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(p_username));
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated, service_role;

-- A player without a country picks one once. Changing it later will be an admin action,
-- because the country decides whether real money is allowed.
create function public.set_my_country(p_country_code text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.countries c where c.country_code = upper(p_country_code) and c.is_active) then
    raise exception 'UNKNOWN_COUNTRY' using errcode = 'AG002';
  end if;

  update public.profiles p
     set country_code = upper(p_country_code)
   where p.id = v_user_id and p.country_code is null;

  if not found then
    raise exception 'COUNTRY_ALREADY_SET' using errcode = 'AG020';
  end if;
end;
$$;

revoke all on function public.set_my_country(text) from public, anon;
grant execute on function public.set_my_country(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Ledger integrity check. Returns one row per problem; no rows means the books balance.
--   wallet_ledger_mismatch : a wallet balance differs from the sum of that player's ledger entries
--   ledger_without_wallet  : ledger entries exist for a player with no wallet
--   balance_after_mismatch : an entry's balance_after differs from the running total up to it
--   escrow_conservation    : tokens staked are not all accounted for as held escrow, refunds,
--                            payouts or rake (tokens were created or lost inside a match)
-- ---------------------------------------------------------------------------------------------
create function public.verify_ledger_integrity()
returns table (check_name text, user_id uuid, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  with sums as (
    select l.user_id as uid,
           coalesce(sum(l.amount) filter (where l.balance_type = 'bonus'), 0) as bonus,
           coalesce(sum(l.amount) filter (where l.balance_type = 'cash'), 0) as cash
      from public.ledger_entries l
     group by l.user_id
  ),
  running as (
    select l.id, l.user_id as uid, l.balance_type, l.balance_after,
           sum(l.amount) over (partition by l.user_id, l.balance_type order by l.id) as expected
      from public.ledger_entries l
  ),
  flows as (
    select
      (select coalesce(sum(l.amount), 0) from public.ledger_entries l
        where l.entry_type in ('stake', 'stake_refund', 'win_payout')) as moved,
      (select coalesce(sum(e.amount), 0) from public.escrow e where e.status = 'held') as held,
      (select coalesce(sum(r.amount), 0) from public.platform_revenue r) as rake
  )
  select 'wallet_ledger_mismatch', w.user_id,
         format('wallet bonus=%s cash=%s but ledger bonus=%s cash=%s',
                w.bonus_balance, w.cash_balance, coalesce(s.bonus, 0), coalesce(s.cash, 0))
    from public.wallets w
    left join sums s on s.uid = w.user_id
   where w.bonus_balance <> coalesce(s.bonus, 0) or w.cash_balance <> coalesce(s.cash, 0)
  union all
  select 'ledger_without_wallet', s.uid, 'ledger entries exist but there is no wallet'
    from sums s
   where not exists (select 1 from public.wallets w where w.user_id = s.uid)
  union all
  select 'balance_after_mismatch', r.uid,
         format('entry %s (%s) has balance_after=%s, expected %s', r.id, r.balance_type, r.balance_after, r.expected)
    from running r
   where r.balance_after <> r.expected
  union all
  select 'escrow_conservation', null::uuid,
         format('stake flows=%s, held escrow=%s, rake=%s: these should add up to zero', f.moved, f.held, f.rake)
    from flows f
   where f.moved + f.held + f.rake <> 0;
$$;

-- Same check, but fails loudly. Used by tests and scheduled monitoring.
create function public.assert_ledger_integrity() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problems text;
begin
  select string_agg(v.check_name || coalesce(' [' || v.user_id::text || ']', '') || ': ' || v.detail, '; ')
    into v_problems
    from public.verify_ledger_integrity() v;
  if v_problems is not null then
    raise exception 'LEDGER_INTEGRITY_FAILED: %', v_problems using errcode = 'AG030';
  end if;
end;
$$;

revoke all on function public.verify_ledger_integrity() from public, anon, authenticated;
revoke all on function public.assert_ledger_integrity() from public, anon, authenticated;
grant execute on function public.verify_ledger_integrity() to service_role;
grant execute on function public.assert_ledger_integrity() to service_role;
