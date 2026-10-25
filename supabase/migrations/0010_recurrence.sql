-- Recurring tasks.
--
-- `tasks.recurrence` existed as an unconstrained jsonb column that nothing
-- read or wrote, so a recurring task was a recurring task in name only. This
-- gives the column a defined shape, a CHECK that rejects anything else, and a
-- trigger that creates the next occurrence when one is explicitly completed.
--
-- The model is one task at a time, not a year of rows generated upfront: a
-- series advances only when a human marks the current occurrence Completed,
-- which keeps it inside the brief's rule that completion is an explicit status
-- change and never inferred.
--
-- Shape:
--   {
--     "freq":       "daily" | "weekly" | "monthly" | "yearly",
--     "interval":   1,                  -- every N periods, default 1
--     "weekdays":   [1,3,5],            -- weekly only; ISO, 1=Mon .. 7=Sun
--     "anchor":     "2026-01-31",       -- the series' first due date
--     "occurrence": 0,                  -- how many have been created so far
--     "until":      "2027-01-01",       -- optional last allowed date
--     "remaining":  10                  -- optional; how many FURTHER
--                                       --   occurrences to create after this one
--   }
--
-- `anchor` and `occurrence` are what keep a monthly series on its own day.
-- Adding a month repeatedly walks a 31st down to the 28th and leaves it there,
-- because February clamps and March then counts from the clamped day. Counting
-- from the anchor instead means the 31st returns whenever the month has one.

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------

