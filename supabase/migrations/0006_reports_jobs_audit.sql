-- 0006: notifications, the daily report pipeline, the durable job queue and
-- the audit trail.

create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- One row per (scope, subject, date). Generation is separate from delivery so
-- a failed send can be retried without recomputing, and so a report can be
-- previewed before anything is sent.
create table if not exists public.daily_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  scope public.report_scope not null,
  -- Set for a personal report, null for a team report.
  subject_user_id uuid references public.profiles (id) on delete cascade,
  -- The calendar date in `timezone` that the report covers, not the instant it
  -- was produced. This is what makes "one report per recipient per day" a
  -- statement the database can enforce.
  report_date date not null,
  timezone text not null default 'Asia/Kolkata',
  status public.report_status not null default 'pending',
  -- Structured counts and record references, assembled from task rows by
  -- deterministic SQL. The narrative is rendered from this, so the numbers in
  -- a report cannot be model output.
  content jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  rendered_text text,
  generated_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_reports_scope_subject check (
    (scope = 'personal' and subject_user_id is not null)
    or (scope = 'team' and subject_user_id is null)
  )
);
-- Acceptance criterion 17: two cron firings for the same date cannot produce
-- two reports. Two partial indexes because NULL subject_user_id would
-- otherwise defeat a single unique constraint.
create unique index if not exists daily_reports_personal_unique
  on public.daily_reports (workspace_id, subject_user_id, report_date)
  where scope = 'personal';
create unique index if not exists daily_reports_team_unique
  on public.daily_reports (workspace_id, report_date)
  where scope = 'team';
create index if not exists daily_reports_date_idx on public.daily_reports (report_date desc);
create index if not exists daily_reports_status_idx on public.daily_reports (status);

create table if not exists public.report_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  daily_report_id uuid not null references public.daily_reports (id) on delete cascade,
  channel text not null default 'whatsapp',
  provider text not null,
  recipient_kind text not null check (recipient_kind in ('personal', 'group', 'member_fanout')),
  -- Stored as given to the provider, so a delivery can be traced to an actual
  -- destination rather than an inferred one.
  recipient text not null,
  status public.delivery_status not null default 'pending',
  provider_message_id text,
  -- Raw provider status string, kept so 'delivered' is only ever claimed
  -- because a provider said so.
  provider_status text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  error text,
  -- Deterministic from (report, recipient, provider). A retried send reuses
  -- the row instead of creating a second delivery.
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists report_deliveries_report_idx on public.report_deliveries (daily_report_id);
create index if not exists report_deliveries_status_idx on public.report_deliveries (status);
create index if not exists report_deliveries_retry_idx
  on public.report_deliveries (next_retry_at) where status = 'failed';
create index if not exists report_deliveries_provider_message_idx
  on public.report_deliveries (provider_message_id) where provider_message_id is not null;

-- Durable work queue. Transcription, embedding, syncing and report generation
-- all run through here rather than inside a request, so a slow provider cannot
-- hold a UI response open and a crashed worker loses nothing.
create table if not exists public.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_type text not null,
  status public.job_status not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  -- Set when a worker claims the job; a stale lock is reclaimable, which is
  -- how a deployment restart mid-job recovers.
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_runs_claimable_idx
  on public.job_runs (job_type, run_after) where status = 'queued';
create index if not exists job_runs_locked_idx on public.job_runs (locked_at) where status = 'running';

create table if not exists public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_workspace_idx on public.audit_logs (workspace_id, created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- Fixed-window counters for the AI and search endpoints. A table rather than
-- in-process memory because serverless instances share no state.
create table if not exists public.rate_limit_counters (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_limit_counters_window_idx on public.rate_limit_counters (window_start);

create or replace trigger daily_reports_touch before update on public.daily_reports
  for each row execute function app.touch_updated_at();
create or replace trigger report_deliveries_touch before update on public.report_deliveries
  for each row execute function app.touch_updated_at();
create or replace trigger job_runs_touch before update on public.job_runs
  for each row execute function app.touch_updated_at();
