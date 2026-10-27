-- `setpos`: "the last working day of the month", and its relatives.
--
-- LIMITATIONS.md named this as the gap in 0010's four frequencies, because it
-- is what a monthly reporting task actually wants. The four frequencies can
-- say "every month on the 31st", which is not the same thing and is wrong in
-- any month that ends on a weekend.
--
-- `setpos` selects from the dates in a period that match `weekdays`:
--
--   {"freq":"monthly","weekdays":[1,2,3,4,5],"setpos":-1}  last working day
--   {"freq":"monthly","weekdays":[5],"setpos":-1}          last Friday
--   {"freq":"monthly","weekdays":[2],"setpos":3}           third Tuesday
--   {"freq":"monthly","weekdays":[1],"setpos":1,"interval":3}  first Monday, quarterly
--
-- Positive counts from the start of the month, negative from the end. It is
-- monthly-only and requires `weekdays`: "the third Tuesday" of a week or a day
-- means nothing, and allowing it would only create rules that never fire.
--
-- A period with no matching date -- "the fifth Monday" of a month that has
-- four -- is skipped rather than ending the series. That is a deliberate
-- divergence from RFC 5545, which would simply produce no occurrence there:
-- for a task, skipping to the next eligible month is useful where silence is
-- just a task that stopped appearing.

