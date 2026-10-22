-- One Africa Life: Furniture City delivers. A thing bought goes on the store's truck, which drives
-- it to the family's house, where its men carry it in (the game shows it). It is home when they
-- have (the game says so: 'receive', no sooner than a minute after it was bought) or, whatever the
-- game shows, eight minutes after it was bought; until then it cannot be put anywhere.

alter table public.oal_things add column arrives_at timestamptz;

create or replace function public.oal_thing_action(p_user_id uuid, p_action text, p_data jsonb) returns jsonb
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
    insert into public.oal_things (user_id, item, paid, arrives_at) values (p_user_id, p_data->>'item', v_price, now() + interval '8 minutes') returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  -- The truck at the house, the things carried in: home (none sooner than a minute after it was
  -- bought, the truck's least time on the road).
  if p_action = 'receive' then
    update public.oal_things t set arrives_at = null
      where t.user_id = p_user_id and t.arrives_at is not null and t.bought_at <= now() - interval '1 minute';
    get diagnostics v_count = row_count;
    return jsonb_build_object('ok', true, 'received', v_count);
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
    if v_thing.arrives_at > now() then
      return jsonb_build_object('ok', false, 'code', 'ON_ITS_WAY');
    end if;
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
