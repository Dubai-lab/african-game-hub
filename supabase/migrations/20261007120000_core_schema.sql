-- African Game Hub: shared core schema.
-- Nothing in this file knows about chess (or any other game). Game modules add their own tables.
--
-- RLS is enabled on every table the moment it is created. Policies and grants are in
-- 20261007120200_rls_policies.sql.

-- Internal helpers live in a schema the Data API does not expose, so they can never be called as RPCs.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Countries: every country-specific rule lives here, never in code.
-- ---------------------------------------------------------------------------------------------
create table public.countries (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  name text not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  currency_minor_units smallint not null default 2 check (currency_minor_units between 0 and 3),
  -- How much local currency (major units) one token is worth. Used only at deposit/withdrawal time.
  token_to_currency_rate numeric(20, 8) check (token_to_currency_rate > 0),
  real_money_enabled boolean not null default false,
  payment_providers text[] not null default '{}',
  -- Limits are in tokens.
  min_deposit bigint check (min_deposit > 0),
  max_deposit bigint check (max_deposit > 0),
  min_withdrawal bigint check (min_withdrawal > 0),
  max_withdrawal bigint check (max_withdrawal > 0),
  default_language text not null default 'en' check (default_language ~ '^[a-z]{2}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint countries_real_money_needs_rate
    check (not real_money_enabled or token_to_currency_rate is not null),
  constraint countries_deposit_range check (min_deposit is null or max_deposit is null or min_deposit <= max_deposit),
  constraint countries_withdrawal_range
    check (min_withdrawal is null or max_withdrawal is null or min_withdrawal <= max_withdrawal)
);
alter table public.countries enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Platform settings: exactly one row.
-- ---------------------------------------------------------------------------------------------
create table public.platform_settings (
  id boolean primary key default true check (id),
  -- Rake in basis points (1000 = 10%), so it stays an integer and can be e.g. 7.5%.
  rake_bps integer not null default 1000 check (rake_bps between 0 and 5000),
  rake_on_draws boolean not null default false,
  signup_bonus_amount bigint not null default 1000 check (signup_bonus_amount >= 0),
  -- What happens to winnings that were funded by bonus tokens:
  --   bonus_stays_bonus    : the bonus-funded share of a payout returns as bonus (safest)
  --   bonus_stake_returned : the winner's own bonus stake returns as bonus, the rest is cash
  --   cash                 : every payout is cash
  bonus_winnings_policy text not null default 'bonus_stays_bonus'
    check (bonus_winnings_policy in ('bonus_stays_bonus', 'bonus_stake_returned', 'cash')),
  first_move_abort_seconds integer not null default 30 check (first_move_abort_seconds between 5 and 600),
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Profiles. Split in two because RLS works on rows, not columns:
--   profiles        : what other players may see
--   profile_private : what only the owner may see (phone, language, age confirmation, ban)
-- Accounts that have touched money are never deleted (ON DELETE RESTRICT); they are banned or closed.
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) between 1 and 40),
  avatar_url text check (avatar_url ~ '^https://' and char_length(avatar_url) <= 500),
  country_code text references public.countries (country_code),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower_key on public.profiles (lower(username));
create index profiles_country_code_idx on public.profiles (country_code);
alter table public.profiles enable row level security;

create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  phone_e164 text unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_verified_at timestamptz,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'fr', 'pt', 'sw', 'ar', 'rw')),
  age_confirmed_at timestamptz,
  is_banned boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;

