# Project Brief: African Game Hub

Project folder: `african-game-hub`

Read this whole file before writing any code. It describes what we are building, the rules that must never be broken, and the order of work. If anything here is unclear or seems wrong, ask me before guessing.

## 1. What we are building

African Game Hub is a mobile-first skill-gaming platform built for players across Africa. It will host many games (chess first, then games like ludo, draughts, pool, and a football penalty game), all sharing one account, one wallet, and one token system. In every game, players stake tokens against each other. The winner takes the pot minus a platform commission (rake). Tokens will later be bought and withdrawn with real money through mobile money services (MTN MoMo, Airtel Money, M-Pesa, Orange Money and others). Rwanda is the first launch market, but everything must be designed from day one to support many African countries, currencies, languages, and payment providers. See section 14.

**Chess is the first game on the hub, and the only game you are building now.** But the platform must be designed as a hub from day one: everything that is not chess-specific (accounts, wallet, ledger, escrow, matchmaking, settlement, ratings, leaderboards, lobby) belongs to a shared core that any future game can plug into. See section 3.

**Phase 1 uses play-money tokens only.** No real payments yet. But the wallet, escrow, and ledger must be built exactly as if they were real money, so that switching on mobile money later is only a matter of plugging in payment providers.

The site also needs a striking landing page with a 3D hero. See section 10.

The chess experience must feel as polished as chess.com or Chess Universe: smooth, responsive, satisfying. Not a toy. However, do NOT copy chess.com's (or anyone's) piece art, board graphics, sounds, or branding. Same quality, our own look.

## 2. Tech stack

The frontend is **React**. This is decided; do not propose another framework. The tools below are the approved stack. If you want to add a library not listed here, explain why and keep the app lightweight.

- **Frontend:** React + TypeScript + Vite, built as a mobile-first Progressive Web App (installable on Android, works on iPhone too) using `vite-plugin-pwa`.
- **Styling and motion:** Tailwind CSS. `framer-motion` for UI transitions (keep it light; board animations come from react-chessboard).
- **Routing and data:** React Router for navigation. TanStack Query for server data (with `refetchOnWindowFocus`). Zustand for small local UI state (selected theme, sound settings, in-game UI state).
- **Validation:** Zod for validating all inputs, both in the frontend and in Edge Functions.
- **Translations:** `react-i18next`, with right-to-left layout support (for Arabic).
- **Phone numbers:** `libphonenumber-js` for validating and formatting African phone numbers in international (E.164) format.
- **3D (landing page):** `three`, `@react-three/fiber`, and `@react-three/drei`. Load them only on the landing page, lazily, never in the game screens.
- **Landing page SEO:** prerender the landing page to static HTML (for example with a Vite prerender/SSG plugin) so search engines and WhatsApp/Facebook link previews see real content.
- **Chess engine:** Stockfish compiled to WebAssembly, running in a Web Worker (for play-vs-computer and game review).
- **Testing:** Vitest for unit tests, Playwright for end-to-end tests (including two-browser online games).
- **Chess rules:** `chess.js`. Never write chess rule logic by hand.
- **Board UI:** `react-chessboard` (MIT license). Do not use `chessground` (GPL license, incompatible with our commercial closed-source app).
- **Backend:** Supabase, plus one game server (see `server/`). The game server exists only to make moves fast: players in a live game hold an open connection to it, and it passes each move to the opponent at once. It is not a second authority. It records every move through the same Postgres functions the Edge Functions use, never touches wallets, the ledger or escrow, and the app must keep working through the Edge Functions whenever the game server cannot be reached. (Decided by the owner on 9 October 2026; before that the rule was "Supabase only".)
  - Supabase Auth for accounts
  - Postgres for all data
  - Supabase Realtime for live game updates
  - Supabase Edge Functions (Deno, can import `chess.js` from npm) for every action involving moves, tokens, or results
  - Postgres functions (`SECURITY DEFINER`) for atomic money operations
  - `pg_cron` for background sweeps (timeouts, abandoned games)
- **All schema changes go in SQL migration files** under `supabase/migrations/`, never as manual edits in the dashboard. I have created the Supabase project but have NOT created any tables. You create everything through migrations.

Environment variables go in `.env.local` (never committed). Provide a `.env.example`.

## 3. Hub architecture: shared core + game modules

Structure the code so adding a new game later means adding a new module, not changing the core.

