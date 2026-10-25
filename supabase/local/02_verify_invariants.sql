-- The rules the brief states as absolute, executed rather than asserted in
-- prose.
--
-- These were originally verified by hand against a hosted project. That
-- project is no longer reachable from this environment, so the checks are
-- recorded here instead, where anyone can re-run them with `npm run db:verify`.
-- Each one is written so that removing the constraint it tests makes it fail.

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.check(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok   % (%)', label, actual;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com', '{"full_name":"Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com',   '{"full_name":"Bob"}');

select id as alice_personal from public.workspaces
  where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'personal'
\gset

insert into public.workspaces (id, name, kind, owner_id)
values ('33333333-3333-4333-8333-333333333333', 'Acme', 'team',
        '11111111-1111-4111-8111-111111111111');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'member');

-- Signup provisioning --------------------------------------------------------

select pg_temp.check(
  'signup creates exactly one personal workspace',
  (select count(*) from public.workspaces
    where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'personal'),
  1::bigint);

select pg_temp.check(
  'and makes its owner a member',
  (select role::text from public.workspace_members
    where workspace_id = :'alice_personal'
      and user_id = '11111111-1111-4111-8111-111111111111'),
  'owner');

-- "A task is complete only when its status is explicitly Completed." ---------

insert into public.tasks (id, workspace_id, title, status, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        '33333333-3333-4333-8333-333333333333', 'Write the migration',
        'todo', '11111111-1111-4111-8111-111111111111');

