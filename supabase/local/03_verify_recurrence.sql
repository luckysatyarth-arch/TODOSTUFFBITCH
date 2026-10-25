-- Recurring tasks: the date arithmetic, and the rule that a series advances
-- only when a human explicitly completes an occurrence.

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

-- Validation -----------------------------------------------------------------

select pg_temp.check('a null recurrence is valid',
  app.is_valid_recurrence(null), true);
select pg_temp.check('a minimal daily rule is valid',
  app.is_valid_recurrence('{"freq":"daily"}'::jsonb), true);
select pg_temp.check('an unknown frequency is rejected',
  app.is_valid_recurrence('{"freq":"fortnightly"}'::jsonb), false);
select pg_temp.check('a missing frequency is rejected',
  app.is_valid_recurrence('{"interval":2}'::jsonb), false);
select pg_temp.check('a zero interval is rejected',
  app.is_valid_recurrence('{"freq":"daily","interval":0}'::jsonb), false);
select pg_temp.check('a fractional interval is rejected',
  app.is_valid_recurrence('{"freq":"daily","interval":1.5}'::jsonb), false);
select pg_temp.check('weekday 8 is rejected',
  app.is_valid_recurrence('{"freq":"weekly","weekdays":[8]}'::jsonb), false);
select pg_temp.check('an empty weekday list is rejected',
  app.is_valid_recurrence('{"freq":"weekly","weekdays":[]}'::jsonb), false);
select pg_temp.check('weekdays on a monthly rule are rejected',
  app.is_valid_recurrence('{"freq":"monthly","weekdays":[1]}'::jsonb), false);
select pg_temp.check('a malformed date is rejected',
  app.is_valid_recurrence('{"freq":"daily","until":"next tuesday"}'::jsonb), false);
-- A misspelled key must fail rather than being ignored, or "weekday":[1] would
-- quietly mean "every day".
select pg_temp.check('an unknown key is rejected',
  app.is_valid_recurrence('{"freq":"weekly","weekday":[1]}'::jsonb), false);
select pg_temp.check('a non-object is rejected',
  app.is_valid_recurrence('"daily"'::jsonb), false);

-- The CHECK constraint must actually be wired to the column.
do $$
begin
  insert into public.tasks (workspace_id, title, created_by, recurrence)
  values ('00000000-0000-0000-0000-000000000000', 'x',
          '00000000-0000-0000-0000-000000000000', '{"freq":"never"}'::jsonb);
  raise exception 'FAIL an invalid recurrence was stored';
exception
  when check_violation then
    raise notice 'ok   the column rejects an invalid rule';
  when foreign_key_violation then
    raise exception 'FAIL the recurrence CHECK did not fire before the FK';
end;
$$;

-- The arithmetic -------------------------------------------------------------

select pg_temp.check('daily steps one day',
  app.next_occurrence('{"freq":"daily","anchor":"2026-10-25"}'::jsonb, '2026-10-25'),
  '2026-10-26'::date);
select pg_temp.check('every third day',
  app.next_occurrence('{"freq":"daily","interval":3,"anchor":"2026-10-25"}'::jsonb, '2026-10-25'),
  '2026-10-28'::date);
select pg_temp.check('weekly steps seven days',
  app.next_occurrence('{"freq":"weekly","anchor":"2026-10-25"}'::jsonb, '2026-10-25'),
  '2026-11-01'::date);
select pg_temp.check('yearly from a leap day clamps',
  app.next_occurrence('{"freq":"yearly","anchor":"2028-02-29"}'::jsonb, '2028-02-29'),
  '2029-02-28'::date);
-- ...and comes back on the next leap year, because the anchor never moved.
select pg_temp.check('a leap-day series returns to the 29th',
  app.next_occurrence('{"freq":"yearly","anchor":"2028-02-29","occurrence":3}'::jsonb, '2031-02-28'),
  '2032-02-29'::date);

