# Running it

The database is live and already has data in it, so this is two commands and a
file.

## On your own machine

```bash
git clone -b claude/wonderful-lovelace-sj5tuy \
  https://github.com/luckysatyarth-arch/TODOSTUFFBITCH.git
cd TODOSTUFFBITCH
npm install
```

Create `.env.local` with these two lines. Both are safe to put in a client —
the publishable key is designed to be public, and row level security is what
actually protects the data:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://opirienxtsewxoolsaba.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_JTjNZmBI4Zo1gvdBmibXdg_A9X2GCOr
```

Then:

```bash
npm run dev
```

Open http://localhost:3000 and sign in:

```
alice@demo.test
demo-password-1
```

That account already has a personal workspace and a team workspace called
**Acme Product**, with a project, six tasks, a milestone, a note and two
calendar events.

## Or deploy it to Render

The form autofills from Next.js, and one autofilled field is wrong.

| Field | Value |
| --- | --- |
| Branch | `claude/wonderful-lovelace-sj5tuy` |
| **Root Directory** | **Leave empty.** Render may suggest `src/` — clear it |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` |
| Language / Runtime | Node |
| Instance type | Free is fine for a look |

`src/` is the source folder *inside* the app, not the app. `package.json` is at
the repository root, so pointing Render at `src/` means it finds no project to
build and the deploy fails before it starts.

Environment variables, under Advanced:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://opirienxtsewxoolsaba.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_JTjNZmBI4Zo1gvdBmibXdg_A9X2GCOr` |
| `REPORT_TIMEZONE` | `Asia/Kolkata` |
| `NODE_VERSION` | `22` |
| `CRON_SECRET` | a 64-character hex string — see below |
| `CREDENTIALS_ENCRYPTION_KEY` | another one, different |

Those last two are values you generate, not text to paste. Run this twice and
use a different result for each:

```bash
openssl rand -hex 32
# or, without openssl:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Generate them yourself rather than taking them from anyone, including from
this repository's history: `CRON_SECRET` is what stops a stranger triggering
your report run, and `CREDENTIALS_ENCRYPTION_KEY` encrypts stored OAuth
tokens.

**Where the variables go:** on the create form they are under *Environment
Variables*, below Start Command — one Key/Value row each. If the service
already exists, it is the *Environment* tab in its left sidebar, and saving
there redeploys.

After the first deploy, set `NEXT_PUBLIC_APP_URL` to the URL Render gives you
and redeploy. Links inside the daily report are built from it, so until it is
set they point at `localhost`.

### The schedules do not come across

`vercel.json` is Vercel's format and Render ignores it, so none of these fire
on their own:

| Schedule | Endpoint | Does |
| --- | --- | --- |
| `30 15 * * *` UTC | `/api/cron/daily-reports` | 21:00 Asia/Kolkata report run |
| `*/10 * * * *` | `/api/cron/run-jobs` | The job worker |
| `0 * * * *` | `/api/cron/retry-deliveries` | Retries failed deliveries |
| `15 */6 * * *` | `/api/cron/sync-connectors` | Connector sync and re-indexing |

To restore them, add a **Cron Job** service in Render per schedule, each one
calling its endpoint with the shared secret:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-app>.onrender.com/api/cron/daily-reports
```

The routes also accept an `x-cron-secret` header if that suits better. Without
a `SUPABASE_SERVICE_ROLE_KEY` they will authenticate and then report that they
have nothing they are allowed to do, which is the intended behaviour rather
than a failure.

### Two more things about Render

- **The free instance sleeps** after inactivity, so the first request after a
  quiet spell takes the better part of a minute. That is Render, not the app.
- **Pick a region near the database.** The Supabase project is in
  `ap-southeast-2` (Sydney), so Singapore is a much shorter round trip than
  Oregon. Every page here is server-rendered against that database, so the
  distance shows up on every navigation.

## Or deploy it to Vercel

Three minutes in the dashboard. I could not do this for you: the connected
Vercel account can list projects in the **CRYSTA IVF** team but gets
`403 forbidden` on creating one, so it does not hold create permission there.

1. **Import the repo.** vercel.com → Add New → Project → import
   `luckysatyarth-arch/TODOSTUFFBITCH`. It is a Next.js app at the repository
   root, so every build setting is detected; change nothing.

2. **Add the environment variables** before the first deploy. Two are the ones
   from the local setup above; the other three you generate:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://opirienxtsewxoolsaba.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_JTjNZmBI4Zo1gvdBmibXdg_A9X2GCOr` |
   | `REPORT_TIMEZONE` | `Asia/Kolkata` |
   | `CRON_SECRET` | a 64-character hex string — `openssl rand -hex 32` |
   | `CREDENTIALS_ENCRYPTION_KEY` | another one, different |

   Those last two are values you generate, not text to paste. Run
   `openssl rand -hex 32` twice and use a different result for each.
   `CRON_SECRET` is what stops a stranger triggering your report run, and
   `CREDENTIALS_ENCRYPTION_KEY` encrypts stored OAuth tokens, so generate them
   yourself rather than taking them from anyone.