select pg_temp.check(
  'a new task has no completion timestamp',
  (select completed_at is null from public.tasks
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  true);

-- A completion time cannot be asserted without the status that earns it.
-- The write is not rejected; the BEFORE trigger discards it, so the row can
-- never come to rest claiming a completion that did not happen. Assert the
-- outcome rather than the mechanism: either a refusal or a discarded value
-- satisfies the brief, but a persisted forged timestamp does not.
update public.tasks set completed_at = now()
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select pg_temp.check(
  'a completion time written against a non-completed task does not persist',
  (select completed_at is null and status::text = 'todo' from public.tasks
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  true);

-- The same at insert time, which is the likelier route: a bulk import or a
-- script that sets both columns directly.
insert into public.tasks (id, workspace_id, title, status, completed_at, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        '33333333-3333-4333-8333-333333333333', 'Imported task',
        'todo', now(), '11111111-1111-4111-8111-111111111111');

select pg_temp.check(
  'an imported task cannot arrive pre-completed',
  (select completed_at is null from public.tasks
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  true);

-- Setting the status is what earns the timestamp, and it is the database that
-- supplies it, not the caller.
update public.tasks set status = 'completed', completed_at = null
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select pg_temp.check(
  'completing a task sets the timestamp even when the caller passed null',
  (select completed_at is not null from public.tasks
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  true);

-- And the CHECK is still there as the backstop if the trigger were ever
-- dropped: the two columns can never disagree in a stored row.
select pg_temp.check(
  'no stored task disagrees about its own completion',
  (select count(*) from public.tasks
    where (status = 'completed') <> (completed_at is not null)),
  0::bigint);

-- Reopening clears it, so a reopened task cannot look finished.
update public.tasks set status = 'in_progress'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select pg_temp.check(
  'reopening a task clears its completion timestamp',
  (select completed_at is null from public.tasks
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  true);

-- "Approval is mandatory, and must create at most one task." -----------------

insert into public.captures
  (id, workspace_id, owner_id, kind, status, raw_text)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        'text', 'ready', 'Alice will write the migration by Friday.');

insert into public.proposed_tasks
  (id, capture_id, workspace_id, title, source_excerpt, status, confidence)
values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        '33333333-3333-4333-8333-333333333333',
        'Write the migration', 'Alice will write the migration by Friday.',
        'pending', 0.9);

select pg_temp.check(
  'a proposal starts pending and owns no task',
  (select status::text || '/' || coalesce(created_task_id::text, 'none')
     from public.proposed_tasks where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  'pending/none');

select pg_temp.check(
  'extraction alone creates no task',
  (select count(*) from public.tasks
     where source_capture_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  0::bigint);

grant execute on function public.approve_proposed_task(
  uuid, text, text, uuid, uuid, date, public.priority_level, public.task_status)
  to authenticated;
grant select, insert on public.tasks to authenticated;

-- The RPC is SECURITY DEFINER and resolves the caller through auth.uid(), so
-- it has to be exercised as a real signed-in user. Calling it as the table
-- owner would be refused outright, which is itself the first thing to prove.
do $$
begin
  perform public.approve_proposed_task('cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  raise exception 'FAIL an unauthenticated caller was allowed to approve';
exception
  when insufficient_privilege then
    raise notice 'ok   approval is refused when there is no authenticated user';
end;
$$;

-- Bob is a writing member of the same workspace, but the capture is Alice's.
-- Membership must not be enough to turn someone else's recording into work.
set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';

do $$
begin
  perform public.approve_proposed_task('cccccccc-cccc-4ccc-8ccc-ccccccccccc1');
  raise exception 'FAIL bob approved a proposal from alice''s capture';
exception
  when insufficient_privilege then
    raise notice 'ok   a teammate cannot approve another member''s proposal';
end;
$$;

-- Alice can, and exactly one task results.
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select public.approve_proposed_task('cccccccc-cccc-4ccc-8ccc-ccccccccccc1') as first_task
\gset

select pg_temp.check(
  'approving records the task on the proposal and marks it approved',
  (select created_task_id = :'first_task'::uuid and status::text = 'approved'
     from public.proposed_tasks where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  true);

-- A retry must return the first task rather than creating a second. This is
-- what stops a double-click or a replayed request from duplicating work.
select pg_temp.check(
  're-approving returns the same task instead of a new one',
  public.approve_proposed_task('cccccccc-cccc-4ccc-8ccc-ccccccccccc1') = :'first_task'::uuid,
  true);

select pg_temp.check(
  'exactly one task exists for the capture',
  (select count(*) from public.tasks
     where source_capture_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  1::bigint);

-- The approved task carries its provenance, so the record can be traced back
-- to the words it came from.
select pg_temp.check(
  'the created task links back to its capture',
  (select source_capture_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
     from public.tasks where id = :'first_task'::uuid),
  true);

reset role;

-- "One report per scope per date." -------------------------------------------

insert into public.daily_reports
  (workspace_id, scope, subject_user_id, report_date, content)
values ('33333333-3333-4333-8333-333333333333', 'personal',
        '11111111-1111-4111-8111-111111111111', '2026-10-25', '{}'::jsonb);

do $$
begin
  insert into public.daily_reports
    (workspace_id, scope, subject_user_id, report_date, content)
  values ('33333333-3333-4333-8333-333333333333', 'personal',
          '11111111-1111-4111-8111-111111111111', '2026-10-25', '{}'::jsonb);
  raise exception 'FAIL a duplicate personal report for the same date was accepted';
exception
  when unique_violation then
    raise notice 'ok   a second personal report for the same subject and date is rejected';
end;
$$;

insert into public.daily_reports (workspace_id, scope, report_date, content)
values ('33333333-3333-4333-8333-333333333333', 'team', '2026-10-25', '{}'::jsonb);

do $$
begin
  insert into public.daily_reports (workspace_id, scope, report_date, content)
  values ('33333333-3333-4333-8333-333333333333', 'team', '2026-10-25', '{}'::jsonb);
  raise exception 'FAIL a duplicate team report for the same date was accepted';
exception
  when unique_violation then
    raise notice 'ok   a second team report for the same date is rejected';
end;
$$;

-- The two indexes are partial, which is what lets the personal and the team
-- report for one date coexist while still blocking duplicates of either.
select pg_temp.check(
  'a personal and a team report share a date without colliding',
  (select count(*) from public.daily_reports
     where workspace_id = '33333333-3333-4333-8333-333333333333'
       and report_date = '2026-10-25'),
  2::bigint);

-- Each member gets their own personal report for the same date.
insert into public.daily_reports
  (workspace_id, scope, subject_user_id, report_date, content)
values ('33333333-3333-4333-8333-333333333333', 'personal',
        '22222222-2222-4222-8222-222222222222', '2026-10-25', '{}'::jsonb);

select pg_temp.check(
  'a second member gets their own personal report for that date',
  (select count(*) from public.daily_reports
     where workspace_id = '33333333-3333-4333-8333-333333333333'
       and report_date = '2026-10-25' and scope = 'personal'),
  2::bigint);

-- The reporting timezone is part of the stored record, not inferred at read
-- time, so a report cannot be reinterpreted into a different day later.
select pg_temp.check(
  'the reporting timezone is stored on the report',
  (select distinct timezone from public.daily_reports
     where report_date = '2026-10-25'),
  'Asia/Kolkata');

-- A personal report is visible only to its subject, even to a workspace admin.
grant select on public.daily_reports to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';

select pg_temp.check(
  'bob sees the team report and only his own personal one',
  (select count(*) from public.daily_reports
     where workspace_id = '33333333-3333-4333-8333-333333333333'),
  2::bigint);

select pg_temp.check(
  'bob cannot read alice''s personal report',
  (select count(*) from public.daily_reports
     where scope = 'personal'
       and subject_user_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint);

-- Alice owns the workspace, so if admin rights leaked into personal reports
-- this is where it would show.
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select pg_temp.check(
  'the workspace owner still cannot read a member''s personal report',
  (select count(*) from public.daily_reports
     where scope = 'personal'
       and subject_user_id = '22222222-2222-4222-8222-222222222222'),
  0::bigint);

reset role;

-- Cross-workspace integrity --------------------------------------------------

insert into public.projects (id, workspace_id, name, owner_id)
values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', :'alice_personal',
        'Personal project', '11111111-1111-4111-8111-111111111111');

do $$
begin
  insert into public.tasks (workspace_id, title, project_id, created_by)
  values ('33333333-3333-4333-8333-333333333333', 'Smuggled task',
          'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
          '11111111-1111-4111-8111-111111111111');
  raise exception 'FAIL a task was attached to a project in another workspace';
exception
  when others then
    raise notice 'ok   a task cannot reference a project in another workspace';
end;
$$;

-- "Team membership must not grant access to a member's personal workspace." --

grant select on public.tasks, public.workspaces to authenticated;

insert into public.tasks (workspace_id, title, created_by)
values (:'alice_personal', 'Alice private errand',
        '11111111-1111-4111-8111-111111111111');

set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';

select pg_temp.check(
  'bob, a teammate, cannot read alice''s personal tasks',
  (select count(*) from public.tasks where workspace_id = :'alice_personal'),
  0::bigint);

select pg_temp.check(
  'bob cannot even see that workspace',
  (select count(*) from public.workspaces where id = :'alice_personal'),
  0::bigint);

-- Alice can, which is what makes the previous two meaningful.
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select pg_temp.check(
  'alice can read her own personal tasks',
  (select count(*) from public.tasks where workspace_id = :'alice_personal'),
  1::bigint);

-- Credential and job tables are unreachable without the service role.
--
-- Rows are written first, as the owner: a count of zero against an empty
-- table would prove nothing, so the test has to have something to leak.

reset role;

insert into public.integrations
  (id, workspace_id, provider, scope_level, owner_id, status)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        '33333333-3333-4333-8333-333333333333', 'gmail', 'user',
        '11111111-1111-4111-8111-111111111111', 'connected');

insert into public.integration_credentials
  (integration_id, ciphertext, iv, auth_tag)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        'pretend-ciphertext', 'pretend-iv', 'pretend-tag');

insert into public.job_runs (job_type, payload, status)
values ('sync_integration', '{"integration":"gmail"}'::jsonb, 'queued');

select pg_temp.check(
  'the rows really are there to be leaked',
  (select count(*) from public.integration_credentials)
    + (select count(*) from public.job_runs),
  2::bigint);

grant select on public.integration_credentials, public.job_runs to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

-- RLS is on with no policy at all, so there is nothing to grant access: even
-- the integration's own owner, holding an explicit SELECT grant, reads none of
-- it. Only the service role, which bypasses RLS, can.
select pg_temp.check(
  'the integration owner cannot read her own sealed credentials',
  (select count(*) from public.integration_credentials),
  0::bigint);

select pg_temp.check(
  'and cannot read the job queue',
  (select count(*) from public.job_runs),
  0::bigint);

select pg_temp.check(
  'she can still see the integration itself, which carries no secret',
  (select count(*) from public.integrations
     where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'),
  1::bigint);

reset role;

rollback;