create or replace function app.is_valid_recurrence(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_weekday jsonb;
  v_has_setpos boolean;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;

  if not (p ? 'freq') or jsonb_typeof(p -> 'freq') <> 'string'
     or (p ->> 'freq') not in ('daily', 'weekly', 'monthly', 'yearly') then
    return false;
  end if;

  v_has_setpos := p ? 'setpos';

  if v_has_setpos then
    if jsonb_typeof(p -> 'setpos') <> 'number' then return false; end if;
    if (p ->> 'setpos')::numeric <> trunc((p ->> 'setpos')::numeric) then return false; end if;
    -- A month holds at most five of any weekday, so anything outside -5..5
    -- (or zero, which has no meaning) could never select a date.
    if (p ->> 'setpos')::int = 0
       or (p ->> 'setpos')::int < -5 or (p ->> 'setpos')::int > 5 then
      return false;
    end if;
    -- setpos selects from the weekdays it is given, monthly.
    if (p ->> 'freq') <> 'monthly' or not (p ? 'weekdays') then return false; end if;
  end if;

  if p ? 'interval' then
    if jsonb_typeof(p -> 'interval') <> 'number' then return false; end if;
    if (p ->> 'interval')::numeric <> trunc((p ->> 'interval')::numeric) then return false; end if;
    if (p ->> 'interval')::int < 1 or (p ->> 'interval')::int > 366 then return false; end if;
  end if;

  if p ? 'weekdays' then
    -- Weekly means "on these days"; monthly means "these days, then setpos
    -- picks one". Monthly weekdays without a setpos would be ambiguous.
    if (p ->> 'freq') <> 'weekly' and not v_has_setpos then return false; end if;
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

  return not exists (
    select 1 from jsonb_object_keys(p) as k
    where k not in
      ('freq','interval','weekdays','setpos','anchor','occurrence','until','remaining')
  );
end;
$$;

/*
 * The setpos-th matching date within the month containing p_month_start, or
 * null when that month holds no such date.
 *
 * Kept separate because it is the whole of the new rule and is worth being
 * able to read, and test, on its own.
 */
create or replace function app.nth_weekday_of_month(
  p_month_start date,
  p_weekdays int[],
  p_setpos int
)
returns date language sql immutable set search_path = '' as $$
  with days as (
    select d::date as day
    from generate_series(
      date_trunc('month', p_month_start::timestamp)::date,
      (date_trunc('month', p_month_start::timestamp) + interval '1 month - 1 day')::date,
      interval '1 day'
    ) as d
    where extract(isodow from d)::int = any (p_weekdays)
  )
  select day from days
  order by case when p_setpos > 0 then day end asc nulls last,
           case when p_setpos < 0 then day end desc nulls last
  offset greatest(abs(p_setpos) - 1, 0)
  limit 1;
$$;

create or replace function app.next_occurrence(p_recurrence jsonb, p_after date)
returns date language plpgsql immutable set search_path = '' as $$
declare
  v_freq       text;
  v_interval   int;
  v_anchor     date;
  v_occurrence int;
  v_until      date;
  v_setpos     int;
  v_weekdays   int[];
  v_next       date;
  v_month      date;
  v_step       int;
  v_guard      int := 0;
begin
  if p_recurrence is null or p_after is null then return null; end if;

  v_freq       := p_recurrence ->> 'freq';
  v_interval   := coalesce((p_recurrence ->> 'interval')::int, 1);
  v_anchor     := coalesce((p_recurrence ->> 'anchor')::date, p_after);
  v_occurrence := coalesce((p_recurrence ->> 'occurrence')::int, 0);
  v_until      := (p_recurrence ->> 'until')::date;
  v_setpos     := (p_recurrence ->> 'setpos')::int;

  if p_recurrence ? 'remaining' and (p_recurrence ->> 'remaining')::int <= 0 then
    return null;
  end if;

  if p_recurrence ? 'weekdays' then
    select array_agg((value #>> '{}')::int order by (value #>> '{}')::int)
      into v_weekdays
      from jsonb_array_elements(p_recurrence -> 'weekdays');
  end if;

  if v_setpos is not null then
    -- Step whole months from the anchor's month, and in each one ask for the
    -- setpos-th matching day. The loop also skips a month that has no such
    -- day, and catches up a series left alone for a while.
    loop
      v_occurrence := v_occurrence + 1;
      v_guard := v_guard + 1;
      exit when v_guard > 1200;  -- a century of months

      v_month := (date_trunc('month', v_anchor::timestamp)
                  + (v_interval * v_occurrence) * interval '1 month')::date;
      v_next := app.nth_weekday_of_month(v_month, v_weekdays, v_setpos);

      exit when v_next is not null and v_next > p_after;
    end loop;

    if v_next is null or v_next <= p_after then return null; end if;

  elsif v_freq = 'weekly' and p_recurrence ? 'weekdays' then
    v_next := p_after;
    loop
      v_next := v_next + 1;
      v_guard := v_guard + 1;
      exit when v_guard > 7 * (v_interval + 1) + 7;

      if extract(isodow from v_next)::int = any (v_weekdays) then
        if v_interval = 1 then
          exit;
        end if;
        v_step := (
          (date_trunc('week', v_next::timestamp)::date
           - date_trunc('week', v_anchor::timestamp)::date) / 7
        )::int;
        exit when v_step % v_interval = 0;
      end if;
    end loop;

    if extract(isodow from v_next)::int <> all (v_weekdays) then
      return null;
    end if;

  else
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

create or replace function app.advance_recurrence(p_recurrence jsonb, p_next date)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_out       jsonb := p_recurrence;
  v_anchor    date;
  v_remaining int;
begin
  if p_recurrence is null then return null; end if;

  v_anchor := coalesce((p_recurrence ->> 'anchor')::date, p_next);
  v_out := jsonb_set(v_out, '{anchor}', to_jsonb(v_anchor::text), true);

  -- The weekly weekday path snaps to named days instead of counting periods,
  -- so it carries no occurrence number. A setpos rule does count periods --
  -- months -- even though it also has weekdays, so it keeps one.
  if p_recurrence ? 'weekdays' and not (p_recurrence ? 'setpos') then
    v_out := v_out - 'occurrence';
  else
    v_out := jsonb_set(
      v_out, '{occurrence}',
      to_jsonb(
        case
          when p_recurrence ? 'setpos' then
            -- Whole months between the anchor's month and the new date's.
            (((extract(year from p_next) * 12 + extract(month from p_next))
              - (extract(year from v_anchor) * 12 + extract(month from v_anchor)))
             / greatest(coalesce((p_recurrence ->> 'interval')::int, 1), 1))::int
          when (p_recurrence ->> 'freq') = 'daily' then (p_next - v_anchor)
                              / greatest(coalesce((p_recurrence ->> 'interval')::int, 1), 1)
          when (p_recurrence ->> 'freq') = 'weekly' then (p_next - v_anchor) / 7
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

revoke all on function app.nth_weekday_of_month(date, int[], int) from public;
