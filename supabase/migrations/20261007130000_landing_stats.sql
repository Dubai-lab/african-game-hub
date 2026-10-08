-- Public figures for the landing page. Aggregates only: no row of any table is exposed.
-- players_online stays null until online play exists (step 7); the page hides a null figure.
create function public.landing_stats()
returns table (matches_today bigint, countries_represented bigint, players_online bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.matches m
      where m.status = 'finished' and m.finished_at >= date_trunc('day', now())),
    (select count(distinct p.country_code) from public.profiles p where p.country_code is not null),
    null::bigint;
$$;

revoke all on function public.landing_stats() from public;
grant execute on function public.landing_stats() to anon, authenticated, service_role;
