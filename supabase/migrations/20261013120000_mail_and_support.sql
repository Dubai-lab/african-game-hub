-- Email from the hub itself, and "Report a problem".
--
-- Until now the only emails were the two the auth server sends (confirm your account, reset
-- your password). This adds the hub's own: a welcome when an account is confirmed, and an
-- answer at once to a player who reports a problem. More kinds follow the same road.
--
-- How an email is sent: it is written into a queue (mail_outbox) by whatever causes it, in
-- the same transaction, and a small server function (core-mail) empties the queue a few at a
-- time, once a minute. Nothing waits on a mail server, a mail server that is down loses
-- nothing, and the hub never sends faster than its mailbox allows.

-- ---------------------------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------------------------
create table private.mail_outbox (
  id bigint generated always as identity primary key,
  to_email text not null check (to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(to_email) <= 254),
  -- Where an answer should go, when not to the hub's own sending address.
  reply_to text check (reply_to is null or char_length(reply_to) <= 254),
  -- Which email this is. The words live with the function that sends it, in each language.
  template text not null check (template in ('welcome', 'support_received', 'support_notice')),
  language text not null default 'en',
  -- What the words need: a name, a reference number, the player's own message.
  data jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  not_before timestamptz not null default now(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text
);
create index mail_outbox_waiting_idx on private.mail_outbox (not_before, id) where status = 'queued';
alter table private.mail_outbox enable row level security;
revoke all on table private.mail_outbox from public, anon, authenticated;
create policy mail_outbox_deny_all on private.mail_outbox as restrictive for all to public using (false) with check (false);

-- What the database needs to know to wake the sending function: where it is, and the key that
-- proves the call is ours. One row, written for each project by scripts/setupMail.ts (never in
-- a migration: the two projects differ, and the key is a secret).
create table private.mail_settings (
  only_row boolean primary key default true check (only_row),
  functions_url text,
  anon_key text,
  cron_key text,
  -- How many emails one waking may send. The mailbox allows only so many an hour.
  per_minute integer not null default 4 check (per_minute between 1 and 60),
  -- Where our team reads what players report.
  support_address text not null default 'support@africangamehub.com'
);
insert into private.mail_settings default values;
alter table private.mail_settings enable row level security;
revoke all on table private.mail_settings from public, anon, authenticated;
create policy mail_settings_deny_all on private.mail_settings as restrictive for all to public using (false) with check (false);

/** Puts one email in the queue. Never fails its caller: an address that will not do is simply not written to. */
create function private.queue_mail(p_to text, p_template text, p_language text, p_data jsonb, p_reply_to text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_to is null then
    return;
  end if;
  insert into private.mail_outbox (to_email, reply_to, template, language, data)
  values (lower(trim(p_to)), p_reply_to, p_template, coalesce(p_language, 'en'), coalesce(p_data, '{}'::jsonb));
exception when others then
  -- An email is never worth failing a sign-up or a report for.
  null;
end;
$$;
revoke all on function private.queue_mail(text, text, text, jsonb, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The sending function's two calls (service role only)
-- ---------------------------------------------------------------------------------------------

/** Hands over the next few emails to send, marked as being sent. An email stuck "being sent" for ten minutes is offered again. */
create function public.mail_claim(p_limit integer) returns jsonb
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
     order by m.id
     limit greatest(v_limit, 1)
       for update skip locked
  ), taken as (
    update private.mail_outbox m
       set status = 'sending', claimed_at = now(), attempts = m.attempts + 1
      from next
     where m.id = next.id
    returning m.id, m.to_email, m.reply_to, m.template, m.language, m.data
  )
  select coalesce(jsonb_agg(to_jsonb(taken) order by taken.id), '[]'::jsonb) into v_rows from taken;
  return v_rows;
end;
$$;

/** Records what became of one email. One that could not be sent is tried again, later each time, five times in all. */
create function public.mail_done(p_id bigint, p_ok boolean, p_error text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.mail_outbox m
     set status = case when p_ok then 'sent' when m.attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 500) end,
         not_before = case when p_ok then m.not_before else now() + make_interval(mins => 5 * m.attempts) end
   where m.id = p_id and m.status = 'sending';
end;
$$;

/** Puts back emails that were claimed but not attempted (the mailbox's password is not set yet, say), at no cost to their tries. */
create function public.mail_release(p_ids bigint[]) returns void
language sql
security definer
set search_path = ''
as $$
  update private.mail_outbox m
     set status = 'queued', attempts = greatest(m.attempts - 1, 0)
   where m.id = any (p_ids) and m.status = 'sending';
$$;

revoke all on function public.mail_claim(integer) from public, anon, authenticated;
revoke all on function public.mail_done(bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.mail_release(bigint[]) from public, anon, authenticated;
grant execute on function public.mail_claim(integer) to service_role;
grant execute on function public.mail_done(bigint, boolean, text) to service_role;
grant execute on function public.mail_release(bigint[]) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Waking the sending function, once a minute, only when there is something to send
-- ---------------------------------------------------------------------------------------------
create function private.mail_kick() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.mail_settings;
begin
  if not exists (select 1 from private.mail_outbox m where m.status = 'queued' and m.not_before <= now()) then
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
          '{}'::jsonb;
exception when others then
  -- The queue keeps everything: the next minute tries again.
  null;
end;
$$;
revoke all on function private.mail_kick() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('agh-mail', '* * * * *', 'select private.mail_kick()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The welcome email: once, when an account's address is confirmed
-- ---------------------------------------------------------------------------------------------
alter table public.profile_private add column welcomed_at timestamptz;

create function private.welcome_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_language text;
begin
  update public.profile_private pp
     set welcomed_at = now()
   where pp.user_id = new.id and pp.welcomed_at is null
  returning pp.preferred_language into v_language;
  if not found then
    return new;
  end if;
  select coalesce(p.display_name, p.username) into v_name from public.profiles p where p.id = new.id;
  perform private.queue_mail(new.email, 'welcome', v_language, jsonb_build_object('name', v_name));
  return new;
exception when others then
  -- Confirming an account must never fail because of a greeting.
  return new;
end;
$$;
revoke all on function private.welcome_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_confirmed_welcome
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.welcome_user();

-- ---------------------------------------------------------------------------------------------
-- Report a problem
-- ---------------------------------------------------------------------------------------------
create table public.support_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  category text not null check (category in ('account', 'game', 'tokens', 'bug', 'other')),
  message text not null check (char_length(message) between 10 and 2000),
  -- Where in the app the player was, and on what, to help find the fault. Never anything secret.
  page text check (char_length(page) <= 200),
  device text check (char_length(device) <= 300),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references public.profiles (id) on delete restrict,
  admin_note text check (char_length(admin_note) <= 1000)
);
create index support_requests_user_idx on public.support_requests (user_id, id desc);
create index support_requests_status_idx on public.support_requests (status, id desc);
alter table public.support_requests enable row level security;
revoke all on table public.support_requests from anon, authenticated;
grant select (id, category, message, status, created_at, answered_at) on public.support_requests to authenticated;
-- A player reads their own reports (what they wrote and whether it has been answered), nobody else's.
create policy support_requests_select_own on public.support_requests for select to authenticated using (user_id = (select auth.uid()));
create policy support_requests_no_client_writes on public.support_requests as restrictive for all to anon, authenticated using (true) with check (false);

/**
 * A player reports a problem. The report is kept for our team, the player is emailed at once
 * to say it has arrived and when to expect an answer, and the support mailbox is told, with
 * the player's address as the one to reply to.
 */
create function public.submit_support_request(p_category text, p_message text, p_page text default null, p_device text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_message text := trim(coalesce(p_message, ''));
  v_email text;
  v_name text;
  v_language text;
  v_id bigint;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if p_category is null or p_category not in ('account', 'game', 'tokens', 'bug', 'other')
     or char_length(v_message) < 10 or char_length(v_message) > 2000 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  -- Enough for anyone with real trouble; not enough to bury the mailbox.
  if (select count(*) from public.support_requests s where s.user_id = v_me and s.created_at > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_REQUESTS');
  end if;

  insert into public.support_requests (user_id, category, message, page, device)
  values (v_me, p_category, v_message, left(nullif(trim(coalesce(p_page, '')), ''), 200), left(nullif(trim(coalesce(p_device, '')), ''), 300))
  returning id into v_id;

  select u.email into v_email from auth.users u where u.id = v_me;
  select coalesce(p.display_name, p.username) into v_name from public.profiles p where p.id = v_me;
  select pp.preferred_language into v_language from public.profile_private pp where pp.user_id = v_me;

  perform private.queue_mail(v_email, 'support_received', v_language, jsonb_build_object('name', v_name, 'reference', v_id, 'category', p_category, 'message', v_message));
  perform private.queue_mail(
    (select s.support_address from private.mail_settings s), 'support_notice', 'en',
    jsonb_build_object('name', v_name, 'reference', v_id, 'category', p_category, 'message', v_message, 'email', v_email,
                       'page', p_page, 'device', p_device, 'user_id', v_me),
    v_email);

  return jsonb_build_object('ok', true, 'reference', v_id);
end;
$$;
revoke all on function public.submit_support_request(text, text, text, text) from public, anon;
grant execute on function public.submit_support_request(text, text, text, text) to authenticated, service_role;
