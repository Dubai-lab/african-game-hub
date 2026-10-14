-- The hub's admin account moves to the hub's own mailbox, admin@africangamehub.com, and off a
-- personal address that also plays on the hub.
--
-- An account becomes admin when an address on this list is confirmed (see
-- private.grant_admin_if_listed). Taking the old address off the list stops it ever being made
-- admin again; the account that already is admin keeps that until the new one is working, and
-- is then removed from public.admins by our team, so that nobody is locked out in between.
insert into private.admin_emails (email) values ('admin@africangamehub.com') on conflict do nothing;
delete from private.admin_emails where email = 'eg8217178@gmail.com';

-- If the new address already has a confirmed account, it is admin from now on.
insert into public.admins (user_id)
select u.id from auth.users u
 where lower(u.email) = 'admin@africangamehub.com' and u.email_confirmed_at is not null
on conflict do nothing;
