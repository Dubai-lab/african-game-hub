-- Notifications inside the app (the bell), announcements from the hub, the team's side of
-- "Report a problem", emails about a player's account, and what is needed to reach a phone
-- when the app is closed.
--
-- A notification is one row for one player: what happened (its kind) and what the app needs
-- to say so in the player's language (its data). Rows are written by the database itself, in
-- the same transaction as what they announce: a friend request, a challenge, a tournament
-- starting, an answer from our team, a message from the hub. No player can write one.

-- ---------------------------------------------------------------------------------------------
-- More kinds of email, and an order of sending
-- ---------------------------------------------------------------------------------------------
alter table private.mail_outbox drop constraint mail_outbox_template_check;
alter table private.mail_outbox add constraint mail_outbox_template_check
  check (template in ('welcome', 'support_received', 'support_notice', 'support_answered', 'account_suspended', 'account_restored', 'password_changed', 'announcement'));
-- Lower goes first. An announcement to every player must never hold up the answer to one
-- player's report, so it waits behind everything else.
alter table private.mail_outbox add column priority smallint not null default 0;
drop index private.mail_outbox_waiting_idx;
create index mail_outbox_waiting_idx on private.mail_outbox (priority, id) where status = 'queued';

drop function private.queue_mail(text, text, text, jsonb, text);
create function private.queue_mail(p_to text, p_template text, p_language text, p_data jsonb, p_reply_to text default null, p_priority smallint default 0) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_to is null then
    return;
  end if;
  insert into private.mail_outbox (to_email, reply_to, template, language, data, priority)
  values (lower(trim(p_to)), p_reply_to, p_template, coalesce(p_language, 'en'), coalesce(p_data, '{}'::jsonb), coalesce(p_priority, 0));
exception when others then
  -- An email is never worth failing a sign-up or a report for.
  null;
end;
$$;
revoke all on function private.queue_mail(text, text, text, jsonb, text, smallint) from public, anon, authenticated, service_role;

create or replace function public.mail_claim(p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(coalesce(p_limit, (select s.per_minute from private.mail_settings s)), 60);
  v_rows jsonb;
begin
  update private.mail_outbox m
     set status = 'queued'
   where m.status = 'sending' and m.claimed_at < now() - interval '10 minutes';

  with next as (
    select m.id from private.mail_outbox m
     where m.status = 'queued' and m.not_before <= now()
     order by m.priority, m.id
     limit greatest(v_limit, 1)
       for update skip locked
  ), taken as (
    update private.mail_outbox m
       set status = 'sending', claimed_at = now(), attempts = m.attempts + 1
      from next
     where m.id = next.id
    returning m.id, m.to_email, m.reply_to, m.template, m.language, m.data, m.priority
  )
  select coalesce(jsonb_agg(to_jsonb(taken) - 'priority' order by taken.priority, taken.id), '[]'::jsonb) into v_rows from taken;
  return v_rows;
end;
$$;

-- A player may switch off the hub's news emails. (Emails about their own account and their own
-- reports are always sent.)
alter table public.profile_private add column news_emails boolean not null default true;

create function public.set_news_emails(p_on boolean) returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_private pp set news_emails = coalesce(p_on, true), updated_at = now() where pp.user_id = (select auth.uid());
$$;
revoke all on function public.set_news_emails(boolean) from public, anon;
grant execute on function public.set_news_emails(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------------------------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'challenge', 'tournament_started', 'support_answered', 'announcement')),
  -- What the app needs to say it: names, a title, where to go. Never anything private to another player.
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  -- When it was sent on to the player's phones (see push_subscriptions); null while it waits.
  pushed_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, id desc);
create index notifications_unpushed_idx on public.notifications (id) where pushed_at is null;
alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
-- (user_id is readable because live updates are filtered by it; a player sees only their own rows anyway.)
grant select (id, user_id, kind, data, created_at, read_at) on public.notifications to authenticated;
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_no_client_writes on public.notifications as restrictive for all to anon, authenticated using (true) with check (false);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

