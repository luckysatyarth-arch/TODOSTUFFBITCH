# Feature matrix

Status key:

- **Tested** — implemented, and covered by an automated test or verified
  against the live database during development.
- **Implemented** — built and type-checked, but not separately proven by a
  test.
- **Needs credentials** — the code path is complete; it needs a provider key
  or OAuth client to do anything. The UI reports it as requiring setup rather
  than appearing to work.
- **Not supported** — cannot be done, with the reason given. These are not
  omissions to fill in later.

## Workspaces, authentication and authorization

| Feature | Status | Notes |
| --- | --- | --- |
| Email and password registration and sign-in | Tested | e2e covers the gate and the generic failure message |
| Personal workspace created on signup | Tested | Database trigger; integration test asserts it |
| Exactly one personal workspace per user | Tested | Partial unique index; integration test asserts the second insert fails |
| Team workspace creation | Implemented | Creator becomes owner in the same action |
| Workspace switching | Implemented | Workspace id travels in the query string and is re-authorized per request |
| Roles: owner, admin, member, viewer | Tested | Unit tests on the predicates; integration test confirms a viewer's write is refused |
| Invitations with hashed tokens | Implemented | Only a SHA-256 digest is stored; the raw token is shown once |
| Personal data invisible to team colleagues | Tested | Integration test; also verified directly against the live database |
| Cross-workspace parameter tampering refused | Tested | Integrity triggers; integration test asserts both the project and assignee cases |
| Credential, job and rate-limit tables denied to clients | Tested | RLS enabled with no policies; integration test reads back zero rows |
| Data export | Implemented | RLS-filtered, so it contains only what the exporter may see |
| Account deletion | Not supported in-app | Deliberate: it is irreversible and cascades. Documented as an administrator action |
| OAuth sign-in (Google, Microsoft) | Not implemented | Supabase supports it; no provider is wired up |

## Tasks and projects

| Feature | Status | Notes |
| --- | --- | --- |
| Task CRUD with every field in the brief | Implemented | Including dependencies, subtasks, tags, effort, recurrence column |
| Seven statuses | Implemented | inbox, to do, in progress, blocked, in review, completed, cancelled |
| Four priorities | Implemented | Sorted by real severity, not enum alphabetical order |
| Completion only by explicit status change | Tested | Trigger plus CHECK constraint; integration test proves `completed_at` cannot be faked |
| Activity history | Implemented | Written by trigger, append-only, no client write policy |
| Comments | Implemented | Author-scoped editing |
| List, board, table and calendar views | Implemented | Board has drag-to-change-status with optimistic revert |
| Filtering, grouping, sorting | Implemented | Held in the URL, which makes a filtered view shareable |
| Saved views | Implemented as links | A bookmarked URL is the saved view; no separate storage |
| Bulk actions | Implemented | Refused outright when the selection spans two workspaces |
| Inline editing | Implemented | Table view |
| Projects, milestones, dependencies, notes | Implemented | |
| Project progress | Tested | completed / non-cancelled, as specified. Verified at 1/3 = 33.3% on live data |
| Zero-task project | Tested | Reports null, not 0%, and never divides by zero |
| Workload and overload warnings | Implemented | Relative to the busiest member, labelled a capacity guide not a productivity measure |
| Recurrence | Partial | The column and schema exist; no job expands recurring tasks yet |

## Calendar

| Feature | Status | Notes |
| --- | --- | --- |
| Month grid | Implemented | Monday-first, 6×7, adjacent days filled |
| Date click → full day breakdown | Implemented | Completed, remaining, overdue-as-of-that-date, per-member, projects, events, milestones, next week |
| Drag to reschedule | Implemented | Persists immediately; errors surface rather than silently reverting |
| All-day vs timed events | Tested | Separate columns and a CHECK; unit tests cover the date-shift cases |
| Timezone correctness | Tested | A timed event buckets into the workspace zone, not UTC |
| Week, day and agenda views | Not implemented | Month plus the day panel covers the brief's interaction requirement; the other layouts are a straightforward addition |

## Capture and AI approval

