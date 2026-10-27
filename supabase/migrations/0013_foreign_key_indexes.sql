-- Covering indexes for the foreign keys that lacked one.
--
-- From Supabase's performance linter run against the deployed schema.
--
-- Split from the policy change (0014) deliberately: this half is purely
-- additive and applies without confirmation, while dropping and recreating a
-- policy is a destructive statement that needs one. Keeping them apart means
-- the indexes are not held up waiting for that approval.

-- ---------------------------------------------------------------------------
-- Why this matters
-- ---------------------------------------------------------------------------
--
-- An unindexed foreign key costs most on DELETE of the *parent*: PostgreSQL
-- has to scan the child table to enforce the cascade or set-null, with no
-- index to use. Every parent here gets deleted in normal use -- a profile when
-- an account is removed, a workspace or project when it is deleted, a task
-- routinely, an integration on disconnect-and-purge -- so each of these is a
-- sequential scan waiting to happen on a table that will not stay small.
--
-- The read side is a bonus rather than the reason: several of these columns
-- are filtered directly (notes and events by project, reports by subject,
-- integrations by owner).

create index if not exists calendar_events_created_by_idx on public.calendar_events (created_by);
create index if not exists calendar_events_project_idx on public.calendar_events (project_id);
create index if not exists daily_reports_subject_idx on public.daily_reports (subject_user_id);
create index if not exists indexed_documents_integration_idx on public.indexed_documents (integration_id);
create index if not exists integrations_owner_fk_idx on public.integrations (owner_id);
create index if not exists notes_author_idx on public.notes (author_id);
create index if not exists notes_project_idx on public.notes (project_id);
create index if not exists notifications_workspace_idx on public.notifications (workspace_id);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists proposed_tasks_decided_by_idx on public.proposed_tasks (decided_by);
create index if not exists proposed_tasks_duplicate_of_idx on public.proposed_tasks (duplicate_of_task_id);
create index if not exists proposed_tasks_suggested_assignee_idx on public.proposed_tasks (suggested_assignee_id);
create index if not exists proposed_tasks_suggested_project_idx on public.proposed_tasks (suggested_project_id);
create index if not exists task_activity_actor_idx on public.task_activity (actor_id);
create index if not exists task_attachments_uploaded_by_idx on public.task_attachments (uploaded_by);
create index if not exists task_attachments_workspace_idx on public.task_attachments (workspace_id);
create index if not exists task_comments_author_idx on public.task_comments (author_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists workspace_invitations_accepted_by_idx on public.workspace_invitations (accepted_by);
create index if not exists workspace_invitations_invited_by_idx on public.workspace_invitations (invited_by);

-- The 48 indexes the linter reports as unused are unused because this schema
-- is new and almost nothing has queried it yet. They are not dropped on that
-- evidence; "never used" after a day is not the same as unnecessary.
