-- The admin system's database side, plus the two things players need so that there is
-- something for admins to act on: blocking another player, and reporting one.
--
-- How admin access works:
--   * The admin app is a separate application. It talks to ONE Edge Function (admin-api), which
--     checks on every request that the caller is in public.admins and has passed the second
--     sign-in step, and only then calls the admin_* functions below with the service role.
--   * Those functions are callable by the service role only. No access rule is loosened for
--     admins: an admin's own session can read no more than any player's.
--   * Every action that changes anything writes a row to private.admin_audit_log in the same
--     transaction. The log is append-only for every role.
--   * Balances are corrected through the ledger like any other movement, never edited.

-- ---------------------------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------------------------
create table private.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles (id) on delete restrict,
  action text not null,
  target_user_id uuid references public.profiles (id) on delete restrict,
  target_match_id uuid references public.matches (id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_target_idx on private.admin_audit_log (target_user_id, id desc);
alter table private.admin_audit_log enable row level security;
revoke all on table private.admin_audit_log from public, anon, authenticated;
create policy admin_audit_log_deny_all on private.admin_audit_log as restrictive for all to public using (false) with check (false);

create function private.audit_is_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only: % is not allowed', tg_op using errcode = 'AG010';
end;
$$;
revoke all on function private.audit_is_append_only() from public, anon, authenticated, service_role;

create trigger admin_audit_log_no_update_delete
  before update or delete on private.admin_audit_log
  for each row execute function private.audit_is_append_only();
create trigger admin_audit_log_no_truncate
  before truncate on private.admin_audit_log
  for each statement execute function private.audit_is_append_only();

create function private.audit(p_admin_id uuid, p_action text, p_user_id uuid, p_match_id uuid, p_details jsonb) returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.admin_audit_log (admin_id, action, target_user_id, target_match_id, details)
  values (p_admin_id, p_action, p_user_id, p_match_id, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function private.audit(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Blocking (players)
-- ---------------------------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete restrict,
  blocked_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);
alter table public.blocks enable row level security;

create function private.is_blocked_pair(p_a uuid, p_b uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;
revoke all on function private.is_blocked_pair(uuid, uuid) from public, anon, authenticated, service_role;

/** Blocks a player: ends any friendship, and stops friend requests, messages and match chat between the two. */
create function public.block_player(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or p_user_id is null or p_user_id = v_me then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'PLAYER_NOT_FOUND');
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_me, p_user_id) on conflict do nothing;
  delete from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, p_user_id)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_user_id);
  return jsonb_build_object('ok', true);
end;
$$;

