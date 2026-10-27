-- `setpos`: selecting a date by its position among the matching weekdays of a
-- month, which is how "the last working day" is expressed.

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

-- Selecting the date ----------------------------------------------------------

-- October 2026 ends on a Saturday, so its last working day is Friday the 30th.
-- This is the case "every month on the 31st" gets wrong.
select pg_temp.check('last working day of Oct 2026',
  app.nth_weekday_of_month('2026-10-01', array[1,2,3,4,5], -1), '2026-10-30'::date);

-- November 2026 ends on a Monday, so the last working day IS the last day.
select pg_temp.check('last working day of Nov 2026',
  app.nth_weekday_of_month('2026-11-01', array[1,2,3,4,5], -1), '2026-11-30'::date);

select pg_temp.check('last Friday of Oct 2026',
  app.nth_weekday_of_month('2026-10-01', array[5], -1), '2026-10-30'::date);
select pg_temp.check('first Monday of Oct 2026',
  app.nth_weekday_of_month('2026-10-01', array[1], 1), '2026-10-05'::date);
select pg_temp.check('third Tuesday of Oct 2026',
  app.nth_weekday_of_month('2026-10-01', array[2], 3), '2026-10-20'::date);
select pg_temp.check('second-to-last Friday of Oct 2026',
  app.nth_weekday_of_month('2026-10-01', array[5], -2), '2026-10-23'::date);

-- A month with only four Mondays has no fifth one.
select pg_temp.check('fifth Monday of Oct 2026 does not exist',
  app.nth_weekday_of_month('2026-10-01', array[1], 5), null::date);
select pg_temp.check('fifth Monday of Nov 2026 does',
  app.nth_weekday_of_month('2026-11-01', array[1], 5), '2026-11-30'::date);

-- Any day in the month identifies it, not just the first.
select pg_temp.check('any day in the month selects the same date',
  app.nth_weekday_of_month('2026-10-17', array[1,2,3,4,5], -1), '2026-10-30'::date);

-- February, including a leap year.
select pg_temp.check('last working day of Feb 2027',
  app.nth_weekday_of_month('2027-02-01', array[1,2,3,4,5], -1), '2027-02-26'::date);
select pg_temp.check('last working day of Feb 2028 (leap)',
  app.nth_weekday_of_month('2028-02-01', array[1,2,3,4,5], -1), '2028-02-29'::date);

-- Validation ------------------------------------------------------------------

select pg_temp.check('a monthly setpos rule with weekdays is valid',
  app.is_valid_recurrence('{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1}'::jsonb), true);

-- setpos only means something when it has weekdays to select from, monthly.
select pg_temp.check('setpos without weekdays is rejected',
  app.is_valid_recurrence('{"freq":"monthly","setpos":-1}'::jsonb), false);
select pg_temp.check('setpos on a weekly rule is rejected',
  app.is_valid_recurrence('{"freq":"weekly","weekdays":[5],"setpos":-1}'::jsonb), false);
select pg_temp.check('setpos on a daily rule is rejected',
  app.is_valid_recurrence('{"freq":"daily","setpos":1}'::jsonb), false);
select pg_temp.check('setpos of zero is rejected',
  app.is_valid_recurrence('{"freq":"monthly","weekdays":[1],"setpos":0}'::jsonb), false);
select pg_temp.check('setpos beyond a month''s reach is rejected',
  app.is_valid_recurrence('{"freq":"monthly","weekdays":[1],"setpos":6}'::jsonb), false);
select pg_temp.check('setpos of -6 is rejected',
  app.is_valid_recurrence('{"freq":"monthly","weekdays":[1],"setpos":-6}'::jsonb), false);
select pg_temp.check('a fractional setpos is rejected',
  app.is_valid_recurrence('{"freq":"monthly","weekdays":[1],"setpos":1.5}'::jsonb), false);

-- Monthly weekdays without a setpos stay rejected: it would be ambiguous.
select pg_temp.check('monthly weekdays without setpos is still rejected',
  app.is_valid_recurrence('{"freq":"monthly","weekdays":[1]}'::jsonb), false);

-- The rules that existed before must not have changed meaning.
select pg_temp.check('a weekly weekday rule is still valid',
  app.is_valid_recurrence('{"freq":"weekly","weekdays":[1,3,5]}'::jsonb), true);
select pg_temp.check('a plain monthly rule is still valid',
  app.is_valid_recurrence('{"freq":"monthly","interval":2}'::jsonb), true);

-- Stepping the series ---------------------------------------------------------