**Shared core** (game-agnostic, built once):
- Accounts, profiles, countries, languages
- Wallet, ledger, escrow, settlement, rake
- Matchmaking queue (by game type, stake, and game options)
- Ratings per game (a player has a separate chess rating, ludo rating, and so on)
- Leaderboards per game, global and per country
- Lobby where the player picks a game, then a stake
- Match history, notifications, settings, admin

**Game modules** (one per game, chess is the first):
- The game's own rules, state, move validation, UI, sounds, and end conditions
- A game module exposes a standard interface to the core. For example: create the initial state for a match; validate and apply a move from a player; report whether the match has ended and who won (or draw, and why). The core never needs to know chess rules; it only receives a result and settles money.

**Code layout** (suggested, adjust if you have a better reason):
```
african-game-hub/
  src/
    core/          (auth, wallet, lobby, matchmaking, profile, leaderboards, shared UI)
    games/
      chess/       (board, rules adapter, sounds, themes, game screens)
    landing/       (landing page and 3D scene)
  supabase/
    migrations/
    functions/
      core/        (join-queue, settle-match, ...)
      chess/       (chess-make-move, chess-claim-timeout, ...)
```

**Games registry:** a `game_types` table (id like `chess`, name, status: live / coming_soon / disabled, min and max players, allowed stakes and options) drives the lobby, so new games appear by adding a row and a module. Chess is `live`; ludo, draughts, pool and penalty shootout can be listed as `coming_soon` on the lobby and landing page.

## 4. Rules that must never be broken

These matter more than any feature. Real money will eventually flow through this system, and the main threats are cheating players and bugs that create or lose tokens.

1. **The server is the only authority.** The client never decides whether a move is legal, whose turn it is, how much time is left, who won, or anyone's balance. The client sends a move request to an Edge Function; the function validates it with the game module's rules (`chess.js` for chess) against the stored game state, then writes it. The client only displays what the database says.
2. **Clients can never write to money or game tables directly.** RLS must allow players to READ their own wallet, transactions, and games, but INSERT/UPDATE/DELETE on `wallets`, `ledger_entries`, `matches`, `escrow`, and every game's state and move tables (such as `chess_games` and `chess_moves`) must be denied to the `authenticated` and `anon` roles. Only Edge Functions using the service role (or `SECURITY DEFINER` Postgres functions) may change them.
3. **Every token movement is a ledger entry.** Balances are never just "updated." Each change writes an immutable row to `ledger_entries` (amount, type, reference to match or payment, balance after). The wallet balance must always equal the sum of the user's ledger entries. Write a SQL check/function that verifies this.
4. **Money is stored as integers** (`bigint`, smallest unit). Never floats.
5. **Money operations are atomic.** Staking, escrow, payout, and refunds happen inside single Postgres transactions with row locks (`SELECT ... FOR UPDATE`) so two simultaneous requests can never double-spend. Balances can never go negative (add a `CHECK` constraint).
6. **Every match result is settled exactly once.** Use a status column plus a unique constraint or idempotency key so a payout can never run twice, even if a function is retried.
7. **Bonus tokens vs withdrawable tokens.** Wallets track two balances: `bonus_balance` (free signup tokens, playable but never withdrawable) and `cash_balance` (deposits and winnings, withdrawable later). When staking, spend bonus first. Winnings go to `cash_balance`. The rule for converting bonus winnings should be a configurable setting.
8. **Never expose the service role key to the frontend.**

## 5. Supabase engineering rules

Apply these to every part of the app:

- Enable RLS on every table immediately on creation, and write explicit SELECT/INSERT/UPDATE/DELETE policies for each (respecting rule 2 above for money and game tables). Never leave a table with RLS enabled but no policies. Never use a blanket `true` policy on sensitive data. Remember junction tables need policies too.
- Session must survive page refresh, tab switch, minimizing, and locking the phone. Initialize the Supabase client once, call `getSession()` on app load before rendering protected routes (show a loading state, never flash the login page), and listen to `onAuthStateChange`. Never redirect on `TOKEN_REFRESHED`. Never log the user out on a transient network error.
- Re-validate the session and refetch critical data on `visibilitychange` and window `focus`.
- Realtime subscriptions must reconnect automatically after errors and be cleaned up in `useEffect` cleanup when leaving a page.
- Every Supabase call checks `error`. Every async call is wrapped in try/catch. Show toast messages for user-facing errors. Add React error boundaries around major sections. Never show a blank screen.
- Use client-side routing links only. Never block navigation on data fetching; use loading states and skeletons.

**Special case for live games:** if a player's connection drops mid-game, on reconnect the app must reload the full game state from the database (current position, move list, clock values) and resubscribe. The game must never desync.

