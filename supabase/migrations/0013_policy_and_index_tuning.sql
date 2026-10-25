-- Two findings from Supabase's performance linter against the deployed schema.
--
-- Neither changes who can see what. The policy change narrows which policies
-- run for a SELECT without altering the predicate that decides access, and the
-- RLS checks in supabase/local re-run unchanged against both.

-- ---------------------------------------------------------------------------
-- 1. One policy per action, instead of two permissive policies per SELECT
-- ---------------------------------------------------------------------------
--
-- Seven tables were given a `_select` policy plus a `_write` policy declared
-- `for all`. `for all` includes SELECT, so every read evaluated both -- the
-- membership check and the can-write check -- and a row was returned if either
-- passed. The effective permission was still the `_select` predicate, because
-- can_write implies is_member, but the database could not know that and ran
-- both.
--
-- Splitting `for all` into the three write actions leaves reads to the
-- `_select` policy alone. It is also clearer: a policy named `_write` that
-- silently governs reads is a trap for whoever edits it next.

drop policy if exists project_members_write on public.project_members;
create policy project_members_insert on public.project_members for insert to authenticated
  with check (app.can_write_workspace(app.project_workspace(project_id)));
create policy project_members_update on public.project_members for update to authenticated
  using (app.can_write_workspace(app.project_workspace(project_id)))
  with check (app.can_write_workspace(app.project_workspace(project_id)));
create policy project_members_delete on public.project_members for delete to authenticated
  using (app.can_write_workspace(app.project_workspace(project_id)));

drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_insert on public.task_dependencies for insert to authenticated
  with check (app.can_write_workspace(app.task_workspace(task_id)));
create policy task_dependencies_update on public.task_dependencies for update to authenticated
  using (app.can_write_workspace(app.task_workspace(task_id)))
  with check (app.can_write_workspace(app.task_workspace(task_id)));
create policy task_dependencies_delete on public.task_dependencies for delete to authenticated
  using (app.can_write_workspace(app.task_workspace(task_id)));

drop policy if exists task_attachments_write on public.task_attachments;
create policy task_attachments_insert on public.task_attachments for insert to authenticated
  with check (app.can_write_workspace(workspace_id));
create policy task_attachments_update on public.task_attachments for update to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));
create policy task_attachments_delete on public.task_attachments for delete to authenticated
  using (app.can_write_workspace(workspace_id));

drop policy if exists milestones_write on public.milestones;
create policy milestones_insert on public.milestones for insert to authenticated
  with check (app.can_write_workspace(workspace_id));
create policy milestones_update on public.milestones for update to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));
create policy milestones_delete on public.milestones for delete to authenticated
  using (app.can_write_workspace(workspace_id));

drop policy if exists calendar_events_write on public.calendar_events;
create policy calendar_events_insert on public.calendar_events for insert to authenticated
  with check (app.can_write_workspace(workspace_id));
create policy calendar_events_update on public.calendar_events for update to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));
create policy calendar_events_delete on public.calendar_events for delete to authenticated
  using (app.can_write_workspace(workspace_id));

drop policy if exists notes_write on public.notes;
create policy notes_insert on public.notes for insert to authenticated
  with check (app.can_write_workspace(workspace_id));
create policy notes_update on public.notes for update to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));
create policy notes_delete on public.notes for delete to authenticated
  using (app.can_write_workspace(workspace_id));

-- integrations is the one where the two predicates genuinely differ: a member
-- may read a workspace-scoped integration, but only its owner or an admin may
-- change one. Keeping them apart is what the linter is asking for here.
drop policy if exists integrations_write on public.integrations;
create policy integrations_insert on public.integrations for insert to authenticated
  with check (
    (scope_level = 'user' and owner_id = (select auth.uid())
      and app.is_workspace_member(workspace_id))
    or (scope_level = 'workspace' and app.can_manage_workspace(workspace_id))
  );
create policy integrations_update on public.integrations for update to authenticated
  using (owner_id = (select auth.uid()) or app.can_manage_workspace(workspace_id))
  with check (
    (scope_level = 'user' and owner_id = (select auth.uid())
      and app.is_workspace_member(workspace_id))
    or (scope_level = 'workspace' and app.can_manage_workspace(workspace_id))
  );
create policy integrations_delete on public.integrations for delete to authenticated
  using (owner_id = (select auth.uid()) or app.can_manage_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- 2. Covering indexes for the foreign keys that lacked one
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
