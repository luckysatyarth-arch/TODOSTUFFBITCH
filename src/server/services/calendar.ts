import { createSupabaseServerClient } from '@/lib/supabase/server';
import { addCalendarDays, monthRange, startOfDayUtc, endOfDayUtc, todayIn } from '@/lib/dates';
import { OPEN_STATUSES } from '@/lib/validation/common';
import type { Database } from '@/lib/supabase/database.types';
import type { WorkspaceSummary } from '@/server/auth';

type TaskStatus = Database['public']['Enums']['task_status'];
type Priority = Database['public']['Enums']['priority_level'];

export interface CalendarTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  assigneeId: string | null;
  assigneeName: string | null;
  projectId: string | null;
  projectName: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  isAllDay: boolean;
  startDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  projectId: string | null;
}

export interface CalendarMilestone {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  projectId: string;
  projectName: string | null;
}

export interface CalendarMonth {
  month: number;
  year: number;
  /** Keyed by YYYY-MM-DD so a day cell is one map lookup. */
  tasksByDate: Map<string, CalendarTask[]>;
  eventsByDate: Map<string, CalendarEvent[]>;
  milestonesByDate: Map<string, CalendarMilestone[]>;
}

/**
 * Loads one month of schedulable records.
 *
 * Timed events are bucketed by their date *in the workspace timezone*, not
 * UTC, so a 1am IST meeting appears on the correct Indian day rather than the
 * previous UTC one.
 */
export async function getCalendarMonth(
  workspace: WorkspaceSummary,
  year: number,
  month: number,
): Promise<CalendarMonth> {
  const supabase = await createSupabaseServerClient();
  const { first, last } = monthRange(year, month);

  // Pad the window by a week either side so the leading/trailing days of the
  // grid (which belong to the adjacent months) are populated too.
  const from = addCalendarDays(first, -7);
  const to = addCalendarDays(last, 7);

  const [tasksRes, eventsRes, milestonesRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, assignee_id, project_id, projects(name), profiles!tasks_assignee_id_fkey(full_name)')
      .eq('workspace_id', workspace.id)
      .not('due_date', 'is', null)
      .gte('due_date', from)
      .lte('due_date', to)
      .limit(2000),
    supabase
      .from('calendar_events')
      .select('id, title, is_all_day, start_date, starts_at, ends_at, location, project_id')
      .eq('workspace_id', workspace.id)
      .or(
        `and(start_date.gte.${from},start_date.lte.${to}),` +
        `and(starts_at.gte.${startOfDayUtc(from, workspace.timezone).toISOString()},` +
        `starts_at.lt.${endOfDayUtc(to, workspace.timezone).toISOString()})`,
      )
      .limit(1000),
    supabase
      .from('milestones')
      .select('id, name, due_date, status, project_id, projects(name)')
      .eq('workspace_id', workspace.id)
      .not('due_date', 'is', null)
      .gte('due_date', from)
      .lte('due_date', to)
      .limit(500),
  ]);

  const tasksByDate = new Map<string, CalendarTask[]>();
  for (const row of tasksRes.data ?? []) {
    if (!row.due_date) continue;
    const task: CalendarTask = {
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueDate: row.due_date,
      assigneeId: row.assignee_id,
      assigneeName: (row.profiles as { full_name: string | null } | null)?.full_name ?? null,
      projectId: row.project_id,
      projectName: (row.projects as { name: string } | null)?.name ?? null,
    };
    push(tasksByDate, row.due_date, task);
  }

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const row of eventsRes.data ?? []) {
    const event: CalendarEvent = {
      id: row.id,
      title: row.title,
      isAllDay: row.is_all_day,
      startDate: row.start_date,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      location: row.location,
      projectId: row.project_id,
    };
    // An all-day event already carries a zone-free date. A timed one is
    // converted into the workspace zone before being bucketed.
    const key = row.is_all_day
      ? row.start_date
      : row.starts_at
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: workspace.timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date(row.starts_at))
        : null;
    if (key) push(eventsByDate, key, event);
  }

  const milestonesByDate = new Map<string, CalendarMilestone[]>();
  for (const row of milestonesRes.data ?? []) {
    if (!row.due_date) continue;
    push(milestonesByDate, row.due_date, {
      id: row.id,
      name: row.name,
      dueDate: row.due_date,
      status: row.status,
      projectId: row.project_id,
      projectName: (row.projects as { name: string } | null)?.name ?? null,
    });
  }

  return { year, month, tasksByDate, eventsByDate, milestonesByDate };
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

export interface DayDetail {
  date: string;
  completed: CalendarTask[];
  incomplete: CalendarTask[];
  overdueAsOf: CalendarTask[];
  byAssignee: Array<{
    userId: string | null; name: string; total: number; completed: number; open: number;
  }>;
  events: CalendarEvent[];
  milestones: CalendarMilestone[];
  blocked: CalendarTask[];
  projects: Array<{
    projectId: string; name: string;
    dueThisDay: number; completedThisDay: number; remainingThisDay: number;
  }>;
  upcomingAfter: CalendarTask[];
}

/**
 * Everything relevant to a single clicked date.
 *
 * `overdueAsOf` is the open work that was already past its due date *on that
 * date*, which is what makes a past day's view historically meaningful rather
 * than just showing today's overdue list.
 */
