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
