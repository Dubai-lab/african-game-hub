-- Chess module tables. Everything chess-specific lives here, keyed by the core match id.

create table public.chess_games (
  match_id uuid primary key references public.matches (id) on delete restrict,
  fen text not null,
  pgn text not null default '',
  turn text not null default 'w' check (turn in ('w', 'b')),
  -- Number of half-moves played. Also guards against two moves being written for the same turn.
  ply integer not null default 0 check (ply >= 0),
  white_time_ms bigint not null check (white_time_ms >= 0),
  black_time_ms bigint not null check (black_time_ms >= 0),
  increment_ms bigint not null default 0 check (increment_ms >= 0),
  -- Server time of the last move (or of the game start). Clocks are computed from this, never from the client.
  last_move_at timestamptz not null default now(),
  draw_offer_by uuid references public.profiles (id)
);
alter table public.chess_games enable row level security;

create table public.chess_moves (
  match_id uuid not null references public.matches (id) on delete restrict,
  ply integer not null check (ply >= 1),
  san text not null,
  uci text not null check (uci ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
  fen_after text not null,
  -- The mover's remaining time after this move.
  time_left_ms bigint not null check (time_left_ms >= 0),
  created_at timestamptz not null default now(),
  primary key (match_id, ply)
);
alter table public.chess_moves enable row level security;