select pg_temp.check('a working-day series moves to the next month',
  app.next_occurrence(
    '{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1,"anchor":"2026-10-30","occurrence":0}'::jsonb,
    '2026-10-30'),
  '2026-11-30'::date);

-- Across a year boundary, and into a January that ends on a Sunday.
select pg_temp.check('and across the year end',
  app.next_occurrence(
    '{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1,"anchor":"2026-10-30","occurrence":2}'::jsonb,
    '2026-12-31'),
  '2027-01-29'::date);

-- A quarterly interval steps three months, not three occurrences.
select pg_temp.check('an interval of 3 steps a quarter',
  app.next_occurrence(
    '{"freq":"monthly","weekdays":[1],"setpos":1,"interval":3,"anchor":"2026-10-05","occurrence":0}'::jsonb,
    '2026-10-05'),
  '2027-01-04'::date);

-- A period with no matching date is skipped rather than ending the series.
select pg_temp.check('a fifth-Monday series skips months that have four',
  app.next_occurrence(
    '{"freq":"monthly","weekdays":[1],"setpos":5,"anchor":"2026-11-30","occurrence":0}'::jsonb,
    '2026-11-30'),
  '2027-03-29'::date);

-- until and remaining still terminate a setpos series.
select pg_temp.check('until ends a setpos series',
  app.next_occurrence(
    '{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1,"anchor":"2026-10-30","until":"2026-11-01"}'::jsonb,
    '2026-10-30'),
  null::date);
select pg_temp.check('an exhausted count ends a setpos series',
  app.next_occurrence(
    '{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1,"anchor":"2026-10-30","remaining":0}'::jsonb,
    '2026-10-30'),
  null::date);

-- advance_recurrence keeps the anchor and counts months, where the weekly
-- weekday path drops the occurrence entirely.
select pg_temp.check('advancing a setpos rule keeps its anchor',
  app.advance_recurrence(
    '{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1,"anchor":"2026-10-30"}'::jsonb,
    '2026-11-30') ->> 'anchor',
  '2026-10-30');
select pg_temp.check('and records the month it has reached',
  app.advance_recurrence(
    '{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1,"anchor":"2026-10-30"}'::jsonb,
    '2027-01-29') ->> 'occurrence',
  '3');
select pg_temp.check('a weekly weekday rule still drops its occurrence',
  app.advance_recurrence(
    '{"freq":"weekly","weekdays":[1,3],"anchor":"2026-10-26"}'::jsonb,
    '2026-10-28') ? 'occurrence',
  false);

-- End to end, through a real task ----------------------------------------------

insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111', 'alice@example.com', '{"full_name":"Alice"}');

insert into public.workspaces (id, name, kind, owner_id)
values ('33333333-3333-4333-8333-333333333333', 'Acme', 'team',
        '11111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role)
values ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111', 'owner');

insert into public.tasks (id, workspace_id, title, status, due_date, created_by, recurrence)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        '33333333-3333-4333-8333-333333333333',
        'File the month-end report', 'todo', '2026-10-30',
        '11111111-1111-4111-8111-111111111111',
        '{"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1,"anchor":"2026-10-30"}'::jsonb);

update public.tasks set status = 'completed'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select recurrence_spawned_task_id as nxt from public.tasks
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
\gset

select pg_temp.check('completing it schedules the next month''s working day',
  (select due_date from public.tasks where id = :'nxt'::uuid), '2026-11-30'::date);

select pg_temp.check('and the successor carries the rule forward',
  (select recurrence ->> 'setpos' from public.tasks where id = :'nxt'::uuid), '-1');

-- Walk the series a year forward; no occurrence may land on a weekend.
do $$
declare
  v_id uuid := (select recurrence_spawned_task_id from public.tasks
                where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  v_next uuid;
  v_due date;
  v_weekend int := 0;
begin
  for i in 1..12 loop
    update public.tasks set status = 'completed' where id = v_id;
    select recurrence_spawned_task_id into v_next from public.tasks where id = v_id;
    exit when v_next is null;
    select due_date into v_due from public.tasks where id = v_next;
    if extract(isodow from v_due)::int > 5 then
      v_weekend := v_weekend + 1;
      raise warning 'occurrence % fell on %', v_due, to_char(v_due, 'Dy');
    end if;
    v_id := v_next;
  end loop;

  if v_weekend > 0 then
    raise exception 'FAIL % occurrence(s) of a working-day series fell on a weekend', v_weekend;
  end if;
  raise notice 'ok   a year of a working-day series never lands on a weekend';
end;
$$;

rollback;