-- Admins are a separate table so the flag can never be reached through a profile update.
create table public.admins (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

-- Emails that become admins once their address is confirmed. Never exposed to clients.
create table private.admin_emails (
  email text primary key check (email = lower(email))
);
alter table private.admin_emails enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Games registry: a new game appears in the lobby by adding a row here plus a game module.
-- ---------------------------------------------------------------------------------------------
create table public.game_types (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null,
  status text not null default 'coming_soon' check (status in ('live', 'coming_soon', 'disabled')),
  sort_order integer not null default 0,
  min_players smallint not null default 2 check (min_players >= 2),
  max_players smallint not null default 2,
  stake_levels bigint[] not null default '{}',
  -- Game-specific choices offered in the lobby (for chess: time controls).
  options_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint game_types_player_range check (max_players >= min_players)
);
alter table public.game_types enable row level security;

create table public.player_ratings (
  user_id uuid not null references public.profiles (id) on delete restrict,
  game_type text not null references public.game_types (id),
  rating integer not null default 1200 check (rating >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_type),
  constraint player_ratings_totals check (games_played = wins + losses + draws)
);
create index player_ratings_leaderboard_idx on public.player_ratings (game_type, rating desc);
alter table public.player_ratings enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Wallets. Two balances: bonus (playable, never withdrawable) and cash (withdrawable later).
-- Balances change only through private.apply_ledger_entry(), which writes the ledger row too.
-- ---------------------------------------------------------------------------------------------
create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  bonus_balance bigint not null default 0 check (bonus_balance >= 0),
  cash_balance bigint not null default 0 check (cash_balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Payments (deposits and withdrawals). Not used in phase 1; designed now so a mobile money
-- provider can be plugged in without touching wallet logic.
-- ---------------------------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  direction text not null check (direction in ('deposit', 'withdrawal')),
  provider text not null,
  country_code text not null references public.countries (country_code),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  token_amount bigint not null check (token_amount > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  -- Local currency in its smallest unit.
  currency_amount bigint not null check (currency_amount > 0),
  -- The rate that applied to this payment, kept forever.
  rate_used numeric(20, 8) not null check (rate_used > 0),
  status text not null default 'pending'
    check (status in ('pending', 'needs_review', 'processing', 'succeeded', 'failed', 'cancelled')),
  provider_reference text,
  idempotency_key text not null unique,
  reviewed_by uuid references public.profiles (id),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);
create index payments_user_idx on public.payments (user_id, created_at desc);
alter table public.payments enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Matches. Game-agnostic: the core only knows who played, for how much, and the result.
-- ---------------------------------------------------------------------------------------------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  game_type text not null references public.game_types (id),
  stake_amount bigint not null check (stake_amount >= 0),
  options jsonb not null default '{}'::jsonb,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'aborted')),
  winner_id uuid references public.profiles (id),
  result text check (result in ('win', 'draw', 'aborted')),
  end_reason text,
  settled boolean not null default false,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint matches_result_matches_status check (
    (status in ('waiting', 'active') and result is null)
    or (status = 'finished' and result in ('win', 'draw'))
    or (status = 'aborted' and result = 'aborted')
  ),
  constraint matches_winner_only_on_win check ((result = 'win') is not distinct from (winner_id is not null)
    or (result is null and winner_id is null)),
  constraint matches_settled_only_when_over check (not settled or status in ('finished', 'aborted')),
  constraint matches_settled_at_set check (settled = (settled_at is not null))
);
create index matches_status_idx on public.matches (status) where status in ('waiting', 'active');
create index matches_unsettled_idx on public.matches (finished_at) where not settled and status in ('finished', 'aborted');
alter table public.matches enable row level security;

-- One row per player per match. Never assume two players: ludo seats up to four.
create table public.match_players (
  match_id uuid not null references public.matches (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  seat text not null,
  rating_before integer,
  rating_after integer,
  tokens_change bigint,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, seat)
);
create index match_players_user_idx on public.match_players (user_id, joined_at desc);
alter table public.match_players enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Ledger: every token movement, forever. Append-only (enforced by triggers below).
-- There is no 'rake' entry type: rake never touches a player's wallet. The winner is paid
-- pot minus rake in one win_payout entry, and the rake is recorded in platform_revenue.
-- ---------------------------------------------------------------------------------------------
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount bigint not null check (amount <> 0),
  balance_type text not null check (balance_type in ('bonus', 'cash')),
  entry_type text not null
    check (entry_type in ('signup_bonus', 'stake', 'stake_refund', 'win_payout', 'deposit', 'withdrawal', 'adjustment')),
  match_id uuid references public.matches (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  balance_after bigint not null check (balance_after >= 0),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  constraint ledger_entries_sign check (
    case entry_type
      when 'stake' then amount < 0
      when 'withdrawal' then amount < 0
      when 'adjustment' then true
      else amount > 0
    end
  ),
  constraint ledger_entries_match_ref
    check (entry_type not in ('stake', 'stake_refund', 'win_payout') or match_id is not null),
  constraint ledger_entries_payment_ref
    check (entry_type not in ('deposit', 'withdrawal') or payment_id is not null)
);
create index ledger_entries_user_idx on public.ledger_entries (user_id, id desc);
create index ledger_entries_match_idx on public.ledger_entries (match_id) where match_id is not null;
-- A player can receive the signup bonus only once, whatever happens.
create unique index ledger_entries_one_signup_bonus on public.ledger_entries (user_id) where entry_type = 'signup_bonus';
alter table public.ledger_entries enable row level security;

