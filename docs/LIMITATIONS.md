# Known limitations and recommended next steps

Written to be useful rather than reassuring. Everything here is either a real
constraint of an external platform, or a deliberate scope decision — not a
list of things that quietly do not work.

## Read this first: migrations 0010 and 0011 are not applied to the hosted project

Migrations 0001–0009 were applied to the Supabase project this was developed
against. **0010 (recurrence) and 0011 (the job queue) have not been**, because
access to that project was withdrawn from the environment the work was done in
before they could be run.

Both are verified — they apply cleanly to a stock PostgreSQL 16 and pass 70 SQL
checks under `npm run db:verify` — but on the hosted database the recurrence
column still has no CHECK, no `recurrence_spawned_task_id` and no trigger, and
the queue functions do not exist, so completing a recurring task there does
nothing and the worker route returns an error. Apply them before relying on
either:

```bash
DATABASE_URL='postgresql://...' npm run db:push
```

`src/lib/supabase/database.types.ts` carries a hand-added column and five
hand-added function signatures for the same reason; regenerating the types
after applying both produces the same file.

## Hard limitations, imposed by external platforms

### Personal WhatsApp inbox access is impossible

No official Meta or Twilio API exposes an ordinary personal WhatsApp
account's messages. This is a property of the platform, not a missing
endpoint. Vendors who sell it drive WhatsApp Web with unofficial automation,
which the brief rules out as a production dependency and which risks the
account being banned.

**What we do instead:** the user forwards chosen messages to the business
number, and they arrive by webhook as captures. This also satisfies the
requirement that the user selects what is ingested rather than whole
conversations being swept up.

### WhatsApp group delivery is capped at 8 participants

Meta's Cloud API Groups capability requires an Official Business Account and
limits a group to 8 participants including the business number — so 7 people.
Twilio has no group sending at all.

**Consequence:** group delivery of the team report is genuinely available for
a team of 7 or fewer. Beyond that the application fans the report out to
members' individual numbers and says so on the Reports page. It never
silently substitutes a different recipient.

**Verification still owed:** `developers.facebook.com` was blocked by the
build environment's network policy, so these limits are corroborated across
multiple independent third-party sources but were **not** read from Meta's
own documentation. Confirm the participant cap and the eligibility gate
before enabling group delivery in production. The code reads the limits from
a capability descriptor, so correcting them is a one-line change in the
adapter rather than a refactor.

### Business-initiated messages need an approved template

Outside a 24-hour customer-service window, WhatsApp requires a pre-approved
template. The 21:00 report is business-initiated, so a production deployment
must register a template. The current adapter sends a text message, which
works inside the window and in testing. `WHATSAPP_META_TEMPLATE_NAME` is
already plumbed through; switching the send is a small change in
`src/server/connectors/whatsapp/meta.ts`.

### Teams message access needs tenant admin consent

`ChannelMessage.Read.All` cannot be granted by a user. Private channels are
inaccessible under delegated permissions at all, and history beyond the
tenant retention policy is not retrievable. The connector reports an explicit
403 rather than appearing to find nothing.

### Notion has no incremental sync

Notion's search endpoint exposes no delta cursor, so each sync re-reads the
shared set. For a large Notion workspace this is slow and worth replacing with
per-database queries filtered on `last_edited_time`.

## Deliberate scope decisions

### Connector content depth

Drive indexes file metadata, not document text. Gmail and Graph index headers
and a snippet, not full bodies. Notion indexes titles and properties, not
block bodies. This keeps the index small and the sync fast, and means search
finds documents reliably by name and context but not by a phrase buried
inside one.

**Next step:** add a per-source content fetch behind a "deep indexing"
setting, and chunk the result through the existing `indexDocuments` path,
which already handles chunking and embedding.

### The queue runs three job types, and transcription is not one of them

`/api/cron/run-jobs` claims from `job_runs` every ten minutes and runs
connector syncs, workspace re-indexing and delivery retries. Claiming is
atomic (`for update skip locked`), attempts are counted, backoff is capped
exponential and a job that exhausts its attempts becomes `dead` rather than
looping.

What is not on it yet is transcription and embedding generation, which still
run inline in the request that triggers them. Audio uploads straight to
storage, so a long recording does not hold a request open — but a slow
transcription does. Both need provider credentials before the move is worth
making, since neither does anything without them.

**Next step:** add `transcribe_capture` and `embed_documents` handlers to
`src/server/services/jobs.ts` and enqueue from the capture path instead of
awaiting. The handlers are already separate functions that take a client, so
they move unchanged.

One operational note: the worker returns 200 even when individual jobs failed.
The request did its work, and each failure is recorded on its own row with its
attempt count. Failing the response would make the scheduler retry the whole
batch and double-count attempts against the jobs that succeeded. Watch the
`dead` count in the response, not the status code — that is the number that
have given up and need a person.

