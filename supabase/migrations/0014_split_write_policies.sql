-- One policy per action, instead of two permissive policies per SELECT.
--
-- From Supabase's performance linter run against the deployed schema. It does
-- not change who can see what: it narrows which policies run for a SELECT
-- without altering the predicate that decides access, and the 17 checks in
-- supabase/local/05_verify_policy_split.sql confirm that against a real
-- PostgreSQL.
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