create function public.unblock_player(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- A friend request is refused when either player has blocked the other. The refusal does not
-- say who blocked whom.
create or replace function public.send_friend_request(p_username text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_them uuid;
  v_existing public.friendships;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  select p.id into v_them from public.profiles p where lower(p.username) = lower(trim(p_username));
  if v_them is null then
    return jsonb_build_object('ok', false, 'code', 'PLAYER_NOT_FOUND');
  end if;
  if v_them = v_me then
    return jsonb_build_object('ok', false, 'code', 'CANNOT_FRIEND_SELF');
  end if;
  if private.is_blocked_pair(v_me, v_them) then
    return jsonb_build_object('ok', false, 'code', 'CANNOT_CONTACT');
  end if;

  select * into v_existing from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, v_them)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_them)
     for update;

  if found then
    if v_existing.status = 'accepted' then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_FRIENDS');
    end if;
    if v_existing.requester_id = v_me then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_ALREADY_SENT');
    end if;
    update public.friendships f set status = 'accepted', responded_at = now() where f.id = v_existing.id;
    return jsonb_build_object('ok', true, 'status', 'accepted');
  end if;

  if (select count(*) from public.friendships f where f.requester_id = v_me and f.status = 'pending') >= 50 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_REQUESTS');
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_me, v_them);
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- A banned player cannot send private messages. (Blocking needs no check here: it ends the
-- friendship, and without one there is no messaging.)
create or replace function public.send_direct_message(p_to uuid, p_body text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := trim(coalesce(p_body, ''));
  v_id bigint;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if exists (select 1 from public.profile_private pp where pp.user_id = v_me and pp.is_banned) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
  end if;
  -- The privacy rule: no accepted friendship, no message.
  if not private.are_friends(v_me, p_to) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FRIENDS');
  end if;
  if (select count(*) from public.direct_messages m where m.sender_id = v_me and m.created_at > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('ok', false, 'code', 'SLOW_DOWN');
  end if;

  insert into public.direct_messages (sender_id, recipient_id, body) values (v_me, p_to, v_body) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Match chat is also closed between two players when either has blocked the other, and for a
-- banned player. (send_match_message asks this function, so it needs no change.)
create or replace function public.match_chat_status(p_match_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_match_player(p_match_id) then
    jsonb_build_object(
      'mine', (select pp.match_chat_enabled and not pp.is_banned from public.profile_private pp where pp.user_id = (select auth.uid())),
      'others', not exists (
        select 1 from public.match_players mp
          join public.profile_private pp on pp.user_id = mp.user_id
         where mp.match_id = p_match_id and mp.user_id <> (select auth.uid())
           and (not pp.match_chat_enabled or private.is_blocked_pair(mp.user_id, (select auth.uid())))))
  end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reports (players report, admins read)
-- ---------------------------------------------------------------------------------------------
create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete restrict,
  reported_id uuid not null references public.profiles (id) on delete restrict,
  match_id uuid references public.matches (id) on delete restrict,
  reason text not null check (reason in ('abuse', 'cheating', 'multiple_accounts', 'other')),
  note text check (char_length(note) <= 500),
  -- What was said, copied at the moment of the report. Admins read this copy; they have no
  -- way to browse players' conversations in general.
  context jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references public.profiles (id) on delete restrict,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint reports_not_self check (reporter_id <> reported_id)
);
create index reports_status_idx on public.reports (status, id desc);
create index reports_reported_idx on public.reports (reported_id, id desc);
alter table public.reports enable row level security;

create function public.report_player(p_user_id uuid, p_reason text, p_note text, p_match_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_context jsonb;
begin
  if v_me is null or p_user_id is null or p_user_id = v_me then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if p_reason is null or p_reason not in ('abuse', 'cheating', 'multiple_accounts', 'other') or char_length(coalesce(v_note, '')) > 500 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'PLAYER_NOT_FOUND');
  end if;
  -- A match may only be cited by someone who played in it, against someone who played in it.
  if p_match_id is not null and not exists (
       select 1 from public.match_players a join public.match_players b on b.match_id = a.match_id
        where a.match_id = p_match_id and a.user_id = v_me and b.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  if exists (select 1 from public.reports r
              where r.reporter_id = v_me and r.reported_id = p_user_id and r.status = 'open'
                and r.match_id is not distinct from p_match_id) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_REPORTED');
  end if;
  if (select count(*) from public.reports r where r.reporter_id = v_me and r.created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_REPORTS');
  end if;

  if p_match_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('from', x.sender_id, 'kind', x.kind, 'body', x.body, 'at', x.created_at) order by x.id), '[]'::jsonb)
      into v_context
      from (select mm.* from public.match_messages mm where mm.match_id = p_match_id order by mm.id desc limit 40) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('from', x.sender_id, 'kind', 'text', 'body', x.body, 'at', x.created_at) order by x.id), '[]'::jsonb)
      into v_context
      from (select dm.* from public.direct_messages dm
             where (dm.sender_id = v_me and dm.recipient_id = p_user_id) or (dm.sender_id = p_user_id and dm.recipient_id = v_me)
             order by dm.id desc limit 40) x;
  end if;

  insert into public.reports (reporter_id, reported_id, match_id, reason, note, context)
  values (v_me, p_user_id, p_match_id, p_reason, v_note, v_context);
  return jsonb_build_object('ok', true);
end;
$$;

