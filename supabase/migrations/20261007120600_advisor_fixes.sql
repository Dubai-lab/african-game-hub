-- Follow-ups from the Supabase security and performance advisors.

-- Supabase ships an event-trigger function that enables RLS on new public tables. It still fires
-- after this; the API roles simply lose the (pointless) right to call it as an RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- Indexes for foreign keys that are actually filtered on.
-- escrow.user_id: the "read your own escrow" policy filters by it.
create index escrow_user_idx on public.escrow (user_id);
create index ledger_entries_payment_idx on public.ledger_entries (payment_id) where payment_id is not null;
create index matches_winner_idx on public.matches (winner_id) where winner_id is not null;
create index payments_review_queue_idx on public.payments (created_at) where status = 'needs_review';
