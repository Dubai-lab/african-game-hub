# Deploying African Game Hub

This guide takes the project from a laptop to a live site. It assumes you can run commands in a terminal and have a Supabase account and a hosting account (the examples use Vercel).

There are two parts to deploy:

- **The backend** is a Supabase project: database, sign-in, live updates, and four server functions.
- **The website** is a folder of static files (`dist/`) that any static host can serve.

## Before you start: use a fresh Supabase project for production

Do not launch on the project used during development. It contains test accounts and their matches, which cannot be deleted (ledger rows are permanent by design). Creating a new project also lets you choose the region, and the region cannot be changed later.

**Choosing the region.** Every move travels to the database and back. From West and East Africa the development project in Ireland (`eu-west-1`) adds roughly 0.45 seconds to each request. Pick the Supabase region closest to your players; after setup, `npm run online:check` (on a development project) prints real move times, so you can compare two regions before committing.

**Plan.** Supabase's free plan pauses a project after a period without activity and has no automatic backups. A project holding player balances should be on a paid plan with backups (point-in-time recovery if you can).

## 1. Create the backend

1. Create the Supabase project. Note its project reference (the part of its URL before `.supabase.co`).
2. In the dashboard, copy the project URL, the `anon` key and the `service_role` key (Project Settings → API), and create an access token (Account → Access Tokens).
3. Copy `.env.example` to `.env.local` and fill in the values for the **new** project. Leave `AGH_ENVIRONMENT` out. That one line is what allows the test scripts to create test accounts, and it must never be set on a live project.
4. Create the database:

   ```
   npm install
   npm run db:push
   ```

   This applies every file in `supabase/migrations/`, in order: tables, access rules, the signup trigger, matchmaking, settlement, the scheduled jobs, and the reference data (countries, games, settings).

5. Deploy the server functions:

   ```
   npm run functions:deploy
   ```

6. Check the result:

   ```
   npm run db:check
   ```

   On a live project this runs the inside checks only (access rules, guards, scheduled jobs, ledger integrity). It should end with "All checks passed."

## 2. Configure sign-in and email

In the Supabase dashboard, under Authentication:

- **URL Configuration.** Set the Site URL to your real address (for example `https://play.example.com`) and add `https://play.example.com/**` to the redirect URLs.
- **Emails → SMTP Settings.** Enter a mail service for confirmation emails. A personal Gmail account works for testing but is limited to about 500 emails a day and is easily flagged as spam; use a transactional email service for launch.
- **Email confirmation** must stay on (it is by default).
- **Password length:** set the minimum to 8, to match the signup form.

## 3. Decide who the first admin is

The migration `20261007120400_seed_reference_data.sql` lists one email address. The account that signs up with that address **and confirms it** becomes an admin. Change the address in that file before running `db:push` on the new project if it should be someone else.

## 4. Build and host the website

1. In your host's settings, define these environment variables (they are read when the site is built):

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | The production project URL |
   | `VITE_SUPABASE_ANON_KEY` | The production `anon` key |
   | `VITE_SITE_URL` | Your real address, no trailing slash (used by link previews) |
   | `VITE_CONTACT_EMAIL` | The contact address shown in the footer |

   Never give the host the `service_role` key or the access token. The website does not need them, and anything prefixed `VITE_` is visible to every visitor.

2. Build command: `npm run build`. Output folder: `dist`.

   The build also renders the landing page to static HTML (so search engines and WhatsApp previews see real text) and produces two entry files: `index.html` for `/`, and `app.html`, an empty shell for every other route.

3. **Routing.** The host must serve `app.html` for any path that is not a real file (`/lobby`, `/play/chess/match/…` and so on). `vercel.json` in this repository already does this for Vercel, and sets caching and security headers. On another host, reproduce two rules:
   - paths that are not files → `/app.html`
   - `/assets/*` → cache for a year (the file names change whenever their content does); `sw.js`, `index.html` and `app.html` → do not cache

4. Deploy, then open the site on a phone and:
   - sign up with a real email address and confirm it;
   - check the wallet shows the signup bonus;
   - play a free game between two accounts on two phones;
   - play a staked game and check both wallets and the transaction history.

