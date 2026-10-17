-- Street basketball joins the games list. For now it is practice against the computer only:
-- its online matches will be run by the game server (a real-time game, see CLAUDE.md), and
-- until then the app's Play button for it opens practice.
--
-- Nothing can be staked or matched yet: it has no stake levels, and the matchmaking functions
-- know no basketball (supabase/functions/_shared/games.ts), so a request to find a match, to
-- challenge a friend or to hold a tournament of it is refused.
insert into public.game_types (id, name, status, sort_order, min_players, max_players, stake_levels, rating_pools, options_schema)
values ('basketball', 'Street Basketball', 'live', 25, 2, 4, '{}', '{default}', '{}'::jsonb);
