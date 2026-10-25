# Productivity Workspace

A personal and team productivity application: tasks, projects, an interactive
calendar, voice and message capture with AI-proposed tasks that require human
approval, authorization-aware search across internal and connected sources,
and a scheduled daily report delivered at 21:00 Asia/Kolkata.

Built with Next.js 16 (App Router), TypeScript, Tailwind 4, Supabase
(PostgreSQL, Auth, Storage, pgvector) and a configurable LLM provider.

---

## What is actually working

Read `docs/FEATURE-MATRIX.md` before anything else. It states, per feature,
whether it is implemented and tested, implemented but needing credentials, or
not supported at all. Two things are worth knowing up front:

- **Reading a personal WhatsApp inbox is not possible** through any official
  API, so it is not implemented. Capture works by forwarding chosen messages
  to a business number. See `docs/RESEARCH-WHATSAPP.md`.
- **WhatsApp group delivery is possible but narrow**: Meta's Cloud API caps a
  group at 8 participants including the sender and requires an Official
  Business Account. Larger teams get individual messages instead, and the
  Reports page says so rather than failing quietly.

## Quick start

### 1. Prerequisites

- Node.js 20.9 or newer
- A Supabase project (free tier is enough)

### 2. Install

```bash
npm install
cp .env.example .env.local
```

### 3. Configure the minimum

Only four variables are needed to start the app:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=...      # Settings → API → service_role
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Everything else is optional and disables a specific feature when absent. The
Settings page shows exactly what this deployment can and cannot do.

### 4. Apply the migrations

With the bundled runner, which tracks what it has applied in
`app.schema_migrations` and so is safe to re-run:

```bash
# Project Settings -> Database -> Connection string. Do not commit it.
DATABASE_URL='postgresql://...' npm run db:push
DATABASE_URL='postgresql://...' npm run db:push -- --dry-run   # just list
```

Each file runs in its own transaction, so a failure rolls back whole and
leaves the database on the last good migration. If a migration that was
already applied has since been edited, the runner says so and refuses to
re-run it rather than guessing.

Or with the Supabase CLI:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

…or by pasting each file from `supabase/migrations/` into the SQL editor **in
numerical order**. The order matters: later migrations depend on the enums,
helper functions and tables created by earlier ones.

All twelve are already applied to the project this was developed against; the
runner reports "Up to date" there. Then confirm the result:

```sql
-- Should list 29 tables, every one with RLS enabled.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Three tables — `integration_credentials`, `job_runs` and
`rate_limit_counters` — have RLS enabled with **no policies**. That is
deliberate: it denies the `authenticated` role outright, leaving them
reachable only by the service role. Supabase's linter reports them as INFO;
that is the intended design.

### 5. Seed demo data

```bash
npm run db:seed          # add demo data
npm run db:seed -- --reset   # delete the demo users first, then re-add
```

This creates three confirmed users (password `demo-password-1`):

| Email | Role in the team workspace |
| --- | --- |
| `alice@demo.test` | owner, and has a private personal workspace |
| `bob@demo.test` | member |
| `priya@demo.test` | viewer (read-only) |

Signing in as Bob and looking for Alice's personal tasks is the quickest way
to see the authorization boundary for yourself.

### 6. Run

```bash
npm run dev
```

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run verify` | typecheck + lint + unit tests |
| `npm test` | Unit tests (integration tests skip without credentials) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:push` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:verify` | Apply the migrations to a throwaway local Postgres and run the 115 authorization and behaviour checks (no hosted project needed) |
| `npm run db:seed` | Seed demo data |

To run the integration tests, which need the service role key:

```bash
node --env-file=.env.local ./node_modules/.bin/vitest run tests/integration
```

On a machine whose Chromium sits at a fixed path rather than the revision
Playwright would download (common in CI images), point at it:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Architecture

```
src/
  app/
    (auth)/            login, signup, server actions
    (app)/             the authenticated shell and every screen
    api/cron/          daily reports, job worker, delivery retries, connector sync
    api/integrations/  OAuth start and callback, one pair per provider family
    api/webhooks/      inbound WhatsApp (signature-verified)
  components/          UI primitives and feature components
  lib/
    env.ts             tiered env validation + capability flags
    dates.ts           timezone handling; the 21:00 IST contract
    supabase/          browser, server and admin clients
    validation/        Zod schemas shared by actions and tests
  server/
    auth.ts            session and workspace authorization
    ai/                provider, prompts, output schemas, embeddings
    connectors/        connector interface and per-provider adapters
    services/          dashboards, tasks, calendar, capture, search,
                       reports, delivery, indexing, rate limiting
supabase/migrations/   eleven ordered SQL migrations
supabase/local/        local verification harness (not deployed)
docs/                  setup, feature matrix, limitations, research
tests/                 unit, integration and e2e
```

