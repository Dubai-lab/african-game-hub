-- Telling a promotion's winners that they have won, by email: their place, the prize, and how
-- to receive it (reply with the mobile money number the prize should go to). The reply goes to
-- the hub's support mailbox, like every other answer to the hub's emails.
--
-- Our team sends it from the promotion's page, to one winner or to every winner not yet told.
-- Each email sent is written down, so the page shows who has been told and when, and nobody is
-- told twice by a slip of the hand. As before, no tokens move: the prize is sent outside the
-- system and noted with "Mark as paid".

alter table private.mail_outbox drop constraint mail_outbox_template_check;
alter table private.mail_outbox add constraint mail_outbox_template_check
  check (template in ('welcome', 'support_received', 'support_notice', 'support_answered', 'account_suspended', 'account_restored', 'password_changed', 'announcement', 'promotion_won'));

create table public.promotion_emails (
  id bigint generated always as identity primary key,
  promotion_id bigint not null references public.promotions (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  place integer not null check (place >= 1),
  -- What the email said the prize was, and our team's own words added to it, as sent.
  prize text not null check (char_length(prize) between 1 and 200),
  note text check (char_length(note) <= 1000),
  sent_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index promotion_emails_player_idx on public.promotion_emails (promotion_id, user_id, id desc);
alter table public.promotion_emails enable row level security;
revoke all on table public.promotion_emails from anon, authenticated;
create policy promotion_emails_no_client_access on public.promotion_emails as restrictive for all to anon, authenticated using (false) with check (false);

/** A promotion's winners and their places: the first to qualify, as many as it has winning places. */
create function private.promotion_winners(p_promotion_id bigint)
returns table (user_id uuid, place integer)
language sql
stable
security definer
set search_path = ''
as $$
  select q.user_id, q.place::integer
    from (select g.user_id, row_number() over (order by g.finished_at, g.user_id) as place
            from public.promotions pr, private.promotion_games(pr.id) g
           where pr.id = p_promotion_id and g.nth = pr.games_needed) q, public.promotions pr
   where pr.id = p_promotion_id and q.place <= pr.winners;
$$;
revoke all on function private.promotion_winners(bigint) from public, anon, authenticated, service_role;

/**
 * Emails winners of a promotion that they have won. p_user_ids names the winners to tell; null
 * means every winner not yet told and not yet paid. A named player who is not a winner, or is
 * banned, refuses the whole request. A winner told less than ten minutes ago is not told again,
 * and one without a confirmed email address is counted but cannot be told.
 */
create function public.admin_promotion_email(p_admin_id uuid, p_promotion_id bigint, p_user_ids uuid[], p_prize text, p_note text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_promotion public.promotions;
  v_prize text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_ids uuid[] := case when coalesce(cardinality(p_user_ids), 0) = 0 then null else p_user_ids end;
  v_winner record;
  v_emailed integer := 0;
  v_no_address integer := 0;
  v_recent integer := 0;
begin
  select * into v_promotion from public.promotions where id = p_promotion_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROMOTION_NOT_FOUND');
  end if;
  v_prize := coalesce(nullif(trim(coalesce(p_prize, '')), ''), nullif(trim(coalesce(v_promotion.reward, '')), ''));
  if v_prize is null then
    return jsonb_build_object('ok', false, 'code', 'PRIZE_REQUIRED');
  end if;
  if char_length(v_prize) > 200 or char_length(coalesce(v_note, '')) > 1000 or coalesce(cardinality(v_ids), 0) > 100 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  end if;

  if v_ids is not null then
    if exists (select 1 from unnest(v_ids) i where not exists (select 1 from private.promotion_winners(p_promotion_id) w where w.user_id = i)) then
      return jsonb_build_object('ok', false, 'code', 'NOT_A_WINNER');
    end if;
    if exists (select 1 from unnest(v_ids) i join public.profile_private pp on pp.user_id = i where pp.is_banned) then
      return jsonb_build_object('ok', false, 'code', 'PLAYER_BANNED');
    end if;
  end if;

  for v_winner in
    select w.user_id, w.place, u.email, u.email_confirmed_at, pp.preferred_language, coalesce(p.display_name, p.username) as name,
           exists (select 1 from public.promotion_emails e where e.promotion_id = p_promotion_id and e.user_id = w.user_id and e.created_at > now() - interval '10 minutes') as recent
      from private.promotion_winners(p_promotion_id) w
      join public.profiles p on p.id = w.user_id
      join public.profile_private pp on pp.user_id = w.user_id
      left join auth.users u on u.id = w.user_id
     where case when v_ids is not null then w.user_id = any (v_ids)
                else not pp.is_banned
                     and not exists (select 1 from public.promotion_emails e where e.promotion_id = p_promotion_id and e.user_id = w.user_id)
                     and not exists (select 1 from public.promotion_payouts po where po.promotion_id = p_promotion_id and po.user_id = w.user_id) end
     order by w.place
  loop
    if v_winner.recent then
      v_recent := v_recent + 1;
    elsif v_winner.email is null or v_winner.email_confirmed_at is null then
      v_no_address := v_no_address + 1;
    else
      -- About the player's own prize, so sent whether or not they take the hub's news emails.
      perform private.queue_mail(v_winner.email, 'promotion_won', v_winner.preferred_language,
        jsonb_build_object('name', v_winner.name, 'promotion', v_promotion.name, 'place', v_winner.place, 'prize', v_prize, 'note', v_note));
      insert into public.promotion_emails (promotion_id, user_id, place, prize, note, sent_by)
      values (p_promotion_id, v_winner.user_id, v_winner.place, v_prize, v_note, p_admin_id);
      perform private.audit(p_admin_id, 'promotion_emailed', v_winner.user_id, null,
        jsonb_build_object('promotion_id', p_promotion_id, 'place', v_winner.place, 'prize', v_prize));
      v_emailed := v_emailed + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'emailed', v_emailed, 'no_address', v_no_address, 'recent', v_recent);
end;
$$;

-- The promotion's page, as before, with when each player was last emailed about their prize.
create or replace function public.admin_promotion(p_promotion_id bigint) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select * from public.promotions where id = p_promotion_id
  ), per as (
    select g.user_id,
           count(*) filter (where g.counted) as games,
           count(*) as games_played,
           count(distinct g.against) filter (where g.counted) as opponents,
           min(g.finished_at) filter (where g.nth = (select games_needed from p)) as qualified_at
      from private.promotion_games(p_promotion_id) g
     group by g.user_id
  ), placed as (
    select per.*, case when per.qualified_at is not null then row_number() over (partition by per.qualified_at is not null order by per.qualified_at, per.user_id) end as place
      from per
  ), shown as (
    select d.user_id, pr.username, pr.display_name, pr.country_code, pr.created_at as registered_at,
           u.email, u.email_confirmed_at is not null as email_confirmed, pp.phone_e164 as phone, pp.is_banned as banned,
           d.games, d.games_played, d.opponents, d.qualified_at, d.place,
           coalesce(d.place <= (select winners from p), false) as winner,
           po.paid_at, po.note as paid_note, (select a.username from public.profiles a where a.id = po.paid_by) as paid_by,
           (select max(e.created_at) from public.promotion_emails e where e.promotion_id = p_promotion_id and e.user_id = d.user_id) as emailed_at
      from placed d
      join public.profiles pr on pr.id = d.user_id
      join public.profile_private pp on pp.user_id = d.user_id
      left join auth.users u on u.id = d.user_id
      left join public.promotion_payouts po on po.promotion_id = p_promotion_id and po.user_id = d.user_id
     order by d.place nulls last, d.games desc, d.user_id
     limit 500
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'promotion', (select to_jsonb(p) - 'created_by' || jsonb_build_object('created_by', (select a.username from public.profiles a where a.id = p.created_by)) from p),
    'qualified', (select count(*) from per where qualified_at is not null),
    'playing', (select count(*) from per where qualified_at is null),
    'paid', (select count(*) from public.promotion_payouts po where po.promotion_id = p_promotion_id),
    'emailed', (select count(distinct e.user_id) from public.promotion_emails e where e.promotion_id = p_promotion_id),
    -- Registered in the period, whether or not they have played yet.
    'registered', (select count(*) from public.profiles pr, p where pr.created_at >= p.starts_at and pr.created_at <= p.ends_at),
    'rows', coalesce((select jsonb_agg(to_jsonb(s) order by s.place nulls last, s.games desc, s.user_id) from shown s), '[]'::jsonb)) end;
$$;

revoke all on function public.admin_promotion_email(uuid, bigint, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.admin_promotion_email(uuid, bigint, uuid[], text, text) to service_role;
revoke all on function public.admin_promotion(bigint) from public, anon, authenticated;
grant execute on function public.admin_promotion(bigint) to service_role;
