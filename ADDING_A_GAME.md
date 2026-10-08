# Adding a game to the hub

The hub is a shared core plus one module per game. The core owns accounts, wallets, the ledger, escrow, matchmaking, settlement, ratings, leaderboards, profiles and the lobby. It knows nothing about the rules of any game. A game module owns its rules, its state, its screens and its sounds, and tells the core one thing: how a match ended.

Adding a game therefore means writing a module and registering it in four places. Nothing in the core changes. Chess is the worked example throughout; "ludo" is the game being added.

Ludo has since been added exactly this way, and is the second worked example: `supabase/migrations/20261007210000_ludo.sql`, `supabase/functions/ludo-action/`, `src/games/ludo/`, `supabase/tests/ludo.test.ts` and `e2e/ludo.spec.ts`. Its rules (and its dice) live entirely in the database, which suits a game with no library to lean on; chess keeps its rules in the server function, where chess.js runs. Either is fine. What is not fine is rules on the player's device.

Pool (8-ball and 9-ball) is the third: `supabase/migrations/20261008150000_pool.sql`, `supabase/functions/pool-action/`, `supabase/functions/_shared/pool.ts`, `src/games/pool/`, `supabase/tests/pool.test.ts` and `e2e/pool.spec.ts`. It shows how to do a game of physics. One file, `_shared/pool.ts`, holds the table, the physics and the rules, written so that it gives the same answer everywhere (fixed time step, only + − × ÷ and square root, shots sent as whole numbers). The server function runs it to decide every shot; the player's device runs the very same file only to draw the shot it has just sent, and then takes the table the server stored. The device never tells the server where a ball ended up.

## What the core does for you

You do not write any of this again:

- **Matchmaking.** Players are paired on the same game, stake, options and rating pool, closest rating first.
- **Stakes.** Both stakes move into escrow in the same transaction that creates the match.
- **Settlement.** When you report a result, the winner is paid the pot less the rake, or stakes are refunded on a draw or abort, exactly once.
- **Ratings, leaderboards, match history, profiles.** Updated from the result, per game and rating pool.
- **The lobby.** Your game appears there from its row in the registry.
- **After the match.** "New game" (someone new, same terms) and "Rematch" (the same opponent, who accepts or declines) work for any two-player game: call `useAfterMatch` and render `AfterMatchActions` from `src/core/matchmaking/afterMatch.tsx` on your result screen. A rematch swaps who goes first; the core remembers the seat number it dealt (`match_players.seat_order`) even after your game renames the seats.
- **Chat, reporting and blocking** between the players: render `MatchChat` from `src/core/social/MatchChat.tsx`.
- **Admin.** Matches of your game appear in the admin system with players, stakes and money movements.

## The contract

A game talks to the core through three small hooks in the database and one function call.

| You provide | When the core calls it | What it must do |
| --- | --- | --- |
| `private.ludo_init_match(match_id uuid, options jsonb)` | Inside the transaction that creates a match | Create the game's starting state. The core has seated the players as `'1'`, `'2'`, … in random order in `match_players.seat`; rename the seats if your game has names for them (chess renames them `white` and `black`). Raise an exception to refuse the match; everything, stakes included, is then undone. |
| `private.ludo_on_finish(match_id uuid)` | When a match ends, before settlement | Tidy the game's own state (chess freezes the clocks and writes the game record). May do nothing, but must exist. |
| An entry in `supabase/functions/_shared/games.ts` | When a player asks to find a match | Check the options the player asked for and return them in a fixed shape, with the rating pool they belong to. |

| You call | When |
| --- | --- |
| `private.finish_match(match_id, result, winner_id, end_reason)` | The moment your rules decide the match is over. `result` is `'win'` (with `winner_id`), `'draw'` or `'aborted'`. `end_reason` is your own short word for why. It returns `false` if the match was already over, so calling it twice is harmless. |

That call is the whole interface for money. You never touch wallets, the ledger or escrow. If you find yourself writing to them from game code, stop: the design is being bypassed.

Two rules from the project brief apply to every game:

1. **The server is the only authority.** The app sends what the player wants to do; a server function decides whether it happens, using the stored state. The app only displays what the database says.
2. **Clients never write game tables.** Your state tables get row level security that lets players read their own matches (and finished ones) and write nothing.

## Step by step

### 1. Database: one migration

Create `supabase/migrations/<timestamp>_ludo.sql` containing:

- **Your state tables**, keyed by `match_id` (chess has `chess_games` and `chess_moves`). Enable row level security on each as you create it. Name the main one `<game>_games` (one row per match): the admin system shows that row on its match page for any game, with no admin code to write.
- **Access rules.** Copy the pattern at the bottom of `20261007120200_rls_policies.sql`: revoke everything from `anon` and `authenticated`, add the three deny policies for insert, update and delete, then grant `select` with a policy using `private.is_match_player(match_id) or private.is_match_finished(match_id)`.
- **The two hooks**, `private.ludo_init_match` and `private.ludo_on_finish`, as `security definer` functions with `set search_path = ''`, and `revoke all … from public, anon, authenticated, service_role`.
- **Your action functions**, in `public`, callable by `service_role` only: for example `public.ludo_apply_turn(match_id, user_id, expected_turn, …)`. Follow `public.chess_apply_move`: lock the state row `for update`, re-check that the match is active, that it is this player's turn, and that the player's view is current (the `expected_…` argument), then write, then call `private.finish_match` if the game is over.
- **Timeouts.** If your game has clocks, add a `private.ludo_check_clock(match_id)` and call it from `private.sweep()` the way chess and ludo do, so abandoned games still end.
- **Chance.** If your game has dice or cards, they are drawn on the server, from a secure source (`private.ludo_roll()` shows how), never on the player's device and never from `random()`.
- **Realtime.** `alter publication supabase_realtime add table …` for the tables the app watches.
- **The registry row**, or an update to it if the game is already listed as coming soon:

  ```sql
  update public.game_types
     set status = 'live',
         min_players = 2, max_players = 4,
         stake_levels = '{0,50,100,250}',
         rating_pools = '{default}',
         options_schema = '{"board_sizes": ["classic"]}'::jsonb
   where id = 'ludo';
  ```

