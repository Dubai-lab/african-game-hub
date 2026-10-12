-- A player's gender: male or female. Asked for when an account is made; players who joined
-- before this are asked once, the next time they open the app. It is part of the public
-- profile (it chooses the little figure shown at a player's place at a table), so it is kept
-- with the name and the country, not with the private details.

alter table public.profiles add column gender text check (gender in ('male', 'female'));

comment on column public.profiles.gender is 'male or female. Null until the player has said (accounts older than the question, or made by an admin).';

-- ---------------------------------------------------------------------------------------------
-- Signup: the same provisioning as before, now reading the gender from the form as well.
-- Like every other field of the metadata it is the player's to send, so it is checked here:
-- anything but the two values is left unset, and the app asks again.
-- ---------------------------------------------------------------------------------------------
create or replace function private.provision_user(
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
  v_gender text := case when lower(v_meta ->> 'gender') in ('male', 'female') then lower(v_meta ->> 'gender') end;
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
    insert into public.profiles (id, username, country_code, gender) values (p_user_id, v_username, v_country, v_gender);
  exception when unique_violation then
    -- Someone took the name between the availability check and now.
    insert into public.profiles (id, username, country_code, gender) values (p_user_id, v_fallback_username, v_country, v_gender);
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

-- ---------------------------------------------------------------------------------------------
-- A player who has not said answers once. (Players cannot write the column themselves: the
-- app may only change a display name and a photo. A wrong answer is put right by our team.)
-- ---------------------------------------------------------------------------------------------
create function public.set_my_gender(p_gender text) returns void
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
  if p_gender is null or p_gender not in ('male', 'female') then
    raise exception 'BAD_REQUEST' using errcode = 'AG002';
  end if;

  update public.profiles p
     set gender = p_gender
   where p.id = v_user_id and p.gender is null;
end;
$$;

revoke all on function public.set_my_gender(text) from public, anon;
grant execute on function public.set_my_gender(text) to authenticated, service_role;
