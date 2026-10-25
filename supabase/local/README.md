# Local schema verification

`npm run db:verify` applies the real migrations to a throwaway PostgreSQL 16
cluster and runs the authorization checks against it.

```bash
npm run db:verify            # apply, check, tear down
KEEP=1 npm run db:verify     # leave the cluster up afterwards

psql -h /var/run/postgresql -p 5433 -U postgres -d verify
```

It needs no hosted project, no service-role key and no network, which is why
it exists: the authorization rules in this application are RLS policies, and a
policy is only worth as much as its last execution. Reading one tells you what
it was meant to do.

## What is in here

| File | |
| --- | --- |
| `00_bootstrap.sql` | The Supabase-managed objects the migrations depend on — the three roles, `auth.users`, `auth.uid()`, and the `storage` schema — recreated locally. Not part of the deployed schema |
| `01_verify_search.sql` | Internal search: that it returns indexed rows at all, and that the `owner_only` flag and workspace membership are both enforced inside the query |
| `02_verify_invariants.sql` | The rules the brief states as absolute: completion cannot be forged, approval is required and happens at most once, one report per scope per date, and personal data stays private from teammates and admins |
| `03_verify_recurrence.sql` | Recurrence: the rule shape the column accepts, the date arithmetic (including the anchoring that stops a monthly 31st drifting to the 28th), and that a series advances only on an explicit completion |
| `04_verify_jobs.sql` | The job queue: idempotent enqueue, atomic claiming, backoff, dead-lettering, stale-lock reclaim, and that every queue function is refused to `anon` and `authenticated` |

Each check file runs inside a transaction that rolls back, so the cluster is
left as the migrations made it.

## How the checks are written

Two rules, because they are what separate a test from a reassuring noise:

**Everything runs as `authenticated`, with JWT claims set.** A superuser or a
table owner bypasses RLS entirely. A check that forgot to switch role would
pass against any set of policies, including none at all. `00_bootstrap.sql`
defines `auth.uid()` to read the same `request.jwt.claim.sub` setting the
Supabase API gateway populates, so a policy sees exactly what it sees in
production.

**Every "cannot see it" check is paired with someone who can.** An index that
returned nothing to anybody, or a table that was simply empty, would satisfy a
privacy assertion while the feature was broken. So Bob not seeing Alice's mail
is asserted next to Alice seeing it, and the credential tables are populated
before being read back as zero rows.

The negative control for the whole approach: as the table owner, with RLS
bypassed, the team search returns both documents; as Bob, it returns one. The
policy is doing the work, not the query.

## What this does not cover

The provider adapters. Those need real OAuth clients and live accounts, and no
amount of local SQL will tell you whether Gmail's API returns what the adapter
expects. See `docs/LIMITATIONS.md`.