-- Access for the two new player-facing tables.
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['blocks', 'reports'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format(
        'create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
        t || '_deny_client_' || op, t, op,
        case op when 'insert' then 'with check (false)' when 'delete' then 'using (false)' else 'using (false) with check (false)' end);
    end loop;
  end loop;
end;
$$;

-- A player sees whom they have blocked (so the app can offer "Unblock"), never who blocked them.
grant select on public.blocks to authenticated;
create policy blocks_select_own on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
-- Reports are for admins only. Players cannot read them, not even their own.
create policy reports_deny_client_select on public.reports as restrictive for select to anon, authenticated using (false);

do $$
declare
  fn text;
begin
  foreach fn in array array['public.block_player(uuid)', 'public.unblock_player(uuid)', 'public.report_player(uuid, text, text, uuid)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin functions (service role only; the Edge Function has already checked who is calling)
-- ---------------------------------------------------------------------------------------------
alter table public.profile_private add column ban_reason text;

create function public.admin_overview() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'players_today', (select count(*) from public.profiles p where p.created_at >= date_trunc('day', now())),
    'banned', (select count(*) from public.profile_private pp where pp.is_banned),
    'active_matches', (select count(*) from public.matches m where m.status = 'active'),
    'matches_today', (select count(*) from public.matches m where m.status = 'finished' and m.finished_at >= date_trunc('day', now())),
    'searching', (select count(*) from public.match_queue),
    'tokens_bonus', (select coalesce(sum(w.bonus_balance), 0) from public.wallets w),
    'tokens_cash', (select coalesce(sum(w.cash_balance), 0) from public.wallets w),
    'tokens_in_escrow', (select coalesce(sum(e.amount), 0) from public.escrow e where e.status = 'held'),
    'rake_total', (select coalesce(sum(r.amount), 0) from public.platform_revenue r),
    'rake_cash_total', (select coalesce(sum(r.cash_amount), 0) from public.platform_revenue r),
    'rake_today', (select coalesce(sum(r.amount), 0) from public.platform_revenue r where r.created_at >= date_trunc('day', now())),
    'open_reports', (select count(*) from public.reports r where r.status = 'open'),
    'integrity_problems', (select count(*) from public.verify_ledger_integrity()),
    'integrity_alerts', (select count(*) from private.integrity_alerts),
    'last_alert_at', (select max(a.checked_at) from private.integrity_alerts a)
  );
$$;

create function public.admin_search_players(p_query text, p_limit integer, p_offset integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as term),
  hits as (
    select p.id, p.username, p.display_name, p.country_code, p.created_at, u.email,
           pp.is_banned, w.bonus_balance, w.cash_balance
      from public.profiles p
      join auth.users u on u.id = p.id
      join public.profile_private pp on pp.user_id = p.id
      left join public.wallets w on w.user_id = p.id
      cross join q
     where q.term is null
        or p.username ilike '%' || q.term || '%'
        or p.display_name ilike '%' || q.term || '%'
        or u.email ilike '%' || q.term || '%'
        or p.id::text = q.term
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc)
                        from (select * from hits order by created_at desc
                               limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) h), '[]'::jsonb));
$$;

create function public.admin_player(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'country_code', p.country_code,
    'created_at', p.created_at,
    'email', u.email,
    'email_confirmed', u.email_confirmed_at is not null,
    'last_sign_in_at', u.last_sign_in_at,
    'is_admin', exists (select 1 from public.admins a where a.user_id = p.id),
    'is_banned', pp.is_banned,
    'ban_reason', pp.ban_reason,
    'age_confirmed', pp.age_confirmed_at is not null,
    'phone', pp.phone_e164,
    'language', pp.preferred_language,
    'match_chat_enabled', pp.match_chat_enabled,
    'bonus_balance', coalesce(w.bonus_balance, 0),
    'cash_balance', coalesce(w.cash_balance, 0),
    'in_escrow', (select coalesce(sum(e.amount), 0) from public.escrow e where e.user_id = p.id and e.status = 'held'),
    'ratings', coalesce((select jsonb_agg(jsonb_build_object('game', r.game_type, 'pool', r.pool, 'rating', r.rating, 'games', r.games_played,
                                                               'wins', r.wins, 'losses', r.losses, 'draws', r.draws) order by r.game_type, r.pool)
                           from public.player_ratings r where r.user_id = p.id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc)
                          from (select l.id, l.amount, l.balance_type, l.entry_type, l.balance_after, l.match_id, l.created_at
                                  from public.ledger_entries l where l.user_id = p.id order by l.id desc limit 60) x), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
                           from (select m.id, m.game_type, m.rating_pool, m.status, m.result, m.end_reason, m.stake_amount, m.created_at,
                                        (m.winner_id = p.id) as won, mp.tokens_change, mp.rating_before, mp.rating_after,
                                        (select string_agg(op.username, ', ') from public.match_players o join public.profiles op on op.id = o.user_id
                                          where o.match_id = m.id and o.user_id <> p.id) as opponents
                                   from public.match_players mp join public.matches m on m.id = mp.match_id
                                  where mp.user_id = p.id order by m.created_at desc limit 40) x), '[]'::jsonb),
    'reports_against', (select count(*) from public.reports r where r.reported_id = p.id),
    'reports_open', (select count(*) from public.reports r where r.reported_id = p.id and r.status = 'open'),
    'reports_made', (select count(*) from public.reports r where r.reporter_id = p.id),
    'friends', (select count(*) from public.friendships f where f.status = 'accepted' and p.id in (f.requester_id, f.addressee_id)),
    'admin_actions', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc)
                                 from (select a.id, a.action, a.details, a.created_at,
                                              (select ap.username from public.profiles ap where ap.id = a.admin_id) as admin
                                         from private.admin_audit_log a where a.target_user_id = p.id order by a.id desc limit 30) x), '[]'::jsonb)
  )
    from public.profiles p
    join auth.users u on u.id = p.id
    join public.profile_private pp on pp.user_id = p.id
    left join public.wallets w on w.user_id = p.id
   where p.id = p_user_id;