## 6. Database (create via migrations)

Suggested tables. Improve the design if you see a better approach, but explain why. Shared core tables must not contain chess-specific columns.

Shared core:
- `profiles`: id (references auth.users), username (unique), display_name, avatar_url, country_code (ISO, e.g. RW, NG, KE), preferred_language, phone_e164, created_at, is_banned
- `game_types`: id (e.g. `chess`), name, status (live, coming_soon, disabled), sort_order, allowed stake levels, options schema (e.g. time controls for chess)
- `player_ratings`: user_id, game_type, rating (default 1200), games_played, wins, losses, draws (unique per user + game_type)
- `wallets`: user_id, bonus_balance, cash_balance, updated_at (CHECK both >= 0)
- `ledger_entries`: id, user_id, amount (signed), balance_type (bonus/cash), entry_type (signup_bonus, stake, stake_refund, win_payout, rake, deposit, withdrawal, adjustment), match_id, payment_id, balance_after, created_at. Append-only: no updates or deletes allowed, even for service role (enforce with a trigger).
- `matches`: id, game_type, stake_amount, options (jsonb, e.g. time control), status (waiting, active, finished, aborted), winner_id (null for draw), result (win, draw, aborted), end_reason (text, game-specific), settled (boolean), created_at, started_at, finished_at
- `match_players`: match_id, user_id, seat (e.g. white/black for chess; seat numbers for multi-player games like ludo), rating_before, rating_after, tokens_change
- `escrow`: match_id, user_id, amount, balance_type, status (held, paid_out, refunded)
- `match_queue`: user_id, game_type, stake_amount, options, rating, joined_at
- `countries`: country_code, name, currency_code, token_to_currency_rate, real_money_enabled (boolean, default false), payment_providers available, min/max deposit and withdrawal, default_language
- `platform_settings`: rake_percent (default 10), signup_bonus_amount, bonus withdrawal rules
- `platform_revenue`: rake collected per match (or include rake as ledger entries on a platform account)

Chess module:
- `chess_games`: match_id, fen, pgn, turn, white_time_ms, black_time_ms, increment_ms, last_move_at, draw_offer_by
- `chess_moves`: match_id, ply, san, uci, fen_after, time_left_ms, created_at

Note that some games (like ludo) will have 2 to 4 players, so never assume exactly two players in core tables.

Signup trigger: when a user signs up, automatically create their profile and wallet, and credit the signup bonus through a ledger entry.

## 7. How a staked match works (shown for chess)

1. **Join queue:** player picks a game (chess), a stake level, and options (time control). Edge Function checks they have enough balance and adds them to `match_queue`.
2. **Match:** pair queued players with the same game, stake, and options (prefer close ratings). Do this in one atomic Postgres function so a player can never be matched twice. Lock both stakes into `escrow` (deducting from wallets via ledger entries) in the same transaction. If either player lacks funds, cancel cleanly and refund. Create the `matches`, `match_players`, and `chess_games` rows. Randomly assign colors.
3. **Play:** each move goes to a `chess-make-move` Edge Function that checks: match is active, it is this player's turn, the move is legal (chess.js on stored FEN), and the player has time left. It then updates FEN, PGN, clocks, and inserts into `chess_moves`. Both clients receive the update by Realtime.
4. **Clocks (server-side):** store each player's remaining time and `last_move_at`. On each move, subtract elapsed server time from the mover's clock and add the increment. The client shows a smooth countdown locally but always corrects to server values. Never trust client timestamps.
5. **Game end:** checkmate, stalemate, draws, resignation, draw-by-agreement, or timeout. Timeouts are detected when either player calls a `claim_timeout` function or by a `pg_cron` job running every few seconds that finds games where the player to move has run out of time.
6. **Abort rule:** if a player does not make their first move within a set time (for example 30 seconds), abort the game and refund both stakes in full.
7. **Abandonment:** a disconnected player's clock keeps running; they lose on time if they don't return.
8. **Settlement:** when the chess module reports a result, the shared core `settle_match` function, in one transaction, marks the match settled, pay the winner (pot minus rake) to `cash_balance`, record rake as platform revenue, and mark escrow as paid out. On a draw, refund each player's stake (decide with me whether rake applies to draws; default: no rake on draws). Update the player's chess rating in `player_ratings` (Elo or Glicko-2). This settlement code must work unchanged for any future game.

## 8. The chess experience (this is what makes or breaks the product)

The board must feel premium. Required:

