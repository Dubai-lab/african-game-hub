-- Friends, private messages, and chat during a match. Shared core: nothing here is about chess.
--
-- The privacy rules, all enforced here in the database (the app cannot get around them):
--   * A private message can only be sent to someone who has ACCEPTED a friend request.
--   * During a match the players may send each other text and emoji whether or not they are
--     friends, but only if BOTH have live chat switched on. A player who switches it off can
--     neither send nor be sent anything.
--   * Only the two people in a conversation can read it. Match chat can be read by the players
--     of that match and nobody else, even after the game is public for replay.
--
-- Clients never write these tables directly. They call the functions below, which act as the
-- signed-in player (auth.uid()) and can therefore never be used on someone else's behalf.

-- ---------------------------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete restrict,
  addressee_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id)
);
-- One row per pair of players, whoever asked first.
create unique index friendships_pair_key on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index friendships_requester_idx on public.friendships (requester_id, status);
alter table public.friendships enable row level security;

create function private.are_friends(p_a uuid, p_b uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least(p_a, p_b)
       and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b)
  );
$$;

/** Asks a player (by username) to be friends. If they had already asked you, you become friends at once. */
create function public.send_friend_request(p_username text) returns jsonb
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

  -- Keeps one account from spraying requests at everyone.
  if (select count(*) from public.friendships f where f.requester_id = v_me and f.status = 'pending') >= 50 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_REQUESTS');
  end if;

  insert into public.friendships (requester_id, addressee_id) values (v_me, v_them);
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

/** Accepts or declines a request that was sent TO the caller. Declining removes it. */
create function public.respond_friend_request(p_requester_id uuid, p_accept boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if p_accept then
    update public.friendships f set status = 'accepted', responded_at = now()
     where f.requester_id = p_requester_id and f.addressee_id = v_me and f.status = 'pending';
  else
    delete from public.friendships f
     where f.requester_id = p_requester_id and f.addressee_id = v_me and f.status = 'pending';
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_SUCH_REQUEST');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

/** Ends a friendship, or withdraws a request the caller sent. Messaging stops at once. */
create function public.remove_friend(p_other_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  delete from public.friendships f
   where least(f.requester_id, f.addressee_id) = least(v_me, p_other_id)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_other_id)
     and (f.status = 'accepted' or f.requester_id = v_me);
  return jsonb_build_object('ok', found);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Private messages (friends only)
-- ---------------------------------------------------------------------------------------------
create table public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  recipient_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_not_self check (sender_id <> recipient_id)
);
create index direct_messages_pair_idx on public.direct_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), id desc);
create index direct_messages_unread_idx on public.direct_messages (recipient_id) where read_at is null;
alter table public.direct_messages enable row level security;

create function public.send_direct_message(p_to uuid, p_body text) returns jsonb
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

create function public.mark_messages_read(p_from uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.direct_messages m set read_at = now()
   where m.recipient_id = (select auth.uid()) and m.sender_id = p_from and m.read_at is null;
$$;

-- ---------------------------------------------------------------------------------------------
-- Chat during a match (text and emoji; friends or not; both players must have it switched on)
-- ---------------------------------------------------------------------------------------------

-- Kept beside the other owner-only account fields, and checked by the server on every message.
alter table public.profile_private add column match_chat_enabled boolean not null default true;
grant update (match_chat_enabled) on public.profile_private to authenticated;

create table public.match_messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete restrict,
  sender_id uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('text', 'emoji')),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index match_messages_match_idx on public.match_messages (match_id, id);
alter table public.match_messages enable row level security;

/** Whether live chat is on for the caller and for everyone else in the match. Players only. */
create function public.match_chat_status(p_match_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_match_player(p_match_id) then
    jsonb_build_object(
      'mine', (select pp.match_chat_enabled from public.profile_private pp where pp.user_id = (select auth.uid())),
      'others', not exists (
        select 1 from public.match_players mp
          join public.profile_private pp on pp.user_id = mp.user_id
         where mp.match_id = p_match_id and mp.user_id <> (select auth.uid()) and not pp.match_chat_enabled))
  end;
$$;

create function public.send_match_message(p_match_id uuid, p_kind text, p_body text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_body text := trim(coalesce(p_body, ''));
  v_status jsonb;
  v_id bigint;
  -- The reactions on offer. Anything else sent as an "emoji" is refused.
  v_emoji constant text[] := array['👍','👏','😂','😮','😢','😡','🤝','🔥','💪','🙏','😎','🤔'];
begin
  if v_me is null or not private.is_match_player(p_match_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_PLAYER');
  end if;
  -- During the game, and for ten minutes afterwards (time to say "good game").
  if not exists (
    select 1 from public.matches m
     where m.id = p_match_id
       and (m.status = 'active' or (m.status in ('finished', 'aborted') and m.finished_at > now() - interval '10 minutes'))) then
    return jsonb_build_object('ok', false, 'code', 'CHAT_CLOSED');
  end if;

  v_status := public.match_chat_status(p_match_id);
  if not (v_status ->> 'mine')::boolean then
    return jsonb_build_object('ok', false, 'code', 'CHAT_OFF_YOU');
  end if;
  if not (v_status ->> 'others')::boolean then
    return jsonb_build_object('ok', false, 'code', 'CHAT_OFF_OPPONENT');
  end if;

  if p_kind = 'emoji' then
    if not (v_body = any (v_emoji)) then
      return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
    end if;
  elsif p_kind = 'text' then
    if char_length(v_body) < 1 or char_length(v_body) > 200 then
      return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'BAD_MESSAGE');
  end if;

  -- No flooding an opponent who is trying to think.
  if (select count(*) from public.match_messages mm
       where mm.match_id = p_match_id and mm.sender_id = v_me and mm.created_at > now() - interval '10 seconds') >= 5 then
    return jsonb_build_object('ok', false, 'code', 'SLOW_DOWN');
  end if;

  insert into public.match_messages (match_id, sender_id, kind, body) values (p_match_id, v_me, p_kind, v_body) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Access rules: read what is yours, write nothing directly.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['friendships', 'direct_messages', 'match_messages'] loop
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

create policy friendships_select_own on public.friendships
  for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

create policy direct_messages_select_own on public.direct_messages
  for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

-- Players of the match only. A finished game is public for replay; its chat is not.
create policy match_messages_select_players on public.match_messages
  for select to authenticated
  using (private.is_match_player(match_id));

revoke all on function private.are_friends(uuid, uuid) from public, anon, authenticated, service_role;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.send_friend_request(text)',
    'public.respond_friend_request(uuid, boolean)',
    'public.remove_friend(uuid)',
    'public.send_direct_message(uuid, text)',
    'public.mark_messages_read(uuid)',
    'public.match_chat_status(uuid)',
    'public.send_match_message(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;

-- Live delivery. Realtime applies the SELECT policies above to every subscriber.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.friendships, public.direct_messages, public.match_messages;
  end if;
end;
$$;