create function private.notify(p_user_id uuid, p_kind text, p_data jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, kind, data) values (p_user_id, p_kind, coalesce(p_data, '{}'::jsonb));
  -- No player needs more than their last hundred.
  delete from public.notifications n
   where n.user_id = p_user_id
     and n.id < (select min(k.id) from (select o.id from public.notifications o where o.user_id = p_user_id order by o.id desc limit 100) k);
exception when others then
  -- A notification is never worth failing what it announces.
  null;
end;
$$;
revoke all on function private.notify(uuid, text, jsonb) from public, anon, authenticated, service_role;

/** Marks the player's notifications as read, up to and including this one (all of them when none is named). */
create function public.mark_notifications_read(p_up_to bigint default null) returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications n
     set read_at = now()
   where n.user_id = (select auth.uid()) and n.read_at is null and (p_up_to is null or n.id <= p_up_to);
$$;
revoke all on function public.mark_notifications_read(bigint) from public, anon;
grant execute on function public.mark_notifications_read(bigint) to authenticated, service_role;

-- A friend request, and its acceptance.
create function private.notify_friendship() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select p.username into v_name from public.profiles p where p.id = new.requester_id;
    perform private.notify(new.addressee_id, 'friend_request', jsonb_build_object('username', v_name));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    select p.username into v_name from public.profiles p where p.id = new.addressee_id;
    perform private.notify(new.requester_id, 'friend_accepted', jsonb_build_object('username', v_name));
  end if;
  return new;
end;
$$;
revoke all on function private.notify_friendship() from public, anon, authenticated, service_role;
create trigger friendships_notify after insert or update of status on public.friendships
  for each row execute function private.notify_friendship();

-- A challenge sent to a particular player.
create function private.notify_challenge() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.to_user is not null and new.status = 'pending' then
    select p.username into v_name from public.profiles p where p.id = new.from_user;
    perform private.notify(new.to_user, 'challenge', jsonb_build_object('username', v_name, 'game', new.game_type, 'stake', new.stake_amount, 'challenge_id', new.id));
  end if;
  return new;
end;
$$;
revoke all on function private.notify_challenge() from public, anon, authenticated, service_role;
create trigger challenges_notify after insert on public.challenges
  for each row execute function private.notify_challenge();

-- A tournament a player joined has started.
create function private.notify_tournament() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'scheduled' and new.status = 'running' then
    perform private.notify(tp.user_id, 'tournament_started', jsonb_build_object('name', new.name, 'game', new.game_type, 'tournament_id', new.id))
       from public.tournament_players tp
      where tp.tournament_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_tournament() from public, anon, authenticated, service_role;
create trigger tournaments_notify after update of status on public.tournaments
  for each row execute function private.notify_tournament();

-- ---------------------------------------------------------------------------------------------
-- Phones to reach when the app is closed
-- ---------------------------------------------------------------------------------------------
-- One row for each browser (or Home-screen app) a player has said may be sent notifications.
-- The three values are what the browser hands the app for exactly this purpose; they let a
-- message be sent to that one browser and nothing else.
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  language text not null default 'en',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
create policy push_subscriptions_deny_clients on public.push_subscriptions as restrictive for all to anon, authenticated using (false) with check (false);

/** This browser may be sent the player's notifications. (Said again by the same browser, it simply stays.) */
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_language text default 'en') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or p_p256dh is null or char_length(p_p256dh) not between 20 and 200
     or p_auth is null or char_length(p_auth) not between 10 and 100 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  -- A browser belongs to whoever is signed in on it now.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, language)
  values (v_me, p_endpoint, p_p256dh, p_auth, coalesce(nullif(p_language, ''), 'en'))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, language = excluded.language;
  -- A handful of devices is plenty; the oldest go.
  delete from public.push_subscriptions s
   where s.user_id = v_me
     and s.id not in (select k.id from public.push_subscriptions k where k.user_id = v_me order by k.id desc limit 5);
  return jsonb_build_object('ok', true);
