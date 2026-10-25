-- 0004: capture sources, transcripts, and the AI proposals awaiting approval.

-- A capture is private to its owner by default. Voice notes, forwarded
-- WhatsApp messages and meeting transcripts routinely contain material the
-- rest of a team workspace has no business reading, so RLS scopes these rows
-- to owner_id rather than to workspace membership (see 0007).
create table if not exists public.captures (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind public.capture_kind not null,
  status public.capture_status not null default 'pending',
  title text,
  -- Typed input, or the transcript once speech-to-text has run.
  raw_text text,
  -- Path inside the private `captures` storage bucket. Never a public URL.
  storage_path text,
  mime_type text,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  source_provider text,
  source_external_id text,
  source_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists captures_owner_idx on public.captures (owner_id, created_at desc);
create index if not exists captures_workspace_idx on public.captures (workspace_id, created_at desc);
create index if not exists captures_status_idx on public.captures (status);
-- Re-delivering the same WhatsApp message or e-mail must not create a second
-- capture. Scoped per provider so two providers can share an id space.
create unique index if not exists captures_source_unique
  on public.captures (source_provider, source_external_id)
  where source_external_id is not null;

create table if not exists public.transcripts (
  id uuid primary key default extensions.gen_random_uuid(),
  capture_id uuid not null unique references public.captures (id) on delete cascade,
  provider text not null,
  model text,
  language text,
  text text not null,
  -- Timed segments, kept so an extracted task can cite its moment in the audio.
  segments jsonb,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now()
);

-- Nothing here is a task. These are suggestions, and the brief requires human
-- approval before any of them becomes real work.
create table if not exists public.proposed_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  capture_id uuid not null references public.captures (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status public.proposal_status not null default 'pending',
  title text not null check (length(btrim(title)) between 1 and 500),
  description text,
  suggested_project_id uuid references public.projects (id) on delete set null,
  suggested_assignee_id uuid references public.profiles (id) on delete set null,
  suggested_due_date date,
  suggested_priority public.priority_level,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  -- Model self-report. Treated as a sort key for review, never as a licence
  -- to skip approval.
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- Field names the model flagged as guessed. The reviewer sees these marked
  -- rather than presented as fact.
  uncertain_fields text[] not null default '{}',
  extraction_notes text,
  -- Verbatim slice of the source that produced this proposal, for traceability.
  source_excerpt text,
  source_offset_seconds numeric,
  duplicate_of_task_id uuid references public.tasks (id) on delete set null,
  duplicate_similarity numeric check (duplicate_similarity is null or (duplicate_similarity >= 0 and duplicate_similarity <= 1)),
  -- Set exactly once, when approval creates the task. The unique index below
  -- is what makes approval idempotent under retries.
  created_task_id uuid references public.tasks (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An approved proposal must point at the task it created, and an unapproved
  -- one must not point at any task.
  constraint proposed_tasks_approved_has_task
    check ((status = 'approved') = (created_task_id is not null)),
  constraint proposed_tasks_decided_has_actor
    check ((status = 'pending') or (decided_at is not null))
);
create index if not exists proposed_tasks_capture_idx on public.proposed_tasks (capture_id);
create index if not exists proposed_tasks_workspace_status_idx
  on public.proposed_tasks (workspace_id, status, created_at desc);
-- Acceptance criterion 9: a repeated approval request, a double-click or a
-- retried job cannot produce a second task from one proposal.
create unique index if not exists proposed_tasks_one_task_each
  on public.proposed_tasks (created_task_id) where created_task_id is not null;

-- Deferred until now because captures is defined in this migration: a task
-- remembers which capture proposed it, so the UI can link back to the source.
alter table public.tasks
  add column if not exists source_capture_id uuid references public.captures (id) on delete set null;
create index if not exists tasks_source_capture_idx on public.tasks (source_capture_id);

create table if not exists public.task_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id);

create or replace trigger captures_touch before update on public.captures
  for each row execute function app.touch_updated_at();
create or replace trigger proposed_tasks_touch before update on public.proposed_tasks
  for each row execute function app.touch_updated_at();