-- The case the anchor exists for: a monthly series must not walk its day of
-- month downwards after a short February.
select pg_temp.check('a monthly 31st survives February',
  app.next_occurrence('{"freq":"monthly","anchor":"2026-01-31","occurrence":1}'::jsonb, '2026-02-28'),
  '2026-03-31'::date);

-- Weekly on named days.
select pg_temp.check('mon/wed/fri from a Monday gives Wednesday',
  app.next_occurrence('{"freq":"weekly","weekdays":[1,3,5],"anchor":"2026-10-26"}'::jsonb, '2026-10-26'),
  '2026-10-28'::date);
select pg_temp.check('mon/wed/fri from a Friday wraps to Monday',
  app.next_occurrence('{"freq":"weekly","weekdays":[1,3,5],"anchor":"2026-10-26"}'::jsonb, '2026-10-30'),
  '2026-11-02'::date);
select pg_temp.check('every other Tuesday skips a whole week',
  app.next_occurrence('{"freq":"weekly","interval":2,"weekdays":[2],"anchor":"2026-10-27"}'::jsonb, '2026-10-27'),
  '2026-11-10'::date);

-- Termination.
select pg_temp.check('a date past until ends the series',
  app.next_occurrence('{"freq":"daily","anchor":"2026-10-25","until":"2026-10-25"}'::jsonb, '2026-10-25'),
  null::date);
select pg_temp.check('a date on until is still produced',
  app.next_occurrence('{"freq":"daily","anchor":"2026-10-25","until":"2026-10-26"}'::jsonb, '2026-10-25'),
  '2026-10-26'::date);
select pg_temp.check('an exhausted count ends the series',
  app.next_occurrence('{"freq":"daily","anchor":"2026-10-25","remaining":0}'::jsonb, '2026-10-25'),
  null::date);

-- A series left alone for months catches up rather than scheduling the past.
select pg_temp.check('a neglected monthly series skips to the future',
  app.next_occurrence('{"freq":"monthly","anchor":"2026-01-15","occurrence":1}'::jsonb, '2026-06-20'),
  '2026-07-15'::date);

-- Spawning on completion -----------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111', 'alice@example.com', '{"full_name":"Alice"}');

insert into public.workspaces (id, name, kind, owner_id)
values ('33333333-3333-4333-8333-333333333333', 'Acme', 'team',
        '11111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role)
values ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111', 'owner');

insert into public.tasks
  (id, workspace_id, title, description, status, priority, due_date, start_date,
   tags, estimated_minutes, created_by, recurrence)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        '33333333-3333-4333-8333-333333333333',
        'Submit the monthly report', 'Due on the last working day.',
        'todo', 'high', '2026-01-31', '2026-01-29',
        array['finance','recurring'], 45,
        '11111111-1111-4111-8111-111111111111',
        '{"freq":"monthly","anchor":"2026-01-31"}'::jsonb);

-- Nothing is created before the occurrence is completed. A deadline passing
-- must not advance a series any more than it may complete a task.
select pg_temp.check(
  'a recurring task spawns nothing while it is open',
  (select count(*) from public.tasks
     where workspace_id = '33333333-3333-4333-8333-333333333333'),
  1::bigint);

update public.tasks set status = 'in_progress'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select pg_temp.check(
  'and nothing on an ordinary status change',
  (select count(*) from public.tasks
     where workspace_id = '33333333-3333-4333-8333-333333333333'),
  1::bigint);

-- Completing it is what advances the series.
update public.tasks set status = 'completed'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select recurrence_spawned_task_id as spawned from public.tasks
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\gset

select pg_temp.check(
  'completing it creates exactly one successor',
  (select count(*) from public.tasks
     where workspace_id = '33333333-3333-4333-8333-333333333333'),
  2::bigint);

select pg_temp.check(
  'the successor is due on the next anchored date',
  (select due_date from public.tasks where id = :'spawned'::uuid),
  '2026-02-28'::date);

select pg_temp.check(
  'it starts open, not completed',
  (select status::text || '/' || coalesce(completed_at::text, 'null')
     from public.tasks where id = :'spawned'::uuid),
  'todo/null');

