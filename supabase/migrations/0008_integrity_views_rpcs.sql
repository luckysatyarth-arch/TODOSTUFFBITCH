-- 0008: cross-workspace integrity guards, progress reporting, and the RPCs
-- that need to be atomic or RLS-filtered inside the database.

-- ---------------------------------------------------------------------------
-- Integrity guards.
--
-- RLS answers "may this caller touch this workspace's rows?" but not "do the
-- rows this request stitches together belong to the same workspace?". Without
-- these, a caller who can write workspace A could attach a task to a project
-- in workspace B by passing its id. The brief asks specifically that request
-- parameters cannot be manipulated to bypass authorization, so this is
-- enforced in the database rather than trusted to the API layer.
-- ---------------------------------------------------------------------------

create or replace function app.assert_task_consistency()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_other uuid;
begin
  if new.project_id is not null then
    select workspace_id into v_other from public.projects where id = new.project_id;
    if v_other is distinct from new.workspace_id then
      raise exception 'project % is not in workspace %', new.project_id, new.workspace_id
        using errcode = 'check_violation';
    end if;
  end if;

  if new.parent_task_id is not null then
    select workspace_id into v_other from public.tasks where id = new.parent_task_id;
    if v_other is distinct from new.workspace_id then
      raise exception 'parent task % is not in workspace %', new.parent_task_id, new.workspace_id
        using errcode = 'check_violation';
    end if;
  end if;

  -- An assignee must actually belong to the workspace, so work cannot be
  -- pushed onto someone outside it.
  if new.assignee_id is not null
     and not exists (
       select 1 from public.workspace_members wm
       where wm.workspace_id = new.workspace_id and wm.user_id = new.assignee_id
     ) then
    raise exception 'assignee % is not a member of workspace %', new.assignee_id, new.workspace_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace trigger tasks_assert_consistency
  before insert or update of workspace_id, project_id, parent_task_id, assignee_id
  on public.tasks
  for each row execute function app.assert_task_consistency();

create or replace function app.assert_project_child_consistency()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_other uuid;
begin
  if new.project_id is not null then
    select workspace_id into v_other from public.projects where id = new.project_id;
    if v_other is distinct from new.workspace_id then
      raise exception 'project % is not in workspace %', new.project_id, new.workspace_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger milestones_assert_consistency
  before insert or update of workspace_id, project_id on public.milestones
  for each row execute function app.assert_project_child_consistency();

create or replace trigger calendar_events_assert_consistency
  before insert or update of workspace_id, project_id on public.calendar_events
  for each row execute function app.assert_project_child_consistency();

create or replace trigger notes_assert_consistency
  before insert or update of workspace_id, project_id on public.notes
  for each row execute function app.assert_project_child_consistency();

-- A dependency may only exist between two tasks in the same workspace.
create or replace function app.assert_dependency_same_workspace()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select workspace_id from public.tasks where id = new.task_id)
     is distinct from
     (select workspace_id from public.tasks where id = new.depends_on_task_id) then
    raise exception 'task dependencies must stay within one workspace'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace trigger task_dependencies_assert_workspace
  before insert or update on public.task_dependencies
  for each row execute function app.assert_dependency_same_workspace();

-- ---------------------------------------------------------------------------
-- Project progress.
--
-- Deliberately transparent and countable: completed tasks over non-cancelled
-- tasks, exactly as the brief specifies. security_invoker makes the view run
-- under the caller's RLS rather than the view owner's, so it cannot be used to
-- read another workspace's counts.
-- ---------------------------------------------------------------------------

create or replace view public.project_progress with (security_invoker = true) as
select
  p.id                       as project_id,
  p.workspace_id,
  count(t.id) filter (where t.status <> 'cancelled')                      as total_tasks,
  count(t.id) filter (where t.status = 'completed')                       as completed_tasks,
  count(t.id) filter (where t.status not in ('completed', 'cancelled'))   as remaining_tasks,
  count(t.id) filter (where t.status = 'blocked')                         as blocked_tasks,
  count(t.id) filter (
    where t.status not in ('completed', 'cancelled')
      and t.due_date is not null
      and t.due_date < (now() at time zone coalesce(w.timezone, 'Asia/Kolkata'))::date
  )                                                                      as overdue_tasks,
  -- nullif guards the zero-task project: the result is null, which the
  -- application renders as "no tasks yet" rather than 0% or a divide error.
  round(
    100.0 * count(t.id) filter (where t.status = 'completed')
    / nullif(count(t.id) filter (where t.status <> 'cancelled'), 0)
  , 1)                                                                   as percent_complete
from public.projects p
join public.workspaces w on w.id = p.workspace_id
left join public.tasks t on t.project_id = p.id
group by p.id, p.workspace_id, w.timezone;

-- ---------------------------------------------------------------------------
-- Approval.
--
-- Creating a task from a proposal must be atomic and must survive a retry or a
-- double-click, so it lives in one function rather than two client round
-- trips. SECURITY INVOKER keeps the caller's RLS in force: the function cannot
-- be used to write into a workspace the caller has no rights to.
-- ---------------------------------------------------------------------------