end;
$$;

/** This browser is not to be sent notifications any more. */
create function public.remove_push_subscription(p_endpoint text) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = (select auth.uid());
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated, service_role;
grant execute on function public.remove_push_subscription(text) to authenticated, service_role;

/** For the sending function: the next notifications to send on to phones, each with the phones to send it to. Marked as sent in the same step. */
create function public.push_claim(p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  -- First, all at once: those nobody can be sent (the player has no phone signed up, or it is
  -- read or stale already). An announcement to every player must not wait its turn behind them.
  update public.notifications n
     set pushed_at = now()
   where n.pushed_at is null
     and (n.read_at is not null or n.created_at <= now() - interval '1 hour'
          or not exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id));

  with next as (
    select n.id from public.notifications n
     where n.pushed_at is null
     order by n.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
       for update skip locked
  ), taken as (
    update public.notifications n set pushed_at = now() from next where n.id = next.id
    returning n.id, n.user_id, n.kind, n.data, n.read_at, n.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'kind', t.kind, 'data', t.data,
           'to', (select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'language', s.language))
                    from public.push_subscriptions s where s.user_id = t.user_id)) order by t.id), '[]'::jsonb)
    into v_rows
    from taken t
   -- Nothing already read, nothing stale, and nobody without a phone to send to.
   where t.read_at is null and t.created_at > now() - interval '1 hour'
     and exists (select 1 from public.push_subscriptions s where s.user_id = t.user_id);
  return v_rows;
end;
$$;

/** For the sending function: these phones took the message; these no longer exist and are forgotten. */
create function public.push_result(p_ok bigint[], p_gone bigint[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_subscriptions s set last_ok_at = now() where s.id = any (coalesce(p_ok, '{}'));
  delete from public.push_subscriptions s where s.id = any (coalesce(p_gone, '{}'));
end;
$$;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
revoke all on function public.push_result(bigint[], bigint[]) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;
grant execute on function public.push_result(bigint[], bigint[]) to service_role;

-- The same waking as for email, when there is a notification to send on to a phone. Asked
-- for phones only (a notification has just been written), the function leaves the emails to
-- their own minute, so that notifications never make the mailbox send faster than its pace.
drop function private.mail_kick();
create function private.mail_kick(p_phones_only boolean default false) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.mail_settings;
begin
  if (p_phones_only or not exists (select 1 from private.mail_outbox m where m.status = 'queued' and m.not_before <= now()))
     and not exists (select 1 from public.notifications n where n.pushed_at is null) then
    return;
  end if;
  select * into v from private.mail_settings;
  if v.functions_url is null or v.cron_key is null or v.anon_key is null then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3)'
    using v.functions_url || '/core-mail',
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v.anon_key, 'apikey', v.anon_key, 'x-mail-key', v.cron_key),
          jsonb_build_object('phones_only', p_phones_only);
exception when others then
  null;
end;
$$;
revoke all on function private.mail_kick(boolean) from public, anon, authenticated, service_role;

-- A notification should reach a phone in seconds, not at the next minute: the function is
-- woken as soon as one is written: once for all that were written together, so an
-- announcement to every player wakes it once and not once a player.
create function private.push_kick() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from fresh f join public.push_subscriptions s on s.user_id = f.user_id) then
    perform private.mail_kick(true);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.push_kick() from public, anon, authenticated, service_role;
create trigger notifications_push after insert on public.notifications
  referencing new table as fresh
  for each statement execute function private.push_kick();