- Smooth drag-and-drop and tap-to-move (tap piece, tap square), both working well on phones
- Legal move dots when a piece is selected, capture rings on capturable pieces
- Last move highlighted, king highlighted red when in check
- Move and capture animations, including the opponent's moves
- Optimistic UI: show my move instantly, then roll back with a gentle message if the server rejects it
- Pawn promotion picker
- Premoves (nice to have in phase 1, required later)
- Board flips so my color is always at the bottom
- Sounds for move, capture, check, castle, promote, game start, game end, and low time warning. Use only CC0/royalty-free sounds or synthesize them with the Web Audio API. Include a mute toggle.
- Two clocks showing minutes:seconds, switching to tenths of a second under 10 seconds, turning red when low
- Player cards: avatar, username, rating, and captured pieces with material difference (+2, +3)
- Move list in algebraic notation, with the ability to step back through earlier positions during and after the game
- Resign button (with confirmation), offer draw / accept / decline
- Game-over screen: result, reason, tokens won or lost, rating change, rematch and new game buttons
- Several board themes (green, brown wood, blue, grey) and at least two piece sets, saved per user
- Haptic feedback on mobile where supported

Piece graphics must come from a properly licensed free set (for example one of the Lichess piece sets with a commercial-friendly license, with attribution). Record every third-party asset and its license in `ASSETS.md`.

## 9. Other screens for phase 1

- Sign up / log in. Use email + password during development (phone OTP with an SMS provider comes later; design the profile so a verified phone number can be added). Users must confirm they are 18 or older.
- Lobby: wallet balance (bonus and cash shown separately), game picker driven by `game_types` (chess live, others shown as coming soon), then stake level picker, time control picker, "Find match" button with a searching state and cancel option
- Wallet page: balances and full transaction history from the ledger. Deposit and withdraw buttons present but showing "Coming soon"
- Profile: country flag, rating and stats per game, match history; tap a past game to replay it
- Leaderboards: per game, global (all of Africa) and per country
- Play vs computer (Stockfish in a Web Worker, several difficulty levels), with no stakes, for practice
- Settings: board theme, piece set, sounds, logout

## 10. Landing page with 3D hero

The landing page (`/`) is the first thing new players and partners see. It must look premium, distinctive, and clearly made for African players, and it must load fast on budget phones.

**Design process (do this before writing code):**
1. Write a short design plan: a palette of 4 to 6 named hex colors, one or two deliberately chosen typefaces (with fallbacks) and a type scale, a layout sketch for each section, and the concept for the 3D hero.
2. Check the plan against generic defaults. Avoid the looks that make sites feel template-made or AI-generated: cream backgrounds with terracotta accents, near-black with one neon accent, identical rounded cards with soft shadows everywhere, all-caps labels above every heading, fade-up animations on every section. Also avoid clichéd "Africa" imagery (safari animals, generic tribal patterns, a plain map outline). Draw instead on real contemporary African visual culture: confident color, modern African typography and textile geometry used with restraint, and the energy of people playing.
3. Show me the plan and wait for my approval before building.

**3D hero:**
- An original 3D scene that makes someone want to play immediately: for example, a custom-designed chess set on a board that the camera glides across, pieces that react to touch or scroll, or a move being played. Make one memorable moment; keep everything around it calm.
- Built with React Three Fiber and drei. Original or properly licensed 3D models only, recorded in `ASSETS.md`. Never use chess.com's or anyone else's piece designs.
- Performance is not optional: compressed glTF models (Draco or Meshopt), total 3D assets under about 2 MB, pixel ratio capped (max 1.5 on mobile), rendering paused when the hero is off-screen or the tab is hidden.
- The page text and "Play now" button must appear instantly, before the 3D loads. Load the 3D scene lazily after first paint.
- Fallback: on low-end devices (weak GPU, low memory), with data-saver on, or with `prefers-reduced-motion`, show a well-designed static image of the scene instead.

**Sections** (refine in the design plan):
- Hero with a clear headline, a "Play chess free" button, and a log-in link
- The games: chess live now, upcoming games marked as coming soon (driven by `game_types`)
- How it works, as a real sequence: create an account, get free tokens, play real opponents, win tokens (cash out "where available")
- Live numbers from the database (players online, matches played today, countries represented). Only show real numbers; hide a stat if it is still too small to be impressive.
- Fair play: server-checked moves, anti-cheat, secure wallet
- Countries and languages supported
- Responsible gaming and 18+ notice, terms, privacy policy, contact
- Language switcher