select pg_temp.check(
  'it carries the title, project fields and tags forward',
  (select title = 'Submit the monthly report' and priority::text = 'high'
            and tags = array['finance','recurring'] and estimated_minutes = 45
     from public.tasks where id = :'spawned'::uuid),
  true);

-- The two-day lead time between start and due is preserved, not reset.
select pg_temp.check(
  'the lead time between start and due is preserved',
  (select due_date - start_date from public.tasks where id = :'spawned'::uuid),
  2);

select pg_temp.check(
  'the successor carries the rule with its anchor intact',
  (select recurrence ->> 'anchor' from public.tasks where id = :'spawned'::uuid),
  '2026-01-31');

-- Re-completing must not fork the series.
update public.tasks set status = 'in_progress'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
update public.tasks set status = 'completed'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select pg_temp.check(
  'reopening and re-completing does not fork the series',
  (select count(*) from public.tasks
     where workspace_id = '33333333-3333-4333-8333-333333333333'),
  2::bigint);

select pg_temp.check(
  'and still points at the same successor',
  (select recurrence_spawned_task_id = :'spawned'::uuid from public.tasks
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  true);

-- A non-recurring task is untouched by any of this.
insert into public.tasks (id, workspace_id, title, status, due_date, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
        '33333333-3333-4333-8333-333333333333', 'One-off', 'todo',
        '2026-03-01', '11111111-1111-4111-8111-111111111111');
update public.tasks set status = 'completed'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';

select pg_temp.check(
  'a task with no rule spawns nothing',
  (select recurrence_spawned_task_id is null from public.tasks
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'),
  true);

-- A counted series. `remaining` is the number of FURTHER occurrences to
-- create, so remaining:2 produces two successors and then stops.
insert into public.tasks (id, workspace_id, title, status, due_date, created_by, recurrence)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        '33333333-3333-4333-8333-333333333333', 'Last standups', 'todo',
        '2026-03-02', '11111111-1111-4111-8111-111111111111',
        '{"freq":"daily","anchor":"2026-03-02","remaining":2}'::jsonb);

update public.tasks set status = 'completed'
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

select recurrence_spawned_task_id as gen2 from public.tasks
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
\gset

select pg_temp.check(
  'the second occurrence has one further occurrence left',
  (select recurrence ->> 'remaining' from public.tasks where id = :'gen2'::uuid),
  '1');

update public.tasks set status = 'completed' where id = :'gen2'::uuid;

select recurrence_spawned_task_id as gen3 from public.tasks
  where id = :'gen2'::uuid
\gset

select pg_temp.check(
  'the third occurrence is the last and carries no rule',
  (select recurrence is null and due_date = '2026-03-04'::date
     from public.tasks where id = :'gen3'::uuid),
  true);

update public.tasks set status = 'completed' where id = :'gen3'::uuid;

select pg_temp.check(
  'so completing the last one ends the series',
  (select recurrence_spawned_task_id is null from public.tasks
     where id = :'gen3'::uuid),
  true);

select pg_temp.check(
  'the counted series produced exactly three occurrences in total',
  (select count(*) from public.tasks where title = 'Last standups'),
  3::bigint);

-- A series past its until date ends rather than running on.
insert into public.tasks (id, workspace_id, title, status, due_date, created_by, recurrence)
values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        '33333333-3333-4333-8333-333333333333', 'Until yesterday', 'todo',
        '2026-04-01', '11111111-1111-4111-8111-111111111111',
        '{"freq":"daily","anchor":"2026-04-01","until":"2026-04-01"}'::jsonb);

update public.tasks set status = 'completed'
  where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

select pg_temp.check(
  'a series that has reached its until date stops',
  (select recurrence_spawned_task_id is null from public.tasks
     where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  true);

-- A spawned occurrence stays inside its own workspace.
select pg_temp.check(
  'every spawned task belongs to the original workspace',
  (select count(distinct workspace_id) from public.tasks
     where workspace_id = '33333333-3333-4333-8333-333333333333'),
  1::bigint);

rollback;
