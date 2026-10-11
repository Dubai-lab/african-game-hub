-- Penalty Shootout comes off the hub. It was listed as "coming soon" from the first day; the
-- owner has decided not to build it (12 October 2026). Nothing was ever played, so there is
-- nothing to settle.
--
-- The row is kept and switched off, not deleted: a switched-off game is not shown to any
-- player or visitor (see game_types_select_visible), and switching it back on is one line
-- should the decision ever change.
update public.game_types set status = 'disabled' where id = 'penalty';
