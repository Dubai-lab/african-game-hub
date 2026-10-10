# The game server

One small program that keeps an open connection (WebSocket) to each player in a live game, so a move reaches the opponent in one short hop. It carries all four games: chess, draughts, pool and Ludo.

## What it is, and what it is not

It is a faster road for moves. It is not a second authority.

- **The database is still the game.** Every move is recorded by `public.chess_apply_move`, the same database function the `chess-make-move` Edge Function calls: under a row lock, on the database's clock, settling the match when it ends. The server never touches wallets, the ledger or escrow.
- **A move is shown to the opponent a moment before the database confirms it.** If the database then refuses (the mover's time ran out, the game had ended), both players are told to take it back and reload.
- **Nothing is held only in memory.** A game is read from the database when a player connects and dropped when both have gone. If the server stops, the app plays through the Edge Functions, as it does whenever it cannot reach the server.
- **Resigning, draw offers, time-outs and settlement** still go through the Edge Functions and the database's own sweep. Only moves use the server.
- **Ludo is carried, not judged.** Its rules and its dice live in the database (`public.ludo_action`). For Ludo the server only takes the player's request to the database over the open connection and hands the new state to everyone at the table. The dice are never rolled here.

The code: `src/main.ts` (the network side), `src/live.ts` (what happens to a move, the same for every game) and one small file per game (`src/chess.ts`, `src/draughts.ts`, `src/pool.ts`) naming its rules and its database functions. `src/ludo.ts` is the carrier for Ludo. The rules themselves are in `supabase/functions/_shared/`, shared with the Edge Functions.

## Running it

It is built into one file with everything inside it, so the machine needs only Node 22.

```
docker build -f server/Dockerfile -t agh-game-server .     # from the ROOT of the repository
docker run -p 8080:8080 --env-file <secrets> agh-game-server
```

The build must be run from the repository root, because the game rules live outside `server/`. The image has no native modules and builds on ARM64 and x86-64.

Without Docker: `npm ci && node build.mjs && node dist/server.cjs` inside `server/` (with the repository's `supabase/functions/_shared` folder present beside it).

**Run exactly one copy.** Two copies would each hold their own view of a game. Nothing would be lost (the database refuses a move made on an old position), but players connected to different copies would not hear each other's moves over this road.

## Configuration (environment variables)

| Variable | Required | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | yes | The project's address, `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | The project's public key (the one the app uses). Used only to ask the auth server who a session token belongs to |
| `GAME_SERVER_KEY` | yes | This server's own key. A secret: keep it in the secret store. It is a token for the `game_server` database role, which can read a game as a player sees it and record a move through the game's own function, and nothing else: no table, no wallet, no personal details. Made by `npm run server-keys`, which saves it in `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | no | **Do not set this.** It is the key that can do anything, and it does not belong on a machine on the internet. It is still accepted when `GAME_SERVER_KEY` is missing, so an older setup keeps running, and the server logs a warning (`full_access_key`) every time it starts that way |
| `APP_ORIGINS` | yes in production | The player site's address(es), comma-separated. A browser on any other site is refused |
| `ORIGIN_SECRET` | yes in production | When set, every request must carry it in an `X-Origin-Secret` header (the proxy in front adds it). `/health` from the machine itself is exempt |
| `PORT` | no | Where to listen. Default 8080 |

## What it will not put up with

- **Who a player is** is checked with the auth server when they connect, and again every five minutes while they play. A banned account, a signed-out session or an expired token is turned away; the app reconnects with a fresh token if it has one.
- **One address** may hold at most 120 connections, at most 15 that have not yet said who they are, and may open at most 60 in ten seconds. Above that the answer is `429`. (Phone networks put many players behind one address, hence the generous numbers.) The whole server takes at most 4,000 connections.
- The address believed is the **last** entry of `X-Forwarded-For`, the one the proxy added. Earlier entries are written by the caller.
- `/health` reports `refused`: how many connections have been turned away since the server started.

## The nightly copy of the books

`server/backup.mjs` is a separate small script (Node 22, no packages) that copies the money tables into one compressed file and checks that every wallet equals its ledger entries. It uses its own key, `LEDGER_BACKUP_KEY`, which can read those tables and nothing else. It is meant to be run once a night by whatever schedules jobs on the host, and the file kept somewhere private that is not the database:

```
SUPABASE_URL=... SUPABASE_ANON_KEY=... LEDGER_BACKUP_KEY=... node backup.mjs /some/folder
```

It prints one JSON line with the file name and the row counts. It exits with code 2 if the copy does not agree with itself, and with code 1 if it could not be taken: either should raise an alarm.

## What it answers

- `GET /health` → `200 {"ok":true,"games":<live games>,"connections":<open connections>,"uptime":<seconds>}`. Returns `503` once it has been told to stop. From anywhere but the machine itself it needs the secret header.
- WebSocket on `/ws`. Anything else is `404`.
- The player's own address is read from `X-Forwarded-For`.
- It pings every connection every 25 seconds and drops one that does not answer. A proxy in front needs an idle timeout comfortably above that.
- Logs are JSON lines on standard output.

## Stopping and deploying

On `SIGTERM` (or `SIGINT`) it stops accepting connections, finishes answering any move already accepted, tells every player it is restarting, closes their connections and exits, always within ten seconds.

A deploy therefore interrupts nobody's game: for the seconds the server is away, the app sends moves through the Edge Functions and reconnects by itself when the server is back. No clock is charged for the gap, because clocks are kept by the database.

## Switching it on in the app

The app uses the server only when it was built with `VITE_GAME_SERVER_URL` set (for example `wss://d2xirivzgoo9lw.cloudfront.net/ws`). Leave it unset and the app behaves exactly as before. To switch the server off in an emergency, stop the server: the app falls back by itself. To remove it for good, rebuild the site without the variable.

## The messages

All JSON. From the app:

- `{"t":"hello","game":"chess" | "draughts" | "pool" | "ludo","match":"<match id>","token":"<session token>"}` — once, within ten seconds of connecting. The token is checked with the auth server; who the player is never comes from anything else.
- `{"t":"move","id":<number>,"uci":"e2e4","ply":<moves the app has seen>}` for chess; for draughts `"path":[32,28]` (the squares the piece visits) in place of `uci`; for pool `"shot":{dx,dy,power,spinX,spinY,cue?,pocket?}` with `ply` the shot number; for Ludo `"action":"roll"|"move"` with `piece`, `die`, `color`, `full` and `turn_no`

From the server:

- `{"t":"ready","ply":<moves held>}` after a good hello; `{"t":"error","code":"..."}` after a bad one.
- `{"t":"ack","id":<same number>,"ok":true,"san":"e4","ply":1,"white_time_ms":...,"black_time_ms":...,"last_move_at":"...","finished":false}` or `{"t":"ack","id":...,"ok":false,"code":"ILLEGAL_MOVE"}` — the answer to a move.
- To the opponent: `{"t":"move","ply":1,"san":"e4"}` at once, then `{"t":"clock",...}` when the database has confirmed, or `{"t":"revert","ply":1}` if it refused.
- `{"t":"restarting"}` before a planned stop.

A connection that sends more than 40 messages in ten seconds, or a message over 4 KB, is closed.

## Tests

- `npm test` (from the root) includes `server/src/chess.test.ts`: order of moves, refusals, taking a move back, catching up with moves made through the Edge Function.
- `npm run on-dev -- e2e -- e2e/game-server.spec.ts` starts the server on this machine against the development project and plays staked chess through it with two browsers, then again with one player cut off from the server.