**Copy rules:** honest and plain. Never promise income or use "get rich" language. Do not claim real-money cash-out in countries where `real_money_enabled` is false. Skill, competition and community are the selling points.

**Sharing:** proper title, description and Open Graph image so links look good when shared on WhatsApp, Facebook and X.

## 11. Prepare for later phases (don't build yet, but don't block them)

- Mobile money deposits and withdrawals across many countries (MTN MoMo, Airtel Money, M-Pesa, Orange Money, Wave, and possibly an aggregator that covers several countries through one integration). Create a `PaymentProvider` interface and a `payments` table design so each provider and country can be added without changing wallet logic. Withdrawals will require identity verification and admin approval.
- Responsible gaming: daily deposit limits, loss limits, self-exclusion, cool-off periods
- Anti-cheat: compare players' moves to Stockfish after games to flag suspected engine use; detect the same person running multiple accounts
- Admin dashboard: users, matches per game, ledger, flagged accounts, platform revenue, manual adjustments (always via ledger)
- Tournaments, and more games on the hub (ludo, draughts, pool, penalty shootout), each added as a new game module using the shared core

## 12. Order of work

Work in these steps. At the end of each step, tell me what you built, how to test it, and any decision you need from me. Do not jump ahead.

1. Project setup (Vite, TypeScript, Tailwind, Supabase client, routing, auth with session persistence, error boundaries, toasts)
2. Database migrations: shared core tables, chess module tables, RLS policies, signup trigger, ledger integrity check
3. Landing page design plan (wait for my approval), then build the landing page with the 3D hero
4. Lobby with the games registry (chess live, others coming soon)
5. Local chess board with every UX feature from section 8 (play both sides on one device) so we can perfect the feel first
6. Play vs computer
7. Online chess without stakes: matchmaking, server-validated moves, server clocks, Realtime sync, reconnect, game end
8. Staking through the shared core: escrow, settlement, rake, ratings, wallet and transaction history
9. Testing: write tests for the money functions (double-spend attempts, simultaneous matches, retried settlement, insufficient balance, draws, aborts) and for move validation (illegal moves, moving out of turn, moving after time runs out). The ledger integrity check must pass after every test.
10. Polish, performance on low-end Android phones (including the landing page), and a deployment guide

At the end, write a short `ADDING_A_GAME.md` explaining exactly how a future game module plugs into the core.

## 13. Context about the users

Players are across Africa, mostly on mid-range or budget Android phones, often on slow or unstable mobile data (3G is common), and data costs real money for them. This shapes every technical decision:

- Keep the initial download small (target under 500 KB of JavaScript for the first load). Lazy-load Stockfish, extra themes, and non-essential pages.
- Compress and cache assets; the app shell should open instantly on repeat visits, even offline (show cached profile and history, and clearly say online play needs a connection).
- Offer a data-saver setting (no avatars, fewer animations).
- Moves are tiny messages; never send the full game state on every move, except when reconnecting.
- Handle slow and dropped connections gracefully, with clear "Reconnecting..." states.
- Everything must work one-handed on a small screen.

## 14. Built for Africa: multi-country design

Rwanda launches first, but never hard-code anything to Rwanda, and never hard-code anything to chess outside the chess module.

- **Countries:** every user has a country. Country-specific settings (currency, payment providers, limits, whether real money is allowed) live in the `countries` table, not in code.
- **Real money is switched on per country.** Gaming laws differ in every African country, and we will only enable real-money play where we are licensed. Use the `real_money_enabled` flag; in countries where it is false, users can still play with play-money tokens, practice, and climb leaderboards, but can't deposit or withdraw. The app must make this clear without feeling broken.
- **One token, many currencies.** Tokens are the single internal unit for all games, so players from different countries can play each other. Conversion to local currency (RWF, NGN, KES, GHS, UGX, XOF, ZAR and others) happens only at deposit and withdrawal time, using rates stored in the database. Store the rate used on every payment record. Flag to me any risk of players exploiting rate differences between countries.
- **Languages:** build with i18n from the start; no hard-coded text. Start with English and French (covering most of the continent), then Portuguese, Swahili, Arabic (right-to-left), Kinyarwanda, and others. Chess notation stays standard.
- **Phone numbers:** store in E.164 international format with country code; mobile money accounts are tied to phone numbers.
- **Time:** store all times in UTC; display in the user's local time zone.
- **Identity:** players should see where their opponent is from (country flag) and there should be per-country leaderboards; national pride is a big motivator.
- **Matchmaking:** default to matching across all of Africa for fast pairing, with an option to prefer opponents in the same country or with low latency.
