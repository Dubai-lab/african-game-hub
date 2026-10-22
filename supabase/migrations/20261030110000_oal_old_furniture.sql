-- One Africa Life: the family house's own furniture sold (its living room's, its bedrooms': the
-- game hides each piece sold), to make room for things from Furniture City; paid for at once, in
-- US dollars, once (a piece sold is gone).

create table public.oal_pieces_sold (
  user_id uuid not null references public.oal_lives (user_id) on delete cascade,
  piece text not null check (piece in ('living', 'bedroom')),
  sold_at timestamptz not null default now(),
  primary key (user_id, piece)
);
alter table public.oal_pieces_sold enable row level security;
create policy oal_pieces_sold_select on public.oal_pieces_sold for select to authenticated using (user_id = (select auth.uid()));
create policy oal_pieces_sold_insert on public.oal_pieces_sold for insert to authenticated with check (false);
create policy oal_pieces_sold_update on public.oal_pieces_sold for update to authenticated using (false);
create policy oal_pieces_sold_delete on public.oal_pieces_sold for delete to authenticated using (false);
revoke insert, update, delete on public.oal_pieces_sold from anon, authenticated;

/** A piece of the house's own furniture sold (US cents: the living room's 12000, the bedrooms' 8000). */
create function public.oal_piece_sell(p_user_id uuid, p_piece text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_life public.oal_lives;
  v_price bigint := case p_piece when 'living' then 12000 when 'bedroom' then 8000 end;
begin
  v_life := private.oal_settle(p_user_id);
  if v_life is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LIFE');
  end if;
  if v_price is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;
  insert into public.oal_pieces_sold (user_id, piece) values (p_user_id, p_piece) on conflict do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SOLD');
  end if;
  perform private.oal_money(p_user_id, 'USD', v_price, 'furniture_sold');
  return jsonb_build_object('ok', true, 'got', v_price);
end;
$$;
revoke all on function public.oal_piece_sell(uuid, text) from public, anon, authenticated;
grant execute on function public.oal_piece_sell(uuid, text) to service_role;