## 4b. Host the admin system (a separate site)

The admin system is its own application in the `admin/` folder. It is built and hosted separately from the player website, at its own address, and none of its code is in the player website. Both talk to the same backend.

1. Create a **second** project on your host from the same repository, with **Root Directory** set to `admin`. (`admin/vercel.json` sets the routing and strict security headers for Vercel.)
2. Give it two environment variables only: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the same public values as the player website). Never the `service_role` key.
3. Build command `npm run build`, output folder `dist`.
4. Use an address that is not linked from anywhere, for example `admin.yourdomain.com`. If your host offers password or IP protection for a deployment, switch it on as well.
5. Lock the backend to that address:

   ```
   npx supabase secrets set ADMIN_APP_ORIGIN=https://admin.yourdomain.com --project-ref YOUR_PROJECT_REF
   ```

   After this, browsers on any other website are refused by the admin API.

**How admin access is protected**

- The admin app can do nothing by itself. Every request goes to one server function (`admin-api`), which checks each time that the session is valid, that the account is in the `admins` table, and that the session passed the second sign-in step.
- **Two steps to sign in:** password, then a six-digit code from an authenticator app. The first time an admin signs in, the app walks them through setting the authenticator up. Do this yourself straight after deploying, so nobody else can do it with a stolen password.
- Every change an admin makes (ban, balance correction, calling a match off, closing a report) requires a written reason and is recorded in an audit log that nobody can edit or delete, not even with the service key.
- A balance correction is an ordinary ledger entry, so the books still balance. An admin cannot correct their own wallet or ban another admin.
- The session lives only in that browser tab and ends after 20 minutes without activity.

**Adding or removing an admin** is deliberately not possible from the admin app. In the Supabase SQL editor:

```sql
insert into public.admins (user_id) select id from auth.users where email = 'person@example.com';
delete from public.admins where user_id = (select id from auth.users where email = 'person@example.com');
```

**An admin lost their phone.** Remove their authenticator, and they set up a new one at the next sign-in:

```sql
delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'person@example.com');
```

To run the admin app on your own computer: `npm --prefix admin install` once, then `npm run admin:dev` and open http://localhost:5180.

## 4c. Hosting on AWS (S3 + CloudFront)

Both sites are also hosted on AWS, in account profile `myprofile`, Region `eu-north-1`. Supabase stays the backend; AWS only serves the static files.

| | Player site | Admin site |
| --- | --- | --- |
| Address | https://d2xirivzgoo9lw.cloudfront.net | https://d2hp5w4slz51xb.cloudfront.net |
| CloudFormation stack | `agh-player` | `agh-admin` |
| Publish a new version | `npm run deploy:player` | `npm run deploy:admin` |

**How it is built.** `infra/site.yaml` describes one site: a private S3 bucket that holds the files, and a CloudFront distribution in front of it that provides HTTPS, compression and caching close to the player. Only CloudFront may read the bucket. A small CloudFront Function sends app addresses such as `/lobby` to the entry file (`app.html` for players, `index.html` for admin). The same template is deployed twice; the admin copy has `Hardened=true`, which adds the strict security headers.

**Publishing.** `deploy.ps1` reads the bucket and address from the stack, builds with that address, refuses to continue if a server-side secret from `.env.local` is found in the built files, uploads, and refreshes the few files whose names never change. If AWS reports an expired session, run `aws login --profile myprofile` first.

**Caching.** Files in `/assets/` have their content's fingerprint in their name, so they are kept for a year. Sounds, the chess engine and landing pictures are kept for 30 days. The entry pages and the service worker are always re-checked, which is how a new version reaches everyone. Files from earlier versions are left in the bucket so that a phone part-way through loading yesterday's version can finish.

**Rolling back.** Check out the earlier commit and run the deploy command again.

**Cost.** Expected to be $0 a month: CloudFront's free allowance is 1 TB and 10 million requests a month across the whole account, and the two sites store under 4 MB. The budget `portfolio-monthly-1usd` covers the whole account and emails at 50% and 100% of $1 spent, and when the forecast passes $1. An alert only warns; it does not stop anything.

