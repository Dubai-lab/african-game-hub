-- 1. Rating pools: a player has one rating per pool within a game, the way chess sites keep
--    separate Bullet, Blitz and Rapid ratings. The core stays game-agnostic: a pool is just a
--    name. Each game module decides which pool a match belongs to (for chess, from the time
--    control), and games without pools use 'default'.
-- 2. Per-user preferences (board theme, piece set, sound), saved with the account.

alter table public.game_types
  add column rating_pools text[] not null default '{default}'
    check (cardinality(rating_pools) >= 1);

update public.game_types set rating_pools = '{bullet,blitz,rapid}' where id = 'chess';

alter table public.player_ratings
  add column pool text not null default 'default' check (pool ~ '^[a-z][a-z0-9_]{0,30}$');

alter table public.player_ratings drop constraint player_ratings_pkey;
alter table public.player_ratings add primary key (user_id, game_type, pool);

drop index public.player_ratings_leaderboard_idx;
create index player_ratings_leaderboard_idx on public.player_ratings (game_type, pool, rating desc);

-- The pool a match counts toward is fixed when the match is created, so settlement never has
-- to understand a game's options.
alter table public.matches
  add column rating_pool text not null default 'default' check (rating_pool ~ '^[a-z][a-z0-9_]{0,30}$');

alter table public.match_queue
  add column rating_pool text not null default 'default' check (rating_pool ~ '^[a-z][a-z0-9_]{0,30}$');

-- Preferences are cosmetic and owned by the player, so the player may write them directly.
-- The size cap stops the column being used as free storage.
alter table public.profile_private
  add column preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 2048);

grant update (preferences) on public.profile_private to authenticated;