$$;

create function public.admin_set_ban(p_admin_id uuid, p_user_id uuid, p_banned boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  -- Admins cannot ban admins (including themselves): removing an admin is done in the database.
  if exists (select 1 from public.admins a where a.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'CANNOT_BAN_ADMIN');
  end if;
  update public.profile_private pp
     set is_banned = p_banned, ban_reason = case when p_banned then v_reason end, updated_at = now()
   where pp.user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PLAYER_NOT_FOUND');
  end if;
  if p_banned then
    delete from public.match_queue q where q.user_id = p_user_id;
  end if;
  perform private.audit(p_admin_id, case when p_banned then 'ban' else 'unban' end, p_user_id, null, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

/**
 * Corrects a balance. It is an ordinary ledger entry of type 'adjustment' (so the books still
 * balance), and the audit log records which admin made it, the reason, and the ledger row.
 */
create function public.admin_adjust_balance(p_admin_id uuid, p_user_id uuid, p_amount bigint, p_balance_type text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_entry bigint;
begin
  if v_reason is null or char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 or p_balance_type not in ('bonus', 'cash') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  -- Nobody adjusts their own wallet.
  if p_user_id = p_admin_id then
    return jsonb_build_object('ok', false, 'code', 'CANNOT_ADJUST_SELF');
  end if;
  begin
    v_entry := private.apply_ledger_entry(p_user_id, p_amount, p_balance_type, 'adjustment');
  exception
    when sqlstate 'AG001' then return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE');
    when sqlstate 'AG003' then return jsonb_build_object('ok', false, 'code', 'PLAYER_NOT_FOUND');
  end;
  perform private.audit(p_admin_id, 'adjust_balance', p_user_id, null,
    jsonb_build_object('amount', p_amount, 'balance_type', p_balance_type, 'reason', v_reason, 'ledger_entry_id', v_entry));
  return jsonb_build_object('ok', true, 'ledger_entry_id', v_entry);
end;
$$;

create function public.admin_matches(p_status text, p_limit integer, p_offset integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with hits as (
    select m.id, m.game_type, m.rating_pool, m.status, m.result, m.end_reason, m.stake_amount, m.settled, m.created_at, m.finished_at,
           (select string_agg(p.username || ' (' || mp.seat || ')', ' vs ' order by mp.seat desc)
              from public.match_players mp join public.profiles p on p.id = mp.user_id where mp.match_id = m.id) as players,
           (select wp.username from public.profiles wp where wp.id = m.winner_id) as winner
      from public.matches m
     where p_status is null or m.status = p_status
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc)
                        from (select * from hits order by created_at desc
                               limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) h), '[]'::jsonb));
$$;

create function public.admin_match(p_match_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_game jsonb;
begin
  select * into v_match from public.matches m where m.id = p_match_id;
  if not found then
    return null;
  end if;
  -- Each game keeps its state in <game>_games; shown as-is, whatever the game.
  if to_regclass('public.' || quote_ident(v_match.game_type || '_games')) is not null then
    execute format('select to_jsonb(g) from public.%I g where g.match_id = $1', v_match.game_type || '_games') into v_game using p_match_id;
  end if;

  return to_jsonb(v_match) || jsonb_build_object(
    'winner', (select p.username from public.profiles p where p.id = v_match.winner_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object('user_id', mp.user_id, 'username', p.username, 'seat', mp.seat,
                                                              'rating_before', mp.rating_before, 'rating_after', mp.rating_after,
                                                              'tokens_change', mp.tokens_change) order by mp.seat desc)
                           from public.match_players mp join public.profiles p on p.id = mp.user_id where mp.match_id = p_match_id), '[]'::jsonb),
    'escrow', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'amount', e.amount, 'balance_type', e.balance_type, 'status', e.status) order by e.id)
                          from public.escrow e join public.profiles p on p.id = e.user_id where e.match_id = p_match_id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'username', p.username, 'amount', l.amount, 'balance_type', l.balance_type,
                                                             'entry_type', l.entry_type, 'created_at', l.created_at) order by l.id)
                          from public.ledger_entries l join public.profiles p on p.id = l.user_id where l.match_id = p_match_id), '[]'::jsonb),
    'rake', (select r.amount from public.platform_revenue r where r.match_id = p_match_id),
    'game', v_game
  );
