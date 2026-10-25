-- The tables whose `for all` write policy was split into insert/update/delete
-- in migration 0013.
--
-- Splitting it means reads are now governed by the `_select` policy alone,
-- where before either policy could admit a row. The predicates were written so
-- that can_write implies is_member, so the effective permission should be
-- unchanged -- but "should be" is the reason to test it. What matters is that a
-- member can still read and write, and that a viewer can still read and still
-- cannot write.

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
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com',  '{"full_name":"Owner"}'),
  ('22222222-2222-4222-8222-222222222222', 'member@example.com', '{"full_name":"Member"}'),
  ('33333333-3333-4333-8333-333333333333', 'viewer@example.com', '{"full_name":"Viewer"}');

insert into public.workspaces (id, name, kind, owner_id)
values ('44444444-4444-4444-8444-444444444444', 'Acme', 'team',
        '11111111-1111-4111-8111-111111111111');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'member'),
  ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'viewer');

insert into public.projects (id, workspace_id, name, owner_id)
values ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444',
        'Billing', '11111111-1111-4111-8111-111111111111');

-- Seed one row in each affected table, as the owner.
insert into public.notes (id, workspace_id, project_id, author_id, title, body)
values ('66666666-6666-4666-8666-666666666661', '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111',
        'Cutover notes', 'Freeze writes at 21:00.');

insert into public.milestones (id, workspace_id, project_id, name, due_date)
values ('66666666-6666-4666-8666-666666666662', '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555', 'Cutover', '2026-12-01');

insert into public.calendar_events (id, workspace_id, title, is_all_day, start_date, created_by)
values ('66666666-6666-4666-8666-666666666663', '44444444-4444-4444-8444-444444444444',
        'Quarter close', true, '2026-12-01', '11111111-1111-4111-8111-111111111111');

insert into public.tasks (id, workspace_id, title, created_by)
values ('66666666-6666-4666-8666-666666666664', '44444444-4444-4444-8444-444444444444',
        'Host one attachment', '11111111-1111-4111-8111-111111111111');

insert into public.task_attachments
  (id, task_id, workspace_id, uploaded_by, storage_path, file_name)
values ('66666666-6666-4666-8666-666666666665', '66666666-6666-4666-8666-666666666664',
        '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
        '44444444-4444-4444-8444-444444444444/plan.pdf', 'plan.pdf');

insert into public.project_members (id, project_id, user_id)
values ('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555',
        '22222222-2222-4222-8222-222222222222');

insert into public.task_dependencies (task_id, depends_on_task_id)
select '66666666-6666-4666-8666-666666666664', id from public.tasks
where id <> '66666666-6666-4666-8666-666666666664' limit 1;

grant select, insert, update, delete on
  public.notes, public.milestones, public.calendar_events, public.task_attachments,
  public.project_members, public.task_dependencies, public.integrations, public.tasks
  to authenticated;

-- A writing member -------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';

select pg_temp.check('member reads the note',
  (select count(*) from public.notes), 1::bigint);
select pg_temp.check('member reads the milestone',
  (select count(*) from public.milestones), 1::bigint);
select pg_temp.check('member reads the event',
  (select count(*) from public.calendar_events), 1::bigint);
select pg_temp.check('member reads the attachment',
  (select count(*) from public.task_attachments), 1::bigint);
select pg_temp.check('member reads project members',
  (select count(*) from public.project_members), 1::bigint);

-- And can still write, which the split must not have taken away.
insert into public.notes (workspace_id, author_id, title, body)
values ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222',
        'Member note', 'Added by a member.');
select pg_temp.check('member can insert a note',
  (select count(*) from public.notes), 2::bigint);

update public.notes set body = 'Edited by a member.'
  where id = '66666666-6666-4666-8666-666666666661';
select pg_temp.check('member can update a note',
  (select body from public.notes where id = '66666666-6666-4666-8666-666666666661'),
  'Edited by a member.');

update public.milestones set name = 'Cutover v2'
  where id = '66666666-6666-4666-8666-666666666662';
select pg_temp.check('member can update a milestone',
  (select name from public.milestones where id = '66666666-6666-4666-8666-666666666662'),
  'Cutover v2');

update public.calendar_events set title = 'Quarter close (moved)'
  where id = '66666666-6666-4666-8666-666666666663';
select pg_temp.check('member can update an event',
  (select title from public.calendar_events where id = '66666666-6666-4666-8666-666666666663'),
  'Quarter close (moved)');

-- A viewer ---------------------------------------------------------------------

set local "request.jwt.claim.sub" = '33333333-3333-4333-8333-333333333333';

select pg_temp.check('viewer reads the notes',
  (select count(*) from public.notes), 2::bigint);
select pg_temp.check('viewer reads the milestone',
  (select count(*) from public.milestones), 1::bigint);
select pg_temp.check('viewer reads the event',
  (select count(*) from public.calendar_events), 1::bigint);

-- Reads yes, writes no. An UPDATE a policy forbids matches no rows rather than
-- raising, so the check is that nothing changed.
update public.notes set body = 'Viewer got in.'
  where id = '66666666-6666-4666-8666-666666666661';
select pg_temp.check('a viewer cannot update a note',
  (select body from public.notes where id = '66666666-6666-4666-8666-666666666661'),
  'Edited by a member.');

update public.milestones set name = 'Viewer got in'
  where id = '66666666-6666-4666-8666-666666666662';
select pg_temp.check('a viewer cannot update a milestone',
  (select name from public.milestones where id = '66666666-6666-4666-8666-666666666662'),
  'Cutover v2');

delete from public.calendar_events
  where id = '66666666-6666-4666-8666-666666666663';
select pg_temp.check('a viewer cannot delete an event',
  (select count(*) from public.calendar_events), 1::bigint);

do $$
begin
  insert into public.notes (workspace_id, author_id, title, body)
  values ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333',
          'Viewer note', 'Should not exist.');
  raise exception 'FAIL a viewer inserted a note';
exception when insufficient_privilege then
  raise notice 'ok   a viewer cannot insert a note';
end;
$$;

-- A stranger -------------------------------------------------------------------

set local "request.jwt.claim.sub" = '99999999-9999-4999-8999-999999999999';

select pg_temp.check('a non-member reads none of it',
  (select count(*) from public.notes)
    + (select count(*) from public.milestones)
    + (select count(*) from public.calendar_events)
    + (select count(*) from public.task_attachments)
    + (select count(*) from public.project_members),
  0::bigint);

reset role;

rollback;
