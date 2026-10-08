-- The ledger integrity check, run on a schedule. Whenever it finds a problem the findings are
-- written to private.integrity_alerts, so a fault is on record within minutes of happening
-- instead of waiting for someone to run the check by hand. The admin dashboard (later phase)
-- reads this table; until then: select * from private.integrity_alerts order by id desc;

create table private.integrity_alerts (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  problems jsonb not null
);
alter table private.integrity_alerts enable row level security;
revoke all on table private.integrity_alerts from public, anon, authenticated;
create policy integrity_alerts_deny_all on private.integrity_alerts as restrictive for all to public using (false) with check (false);

/** Runs the check; records an alert and returns the number of problems (0 when the books balance). */
create function private.check_integrity() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problems jsonb;
begin
  select jsonb_agg(to_jsonb(v)) into v_problems from public.verify_ledger_integrity() v;
  if v_problems is null then
    return 0;
  end if;
  insert into private.integrity_alerts (problems) values (v_problems);
  return jsonb_array_length(v_problems);
end;
$$;

revoke all on function private.check_integrity() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('agh-integrity', '*/10 * * * *', 'select private.check_integrity()');
  end if;
end;
$$;