-- Stakes held while a match is in play. A stake can come partly from bonus and partly from cash.
create table public.escrow (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  amount bigint not null check (amount > 0),
  balance_type text not null check (balance_type in ('bonus', 'cash')),
  status text not null default 'held' check (status in ('held', 'paid_out', 'refunded')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (match_id, user_id, balance_type),
  constraint escrow_released_at_set check ((status = 'held') = (released_at is null))
);
create index escrow_held_idx on public.escrow (match_id) where status = 'held';
alter table public.escrow enable row level security;

-- A player waits in at most one queue at a time (primary key on user_id).
create table public.match_queue (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  game_type text not null references public.game_types (id),
  stake_amount bigint not null check (stake_amount >= 0),
  options jsonb not null default '{}'::jsonb,
  rating integer not null,
  country_code text references public.countries (country_code),
  prefer_same_country boolean not null default false,
  joined_at timestamptz not null default now()
);
create index match_queue_pairing_idx on public.match_queue (game_type, stake_amount, joined_at);
alter table public.match_queue enable row level security;

-- Rake collected, one row per match: the primary key makes it impossible to take rake twice.
create table public.platform_revenue (
  match_id uuid primary key references public.matches (id) on delete restrict,
  amount bigint not null check (amount >= 0),
  created_at timestamptz not null default now()
);
alter table public.platform_revenue enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Guards. These apply to every role, including the service role and the table owner.
-- ---------------------------------------------------------------------------------------------

-- The ledger is append-only.
create function private.ledger_is_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ledger_entries is append-only: % is not allowed', tg_op using errcode = 'AG010';
end;
$$;

create trigger ledger_entries_no_update_delete
  before update or delete on public.ledger_entries
  for each row execute function private.ledger_is_append_only();

create trigger ledger_entries_no_truncate
  before truncate on public.ledger_entries
  for each statement execute function private.ledger_is_append_only();

-- Ledger rows can only be written together with the matching wallet change.
create function private.ledger_insert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('agh.ledger_write', true), '') <> '1' then
    raise exception 'ledger_entries can only be written by private.apply_ledger_entry()' using errcode = 'AG011';
  end if;
  return new;
end;
$$;

create trigger ledger_entries_insert_guard
  before insert on public.ledger_entries
  for each row execute function private.ledger_insert_guard();

-- Balances are never "just updated": a change without a ledger entry is rejected.
create function private.wallet_write_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'wallets cannot be deleted' using errcode = 'AG012';
  end if;
  if tg_op = 'INSERT' then
    if new.bonus_balance <> 0 or new.cash_balance <> 0 then
      raise exception 'a wallet must start empty' using errcode = 'AG012';
    end if;
    return new;
  end if;
  if new.user_id <> old.user_id then
    raise exception 'a wallet cannot change owner' using errcode = 'AG012';
  end if;
  if (new.bonus_balance, new.cash_balance) is distinct from (old.bonus_balance, old.cash_balance)
     and coalesce(current_setting('agh.ledger_write', true), '') <> '1' then
    raise exception 'wallet balances can only be changed by private.apply_ledger_entry()' using errcode = 'AG012';
  end if;
  return new;
end;
$$;

create trigger wallets_write_guard
  before insert or update or delete on public.wallets
  for each row execute function private.wallet_write_guard();

create trigger wallets_no_truncate
  before truncate on public.wallets
  for each statement execute function private.wallet_write_guard();

-- ---------------------------------------------------------------------------------------------
-- The one way tokens move. Locks the wallet row, changes the balance, writes the ledger row.
-- Runs inside the caller's transaction, so staking, payouts and refunds built on it are atomic.
-- Error codes: AG001 insufficient balance, AG002 bad arguments, AG003 wallet not found.
-- ---------------------------------------------------------------------------------------------
create function private.apply_ledger_entry(
  p_user_id uuid,
  p_amount bigint,
  p_balance_type text,
  p_entry_type text,
  p_match_id uuid default null,
  p_payment_id uuid default null,
  p_idempotency_key text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_entry_id bigint;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'LEDGER_ZERO_AMOUNT' using errcode = 'AG002';
  end if;
  if p_balance_type is null or p_balance_type not in ('bonus', 'cash') then
    raise exception 'LEDGER_BAD_BALANCE_TYPE' using errcode = 'AG002';
  end if;

  -- Row lock: a second request for the same wallet waits here until this transaction ends.
  select case p_balance_type when 'bonus' then w.bonus_balance else w.cash_balance end
    into v_balance
    from public.wallets w
   where w.user_id = p_user_id
     for update;

  if not found then
    raise exception 'WALLET_NOT_FOUND' using errcode = 'AG003';
  end if;

  v_balance := v_balance + p_amount;
  if v_balance < 0 then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'AG001';
  end if;

  perform set_config('agh.ledger_write', '1', true);

  update public.wallets w
     set bonus_balance = case when p_balance_type = 'bonus' then v_balance else w.bonus_balance end,
         cash_balance = case when p_balance_type = 'cash' then v_balance else w.cash_balance end,
         updated_at = now()
   where w.user_id = p_user_id;

  insert into public.ledger_entries
    (user_id, amount, balance_type, entry_type, match_id, payment_id, balance_after, idempotency_key)
  values
    (p_user_id, p_amount, p_balance_type, p_entry_type, p_match_id, p_payment_id, v_balance, p_idempotency_key)
  returning id into v_entry_id;

  perform set_config('agh.ledger_write', '', true);

  return v_entry_id;
end;
$$;

revoke all on function private.apply_ledger_entry(uuid, bigint, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.ledger_is_append_only() from public, anon, authenticated, service_role;
revoke all on function private.ledger_insert_guard() from public, anon, authenticated, service_role;
revoke all on function private.wallet_write_guard() from public, anon, authenticated, service_role;