3. **Deploy.** Then set `NEXT_PUBLIC_APP_URL` to the URL Vercel gives you and
   redeploy — links inside the daily report are built from it, so until it is
   set they point at `localhost`.

4. **Lock it down.** Settings → Deployment Protection → Vercel Authentication.
   This serves a live database on a public URL, so only you should be able to
   open it.

Two things to know about the deployment:

- **The crons will not do anything useful yet.** `vercel.json` registers all
  four, and they will authenticate with your `CRON_SECRET`, but report
  generation and connector sync need `SUPABASE_SERVICE_ROLE_KEY` — which is a
  real admin credential, so add it only if you want those, and only as a
  sensitive variable.
- **Vercel's Hobby plan runs crons once a day** and does not guarantee the
  minute, so the 21:00 Asia/Kolkata schedule needs a paid plan to actually
  fire at 21:00.

## What to try

| Where | What is worth looking at |
| --- | --- |
| **Home** | Due today, overdue, blocked counts, computed per workspace |
| **My Tasks** | Switch list / board / table. Drag a card between board columns. Edit a cell inline in the table |
| **A task** | Open one and tick **Repeats** — set Monthly, then "By position", "Last", and the Mon–Fri days. The preview reads "Last working day of every month". Save, set the status to Completed, and the next occurrence appears |
| **Calendar** | Month / week / agenda. Drag a task onto another day to reschedule it |
| **Workspace switcher** | Top left. Personal and team data are separate — that separation is enforced in the database, not the UI |
| **Integrations** | Every connector reports what it needs. Nothing claims to work that does not |
| **Reports** | States the 21:00 Asia/Kolkata schedule and what is configured |

## What will not work, and why

These need credentials nobody has supplied, and each one says so on screen
rather than failing quietly:

- **Voice and text capture → AI task extraction.** Needs an `ANTHROPIC_API_KEY`
  or `OPENAI_API_KEY`. Recording and upload work; extraction does not.
- **AI search answers.** Keyword search over your own records works. Grounded
  answers with citations need an AI key.
- **Connectors** (Drive, Gmail, Teams, Notion). Need OAuth clients.
- **WhatsApp delivery of the daily report.** Needs a Meta or Twilio account and
  an approved template.
- **The cron jobs** (daily report, job worker, connector sync). Need
  `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`, and a deployment for anything
  to call them on a schedule.

To turn any of those on, copy `.env.example` and fill in that section;
`docs/INTEGRATIONS.md` has the per-provider steps.

## Supabase has to be told where the app lives

Easy to miss, and the failure is confusing: you sign up, the confirmation email
arrives, you click it, and you land on a 404 at `/?code=...`.

That path is the clue. The app asks Supabase to send people to
`<app>/auth/callback`. When that address is not on Supabase's allow-list,
Supabase does not error — it quietly falls back to the project's **Site URL**
instead, which by default is whatever was there first. The one-time code is
fine; it is being delivered to the wrong door.

In **Supabase → Authentication → URL Configuration**:

| Field | Value |
| --- | --- |
| Site URL | `https://<your-app>` |
| Redirect URLs | `https://<your-app>/auth/callback` |
| Redirect URLs | `http://localhost:3000/auth/callback` |

Add both redirect entries. The localhost one is what lets you run locally
against the same database without the confirmation link bouncing you to the
deployed app.

Then make sure the app agrees: `NEXT_PUBLIC_APP_URL` in the host's environment
must be that same `https://<your-app>`, with no trailing slash. That is the
value the app puts in the email in the first place, so if the two disagree you
get the fallback again.

A confirmation link that has already failed is spent — the code is single use
and short-lived. Request a new one after fixing the settings, or sidestep email
entirely by signing in as `alice@demo.test`, which is already confirmed.

## If signup rejects you

New sign-ups may need email confirmation, depending on the project's auth
settings. `alice@demo.test` is already confirmed, which is why it is the one to
use. To confirm another address, either turn confirmation off under
Authentication → Sign In / Providers in the Supabase dashboard, or click the
link in the confirmation email.

## Checking the work without running it

```bash
npm run verify      # typecheck, lint, 174 unit tests
npm run db:verify   # applies the migrations to a throwaway local Postgres
                    # and runs 166 authorization and behaviour checks
npx playwright test # 20 end-to-end tests
```

`npm run db:verify` needs PostgreSQL 16 and pgvector installed locally
(`apt-get install postgresql-16 postgresql-16-pgvector`), and no credentials.
It is the one that proves the row level security policies do what they claim,
by executing them as a signed-in user.