### Integration tests still need a hosted project, but the schema does not

`npm run db:verify` applies the migrations to a throwaway local PostgreSQL
cluster and runs the authorization checks against it, as the `authenticated`
role with RLS enforced. That covers internal search retrieval, the
`owner_only` boundary, forged completion, approval idempotency, report
uniqueness and the deny-all credential tables — 45 assertions, no network and
no service-role key. See `supabase/local/README.md`.

What it does not cover is the application code path: the Vitest integration
tests exercise the server actions through a real Supabase client, and those
still need a hosted project and `SUPABASE_SERVICE_ROLE_KEY` (they create and
delete confirmed users, which only the service role can do). They skip
themselves when it is absent rather than passing vacuously — so a CI pipeline
that supplies neither the key nor `npm run db:verify` is not exercising the
authorization boundary at all. `db:verify` needs no credentials, so it is the
one to put in CI first.

The local harness also cannot say anything about the provider adapters, which
need real OAuth clients and live accounts.

### Recurrence covers four frequencies, not all of RFC 5545

Daily, weekly (optionally on named weekdays), monthly and yearly, each with an
interval, and an end date or a count. That covers the ordinary cases. It is not
a full RRULE implementation: there is no "last Friday of the month", no
"third Tuesday", no multiple rules on one task and no per-occurrence
exceptions.

A series also advances one step at a time, when an occurrence is explicitly
completed, rather than being expanded into a year of rows upfront. That keeps
it inside the rule that completion is never inferred, and it means a future
occurrence does not exist to be rescheduled in advance. Editing the rule
re-anchors the series on the current task's due date.

One interaction worth knowing: a weekly rule with named weekdays and an
interval above one steps whole weeks from the week the series started, so
"every second Tuesday and Thursday" skips a full week rather than alternating
between the two days.

**Next step:** if "last working day of the month" is needed -- a common one
for reporting tasks -- add a `setpos` field to the rule rather than widening
`freq`.

### The authenticated screens are not covered by an automated test run here

The e2e suite has 20 passing tests (the login gate, every protected route,
the generic failure message, accessibility and phone-width layout) and 9 that
sign in first. Those 9 skip without a seeded database, and they skipped on
every run during this work: the hosted project became unreachable, and a local
Supabase stack could not be started because this environment caps registry
data transfer, so its images cannot be pulled.

What that leaves unverified is whether the signed-in screens render against
real rows and whether the server actions round-trip. The type checker, the
production build and 122 unit tests cover a good deal of it, and the 88 SQL
checks cover the authorization rules underneath. The gap is the rendering and
the round trip, and it is a real gap.

To close it: `npm run db:seed` with a service-role key, then
`npx playwright test`. The specs are written, including for the calendar
layouts; they need only a database to run against.

### No OAuth sign-in

Email and password only. Supabase supports Google and Microsoft sign-in with
no schema change; it was not wired up.

### Account deletion is an administrator action

Deleting a user cascades to their personal workspace, every task in it, and
every capture and recording they own. A self-service button for something
irreversible and that broad did not seem right without a confirmation flow and
a grace period. Settings documents the path instead.

### Report delivery is WhatsApp only

The delivery layer is adapter-based and the `report_deliveries` table carries
a `channel` column, so email or Slack would be an additional adapter rather
than a rework. Only WhatsApp adapters exist.

## Operational notes

### Vercel Hobby limits the schedule

Hobby plans run cron jobs once per day and do not guarantee the minute. The
hourly retry sweep needs a paid plan. Without it, a delivery that fails at
21:00 retries at the next daily run. The route tolerates an hour of drift and
reports the local time it actually observed.

### Rate limiting fails open

If `SUPABASE_SERVICE_ROLE_KEY` is absent, the rate limiter allows the request
rather than refusing every AI call. The AI surface is already behind
authentication, so this is the safer failure mode — but a deployment that
wants a hard ceiling must set the service role key.

### Dashboards compute in application code

The dashboards fetch up to 2000 task rows and aggregate in TypeScript. That is
fine for a workspace of normal size and keeps the definitions of "overdue" and
"remaining" identical to the reports. For a very large workspace, move the
counts into SQL views alongside `project_progress`.

## Recommended order of work from here

1. **Register the WhatsApp template** and verify the group limits against
   Meta's documentation. These are the only things standing between the
   reporting pipeline and live production delivery.
2. **Move transcription and embedding onto the queue**, which the worker now
   exists to run; they need provider credentials first.
3. **Deepen connector indexing** behind a setting, starting with Drive
   document export, which is the most valuable and the best documented.
4. **Add `setpos` to the recurrence rule** for "last working day of the
   month", which reporting tasks want and the current four frequencies cannot
   express.
5. **Move dashboard aggregation into SQL** once a workspace outgrows a couple
   of thousand tasks.
6. **Seed a database and run the signed-in e2e specs**, which are written and
   currently skip.