Add tests beside the existing ones in `supabase/tests/` (they run against a local Postgres, no network): turn order, your end conditions, and that a finished staked match pays out. `supabase/tests/online.test.ts` is the model. Then `npm run db:push` and `npm run db:types`.

**More than two players.** The core handles any number: matchmaking fills a table of the size your game asks for (return `players` from `queueChoice`, within the registry row's `min_players` and `max_players`), every stake goes into escrow together, the one winner takes the pot less the rake, and ratings are worked out for the whole table. Ludo plays with two, three or four. What the core does not have is a shared pot: there is one winner. The rematch offer is for two-player matches only; bigger tables are offered a new game instead.

**After the result.** A match is over for the core (paid, rated, players free to start another) the moment you call `finish_match`. If your game lets the others carry on for fun, as free Ludo does for second and third place, keep your own table open in your own state; do not delay the result.

### 2. Server: validate options, then one function per kind of action

- In `supabase/functions/_shared/games.ts`, add `ludo` with a `queueChoice` function. It receives the game's `options_schema` and what the player asked for, and returns `{ options, ratingPool }` or `null` if the request is not on offer. Two players are only paired when their `options` are identical, so always return them in one fixed shape.
- Add `supabase/functions/ludo-take-turn/index.ts`. Use the `serve(schema, handler)` helper from `_shared/http.ts`: it handles sign-in, input validation and errors. Inside, load the state, apply your rules, and call your `public.ludo_apply_turn` function with the service-role client (`admin`). Game rules that need a library belong here, as chess.js does for chess; rules simple enough for SQL can live in the database function instead.
- `npm run functions:deploy`.

Function folders must sit directly under `supabase/functions/`, so name them with the game as a prefix (`ludo-take-turn`, `ludo-game-action`).

### 3. App: the module

Create `src/games/ludo/` and export a `GameModule` (the type is in `src/games/types.ts`):

| Field | What it is |
| --- | --- |
| `id` | `'ludo'`, matching the registry row |
| `OptionsPicker` | The part of the lobby where the player chooses your game's options (chess: the time control). Receives the registry's `options_schema`. |
| `defaultOptions`, `isValidOptions` | The first sensible choice, and whether a remembered choice is still on offer |
| `ratingPool` | Which rating a match with these options counts toward. Must agree with what `queueChoice` returns on the server. |
| `MatchScreen` | The screen for one match, loaded lazily, given a `matchId`. It loads the full state from the database, subscribes to Realtime, reloads on every reconnect, and sends actions through `callFunction`. `src/games/chess/online/useOnlineChessGame.ts` shows the pattern, including showing the player's own action at once and taking it back if the server refuses. |
| `SettingsSection` (optional) | Your game's part of the Settings page |
| `practice` (optional) | Links shown in the lobby under "Practice" when your game is selected (chess: play the computer, two players on one phone) |

Then register it with one line in `src/games/registry.ts`.

The route `/play/ludo/match/:matchId` now opens your `MatchScreen`, the lobby shows your game and its picker, and Find match, the wallet, the result's token and rating changes, the profile's history and the leaderboards all work without further changes.

### 4. Words, assets and tests

- **Translations.** Add `games.ludo` (the name), `ratingPools.<pool>` for any new pool names, your screens' text under a `ludo` key, and a sentence for each refusal code your functions return under `errors.codes`, in every file in `src/core/i18n/locales/`.
- **Assets.** Record every third-party image, sound, font or model in `ASSETS.md` with its licence before it ships. Prefer original work; when using someone else's, check the licence at its source and avoid non-commercial and GPL artwork.
- **Tests.** Add a browser test in `e2e/` that plays a full match between the two test accounts (see `e2e/online.spec.ts`), and add your action function to the simultaneous-request tests in `supabase/tests-live/`. The ledger integrity check must pass after every one.

## Checklist

- [ ] Migration: state tables with access rules, `ludo_init_match`, `ludo_on_finish`, action functions, timeouts in the sweep, Realtime, registry row
- [ ] Every way a match can end calls `private.finish_match`
- [ ] No game code writes to wallets, the ledger or escrow
- [ ] `_shared/games.ts` entry, and the server functions deployed
- [ ] `src/games/ludo/` module, registered in `src/games/registry.ts`
- [ ] Translations in every language file
- [ ] `ASSETS.md` updated
- [ ] Database tests, a two-player browser test and a simultaneous-request test, all with a clean ledger check
- [ ] `npm run db:check` passes