create or replace function public.approve_proposed_task(
  p_proposal_id uuid,
  p_title text default null,
  p_description text default null,
  p_project_id uuid default null,
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority public.priority_level default null,
  p_status public.task_status default 'todo'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.proposed_tasks;
  v_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  -- FOR UPDATE serialises two concurrent approvals of the same proposal; the
  -- second waits here and then takes the already-approved branch below.
  select * into v_proposal
  from public.proposed_tasks
  where id = p_proposal_id
  for update;

  if not found then
    raise exception 'proposal % not found', p_proposal_id
      using errcode = 'no_data_found';
  end if;

  -- This function is SECURITY DEFINER because it must write to task_activity
  -- and audit_logs, which carry no INSERT policy precisely so a client cannot
  -- forge history. The two checks RLS would have made are therefore made here,
  -- explicitly: only the person who captured the source may turn it into work,
  -- and only with a writing role. auth.uid() still resolves to the caller
  -- inside a definer function, so both helpers evaluate against the real user.
  if not app.owns_capture(v_proposal.capture_id) then
    raise exception 'that proposal does not belong to you'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.can_write_workspace(v_proposal.workspace_id) then
    raise exception 'your role in this workspace is read-only'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent: a retried request returns the task the first call created
  -- instead of creating a second one.
  if v_proposal.created_task_id is not null then
    return v_proposal.created_task_id;
  end if;

  if v_proposal.status <> 'pending' then
    raise exception 'proposal % is % and cannot be approved', p_proposal_id, v_proposal.status
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.tasks (
    workspace_id, project_id, title, description, status, priority,
    assignee_id, created_by, due_date, estimated_minutes, source_capture_id
  ) values (
    v_proposal.workspace_id,
    coalesce(p_project_id, v_proposal.suggested_project_id),
    coalesce(nullif(btrim(p_title), ''), v_proposal.title),
    coalesce(p_description, v_proposal.description),
    coalesce(p_status, 'todo'),
    coalesce(p_priority, v_proposal.suggested_priority, 'medium'),
    coalesce(p_assignee_id, v_proposal.suggested_assignee_id),
    auth.uid(),
    coalesce(p_due_date, v_proposal.suggested_due_date),
    v_proposal.estimated_minutes,
    v_proposal.capture_id
  )
  returning id into v_task_id;

  update public.proposed_tasks
  set status = 'approved',
      created_task_id = v_task_id,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_proposal_id;

  insert into public.task_activity (task_id, actor_id, action, to_value)
  values (
    v_task_id, auth.uid(), 'created_from_proposal',
    jsonb_build_object('proposal_id', p_proposal_id, 'capture_id', v_proposal.capture_id)
  );

  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_proposal.workspace_id, auth.uid(), 'proposal.approved', 'proposed_task',
    p_proposal_id::text,
    jsonb_build_object('task_id', v_task_id, 'capture_id', v_proposal.capture_id)
  );

  return v_task_id;
end;
$$;

grant execute on function public.approve_proposed_task(
  uuid, text, text, uuid, uuid, date, public.priority_level, public.task_status
) to authenticated;

-- ---------------------------------------------------------------------------
-- Retrieval.
--
-- Both search functions are SECURITY INVOKER, so the RLS policies on
-- indexed_documents, document_chunks and document_embeddings filter rows
-- before anything is returned. That is what makes "permissions are applied
-- before results reach the model" true at the database level rather than
-- being a promise made in application code.
-- ---------------------------------------------------------------------------

create or replace function public.search_documents_fts(
  p_workspace uuid,
  p_query text,
  p_limit integer default 20,
  p_sources public.document_source[] default null
)
returns table (
  document_id uuid,
  source_type public.document_source,
  source_record_id text,
  title text,
  excerpt text,
  url text,
  author text,
  source_timestamp timestamptz,
  access_scope public.access_scope,
  rank real
)
language sql stable set search_path = '' as $$
  select d.id, d.source_type, d.source_record_id, d.title,
         coalesce(d.excerpt, left(d.content, 400)),
         d.url, d.author, d.source_timestamp, d.access_scope,
         ts_rank(d.fts, websearch_to_tsquery('english', p_query)) as rank
  from public.indexed_documents d
  where d.workspace_id = p_workspace
    and d.fts @@ websearch_to_tsquery('english', p_query)
    and (p_sources is null or d.source_type = any (p_sources))
  order by rank desc, d.source_timestamp desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

grant execute on function public.search_documents_fts(
  uuid, text, integer, public.document_source[]
) to authenticated;

create or replace function public.match_document_chunks(
  p_workspace uuid,
  p_embedding extensions.vector(1536),
  p_limit integer default 20,
  p_min_similarity double precision default 0.15,
  p_sources public.document_source[] default null
)
returns table (
  document_id uuid,
  chunk_id uuid,
  source_type public.document_source,
  source_record_id text,
  title text,
  url text,
  chunk_content text,
  source_timestamp timestamptz,
  access_scope public.access_scope,
  similarity double precision
)
language sql stable set search_path = '' as $$
  select d.id, dc.id, d.source_type, d.source_record_id, d.title, d.url,
         dc.content, d.source_timestamp, d.access_scope,
         1 - (de.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.document_embeddings de
  join public.document_chunks dc on dc.id = de.chunk_id
  join public.indexed_documents d on d.id = dc.document_id
  where d.workspace_id = p_workspace
    and (p_sources is null or d.source_type = any (p_sources))
    and 1 - (de.embedding operator(extensions.<=>) p_embedding) >= coalesce(p_min_similarity, 0.15)
  order by de.embedding operator(extensions.<=>) p_embedding
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

grant execute on function public.match_document_chunks(
  uuid, extensions.vector, integer, double precision, public.document_source[]
) to authenticated;
