-- 0003: projects, tasks and everything hanging off a task.

create table if not exists public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  description text,
  owner_id uuid references public.profiles (id) on delete set null,
  status public.project_status not null default 'planning',
  priority public.priority_level not null default 'medium',
  start_date date,
  target_date date,
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_date_order check (start_date is null or target_date is null or start_date <= target_date)
);
create index if not exists projects_workspace_idx on public.projects (workspace_id);
create index if not exists projects_workspace_status_idx on public.projects (workspace_id, status);
create index if not exists projects_owner_idx on public.projects (owner_id);

create table if not exists public.project_members (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'contributor',
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

-- Tasks are the system of record for completion. Nothing infers completion:
-- `completed_at` is only set by the status transition trigger below.
create table if not exists public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  -- Self-reference gives us subtasks without a second table.
  parent_task_id uuid references public.tasks (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 500),
  description text,
  status public.task_status not null default 'todo',
  priority public.priority_level not null default 'medium',
  assignee_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  -- Dates, not timestamps: a task due "Friday" is an all-day obligation and
  -- must not drift across the date line when rendered in another zone.
  start_date date,
  due_date date,
  -- Set only when a specific clock time genuinely matters.
  due_at timestamptz,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  actual_minutes integer check (actual_minutes is null or actual_minutes >= 0),
  tags text[] not null default '{}',
  recurrence jsonb,
  -- Fractional so a card can be dropped between two others without a rewrite.
  board_position numeric not null default 0,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_no_self_parent check (parent_task_id is null or parent_task_id <> id),
  constraint tasks_completed_at_matches_status
    check ((status = 'completed') = (completed_at is not null)),
  constraint tasks_date_order check (start_date is null or due_date is null or start_date <= due_date)
);
create index if not exists tasks_workspace_idx on public.tasks (workspace_id);
create index if not exists tasks_workspace_status_idx on public.tasks (workspace_id, status);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_due_date_idx on public.tasks (due_date);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_parent_idx on public.tasks (parent_task_id);
-- Drives "my open work due by date", the hottest dashboard and report query.
create index if not exists tasks_workspace_assignee_due_idx
  on public.tasks (workspace_id, assignee_id, due_date)
  where status not in ('completed', 'cancelled');
create index if not exists tasks_tags_idx on public.tasks using gin (tags);

create table if not exists public.task_dependencies (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  constraint task_dependencies_no_self check (task_id <> depends_on_task_id)
);
create index if not exists task_dependencies_depends_idx on public.task_dependencies (depends_on_task_id);

create table if not exists public.task_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

-- Append-only audit of task change. Written by trigger, never by the client.
create table if not exists public.task_activity (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  field text,
  from_value jsonb,
  to_value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists task_activity_task_idx on public.task_activity (task_id, created_at desc);

create table if not exists public.milestones (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  description text,
  due_date date,
  status public.milestone_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint milestones_completed_at_matches_status
    check ((status = 'completed') = (completed_at is not null))
);
create index if not exists milestones_project_idx on public.milestones (project_id, due_date);
create index if not exists milestones_workspace_due_idx on public.milestones (workspace_id, due_date);

-- All-day and timestamped events are stored in different columns rather than
-- collapsed into one, so an all-day event never shifts date by timezone.
create table if not exists public.calendar_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 300),
  description text,
  location text,
  is_all_day boolean not null default false,
  start_date date,
  end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  source text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_shape check (
    (is_all_day and start_date is not null and starts_at is null)
    or (not is_all_day and starts_at is not null and start_date is null)
  ),
  constraint calendar_events_all_day_order
    check (end_date is null or start_date is null or start_date <= end_date),
  constraint calendar_events_timed_order
    check (ends_at is null or starts_at is null or starts_at <= ends_at)
);
create index if not exists calendar_events_workspace_start_idx
  on public.calendar_events (workspace_id, start_date, starts_at);
create unique index if not exists calendar_events_external_unique
  on public.calendar_events (workspace_id, source, external_id)
  where external_id is not null;

create table if not exists public.notes (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  author_id uuid references public.profiles (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 300),
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_workspace_idx on public.notes (workspace_id, updated_at desc);

create or replace trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();
create or replace trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();
create or replace trigger task_comments_touch before update on public.task_comments
  for each row execute function app.touch_updated_at();
create or replace trigger milestones_touch before update on public.milestones
  for each row execute function app.touch_updated_at();
create or replace trigger calendar_events_touch before update on public.calendar_events
  for each row execute function app.touch_updated_at();
create or replace trigger notes_touch before update on public.notes
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Completion is a status transition, enforced in the database.
--
-- The brief is explicit that a task is complete only when its status is set to
-- Completed, and that nothing may infer completion from a passing deadline or
-- an AI summary. Keeping completed_at in a trigger (plus the CHECK above) means
-- no code path -- app, script or future job -- can set one without the other.
-- ---------------------------------------------------------------------------

create or replace function app.sync_task_completion()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- OLD is unassigned during INSERT, so the two operations are handled apart
  -- rather than reading old.status behind a coalesce.
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'completed'
      then coalesce(new.completed_at, now()) end;
    new.cancelled_at := case when new.status = 'cancelled'
      then coalesce(new.cancelled_at, now()) end;
    return new;
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  elsif new.status <> 'cancelled' then
    new.cancelled_at := null;
  end if;

  return new;
end;
$$;

create or replace trigger tasks_sync_completion before insert or update on public.tasks
  for each row execute function app.sync_task_completion();

create or replace function app.log_task_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_activity (task_id, actor_id, action, to_value)
    values (new.id, auth.uid(), 'created', jsonb_build_object('title', new.title, 'status', new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_activity (task_id, actor_id, action, field, from_value, to_value)
    values (new.id, auth.uid(), 'status_changed', 'status',
            to_jsonb(old.status), to_jsonb(new.status));
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.task_activity (task_id, actor_id, action, field, from_value, to_value)
    values (new.id, auth.uid(), 'assignee_changed', 'assignee_id',
            to_jsonb(old.assignee_id), to_jsonb(new.assignee_id));
  end if;

  if new.priority is distinct from old.priority then
    insert into public.task_activity (task_id, actor_id, action, field, from_value, to_value)
    values (new.id, auth.uid(), 'priority_changed', 'priority',
            to_jsonb(old.priority), to_jsonb(new.priority));
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.task_activity (task_id, actor_id, action, field, from_value, to_value)
    values (new.id, auth.uid(), 'due_date_changed', 'due_date',
            to_jsonb(old.due_date), to_jsonb(new.due_date));
  end if;

  return new;
end;
$$;

create or replace trigger tasks_log_activity after insert or update on public.tasks
  for each row execute function app.log_task_activity();