create or replace function app.is_valid_recurrence(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_weekday jsonb;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;

  if not (p ? 'freq') or jsonb_typeof(p -> 'freq') <> 'string'
     or (p ->> 'freq') not in ('daily', 'weekly', 'monthly', 'yearly') then
    return false;
  end if;

  -- An absent interval means 1. A present one must be a positive integer, and
  -- is capped so a typo cannot schedule something a century out.
  if p ? 'interval' then
    if jsonb_typeof(p -> 'interval') <> 'number' then return false; end if;
    if (p ->> 'interval')::numeric <> trunc((p ->> 'interval')::numeric) then return false; end if;
    if (p ->> 'interval')::int < 1 or (p ->> 'interval')::int > 366 then return false; end if;
  end if;

  if p ? 'weekdays' then
    if (p ->> 'freq') <> 'weekly' then return false; end if;
    if jsonb_typeof(p -> 'weekdays') <> 'array' then return false; end if;
    if jsonb_array_length(p -> 'weekdays') = 0 then return false; end if;
    for v_weekday in select * from jsonb_array_elements(p -> 'weekdays') loop
      if jsonb_typeof(v_weekday) <> 'number' then return false; end if;
      if (v_weekday #>> '{}')::numeric not in (1,2,3,4,5,6,7) then return false; end if;
    end loop;
  end if;

  if p ? 'anchor' then
    if jsonb_typeof(p -> 'anchor') <> 'string' then return false; end if;
    begin
      perform (p ->> 'anchor')::date;
    exception when others then return false;
    end;
  end if;

  if p ? 'until' then
    if jsonb_typeof(p -> 'until') <> 'string' then return false; end if;
    begin
      perform (p ->> 'until')::date;
    exception when others then return false;
    end;
  end if;

  if p ? 'occurrence' then
    if jsonb_typeof(p -> 'occurrence') <> 'number' then return false; end if;
    if (p ->> 'occurrence')::numeric < 0 then return false; end if;
  end if;

  if p ? 'remaining' then
    if jsonb_typeof(p -> 'remaining') <> 'number' then return false; end if;
    if (p ->> 'remaining')::numeric < 0 then return false; end if;
  end if;

  -- Unknown keys are rejected rather than ignored, so a misspelled "weekday"
  -- fails loudly instead of silently recurring every day.
  return not exists (
    select 1 from jsonb_object_keys(p) as k
    where k not in ('freq','interval','weekdays','anchor','occurrence','until','remaining')
  );
end;
$$;

alter table public.tasks
  add constraint tasks_recurrence_shape
  check (app.is_valid_recurrence(recurrence));

-- ---------------------------------------------------------------------------
-- The date arithmetic
-- ---------------------------------------------------------------------------

/*
 * The next due date strictly after p_after, or null when the series has ended.
 *
 * Pure: it reads no tables and no clock, which is what makes a recurrence rule
 * something you can reason about and test rather than observe.
 */
create or replace function app.next_occurrence(p_recurrence jsonb, p_after date)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v_freq       text;
  v_interval   int;
  v_anchor     date;
  v_occurrence int;
  v_until      date;
  v_weekdays   int[];
  v_next       date;
  v_step       int;
  v_guard      int := 0;
begin
  if p_recurrence is null or p_after is null then return null; end if;

  v_freq       := p_recurrence ->> 'freq';
  v_interval   := coalesce((p_recurrence ->> 'interval')::int, 1);
  v_anchor     := coalesce((p_recurrence ->> 'anchor')::date, p_after);
  v_occurrence := coalesce((p_recurrence ->> 'occurrence')::int, 0);
  v_until      := (p_recurrence ->> 'until')::date;

  -- A series with no occurrences left has ended.
  if p_recurrence ? 'remaining' and (p_recurrence ->> 'remaining')::int <= 0 then
    return null;
  end if;

  if v_freq = 'weekly' and p_recurrence ? 'weekdays' then
    select array_agg((value #>> '{}')::int order by (value #>> '{}')::int)
      into v_weekdays
      from jsonb_array_elements(p_recurrence -> 'weekdays');

    -- Walk forward a day at a time to the next listed weekday. For an
    -- interval of one week this is the whole rule. For a longer interval the
    -- week itself has to be one of the active ones, counted from the anchor's
    -- week, so "every other Tuesday and Thursday" skips a whole week rather
    -- than every other named day.
    v_next := p_after;
    loop
      v_next := v_next + 1;
      v_guard := v_guard + 1;
      -- 7 days times the interval is the longest possible wait, plus a week of
      -- slack for the anchor-week alignment.
      exit when v_guard > 7 * (v_interval + 1) + 7;

      if extract(isodow from v_next)::int = any (v_weekdays) then
        if v_interval = 1 then
          exit;
        end if;
        -- Whole weeks between the anchor's week and this one, Monday-aligned.
        v_step := (
          (date_trunc('week', v_next::timestamp)::date
           - date_trunc('week', v_anchor::timestamp)::date) / 7
        )::int;
        exit when v_step % v_interval = 0;
      end if;
    end loop;

    if extract(isodow from v_next)::int <> all (v_weekdays) then
      return null;  -- unreachable for valid input; never guess a date
    end if;

  else
    -- Count from the anchor so a monthly series keeps its day of month. The
    -- loop advances the occurrence number until the result clears p_after,
    -- which also lets a series that was left alone for months catch up.
    loop
      v_occurrence := v_occurrence + 1;
      v_guard := v_guard + 1;
      exit when v_guard > 4000;

      v_next := case v_freq
        when 'daily'   then v_anchor + (v_interval * v_occurrence) * interval '1 day'
        when 'weekly'  then v_anchor + (v_interval * v_occurrence) * interval '1 week'
        when 'monthly' then v_anchor + (v_interval * v_occurrence) * interval '1 month'
        when 'yearly'  then v_anchor + (v_interval * v_occurrence) * interval '1 year'
      end::date;

      exit when v_next > p_after;
    end loop;

    if v_next is null or v_next <= p_after then return null; end if;
  end if;

  if v_until is not null and v_next > v_until then return null; end if;

  return v_next;
end;
$$;

/*
 * The recurrence to store on the occurrence that follows this one: the same
 * rule, with its position in the series advanced and its budget spent.
 */
create or replace function app.advance_recurrence(p_recurrence jsonb, p_next date)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_out       jsonb := p_recurrence;
  v_anchor    date;
  v_remaining int;
begin
  if p_recurrence is null then return null; end if;

  -- The first occurrence of a series fixes its anchor, which never moves
  -- again; every later date is counted from it.
  v_anchor := coalesce((p_recurrence ->> 'anchor')::date, p_next);
  v_out := jsonb_set(v_out, '{anchor}', to_jsonb(v_anchor::text), true);

  if p_recurrence ? 'weekdays' then
    -- The weekday path snaps to named days instead of counting periods, so it
    -- carries no occurrence number to advance.
    v_out := v_out - 'occurrence';
  else
    v_out := jsonb_set(
      v_out, '{occurrence}',
      to_jsonb(
        case (p_recurrence ->> 'freq')
          when 'daily'   then (p_next - v_anchor)
                              / greatest(coalesce((p_recurrence ->> 'interval')::int, 1), 1)
          when 'weekly'  then (p_next - v_anchor) / 7
                              / greatest(coalesce((p_recurrence ->> 'interval')::int, 1), 1)
          else round(
            (extract(year from p_next) * 12 + extract(month from p_next)
             - extract(year from v_anchor) * 12 - extract(month from v_anchor))
            / case (p_recurrence ->> 'freq') when 'yearly' then 12 else 1 end
            / greatest(coalesce((p_recurrence ->> 'interval')::int, 1), 1)
          )::int
        end
      ), true);
  end if;

  -- `remaining` counts the occurrences still to be created after this one, so
  -- spending the last of them leaves an ordinary, non-recurring task behind
  -- rather than a rule that can never fire.
  if p_recurrence ? 'remaining' then
    v_remaining := greatest((p_recurrence ->> 'remaining')::int - 1, 0);
    if v_remaining = 0 then
      return null;
    end if;
    v_out := jsonb_set(v_out, '{remaining}', to_jsonb(v_remaining), true);
  end if;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spawning the next occurrence
-- ---------------------------------------------------------------------------

-- Which task a completed occurrence produced. The partial unique index makes
-- re-completing a task idempotent: reopening and completing it again returns
-- to the same successor rather than forking the series.
alter table public.tasks
  add column if not exists recurrence_spawned_task_id uuid
    references public.tasks (id) on delete set null;

create unique index if not exists tasks_one_recurrence_successor
  on public.tasks (recurrence_spawned_task_id)
  where recurrence_spawned_task_id is not null;

create or replace function app.spawn_recurring_task()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_next       date;
  v_basis      date;
  v_recurrence jsonb;
  v_new_id     uuid;
begin
  -- Only an explicit transition into completed advances a series, and only
  -- once: a task that already has a successor has already advanced it.
  if new.recurrence is null
     or new.status <> 'completed'
     or old.status = 'completed'
     or new.recurrence_spawned_task_id is not null then
    return new;
  end if;

  -- Count from the occurrence's own due date so the series keeps its schedule
  -- whether it was finished early or late. With no due date there is nothing
  -- to count from, so fall back to the day it was completed.
  v_basis := coalesce(new.due_date, new.completed_at::date, current_date);
  v_next := app.next_occurrence(new.recurrence, v_basis);

  if v_next is null then
    return new;  -- the series ended with this one
  end if;

  v_recurrence := app.advance_recurrence(new.recurrence, v_next);

  insert into public.tasks (
    workspace_id, project_id, parent_task_id, title, description,
    status, priority, assignee_id, created_by,
    start_date, due_date, estimated_minutes, tags, recurrence
  ) values (
    new.workspace_id, new.project_id, new.parent_task_id, new.title, new.description,
    'todo', new.priority, new.assignee_id, new.created_by,
    -- Carry the gap between start and due forward unchanged.
    case when new.start_date is not null and new.due_date is not null
      then v_next - (new.due_date - new.start_date) end,
    v_next, new.estimated_minutes, new.tags, v_recurrence
  )
  returning id into v_new_id;

  new.recurrence_spawned_task_id := v_new_id;
  return new;
end;
$$;

-- BEFORE, so assigning recurrence_spawned_task_id on NEW is the write; an
-- AFTER trigger would need a second UPDATE and could recurse.
create or replace trigger tasks_spawn_recurrence
  before update of status on public.tasks
  for each row execute function app.spawn_recurring_task();

comment on column public.tasks.recurrence is
  'Recurrence rule; see app.is_valid_recurrence. The next occurrence is created when this one is explicitly completed.';
comment on column public.tasks.recurrence_spawned_task_id is
  'The occurrence this task produced on completion. Unique, so re-completion cannot fork the series.';
