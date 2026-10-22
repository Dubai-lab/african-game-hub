-- One Africa Life: things bought at Furniture City (supabase/functions/_shared/oalItems.ts names
-- them and their prices; the database charges these) and kept at home: bought (paid in US
-- dollars, as furniture is priced in Monrovia), put somewhere in the house (or kept aside until
-- placed), moved, sold again (half the price, at once, to anyone). Every change of money is a
-- ledger entry (private.oal_money); the client never writes these rows.

create table public.oal_item_prices (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  -- In US cents.
  price bigint not null check (price > 0)
);
insert into public.oal_item_prices values
  ('sofa_set', 145000),
  ('corner_sofa', 98000),
  ('sofa', 52000),
  ('chandelier', 26000),
  ('double_bed', 65000),
  ('toilet', 18000),
  ('bathtub', 42000),
  ('sink', 12000),
  ('kitchen_counter', 115000);

create table public.oal_things (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.oal_lives (user_id) on delete cascade,
  item text not null references public.oal_item_prices (id),
  -- Where it is kept: the family's house (more homes later).
  home text not null default 'family' check (home in ('family')),
  -- Put in a room (where, turned how: the house's own metres), or kept aside until it is.
  placed boolean not null default false,
  x real check (x is null or (x between -40 and 40)),
  y real check (y is null or (y between -40 and 40)),
  rot real check (rot is null or (rot between -7 and 7)),
  -- What was paid (US cents): what it sells for again is half of it.
  paid bigint not null check (paid > 0),
  bought_at timestamptz not null default now(),
  check ((placed and x is not null and y is not null and rot is not null) or not placed)
);
create index oal_things_user on public.oal_things (user_id);

alter table public.oal_item_prices enable row level security;
alter table public.oal_things enable row level security;
create policy oal_item_prices_select on public.oal_item_prices for select to authenticated using (true);
create policy oal_item_prices_insert on public.oal_item_prices for insert to authenticated with check (false);
create policy oal_item_prices_update on public.oal_item_prices for update to authenticated using (false);
create policy oal_item_prices_delete on public.oal_item_prices for delete to authenticated using (false);
-- One's own things (visitors see a house's things through the game later, by the server).
create policy oal_things_select on public.oal_things for select to authenticated using (user_id = (select auth.uid()));
create policy oal_things_insert on public.oal_things for insert to authenticated with check (false);
create policy oal_things_update on public.oal_things for update to authenticated using (false);
create policy oal_things_delete on public.oal_things for delete to authenticated using (false);
revoke insert, update, delete on public.oal_things, public.oal_item_prices from anon, authenticated;

/** A thing bought, put, moved, kept aside, sold. */
create function public.oal_thing_action(p_user_id uuid, p_action text, p_data jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_price bigint;
  v_thing public.oal_things;
  v_id bigint;
  v_x real;
  v_y real;
  v_rot real;
  v_count int;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;

  if p_action = 'buy' then
    select p.price into v_price from public.oal_item_prices p where p.id = p_data->>'item';
    if v_price is null then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    select count(*) into v_count from public.oal_things t where t.user_id = p_user_id;
    if v_count >= 60 then
      return jsonb_build_object('ok', false, 'code', 'HOME_FULL');
    end if;
    begin
      perform private.oal_money(p_user_id, 'USD', -v_price, 'furniture');
    exception when sqlstate 'AG003' then
      return jsonb_build_object('ok', false, 'code', 'NOT_ENOUGH_MONEY');
    end;
    insert into public.oal_things (user_id, item, paid) values (p_user_id, p_data->>'item', v_price) returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  v_id := (p_data->>'id')::bigint;
  select * into v_thing from public.oal_things t where t.id = v_id and t.user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS');
  end if;

  if p_action = 'sell' then
    delete from public.oal_things t where t.id = v_id;
    perform private.oal_money(p_user_id, 'USD', v_thing.paid / 2, 'furniture_sold');
    return jsonb_build_object('ok', true, 'got', v_thing.paid / 2);
  end if;

  if p_action = 'place' then
    v_x := (p_data->>'x')::real;
    v_y := (p_data->>'y')::real;
    v_rot := (p_data->>'rot')::real;
    if v_x is null or v_y is null or v_rot is null or abs(v_x) > 40 or abs(v_y) > 40 or abs(v_rot) > 7 then
      return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    end if;
    update public.oal_things t set placed = true, x = v_x, y = v_y, rot = v_rot where t.id = v_id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'store' then
    update public.oal_things t set placed = false, x = null, y = null, rot = null where t.id = v_id;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end;
$$;
revoke all on function public.oal_thing_action(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.oal_thing_action(uuid, text, jsonb) to service_role;
