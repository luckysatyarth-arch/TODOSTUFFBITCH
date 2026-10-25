# Known limitations and recommended next steps

Written to be useful rather than reassuring. Everything here is either a real
constraint of an external platform, or a deliberate scope decision — not a
list of things that quietly do not work.

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

### No general worker drives the job queue

`job_runs` exists with claim, retry and lock semantics, and three crons use the
same durable-record pattern: report generation, delivery retries, and connector
sync plus re-indexing. What is still missing is a *general* worker that polls
the queue, so transcription and extraction run inline in the request that
triggers them. Audio is uploaded directly to storage, so a long recording does
not hold a request open — but a slow transcription does.

**Next step:** add `/api/cron/run-jobs`, claim with `FOR UPDATE SKIP LOCKED`,
and move transcription and embedding onto it. The handlers are already separate
functions that take a client, so they can be called from a worker unchanged.

### Internal search retrieval has not been run against a populated index

Tasks, projects and notes are written into `indexed_documents` inline on every
create, update and delete, and swept again by the 6-hourly cron. The query side
— `search_documents_fts` returning those rows, and an `owner_only` document
staying out of another member's results — was verified by reading the policies
and the function definitions, but not by executing a search against a populated
index: database access was withdrawn from this environment before that check
could be run.

The authorization properties it would confirm *are* covered elsewhere: the
integration tests assert that one member cannot read another's personal
records, and the search function is `SECURITY INVOKER`, so it is the same RLS
predicate doing the work in both cases. Treat the retrieval path itself as
unverified until a search has been run against real indexed rows.

**Next step:** create a task in each of two workspaces, run the search as each
member, and confirm both the hits and the absence of the other member's rows.

### Recurring tasks are modelled but not expanded

`tasks.recurrence` is a JSONB column and nothing reads it. A recurring task
does not yet generate its next instance on completion.

**Next step:** expand on completion in the status trigger, or in a nightly
job; the latter is easier to reason about and to test.

### Calendar has month and day views only

The brief asks for month, week, day and agenda. The month grid plus the day
breakdown panel covers the interaction the acceptance criteria describe
(clicking a date shows completed, remaining, overdue and upcoming work). Week
and agenda layouts are presentation over the same `getCalendarMonth` data.

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

### Integration tests need the service role key

They create and delete confirmed users, which only the service role can do.
They skip with a clear message when the key is absent, so `npm test` stays
green — but a CI pipeline that does not supply it is not exercising the
authorization boundary.

## Recommended order of work from here

1. **Register the WhatsApp template** and verify the group limits against
   Meta's documentation. These are the only things standing between the
   reporting pipeline and live production delivery.
2. **Run the internal search path once against a populated index**, which is
   the one acceptance criterion that was implemented but never executed.
3. **Add the general job worker.** Connector sync and re-indexing are now on a
   cron; the worker is what remains for background transcription and
   embedding.
4. **Deepen connector indexing** behind a setting, starting with Drive
   document export, which is the most valuable and the best documented.
5. **Expand recurring tasks**, which is self-contained and well covered by the
   existing trigger tests.
6. **Move dashboard aggregation into SQL** once a workspace outgrows a couple
   of thousand tasks.
7. **Add week and agenda calendar layouts**, which need no new data.