export async function getDayDetail(
  workspace: WorkspaceSummary,
  date: string,
  now = new Date(),
): Promise<DayDetail> {
  const supabase = await createSupabaseServerClient();
  const today = todayIn(workspace.timezone, now);

  const [dueRes, completedRes, overdueRes, eventsRes, milestonesRes, upcomingRes] =
    await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, assignee_id, project_id, projects(name), profiles!tasks_assignee_id_fkey(full_name)')
        .eq('workspace_id', workspace.id)
        .eq('due_date', date)
        .limit(500),
      // Completed on that calendar day, by completion timestamp rather than
      // due date, so "what got done" is accurate.
      supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, assignee_id, project_id, projects(name), profiles!tasks_assignee_id_fkey(full_name)')
        .eq('workspace_id', workspace.id)
        .eq('status', 'completed')
        .gte('completed_at', startOfDayUtc(date, workspace.timezone).toISOString())
        .lt('completed_at', endOfDayUtc(date, workspace.timezone).toISOString())
        .limit(500),
      supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, assignee_id, project_id, projects(name), profiles!tasks_assignee_id_fkey(full_name)')
        .eq('workspace_id', workspace.id)
        .in('status', [...OPEN_STATUSES])
        .lt('due_date', date)
        .limit(500),
      supabase
        .from('calendar_events')
        .select('id, title, is_all_day, start_date, starts_at, ends_at, location, project_id')
        .eq('workspace_id', workspace.id)
        .or(
          `start_date.eq.${date},` +
          `and(starts_at.gte.${startOfDayUtc(date, workspace.timezone).toISOString()},` +
          `starts_at.lt.${endOfDayUtc(date, workspace.timezone).toISOString()})`,
        )
        .limit(100),
      supabase
        .from('milestones')
        .select('id, name, due_date, status, project_id, projects(name)')
        .eq('workspace_id', workspace.id)
        .eq('due_date', date)
        .limit(100),
      supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, assignee_id, project_id, projects(name), profiles!tasks_assignee_id_fkey(full_name)')
        .eq('workspace_id', workspace.id)
        .in('status', [...OPEN_STATUSES])
        .gt('due_date', date)
        .lte('due_date', addCalendarDays(date, 7))
        .order('due_date', { ascending: true })
        .limit(50),
    ]);

  type RawTask = {
    id: string; title: string; status: TaskStatus; priority: Priority;
    due_date: string | null; assignee_id: string | null; project_id: string | null;
    projects: { name: string } | null; profiles: { full_name: string | null } | null;
  };

  const toTask = (r: RawTask): CalendarTask => ({
    id: r.id, title: r.title, status: r.status, priority: r.priority,
    dueDate: r.due_date ?? date,
    assigneeId: r.assignee_id,
    assigneeName: r.profiles?.full_name ?? null,
    projectId: r.project_id,
    projectName: r.projects?.name ?? null,
  });

  const due = ((dueRes.data ?? []) as unknown as RawTask[]).map(toTask);
  const completedThatDay = ((completedRes.data ?? []) as unknown as RawTask[]).map(toTask);
  const overdueAsOf = ((overdueRes.data ?? []) as unknown as RawTask[]).map(toTask);

  const completed = due.filter((t) => t.status === 'completed');
  const incomplete = due.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');

  // Union of work due that day and work completed that day, so the per-person
  // breakdown reflects both.
  const forPeople = [...due];
  for (const t of completedThatDay) {
    if (!forPeople.some((x) => x.id === t.id)) forPeople.push(t);
  }

  const peopleMap = new Map<string, {
    userId: string | null; name: string; total: number; completed: number; open: number;
  }>();
  for (const t of forPeople) {
    const key = t.assigneeId ?? '__unassigned';
    const entry = peopleMap.get(key) ?? {
      userId: t.assigneeId,
      name: t.assigneeName ?? 'Unassigned',
      total: 0, completed: 0, open: 0,
    };
    entry.total += 1;
    if (t.status === 'completed') entry.completed += 1;
    else if (t.status !== 'cancelled') entry.open += 1;
    peopleMap.set(key, entry);
  }

  const projectMap = new Map<string, {
    projectId: string; name: string;
    dueThisDay: number; completedThisDay: number; remainingThisDay: number;
  }>();
  for (const t of due) {
    if (!t.projectId) continue;
    const entry = projectMap.get(t.projectId) ?? {
      projectId: t.projectId,
      name: t.projectName ?? 'Unknown project',
      dueThisDay: 0, completedThisDay: 0, remainingThisDay: 0,
    };
    entry.dueThisDay += 1;
    if (t.status === 'completed') entry.completedThisDay += 1;
    else if (t.status !== 'cancelled') entry.remainingThisDay += 1;
    projectMap.set(t.projectId, entry);
  }

  return {
    date,
    completed: completedThatDay.length > 0 ? completedThatDay : completed,
    incomplete,
    // A future date has no history to be overdue against.
    overdueAsOf: date <= today ? overdueAsOf : [],
    byAssignee: [...peopleMap.values()].sort((a, b) => b.total - a.total),
    events: (eventsRes.data ?? []).map((r) => ({
      id: r.id, title: r.title, isAllDay: r.is_all_day,
      startDate: r.start_date, startsAt: r.starts_at, endsAt: r.ends_at,
      location: r.location, projectId: r.project_id,
    })),
    milestones: (milestonesRes.data ?? []).map((r) => ({
      id: r.id, name: r.name, dueDate: r.due_date!, status: r.status,
      projectId: r.project_id,
      projectName: (r.projects as { name: string } | null)?.name ?? null,
    })),
    blocked: incomplete.filter((t) => t.status === 'blocked'),
    projects: [...projectMap.values()],
    upcomingAfter: ((upcomingRes.data ?? []) as unknown as RawTask[]).map(toTask),
  };
}