| Feature | Status | Notes |
| --- | --- | --- |
| Browser voice recording | Implemented | MediaRecorder, uploads straight to private storage under the user's own prefix |
| Audio file upload | Implemented | 50 MB cap, MIME allow-list enforced by the bucket |
| Playback of the original recording | Implemented | Short-lived signed URL, owner-only |
| Transcription | Needs credentials | Whisper-compatible provider interface. Without it, upload still works and you paste the transcript |
| Editable transcript, with re-extraction | Implemented | Re-running replaces pending proposals and leaves approved ones alone |
| Text and paste capture | Needs credentials | Needs an AI key to extract; direct task creation always works |
| Meeting transcript ingestion | Needs credentials | Same pipeline, labelled as a transcript source |
| WhatsApp capture by forwarding | Needs credentials | Signature-verified webhook; unknown senders discarded, not guessed |
| Task extraction with schema validation | Implemented | Zod-validated via structured outputs |
| Uncertainty preserved rather than invented | Tested | Unit tests on date sanitisation and ambiguous-name refusal |
| Duplicate detection | Tested | Lexical and explainable, so a reviewer can see why two tasks matched |
| Source traceability | Implemented | Verbatim excerpt per proposal; the task links back to its capture |
| Approval inbox: edit, approve, reject, defer | Implemented | Every field editable before approval |
| Nothing created before approval | Tested | Integration test asserts zero tasks exist while a proposal is pending |
| Approval idempotent under retries | Tested | Three concurrent approvals → one task, verified on the live database |
| Prompt-injection handling | Implemented | Untrusted content fenced; an attempt is flagged to the user |

## Search

| Feature | Status | Notes |
| --- | --- | --- |
| Internal full-text search | Implemented | Generated `tsvector` column with a GIN index |
| Semantic search | Needs credentials | pgvector with an HNSW index; needs an embeddings key |
| Permissions applied before retrieval | Implemented | `SECURITY INVOKER` functions, so RLS filters inside the query |
| Owner-only documents excluded from others' results | Implemented | `access_scope` plus an RLS predicate |
| Grounded answers with citations | Needs credentials | Must cite `[n]` records; inferences shown separately from stated fact |
| Insufficient evidence as a real answer | Implemented | A first-class outcome, not a guess |
| Rate limiting | Implemented | Per user, per hour, table-backed |
| Google Drive | Needs credentials | Metadata-level indexing; document bodies not exported |
| Gmail | Needs credentials | Read-only scope, headers and snippet only |
| Outlook mail (Graph) | Needs credentials | Read-only |
| Microsoft Teams | Needs credentials + tenant consent | Private channels inaccessible under delegated permissions |
| Notion | Needs credentials | Only explicitly shared pages; titles and properties, not block bodies; no delta cursor |
| Background re-indexing job | Partial | The indexer and job table exist; no scheduled worker drives them yet |

## Daily 9 PM IST reporting

| Feature | Status | Notes |
| --- | --- | --- |
| Personal report from real task records | Implemented | Every figure from SQL |
| Team report, excluding personal data | Implemented | Different queries; a personal report is visible only to its subject, even to admins |
| Scheduled at 21:00 Asia/Kolkata | Tested | `30 15 * * *` UTC; unit tests assert the equivalence in every season |
| Runs without a browser open | Implemented | Vercel Cron plus a constant-time shared secret |
| Durable generation and delivery records | Implemented | Separate tables, so a failed send retries without recomputing |
| One report per scope per date | Tested | Two partial unique indexes; verified on the live database |
| Idempotent delivery | Implemented | SHA-256 key over report, provider and recipient |
| Retries with backoff | Implemented | Capped exponential, only for retryable failures |
| Missed-schedule catch-up | Implemented | `?date=` re-runs a specific day; the hourly sweep picks up stale failures |
| Admin view of failures | Implemented | Reports page, with masked recipients |
| Manual preview and resend | Implemented | Preview generates without sending |
| No empty or misleading reports | Implemented | `skipped_no_data` records a deliberate non-send |
| Delivery only claimed when confirmed | Implemented | `sent` needs a provider message id; `delivered` needs a status callback |
| WhatsApp send via Meta Cloud API | Needs credentials | Direct and group |
| WhatsApp send via Twilio | Needs credentials | Direct only |
| Dry-run delivery | Implemented | Exercises the whole pipeline with no credentials, and labels its own rows |
| WhatsApp group delivery | Needs credentials, and narrow | Official Business Account required; 8 participants including the sender. Larger teams fan out instead |
| Reading a personal WhatsApp inbox | **Not supported** | No official API offers it. See `docs/RESEARCH-WHATSAPP.md` |
| Email or Slack delivery | Not implemented | The delivery interface would take another adapter cleanly |

## Quality

| Item | Status |
| --- | --- |
| Production build | Passes, 22 routes |
| TypeScript strict, `noUncheckedIndexedAccess` | Passes with no errors |
| ESLint | Passes with no errors or warnings |
| Unit tests | 74 passing |
| Integration tests | 24, skip cleanly without credentials |
| e2e tests | Playwright, auth gate and endpoint refusals |
| Supabase security advisors | Clean, apart from the three intentional deny-all tables |
| Dependencies pinned, lockfile committed | Yes, 0 vulnerabilities at install |