end;
$$;

/** Calls an active match off: no result, every stake refunded in full through the normal settlement. */
create function public.admin_abort_match(p_admin_id uuid, p_match_id uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if not private.finish_match(p_match_id, 'aborted', null, 'admin_abort') then
    return jsonb_build_object('ok', false, 'code', 'MATCH_NOT_ACTIVE');
  end if;
  perform private.audit(p_admin_id, 'abort_match', null, p_match_id, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_reports(p_status text, p_limit integer, p_offset integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with hits as (
    select r.id, r.reason, r.note, r.status, r.match_id, r.created_at, r.resolved_at, r.resolution_note, r.context,
           r.reporter_id, r.reported_id,
           (select p.username from public.profiles p where p.id = r.reporter_id) as reporter,
           (select p.username from public.profiles p where p.id = r.reported_id) as reported,
           (select p.username from public.profiles p where p.id = r.resolved_by) as resolved_by,
           (select count(*) from public.reports o where o.reported_id = r.reported_id) as reports_against_player
      from public.reports r
     where p_status is null or r.status = p_status
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc)
                        from (select * from hits order by id desc
                               limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) h), '[]'::jsonb));
$$;

create function public.admin_resolve_report(p_admin_id uuid, p_report_id bigint, p_status text, p_note text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reported uuid;
begin
  if p_status not in ('resolved', 'dismissed') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  update public.reports r
     set status = p_status, resolved_by = p_admin_id, resolution_note = nullif(trim(coalesce(p_note, '')), ''), resolved_at = now()
   where r.id = p_report_id and r.status = 'open'
  returning r.reported_id into v_reported;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'REPORT_NOT_OPEN');
  end if;
  perform private.audit(p_admin_id, 'report_' || p_status, v_reported, null, jsonb_build_object('report_id', p_report_id, 'note', p_note));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_revenue(p_days integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select generate_series(date_trunc('day', now()) - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90) - 1),
                           date_trunc('day', now()), interval '1 day') as day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day::date,
           'matches', (select count(*) from public.matches m where m.status = 'finished' and m.finished_at >= d.day and m.finished_at < d.day + interval '1 day'),
           'staked', (select coalesce(sum(m.stake_amount), 0) from public.matches m join public.match_players mp on mp.match_id = m.id
                       where m.status = 'finished' and m.finished_at >= d.day and m.finished_at < d.day + interval '1 day'),
           'rake', (select coalesce(sum(r.amount), 0) from public.platform_revenue r where r.created_at >= d.day and r.created_at < d.day + interval '1 day'),
           'rake_cash', (select coalesce(sum(r.cash_amount), 0) from public.platform_revenue r where r.created_at >= d.day and r.created_at < d.day + interval '1 day'),
           'signups', (select count(*) from public.profiles p where p.created_at >= d.day and p.created_at < d.day + interval '1 day')
         ) order by d.day desc), '[]'::jsonb)
    from days d;
$$;

create function public.admin_integrity() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'problems', coalesce((select jsonb_agg(to_jsonb(v)) from public.verify_ledger_integrity() v), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc)
                          from (select a.id, a.checked_at, a.problems from private.integrity_alerts a order by a.id desc limit 30) x), '[]'::jsonb));
$$;

create function public.admin_audit(p_limit integer, p_offset integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from private.admin_audit_log),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc)
                        from (select a.id, a.action, a.details, a.created_at, a.target_user_id, a.target_match_id,
                                     (select p.username from public.profiles p where p.id = a.admin_id) as admin,
                                     (select p.username from public.profiles p where p.id = a.target_user_id) as target
                                from private.admin_audit_log a order by a.id desc
                               limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_overview()',
    'public.admin_search_players(text, integer, integer)',
    'public.admin_player(uuid)',
    'public.admin_set_ban(uuid, uuid, boolean, text)',
    'public.admin_adjust_balance(uuid, uuid, bigint, text, text)',
    'public.admin_matches(text, integer, integer)',
    'public.admin_match(uuid)',
    'public.admin_abort_match(uuid, uuid, text)',
    'public.admin_reports(text, integer, integer)',
    'public.admin_resolve_report(uuid, bigint, text, text)',
    'public.admin_revenue(integer)',
    'public.admin_integrity()',
    'public.admin_audit(integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