**Kill switch.** `npm run aws:off` takes both sites offline without deleting them (`npm run aws:on` brings them back; add `-- -Site player` or `-- -Site admin` for one). An offline distribution serves nothing and costs nothing.

**Removing everything.** Empty each bucket, then delete each stack:

```
aws s3 rm s3://BUCKET_NAME --recursive --profile myprofile
aws cloudformation delete-stack --stack-name agh-player --profile myprofile --region eu-north-1
```

**Not possible on this account:** a custom domain (its certificate must be created in `us-east-1`, which the organization blocks), AWS WAF rate limiting (same reason), and automatic deployment from GitHub (OIDC is blocked).

## 4d. The game server on AWS (Cape Town)

The game server (`server/`, see its README) runs on one small machine in `af-south-1`, created from `infra/game-server.yaml` as the stack `agh-game-server`.

| | |
| --- | --- |
| Address players use | `wss://d2xirivzgoo9lw.cloudfront.net/ws` (the `/ws` path on the player site's CloudFront distribution) |
| Machine | one `t4g.micro`, Amazon Linux, Docker; fixed address `13.245.60.78` |
| Publish a new version | `npm run deploy:server` (the commit on `origin/main`), or `npm run deploy:server -- -Commit abc1234` |
| Logs | CloudWatch log group `/agh/game-server` in `af-south-1` (kept 14 days) |

**How it is reached.** Browsers connect to CloudFront over `wss://`, which is what gives the server an encrypted address without a domain of its own. CloudFront passes `/ws` to the machine over plain HTTP on port 8080 and adds a secret header (`X-Origin-Secret`). The machine's firewall accepts connections from CloudFront's addresses only, and the server refuses any request without the header. There is no SSH; the machine is managed through AWS Systems Manager.

**Exactly one copy.** There is no load balancer and no auto-scaling. Docker restarts the container if it crashes, and AWS restarts or moves the machine if it stops responding.

**Secrets** are in Parameter Store in `af-south-1`, encrypted, under `/agh/game-server/`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGINS`, `ORIGIN_SECRET`. The machine reads them each time a version is started; they are never in the image or the repository. After changing one, run `npm run deploy:server` again so the server picks it up. `ORIGIN_SECRET` is also held by the player stack (parameter `GameServerSecret`), so changing it means updating both.

**Publishing.** The commit must be pushed to GitHub first. The machine fetches it, builds the image from the repository root, stops the running container (which tells its players it is restarting) and starts the new one. If the new one does not report healthy within a minute, the previous image is started again and the command fails. While the server is away the app plays through the Edge Functions.

**Switching the app over.** The player site uses the server only when it is built with `VITE_GAME_SERVER_URL=wss://d2xirivzgoo9lw.cloudfront.net/ws`.

**Alarms** (emailed): the server has not reported healthy for 3 minutes; Docker restarted it 3 times in 15 minutes; memory above 85% for 5 minutes; an out-of-memory message in the logs; AWS's hardware and machine checks (which also recover or reboot it).

**Cost.** About $12.50 a month: the machine ($7.88), its public address ($3.65) and a 10 GB disk (about $1). The budget `account-monthly-15usd-before-credit` emails at 50%, 80% and 100% of $15.

**Stopping it in an emergency.** Stop the machine (`aws ec2 stop-instances --instance-ids <id> --region af-south-1 --profile myprofile`): the app falls back to the Edge Functions by itself. `npm run aws:off -- -Site player` also cuts it off, along with the player site.

**Removing it.** First update the `agh-player` stack with `GameServerOrigin` set to empty, then delete the `agh-game-server` stack and the four parameters.

## 5. Before real players arrive

- **Rotate every secret that was ever pasted into a chat or email:** the access token, the `service_role` key and the mail password. A fresh production project gives you new keys automatically; the mail password you must change yourself.
- **Legal review.** The terms, privacy and responsible gaming pages are drafts and say so on the page. `ASSETS.md` explains how Stockfish (GPL) is used; have that arrangement confirmed too.
- **Real money stays off.** Every country has `real_money_enabled = false`. Do not change that without a licence for that country, a payment provider integration, and refreshed exchange rates (`countries.token_to_currency_rate` was set from rates on 7 October 2026).
- **Install icons and name.** `public/icon.svg` is a simple placeholder mark. Replace it and run `npm run icons`.
- **Business details.** Set `VITE_BUSINESS_NAME`, `VITE_BUSINESS_ADDRESS` and `VITE_BUSINESS_REGISTRATION` (and `VITE_CONTACT_EMAIL`) where the player site is built. They appear in the footer and on every legal page. Use the real registered details only.
- **Check local law** in every country you open: gaming licence, data-protection registration, consumer and tax rules. The policy pages (terms, privacy, cookies, refunds, responsible gaming) are plain-language drafts for a lawyer to finish, including which country's law applies.

## 5b. Security settings worth knowing

- **Which websites may call the server.** Two Edge Function secrets hold the allowed addresses, separated by commas: `APP_ORIGINS` for the player app and `ADMIN_APP_ORIGIN` for the admin app. A browser on any other site is refused. **When the player or admin site gets a new address (a custom domain, another host), add it to the secret or that site will stop working.** Current values: player `https://d2xirivzgoo9lw.cloudfront.net` plus the local development addresses; admin `https://d2hp5w4slz51xb.cloudfront.net` plus `http://localhost:5180`.
- **Rate limit.** Each player may call each server function at most 60 times in 10 seconds; beyond that the answer is `RATE_LIMITED`. Sign-in, sign-up and password emails are limited by Supabase itself (Authentication > Rate limits in the dashboard).
- **Content security policy.** `npm run build` writes a policy into both entry pages of the player site: scripts run only from the site itself, and the page talks only to the site and Supabase. If you ever add something from another address (a font, an analytics script, a payment widget), it must be added to the policy in `scripts/prerender.ts`, and to the cookies and privacy pages. The admin site's stricter policy is set by its host (`infra/site.yaml`, `admin/vercel.json`).
- **Test accounts.** The `e2e-*` accounts exist only on a development project. Their password is `E2E_TEST_PASSWORD` in `.env.local`, never in the code. Delete those accounts before a project takes real players.
- **Checks to rerun before each release:** `npm audit` (known faults in packages), `npm test`, `npx playwright test e2e/accessibility.spec.ts` (contrast, labels, alt text, keyboard), and `npm run db:check` (what a player can and cannot reach in the database).

## Running it day to day

**Releasing a change**

```
npm test                    # unit tests and database tests (no network needed)
npm run db:push             # only if there are new files in supabase/migrations/
npm run functions:deploy    # only if supabase/functions/ changed
```

then deploy the website through your host. Database changes always go in a new migration file, never by hand in the dashboard. After adding a migration, run `npm run db:types` so the app's code is checked against the new tables.

**Watching the money.** Every ten minutes the database checks that all wallets match the ledger and that every staked token is accounted for. Problems are written to a table:

```sql
select * from private.integrity_alerts order by id desc;
```

The admin app shows the same thing on its Integrity page, and a warning on its Overview. An empty table is the normal state. Any row means tokens were created, lost or stuck, and should be treated as an incident: stop staked play (set the game's `status` to `disabled` in `game_types`), then investigate. You can run the check on demand with `select * from public.verify_ledger_integrity();`.

**Background jobs.** Two scheduled jobs run inside the database (`select * from cron.job;`): `agh-sweep` every 10 seconds ends games whose clock ran out while nobody was watching, and `agh-integrity` every 10 minutes is the check above. If games stop ending on time, look at `cron.job_run_details`.

**Settings you can change without a release** (table `platform_settings`): the rake (`rake_bps`, 1000 = 10%), the signup bonus, the first-move time limit, and how bonus-funded winnings are paid. Stake levels and time controls are in `game_types`.

## Testing against a development project

These need `AGH_ENVIRONMENT=development` in `.env.local` and must only ever point at a project with no real players, because they create accounts and play games.

| Command | What it does |
| --- | --- |
| `npm run e2e` | Browser tests: sign-in, lobby, chess, online play, staking, profile, offline |
| `npm run test:live` | Simultaneous-request attacks on the money and move functions |
| `npm run online:check` | Plays test games through the server functions and prints move times |
| `npm run perf` | First-visit size and speed on a throttled phone profile (run `npm run build` first) |
