-- Rematch: after a game, either player can ask the other for another one on the same terms
-- (same game, stake and options, seats swapped). The other player accepts or declines.
--
-- Part of the shared core: nothing here knows which game was played. Two-player matches only.
-- Accepting creates the new match exactly the way matchmaking does: both stakes go into escrow
-- in the same transaction, or no match is made and no token moves.

-- The core deals seats as '1', '2', ... and the game module may then rename them (chess: white,
-- black). The number that was dealt is kept here, so a rematch can swap who goes first without
-- knowing any game's seat names.
alter table public.match_players add column seat_order smallint;
update public.match_players set seat_order = case seat when 'white' then 1 when 'black' then 2 end where seat in ('white', 'black');

create function private.remember_seat_order() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seat_order is null and new.seat ~ '^[0-9]{1,2}$' then
    new.seat_order := new.seat::smallint;
  end if;
  return new;
end;
$$;
revoke all on function private.remember_seat_order() from public, anon, authenticated, service_role;
create trigger match_players_seat_order before insert on public.match_players
  for each row execute function private.remember_seat_order();

create table public.rematch_offers (
  -- One offer per finished match.
  match_id uuid primary key references public.matches (id) on delete restrict,
  offered_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  new_match_id uuid references public.matches (id) on delete restrict,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint rematch_offers_new_match check ((status = 'accepted') = (new_match_id is not null))
);
alter table public.rematch_offers enable row level security;

revoke all on table public.rematch_offers from public, anon, authenticated;
grant all on table public.rematch_offers to service_role;
grant select on table public.rematch_offers to authenticated;
create policy rematch_offers_select_players on public.rematch_offers
  for select to authenticated using (private.is_match_player(match_id));
create policy rematch_offers_deny_client_insert on public.rematch_offers as restrictive for insert to anon, authenticated with check (false);
create policy rematch_offers_deny_client_update on public.rematch_offers as restrictive for update to anon, authenticated using (false) with check (false);
create policy rematch_offers_deny_client_delete on public.rematch_offers as restrictive for delete to anon, authenticated using (false);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rematch_offers;
  end if;
end;
$$;

/**
 * One function for the four things a player can do: 'offer', 'accept', 'decline', 'cancel'.
 * Called by the core-rematch Edge Function, which has already identified the player.
 * Replies { status: 'pending' | 'matched' | 'declined' | 'cancelled' } or { status: 'error', code }.
 */