-- ---------------------------------------------------------------------------------------------
-- Announcements from the hub
-- ---------------------------------------------------------------------------------------------
create table public.announcements (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 3 and 80),
  body text not null check (char_length(body) between 10 and 2000),
  emailed boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  recipients integer not null default 0,
  emails integer not null default 0
);
alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated;
grant select (id, title, body, created_at) on public.announcements to authenticated;
-- Anyone signed in may read what the hub has announced.
create policy announcements_select_signed_in on public.announcements for select to authenticated using (true);
create policy announcements_no_client_writes on public.announcements as restrictive for all to anon, authenticated using (true) with check (false);

/**
 * Our team tells every player something: a notification in the app for all of them, and, when
 * asked for, an email to each player with a confirmed address who has not switched news
 * emails off. The emails go out behind all other mail, at the mailbox's pace.
 */
create function public.admin_announce(p_admin_id uuid, p_title text, p_body text, p_email boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_id bigint;
  v_players integer;
  v_emails integer := 0;
begin
  if char_length(v_title) not between 3 and 80 or char_length(v_body) not between 10 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  -- One announcement in ten minutes: a slip of the hand must not write to everyone twice.
  if exists (select 1 from public.announcements a where a.created_at > now() - interval '10 minutes') then
    return jsonb_build_object('ok', false, 'code', 'TOO_SOON');
  end if;

  insert into public.announcements (title, body, emailed, created_by) values (v_title, v_body, coalesce(p_email, false), p_admin_id) returning id into v_id;

  insert into public.notifications (user_id, kind, data)
  select pp.user_id, 'announcement', jsonb_build_object('title', v_title, 'body', v_body, 'announcement_id', v_id)
    from public.profile_private pp
   where not pp.is_banned;
  get diagnostics v_players = row_count;

  if coalesce(p_email, false) then
    insert into private.mail_outbox (to_email, template, language, data, priority)
    select lower(u.email), 'announcement', pp.preferred_language,
           jsonb_build_object('title', v_title, 'body', v_body, 'name', coalesce(p.display_name, p.username)), 10
      from auth.users u
      join public.profile_private pp on pp.user_id = u.id
      join public.profiles p on p.id = u.id
     where u.email is not null and u.email_confirmed_at is not null and pp.news_emails and not pp.is_banned;
    get diagnostics v_emails = row_count;
  end if;

  update public.announcements a set recipients = v_players, emails = v_emails where a.id = v_id;
  perform private.audit(p_admin_id, 'announce', null, null, jsonb_build_object('announcement_id', v_id, 'title', v_title, 'players', v_players, 'emails', v_emails));
  return jsonb_build_object('ok', true, 'id', v_id, 'players', v_players, 'emails', v_emails);
end;
$$;

create function public.admin_announcements(p_limit integer, p_offset integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.announcements),
    'waiting_emails', (select count(*) from private.mail_outbox m where m.template = 'announcement' and m.status in ('queued', 'sending')),
    'per_minute', (select s.per_minute from private.mail_settings s),
    'rows', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc)
                        from (select a.id, a.title, a.body, a.emailed, a.created_at, a.recipients, a.emails,
                                     (select p.username from public.profiles p where p.id = a.created_by) as created_by
                                from public.announcements a order by a.id desc
                               limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) h), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- The team's side of "Report a problem"
-- ---------------------------------------------------------------------------------------------
create function public.admin_support_requests(p_status text, p_limit integer, p_offset integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with hits as (
    select s.id, s.user_id, s.category, s.message, s.page, s.device, s.status, s.created_at, s.answered_at, s.admin_note,
           (select p.username from public.profiles p where p.id = s.user_id) as username,
           (select u.email from auth.users u where u.id = s.user_id) as email,
           (select p.username from public.profiles p where p.id = s.answered_by) as answered_by
      from public.support_requests s
     where p_status is null or s.status = p_status
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc)
                        from (select * from hits order by id desc
                               limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) h), '[]'::jsonb));
$$;

/**
 * Our team answers a report (the answer is emailed to the player and they are notified in the
 * app), or closes it without one.
 */