### Decisions worth knowing

**Completion cannot be inferred.** A task is complete only when its status is
set to `completed`. `completed_at` is maintained by a database trigger and
pinned to status by a `CHECK` constraint, so no code path — application,
script or future job — can mark something done without a real transition.

**The AI proposes; a person decides.** Extraction writes to `proposed_tasks`,
never to `tasks`. Approval goes through one database function that takes a row
lock, so three concurrent approvals of one proposal produce one task. A
partial unique index on `created_task_id` makes that a storage-level
guarantee, not a convention.

**Uncertainty is preserved, not filled in.** When the model cannot determine
an owner, date or priority, the field stays null and is listed in
`uncertain_fields`, which the review UI marks as unconfirmed. Model-supplied
dates are additionally re-checked against a plausible window before being
accepted.

**Permissions are applied before retrieval, not after.** Both search legs run
through `SECURITY INVOKER` database functions, so RLS filters rows inside the
query. Nothing is fetched broadly and filtered in application code afterwards.

**Report numbers never come from a model.** Every count and list is computed
in SQL. The optional narrative receives the already-computed figures and is
instructed to add no facts; if it fails, the report still sends.

**Calendar dates are zone-free.** A task due "Friday" is stored as a `date`,
so it cannot drift across the date line. Timed events are stored as
`timestamptz` and bucketed into the workspace timezone for display.

## Deployment to Vercel

1. Push the branch and import the repository in Vercel.
2. Add every variable from `.env.example` that your deployment needs, for the
   Production environment. `NEXT_PUBLIC_APP_URL` must be the real deployed
   URL — report links are built from it.
3. Deploy. `vercel.json` registers the cron jobs automatically:
   - `30 15 * * *` → `/api/cron/daily-reports` (21:00 IST)
   - `*/10 * * * *` → `/api/cron/run-jobs` (the job worker)
   - `0 * * * *` → `/api/cron/retry-deliveries`
   - `15 */6 * * *` → `/api/cron/sync-connectors`
4. **Verify the schedule after deploying**, which the brief asks for
   explicitly:

```bash
# Should refuse without the secret.
curl -i https://<your-app>/api/cron/daily-reports

# Generates without sending, so it is safe to run at any hour.
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-app>/api/cron/daily-reports?generateOnly=true&force=true"
```

The response reports the local time it observed, in the reporting timezone.
If that is not 21:00 at the scheduled firing, the cron expression or
`REPORT_TIMEZONE` is wrong — the route says so rather than producing reports
at the wrong hour.

Vercel's Hobby plan runs cron jobs once a day and does not guarantee the
minute. The hourly retry sweep and the 6-hourly connector sync need a paid
plan; without it, a delivery that failed at 21:00 retries at the next daily
run, and connectors sync once a day. Internal records do not depend on that
schedule — they are indexed inline as they are written, and the sweep only
catches up anything a failed inline write missed.

## Security

- Row level security on all 29 tables, with workspace membership as the
  boundary. Verified by integration tests using real user sessions.
- Team membership grants **no** access to anyone's personal workspace.
- Integration credentials live in their own table with no policies, encrypted
  with AES-256-GCM before storage. The service-role key is never sent to the
  browser.
- Integrity triggers reject cross-workspace stitching and assignment to
  non-members, because RLS checks the caller's rights but not whether the ids
  in one request belong together.
- The cron endpoint uses a constant-time secret comparison; the webhook
  verifies `X-Hub-Signature-256` before reading the body.
- Retrieved documents and captured text are fenced as untrusted data, and the
  prompts state that instructions inside them are content, not commands.
- The AI surface is rate limited per user, in a table rather than in memory,
  because serverless instances share no state.
- Audit rows are written for approvals, permission changes, workspace changes,
  exports and report deliveries.

Run `npx supabase db lint` or check Supabase's advisors after any schema
change.

## Documentation

| File | Contents |
| --- | --- |
| `docs/FEATURE-MATRIX.md` | Per-feature status: tested, needs setup, or unsupported |
| `docs/INTEGRATIONS.md` | Per-provider setup, scopes and limitations |
| `docs/RESEARCH-WHATSAPP.md` | What WhatsApp can and cannot do, and why |
| `docs/LIMITATIONS.md` | Known limitations and recommended next steps |
| `docs/OPERATIONS.md` | Running the scheduled job, retries, incident steps |
| `docs/AI-PROMPTS.md` | Every prompt and output schema, and the reasoning |