create function public.rematch(p_user_id uuid, p_match_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
  v_game public.game_types;
  v_other uuid;
  v_my_seat smallint;
  v_other_seat smallint;
  v_played boolean;
  v_offer public.rematch_offers;
  v_fresh boolean;
  v_new uuid;
  v_who uuid;
begin
  -- One request at a time per finished match: two taps at the same instant cannot make two games.
  perform pg_advisory_xact_lock(hashtextextended('agh:rematch:' || p_match_id::text, 0));

  select * into v_match from public.matches m where m.id = p_match_id;
  select true, mp.seat_order into v_played, v_my_seat from public.match_players mp where mp.match_id = p_match_id and mp.user_id = p_user_id;
  if v_match.id is null or v_played is null then
    return jsonb_build_object('status', 'error', 'code', 'NOT_A_PLAYER');
  end if;
  if (select count(*) from public.match_players mp where mp.match_id = p_match_id) <> 2 then
    return jsonb_build_object('status', 'error', 'code', 'REMATCH_NOT_AVAILABLE');
  end if;
  select mp.user_id, mp.seat_order into v_other, v_other_seat
    from public.match_players mp where mp.match_id = p_match_id and mp.user_id <> p_user_id;

  select * into v_offer from public.rematch_offers o where o.match_id = p_match_id;
  -- An offer nobody answered within two minutes no longer counts.
  v_fresh := v_offer.match_id is not null and v_offer.status = 'pending' and v_offer.created_at > now() - interval '2 minutes';

  if v_offer.status = 'accepted' then
    return jsonb_build_object('status', 'matched', 'match_id', v_offer.new_match_id);
  end if;

  if p_action = 'decline' then
    if not v_fresh or v_offer.offered_by = p_user_id then
      return jsonb_build_object('status', 'error', 'code', 'NO_REMATCH_OFFER');
    end if;
    update public.rematch_offers o set status = 'declined', responded_at = now() where o.match_id = p_match_id;
    return jsonb_build_object('status', 'declined');
  end if;

  if p_action = 'cancel' then
    if v_offer.status = 'pending' and v_offer.offered_by = p_user_id then
      update public.rematch_offers o set status = 'cancelled', responded_at = now() where o.match_id = p_match_id;
    end if;
    return jsonb_build_object('status', 'cancelled');
  end if;

  if p_action not in ('offer', 'accept') then
    return jsonb_build_object('status', 'error', 'code', 'BAD_REQUEST');
  end if;

  -- From here on a new game may start, so everything matchmaking checks is checked again.
  if v_match.status not in ('finished', 'aborted') or v_match.finished_at < now() - interval '10 minutes' then
    return jsonb_build_object('status', 'error', 'code', 'REMATCH_CLOSED');
  end if;
  select * into v_game from public.game_types g where g.id = v_match.game_type;
  if v_game.status <> 'live' or not (v_match.stake_amount = any (v_game.stake_levels)) then
    return jsonb_build_object('status', 'error', 'code', 'GAME_NOT_AVAILABLE');
  end if;
  if private.is_blocked_pair(p_user_id, v_other) then
    return jsonb_build_object('status', 'error', 'code', 'CANNOT_CONTACT');
  end if;

  -- Both players' own locks, always in the same order (matchmaking takes these too, so neither
  -- player can be put into another game while this runs).
  for v_who in select u from unnest(array[p_user_id, v_other]) u order by u::text loop
    perform pg_advisory_xact_lock(hashtextextended('agh:user:' || v_who::text, 0));
  end loop;

  if exists (select 1 from public.profile_private pp where pp.user_id = p_user_id and pp.is_banned) then
    return jsonb_build_object('status', 'error', 'code', 'BANNED');
  end if;
  if private.active_match_of(p_user_id) is not null then
    return jsonb_build_object('status', 'error', 'code', 'ALREADY_PLAYING');
  end if;
  if v_match.stake_amount > 0 and private.wallet_total(p_user_id) < v_match.stake_amount then
    return jsonb_build_object('status', 'error', 'code', 'INSUFFICIENT_BALANCE');
  end if;

  -- Asking: record the offer, unless the other player has already asked (then it is a yes).
  if p_action = 'offer' and not (v_fresh and v_offer.offered_by = v_other) then
    if v_fresh then
      return jsonb_build_object('status', 'pending');
    end if;
    -- A player who was turned down does not get to keep asking.
    if v_offer.status = 'declined' and v_offer.offered_by = p_user_id then
      return jsonb_build_object('status', 'error', 'code', 'REMATCH_DECLINED');
    end if;
    insert into public.rematch_offers as o (match_id, offered_by) values (p_match_id, p_user_id)
    on conflict (match_id) do update
      set offered_by = excluded.offered_by, status = 'pending', created_at = now(), responded_at = null;
    return jsonb_build_object('status', 'pending');
  end if;

  if not (v_fresh and v_offer.offered_by = v_other) then
    return jsonb_build_object('status', 'error', 'code', 'NO_REMATCH_OFFER');
  end if;

  -- Accepting. The other player may have moved on since they asked.
  if exists (select 1 from public.profile_private pp where pp.user_id = v_other and pp.is_banned)
     or private.active_match_of(v_other) is not null
     or (v_match.stake_amount > 0 and private.wallet_total(v_other) < v_match.stake_amount) then
    update public.rematch_offers o set status = 'cancelled', responded_at = now() where o.match_id = p_match_id;
    return jsonb_build_object('status', 'error', 'code', 'OPPONENT_UNAVAILABLE');
  end if;

  delete from public.match_queue q where q.user_id in (p_user_id, v_other);

  insert into public.matches (game_type, stake_amount, options, rating_pool, status, started_at)
  values (v_match.game_type, v_match.stake_amount, v_match.options, v_match.rating_pool, 'active', now())
  returning id into v_new;

  -- Seats swap: whoever went first last time goes second now.
  insert into public.match_players (match_id, user_id, seat, rating_before)
  select v_new, x.user_id, x.seat::text,
         coalesce((select r.rating from public.player_ratings r
                    where r.user_id = x.user_id and r.game_type = v_match.game_type and r.pool = v_match.rating_pool), 1200)
    from (values (p_user_id, coalesce(v_other_seat, 1)), (v_other, coalesce(v_my_seat, 2))) as x (user_id, seat);

  perform private.take_stake(v_new, p_user_id, v_match.stake_amount);
  perform private.take_stake(v_new, v_other, v_match.stake_amount);

  execute format('select private.%I($1, $2)', v_match.game_type || '_init_match') using v_new, v_match.options;

  update public.rematch_offers o
     set status = 'accepted', new_match_id = v_new, responded_at = now()
   where o.match_id = p_match_id;

  return jsonb_build_object('status', 'matched', 'match_id', v_new);
end;
$$;

revoke all on function public.rematch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rematch(uuid, uuid, text) to service_role;