create function public.admin_answer_support(p_admin_id uuid, p_request_id bigint, p_status text, p_reply text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
  v_request public.support_requests;
  v_email text;
  v_name text;
  v_language text;
begin
  if p_status not in ('answered', 'closed') or (p_status = 'answered' and (v_reply is null or char_length(v_reply) < 10)) or char_length(coalesce(v_reply, '')) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  update public.support_requests s
     set status = p_status, answered_at = now(), answered_by = p_admin_id, admin_note = v_reply
   where s.id = p_request_id and s.status = 'open'
  returning s.* into v_request;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_OPEN');
  end if;

  if p_status = 'answered' then
    select u.email into v_email from auth.users u where u.id = v_request.user_id;
    select coalesce(p.display_name, p.username) into v_name from public.profiles p where p.id = v_request.user_id;
    select pp.preferred_language into v_language from public.profile_private pp where pp.user_id = v_request.user_id;
    perform private.queue_mail(v_email, 'support_answered', v_language,
                               jsonb_build_object('name', v_name, 'reference', v_request.id, 'message', v_request.message, 'reply', v_reply));
    perform private.notify(v_request.user_id, 'support_answered', jsonb_build_object('reference', v_request.id));
  end if;
  perform private.audit(p_admin_id, 'support_' || p_status, v_request.user_id, null, jsonb_build_object('request_id', p_request_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Emails about a player's own account
-- ---------------------------------------------------------------------------------------------
-- Suspended, or restored: the player is told by email, with the reason our team gave.
create or replace function public.admin_set_ban(p_admin_id uuid, p_user_id uuid, p_banned boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_was boolean;
  v_email text;
  v_name text;
  v_language text;
begin
  if v_reason is null or char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  -- Admins cannot ban admins (including themselves): removing an admin is done in the database.
  if exists (select 1 from public.admins a where a.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'CANNOT_BAN_ADMIN');
  end if;
  select pp.is_banned, pp.preferred_language into v_was, v_language from public.profile_private pp where pp.user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PLAYER_NOT_FOUND');
  end if;
  update public.profile_private pp
     set is_banned = p_banned, ban_reason = case when p_banned then v_reason end, updated_at = now()
   where pp.user_id = p_user_id;
  if p_banned then
    delete from public.match_queue q where q.user_id = p_user_id;
  end if;
  perform private.audit(p_admin_id, case when p_banned then 'ban' else 'unban' end, p_user_id, null, jsonb_build_object('reason', v_reason));

  -- Only when something changed for the player.
  if v_was is distinct from p_banned then
    select u.email into v_email from auth.users u where u.id = p_user_id;
    select coalesce(p.display_name, p.username) into v_name from public.profiles p where p.id = p_user_id;
    perform private.queue_mail(v_email, case when p_banned then 'account_suspended' else 'account_restored' end, v_language,
                               jsonb_build_object('name', v_name, 'reason', v_reason));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- A changed password: the player is told, in case it was not them. (Where the auth server
-- keeps passwords; the test database has no such column, and no such email.)
create function private.password_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_language text;
begin
  select coalesce(p.display_name, p.username) into v_name from public.profiles p where p.id = new.id;
  select pp.preferred_language into v_language from public.profile_private pp where pp.user_id = new.id;
  perform private.queue_mail(new.email, 'password_changed', v_language, jsonb_build_object('name', v_name));
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.password_changed() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute $t$
      create trigger on_auth_user_password_changed
        after update of encrypted_password on auth.users
        for each row
        when (old.encrypted_password is not null and old.encrypted_password is distinct from new.encrypted_password)
        execute function private.password_changed()
    $t$;
  end if;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_announce(uuid, text, text, boolean)',
    'public.admin_announcements(integer, integer)',
    'public.admin_support_requests(text, integer, integer)',
    'public.admin_answer_support(uuid, bigint, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
