-- One Africa Life: the foundation. A player's life (who their character is), the game's money
-- and the game's clock.
--
-- Who decides what:
--   * A life is started by the oal-start-life Edge Function, which checks the character with the
--     rules in supabase/functions/_shared/oal.ts, then calls public.oal_start_life here. The app
--     cannot write any of these tables.
--   * The game's money (Liberian dollars, US dollars, Ghana cedis) is separate from the hub's
--     tokens and can never be cashed out. It is kept like the hub's own wallet all the same:
--     every change is an entry that is never changed or removed, and a balance is always the sum
--     of its entries (public.oal_money_problems checks). Amounts are in hundredths (cents,
--     pesewas), as whole numbers.
--   * The clock runs thirty times faster than real time (a game day is 48 real minutes).

create table public.oal_settings (
  id boolean primary key default true check (id),
  -- The real moment the game's calendar started, and how much faster it runs.
  clock_epoch timestamptz not null default '2026-10-18 00:00:00+00',
  clock_speed integer not null default 30 check (clock_speed > 0),
  -- What a new life starts with (in hundredths): very little, as the design says.
  start_lrd bigint not null default 300000 check (start_lrd >= 0),
  start_usd bigint not null default 2000 check (start_usd >= 0)
);
insert into public.oal_settings default values;
alter table public.oal_settings enable row level security;

create table public.oal_lives (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  -- The character's name. Not unique: what is unique is the player's hub username.
  game_name text not null check (char_length(game_name) between 2 and 40),
  sex text not null check (sex in ('male', 'female')),
  -- On the game's calendar.
  born_on date not null,
  home_country text not null check (home_country in ('LR', 'GH')),
  home_town text not null,
  appearance jsonb not null,
  started_at timestamptz not null default now()
);
alter table public.oal_lives enable row level security;

create table public.oal_balances (
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  currency text not null check (currency in ('LRD', 'USD', 'GHS')),
  amount bigint not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);
alter table public.oal_balances enable row level security;

create table public.oal_money_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete restrict,
  currency text not null check (currency in ('LRD', 'USD', 'GHS')),
  amount bigint not null check (amount <> 0),
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  balance_after bigint not null check (balance_after >= 0),
  -- The game's own date and time when it happened, and the real one.
  game_at timestamp not null,
  created_at timestamptz not null default now()
);
create index oal_money_entries_user on public.oal_money_entries (user_id, id);
alter table public.oal_money_entries enable row level security;

-- Entries are never changed or removed, by anyone.
create function private.oal_entries_are_final() returns trigger
language plpgsql
as $$
begin
  raise exception 'OAL_MONEY_ENTRIES_ARE_FINAL' using errcode = 'AG001';
end;
$$;
create trigger oal_money_entries_final before update or delete on public.oal_money_entries
  for each row execute function private.oal_entries_are_final();

-- Players read their own life and money; nobody writes from the app.
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['oal_settings', 'oal_lives', 'oal_balances', 'oal_money_entries'] loop
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
end;
$$;
create policy oal_settings_read on public.oal_settings for select to authenticated using (true);
create policy oal_lives_read_own on public.oal_lives for select to authenticated using (user_id = auth.uid());
create policy oal_balances_read_own on public.oal_balances for select to authenticated using (user_id = auth.uid());
create policy oal_money_entries_read_own on public.oal_money_entries for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- The clock
-- ---------------------------------------------------------------------------------------------

/** The game's date and time at a real moment. */
create function public.oal_game_time(p_at timestamptz default now()) returns timestamp
language sql
stable
security definer
set search_path = ''
as $$
  select (s.clock_epoch at time zone 'UTC') + (p_at - s.clock_epoch) * s.clock_speed from public.oal_settings s;
$$;

-- ---------------------------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------------------------

/** Every change to a balance, as an entry, under a row lock. Never below zero. */
create function private.oal_money(p_user_id uuid, p_currency text, p_amount bigint, p_kind text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after bigint;
begin
  insert into public.oal_balances (user_id, currency) values (p_user_id, p_currency) on conflict do nothing;
  select b.amount + p_amount into v_after from public.oal_balances b where b.user_id = p_user_id and b.currency = p_currency for update;
  if v_after < 0 then
    raise exception 'OAL_NOT_ENOUGH_MONEY' using errcode = 'AG003';
  end if;
  update public.oal_balances b set amount = v_after, updated_at = now() where b.user_id = p_user_id and b.currency = p_currency;
  insert into public.oal_money_entries (user_id, currency, amount, kind, balance_after, game_at)
  values (p_user_id, p_currency, p_amount, p_kind, v_after, public.oal_game_time());
  return v_after;
end;
$$;

/** Balances that do not equal the sum of their entries (there should never be any). */
create function public.oal_money_problems() returns table (user_id uuid, currency text, balance bigint, entries bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select b.user_id, b.currency, b.amount, coalesce(sum(e.amount), 0)::bigint
    from public.oal_balances b
    left join public.oal_money_entries e on e.user_id = b.user_id and e.currency = b.currency
   group by b.user_id, b.currency, b.amount
  having b.amount <> coalesce(sum(e.amount), 0);
$$;

-- ---------------------------------------------------------------------------------------------
-- Starting a life
-- ---------------------------------------------------------------------------------------------

/**
 * A new life, with a character the Edge Function has already checked. Once per player. Returns
 * {ok: true} or {ok: false, code}.
 */
create function public.oal_start_life(
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

  insert into public.oal_lives (user_id, game_name, sex, born_on, home_country, home_town, appearance)
  values (p_user_id, p_game_name, p_sex, (v_today - make_interval(years => p_age))::date, p_home_country, p_home_town, p_appearance);

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

do $$
declare
  fn text;
begin
  execute 'revoke all on function public.oal_start_life(uuid, text, text, integer, text, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.oal_start_life(uuid, text, text, integer, text, text, jsonb) to service_role';
  execute 'revoke all on function public.oal_money_problems() from public, anon, authenticated';
  execute 'grant execute on function public.oal_money_problems() to service_role';
  execute 'grant execute on function public.oal_game_time(timestamptz) to authenticated, service_role';
  foreach fn in array array['private.oal_money(uuid, text, bigint, text)', 'private.oal_entries_are_final()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;
