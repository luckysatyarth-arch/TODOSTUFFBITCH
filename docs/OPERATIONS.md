# Operations

## The daily report run

Vercel Cron calls `/api/cron/daily-reports` at `30 15 * * *` UTC, which is
21:00 Asia/Kolkata. IST observes no daylight saving, so the fixed UTC
expression holds all year.

The route is authenticated by `CRON_SECRET`, compared in constant time, and
accepts either `Authorization: Bearer <secret>` (what Vercel Cron sends) or
`x-cron-secret`.

### What one run does

For every workspace:

1. A personal report per member, built only from that member's own work.
2. A team report per team workspace, built from the workspace's records.
3. Delivery of each, recording the outcome per recipient.
4. A sweep of earlier failed deliveries whose backoff has elapsed.

One workspace failing does not abort the run; the error is collected and
reported in the response.

### Query parameters

| Parameter | Effect |
| --- | --- |
| `?generateOnly=true` | Generates and stores, sends nothing. Safe at any time |
| `?force=true` | Runs outside the 21:00 window |
| `?date=YYYY-MM-DD` | Re-runs a specific reporting date, for a missed day |

### Verifying after deployment

```bash
# Must refuse.
curl -i https://<your-app>/api/cron/daily-reports

# Generates without sending.
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-app>/api/cron/daily-reports?generateOnly=true&force=true"
```

The response includes `localTime` and `timezone` as the route observed them.
If `localTime` is not around 21:00 when the schedule actually fires, the cron
expression or `REPORT_TIMEZONE` is wrong. Outside the window and without
`force`, the route returns **409 with an explanation** rather than producing
reports at the wrong hour — a 409 from a manual call is correct behaviour.

## Why a duplicate run is safe

Two layers, both in the database rather than in application logic:

- **Generation** is keyed on `(workspace, scope, subject, date)` by two
  partial unique indexes. A second run for the same day updates the existing
  row, and a report already `delivered` or `delivering` is left untouched.
- **Delivery** is keyed on a SHA-256 of `(report, provider, recipient kind,
  recipient)`. A recipient already `sent`, `delivered` or `read` is skipped.

So the cron firing twice, a manual re-run and a resend click all converge on
the same outcome.

## Delivery states

| State | Means |
| --- | --- |
| `pending` | Row created, not yet attempted |
| `sent` | The provider accepted it and returned a message id |
| `delivered` | A provider status callback confirmed delivery |
| `read` | A provider status callback reported a read receipt |
| `failed` | The attempt failed; `next_retry_at` is set if worth retrying |
| `unsupported` | The destination cannot be served, with the reason stored |

`sent` and `delivered` are deliberately distinct. The application never
claims delivery itself; only an inbound status webhook sets it.

## Retries

A failure is retryable only when the provider's response suggests it might
succeed later: HTTP 429, any 5xx, or a network error. A 4xx is not retried,
because the request itself is wrong.

Backoff is `min(2^attempts, 32)` minutes, capped at 5 attempts. The hourly
sweep picks up anything due.

Retry manually from the Reports page, or:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-app>/api/cron/retry-deliveries
```

## When a report did not arrive

Work through this in order:

1. **Open the Reports page.** It shows every report, its status, and each
   delivery attempt with the provider's own error text.
2. **Status `skipped_no_data`** — nothing was sent on purpose: the workspace
   had no records that day. This is correct behaviour, not a failure.
3. **Status `unsupported`** — the destination cannot be served. The reason is
   on the row. Usually a missing number in Settings, or a group with a
   provider that cannot address groups.
4. **Status `failed`** — read the provider error. A template error means the
   24-hour window has closed and an approved template is required.
5. **No report row at all** — the cron did not run. Check the Vercel cron
   logs, then that `CRON_SECRET` matches, then call the endpoint by hand with
   `?generateOnly=true&force=true`.

## Health queries

```sql
-- Did today's run produce what it should have?
select scope, status, count(*)
from daily_reports
where report_date = (now() at time zone 'Asia/Kolkata')::date
group by scope, status;

-- Deliveries still failing.
select provider, recipient_kind, status, attempt_count, error, next_retry_at
from report_deliveries
where status = 'failed'
order by last_attempt_at desc limit 50;

-- Captures stuck mid-pipeline.
select status, count(*), min(created_at) as oldest
from captures
where status in ('pending', 'transcribing', 'extracting')
group by status;

-- Recent audit trail.
select created_at, action, entity_type, entity_id
from audit_logs order by created_at desc limit 50;
```

## Rotating secrets

| Secret | How to rotate |
| --- | --- |
| `CRON_SECRET` | Change the env var and redeploy. No stored state |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in Supabase, update the env var, redeploy |
| `CREDENTIALS_ENCRYPTION_KEY` | **Invalidates stored OAuth tokens.** Reconnect each integration afterwards. `key_version` exists on the row so a staged rotation can be implemented |
| `WHATSAPP_META_ACCESS_TOKEN` | Regenerate the System User token, update, redeploy |
| `WHATSAPP_APP_SECRET` | Update the env var and redeploy; inbound webhooks fail signature verification until it matches |

## Backups

Supabase takes automatic backups on paid plans. On the free plan, export
regularly:

```bash
npx supabase db dump -f backup-$(date +%F).sql
```

Storage buckets (`captures`, `attachments`) are **not** included in a database
dump and need separate backup if the original recordings matter.
