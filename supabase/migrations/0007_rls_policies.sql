-- 0007: Row Level Security.
--
-- Every table in `public` gets RLS enabled. Three tables deliberately get no
-- policy at all -- integration_credentials, job_runs, rate_limit_counters --
-- because RLS-enabled-with-no-policy denies every request from the
-- `authenticated` role. Those are reachable only via the service role, which
-- is used exclusively in server-side code.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` lets the planner
-- evaluate the subquery once per statement instead of once per row.

-- Additional helpers for tables that reach their workspace through a parent.

create or replace function app.owns_capture(p_capture uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.captures c
    where c.id = p_capture and c.owner_id = auth.uid()
  );
$$;

create or replace function app.task_workspace(p_task uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select t.workspace_id from public.tasks t where t.id = p_task;
$$;

create or replace function app.project_workspace(p_project uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.workspace_id from public.projects p where p.id = p_project;
$$;

-- A document is readable when the caller belongs to its workspace AND the
-- document is either workspace-scoped or owned by the caller. This is the
-- single chokepoint that keeps one user's private mail or voice note out of
-- another member's search results.
create or replace function app.can_read_document(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.indexed_documents d
    where d.id = p_document
      and app.is_workspace_member(d.workspace_id)
      and (d.access_scope = 'workspace' or d.owner_id = auth.uid())
  );
$$;

create or replace function app.can_read_integration(p_integration uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.integrations i
    where i.id = p_integration
      and (i.owner_id = auth.uid()
           or (i.owner_id is null and app.is_workspace_member(i.workspace_id)))
  );
$$;

grant execute on function app.owns_capture(uuid) to authenticated, service_role;
grant execute on function app.task_workspace(uuid) to authenticated, service_role;
grant execute on function app.project_workspace(uuid) to authenticated, service_role;
grant execute on function app.can_read_document(uuid) to authenticated, service_role;
grant execute on function app.can_read_integration(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_activity enable row level security;
alter table public.task_attachments enable row level security;
alter table public.milestones enable row level security;
alter table public.calendar_events enable row level security;
alter table public.notes enable row level security;
alter table public.captures enable row level security;
alter table public.transcripts enable row level security;
alter table public.proposed_tasks enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.indexed_documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.document_embeddings enable row level security;
alter table public.notifications enable row level security;
alter table public.daily_reports enable row level security;
alter table public.report_deliveries enable row level security;
alter table public.job_runs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limit_counters enable row level security;

-- profiles: your own row, plus collaborators so their names can be rendered.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app.shares_workspace(id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces: visible to members. Creation is restricted to team workspaces
-- owned by the caller; the personal one is made by the signup trigger.
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces for select to authenticated
  using (app.is_workspace_member(id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()) and kind = 'team');

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces for update to authenticated
  using (app.can_manage_workspace(id)) with check (app.can_manage_workspace(id));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (owner_id = (select auth.uid()));

-- workspace_members: readable by co-members; writable by owners/admins.
-- The helper is SECURITY DEFINER, so this policy does not recurse into itself.
drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (app.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members for insert to authenticated
  with check (app.can_manage_workspace(workspace_id));

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members for update to authenticated
  using (app.can_manage_workspace(workspace_id))
  with check (app.can_manage_workspace(workspace_id));

-- A member may always remove themselves; admins may remove anyone.
drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members for delete to authenticated
  using (app.can_manage_workspace(workspace_id) or user_id = (select auth.uid()));

drop policy if exists workspace_invitations_manage on public.workspace_invitations;
create policy workspace_invitations_manage on public.workspace_invitations for all to authenticated
  using (app.can_manage_workspace(workspace_id))
  with check (app.can_manage_workspace(workspace_id));

-- Workspace-scoped content: members read, writers write, viewers cannot.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (app.is_workspace_member(workspace_id));
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for insert to authenticated
  with check (app.can_write_workspace(workspace_id));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated
  using (app.can_manage_workspace(workspace_id));

drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members for select to authenticated
  using (app.is_workspace_member(app.project_workspace(project_id)));
drop policy if exists project_members_write on public.project_members;
create policy project_members_write on public.project_members for all to authenticated
  using (app.can_write_workspace(app.project_workspace(project_id)))
  with check (app.can_write_workspace(app.project_workspace(project_id)));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (app.is_workspace_member(workspace_id));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (app.can_write_workspace(workspace_id));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (app.can_write_workspace(workspace_id));

drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using (app.is_workspace_member(app.task_workspace(task_id)));
drop policy if exists task_dependencies_write on public.task_dependencies;
create policy task_dependencies_write on public.task_dependencies for all to authenticated
  using (app.can_write_workspace(app.task_workspace(task_id)))
  with check (app.can_write_workspace(app.task_workspace(task_id)));

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select to authenticated
  using (app.is_workspace_member(app.task_workspace(task_id)));
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (app.can_write_workspace(app.task_workspace(task_id))
              and author_id = (select auth.uid()));
-- You may edit or delete your own comment only.
drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete to authenticated
  using (author_id = (select auth.uid())
         or app.can_manage_workspace(app.task_workspace(task_id)));

-- Activity is append-only history written by trigger. Readable, never writable
-- from the client: there is no insert/update/delete policy.
drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity for select to authenticated
  using (app.is_workspace_member(app.task_workspace(task_id)));

drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select to authenticated
  using (app.is_workspace_member(workspace_id));
drop policy if exists task_attachments_write on public.task_attachments;
create policy task_attachments_write on public.task_attachments for all to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));

drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones for select to authenticated
  using (app.is_workspace_member(workspace_id));
drop policy if exists milestones_write on public.milestones;
create policy milestones_write on public.milestones for all to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events for select to authenticated
  using (app.is_workspace_member(workspace_id));
drop policy if exists calendar_events_write on public.calendar_events;
create policy calendar_events_write on public.calendar_events for all to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select to authenticated
  using (app.is_workspace_member(workspace_id));
drop policy if exists notes_write on public.notes;
create policy notes_write on public.notes for all to authenticated
  using (app.can_write_workspace(workspace_id))
  with check (app.can_write_workspace(workspace_id));

-- Captures are private to their owner, not shared with the workspace. A voice
-- note or forwarded message is personal material even inside a team workspace.
drop policy if exists captures_owner_all on public.captures;
create policy captures_owner_all on public.captures for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and app.can_write_workspace(workspace_id));

drop policy if exists transcripts_owner on public.transcripts;
create policy transcripts_owner on public.transcripts for select to authenticated
  using (app.owns_capture(capture_id));

-- Proposals follow their capture's owner: only the person who captured the
-- source decides what becomes a task.
drop policy if exists proposed_tasks_owner_select on public.proposed_tasks;
create policy proposed_tasks_owner_select on public.proposed_tasks for select to authenticated
  using (app.owns_capture(capture_id));
drop policy if exists proposed_tasks_owner_update on public.proposed_tasks;
create policy proposed_tasks_owner_update on public.proposed_tasks for update to authenticated
  using (app.owns_capture(capture_id)) with check (app.owns_capture(capture_id));
drop policy if exists proposed_tasks_owner_delete on public.proposed_tasks;
create policy proposed_tasks_owner_delete on public.proposed_tasks for delete to authenticated
  using (app.owns_capture(capture_id));

drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations for select to authenticated
  using (owner_id = (select auth.uid())
         or (owner_id is null and app.is_workspace_member(workspace_id)));
drop policy if exists integrations_write on public.integrations;
create policy integrations_write on public.integrations for all to authenticated
  using (owner_id = (select auth.uid()) or app.can_manage_workspace(workspace_id))
  with check (
    (scope_level = 'user' and owner_id = (select auth.uid())
      and app.is_workspace_member(workspace_id))
    or (scope_level = 'workspace' and app.can_manage_workspace(workspace_id))
  );

drop policy if exists integration_sync_runs_select on public.integration_sync_runs;
create policy integration_sync_runs_select on public.integration_sync_runs for select to authenticated
  using (app.can_read_integration(integration_id));

drop policy if exists indexed_documents_select on public.indexed_documents;
create policy indexed_documents_select on public.indexed_documents for select to authenticated
  using (app.is_workspace_member(workspace_id)
         and (access_scope = 'workspace' or owner_id = (select auth.uid())));

drop policy if exists document_chunks_select on public.document_chunks;
create policy document_chunks_select on public.document_chunks for select to authenticated
  using (app.can_read_document(document_id));

drop policy if exists document_embeddings_select on public.document_embeddings;
create policy document_embeddings_select on public.document_embeddings for select to authenticated
  using (exists (
    select 1 from public.document_chunks dc
    where dc.id = chunk_id and app.can_read_document(dc.document_id)
  ));

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- A personal report is visible only to its subject, even to workspace admins.
-- Team reports are visible to the whole workspace. Reports are generated
-- server-side, so there is no client write policy.
drop policy if exists daily_reports_select on public.daily_reports;
create policy daily_reports_select on public.daily_reports for select to authenticated
  using (app.is_workspace_member(workspace_id)
         and (scope = 'team' or subject_user_id = (select auth.uid())));

drop policy if exists report_deliveries_select on public.report_deliveries;
create policy report_deliveries_select on public.report_deliveries for select to authenticated
  using (exists (
    select 1 from public.daily_reports r
    where r.id = daily_report_id
      and app.is_workspace_member(r.workspace_id)
      and (r.scope = 'team' or r.subject_user_id = (select auth.uid()))
  ));

-- Audit trail is for workspace administrators.
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (workspace_id is not null and app.can_manage_workspace(workspace_id));

-- integration_credentials, job_runs and rate_limit_counters intentionally have
-- no policies: RLS is on, so every `authenticated` request is denied.
