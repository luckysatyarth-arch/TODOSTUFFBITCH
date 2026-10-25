import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CLOSED_STATUSES, OPEN_STATUSES, PRIORITY_ORDER } from '@/lib/validation/common';
import { addCalendarDays, endOfDayUtc, startOfDayUtc, todayIn } from '@/lib/dates';
import type { Database } from '@/lib/supabase/database.types';
import type { WorkspaceSummary } from '@/server/auth';

type TaskStatus = Database['public']['Enums']['task_status'];
type Priority = Database['public']['Enums']['priority_level'];

export interface TaskBrief {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface ProjectProgressBrief {
  projectId: string;
  name: string;
  status: Database['public']['Enums']['project_status'];
  targetDate: string | null;
  total: number;
  completed: number;
  remaining: number;
  blocked: number;
  overdue: number;
  /** Null when the project has no non-cancelled tasks, rather than a fake 0%. */
  percentComplete: number | null;
}

const TASK_SELECT =
  'id, title, status, priority, due_date, project_id, assignee_id, ' +
  'projects(name), profiles!tasks_assignee_id_fkey(full_name)';

type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  project_id: string | null;
  assignee_id: string | null;
  projects: { name: string } | null;
  profiles: { full_name: string | null } | null;
};

function toBrief(row: TaskRow): TaskBrief {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    projectId: row.project_id,
    projectName: row.projects?.name ?? null,
    assigneeId: row.assignee_id,
    assigneeName: row.profiles?.full_name ?? null,
  };
}

/** Urgent first, then soonest due; undated work sorts last. */
function byPriorityThenDue(a: TaskBrief, b: TaskBrief): number {
  const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (p !== 0) return p;
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}

export interface PersonalDashboard {
  today: string;
  dueToday: TaskBrief[];
  completedToday: TaskBrief[];
  overdue: TaskBrief[];
  remaining: TaskBrief[];
  upcoming: TaskBrief[];
  topPriorities: TaskBrief[];
  blocked: TaskBrief[];
  projects: ProjectProgressBrief[];
  events: Array<{
    id: string; title: string; isAllDay: boolean;
    startDate: string | null; startsAt: string | null;
  }>;
  recentCaptures: Array<{
    id: string; kind: string; status: string; title: string | null; createdAt: string;
  }>;
  pendingProposals: number;
  counts: {
    dueToday: number; completedToday: number; remaining: number;
    overdue: number; blocked: number;
  };
}

/**
 * Personal dashboard. Scoped to the workspace AND to work the user owns or is
 * assigned, so a personal view never silently widens into the whole team.
 */
export async function getPersonalDashboard(
  workspace: WorkspaceSummary,
  userId: string,
  now = new Date(),
): Promise<PersonalDashboard> {
  const supabase = await createSupabaseServerClient();
  const tz = workspace.timezone;
  const today = todayIn(tz, now);
  const horizon = addCalendarDays(today, 14);

  const mine = (q: ReturnType<typeof buildBase>) =>
    // In a personal workspace everything is the user's; in a team workspace
    // this view is deliberately limited to their own assignments.
    workspace.kind === 'personal' ? q : q.or(`assignee_id.eq.${userId},created_by.eq.${userId}`);

  function buildBase() {
    return supabase.from('tasks').select(TASK_SELECT).eq('workspace_id', workspace.id);
  }

  const [openRes, completedTodayRes, eventsRes, projectsRes, progressRes, capturesRes, proposalsRes] =
    await Promise.all([
      mine(buildBase()).in('status', [...OPEN_STATUSES]).limit(500),
      mine(buildBase())
        .eq('status', 'completed')
        .gte('completed_at', startOfDayUtc(today, tz).toISOString())
        .lt('completed_at', endOfDayUtc(today, tz).toISOString())
        .limit(200),
      supabase
        .from('calendar_events')
        .select('id, title, is_all_day, start_date, starts_at')
        .eq('workspace_id', workspace.id)
        .or(`start_date.gte.${today},starts_at.gte.${startOfDayUtc(today, tz).toISOString()}`)
        .order('start_date', { ascending: true, nullsFirst: false })
        .limit(10),
      supabase
        .from('projects')
        .select('id, name, status, target_date')
        .eq('workspace_id', workspace.id)
        .is('archived_at', null)
        .not('status', 'in', '("completed","cancelled")')
        .limit(50),
      supabase.from('project_progress').select('*').eq('workspace_id', workspace.id),
      supabase
        .from('captures')
        .select('id, kind, status, title, created_at')
        .eq('workspace_id', workspace.id)
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('proposed_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .eq('status', 'pending'),
    ]);

  const open = ((openRes.data ?? []) as unknown as TaskRow[]).map(toBrief);
  const completedToday = ((completedTodayRes.data ?? []) as unknown as TaskRow[]).map(toBrief);

  const dueToday = open.filter((t) => t.dueDate === today).sort(byPriorityThenDue);
  const overdue = open
    .filter((t) => t.dueDate !== null && t.dueDate < today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const upcoming = open
    .filter((t) => t.dueDate !== null && t.dueDate > today && t.dueDate <= horizon)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const blocked = open.filter((t) => t.status === 'blocked');

  const progressById = new Map(
    (progressRes.data ?? []).map((p) => [p.project_id as string, p]),
  );

  const projects: ProjectProgressBrief[] = (projectsRes.data ?? []).map((p) => {
    const prog = progressById.get(p.id);
    return {
      projectId: p.id,
      name: p.name,
      status: p.status,
      targetDate: p.target_date,
      total: Number(prog?.total_tasks ?? 0),
      completed: Number(prog?.completed_tasks ?? 0),
      remaining: Number(prog?.remaining_tasks ?? 0),
      blocked: Number(prog?.blocked_tasks ?? 0),
      overdue: Number(prog?.overdue_tasks ?? 0),
      percentComplete:
        prog?.percent_complete === null || prog?.percent_complete === undefined
          ? null
          : Number(prog.percent_complete),
    };
  });

  return {
    today,
    dueToday,
    completedToday,
    overdue,
    remaining: open.sort(byPriorityThenDue).slice(0, 50),
    upcoming,
    // "Needs attention now": overdue first, then today's work, by priority.
    topPriorities: [...overdue, ...dueToday].sort(byPriorityThenDue).slice(0, 5),
    blocked,
    projects,
    events: (eventsRes.data ?? []).map((e) => ({
      id: e.id, title: e.title, isAllDay: e.is_all_day,
      startDate: e.start_date, startsAt: e.starts_at,
    })),
    recentCaptures: (capturesRes.data ?? []).map((c) => ({
      id: c.id, kind: c.kind, status: c.status, title: c.title, createdAt: c.created_at,
    })),
    pendingProposals: proposalsRes.count ?? 0,
    counts: {
      dueToday: dueToday.length,
      completedToday: completedToday.length,
      remaining: open.length,
      overdue: overdue.length,
      blocked: blocked.length,
    },
  };
}

export interface TeamMemberWorkload {
  userId: string;
  name: string;
  role: string;
  assigned: number;
  completed: number;
  open: number;
  overdue: number;
  blocked: number;
  estimatedMinutes: number;
  dueThisWeek: number;
}

export interface TeamDashboard {
  today: string;
  counts: {
    assigned: number; completed: number; pending: number;
    overdue: number; blocked: number; unassigned: number;
  };
  priorityDistribution: Record<Priority, number>;
  workload: TeamMemberWorkload[];
  projectsAtRisk: ProjectProgressBrief[];
  projects: ProjectProgressBrief[];
  upcomingMilestones: Array<{
    id: string; name: string; dueDate: string | null; status: string;
    projectId: string; projectName: string | null; atRisk: boolean;
  }>;
  upcomingDeadlines: TaskBrief[];
  recentlyCompleted: TaskBrief[];
  needsOwner: TaskBrief[];
  blocked: TaskBrief[];
  events: Array<{
    id: string; title: string; isAllDay: boolean;
    startDate: string | null; startsAt: string | null;
  }>;
}

export interface TeamDashboardFilters {
  projectId?: string;
  assigneeId?: string;
  status?: TaskStatus[];
  priority?: Priority[];
  dueFrom?: string;
  dueTo?: string;
}

/**
 * Team dashboard. Reads only the given team workspace, so no personal
 * workspace data can reach it: the workspace id is the boundary and RLS
 * enforces it independently.
 */
export async function getTeamDashboard(
  workspace: WorkspaceSummary,
  filters: TeamDashboardFilters = {},
  now = new Date(),
): Promise<TeamDashboard> {
  const supabase = await createSupabaseServerClient();
  const tz = workspace.timezone;
  const today = todayIn(tz, now);
  const weekEnd = addCalendarDays(today, 7);
  const horizon = addCalendarDays(today, 30);

  // Built as a reassigned chain rather than through a generic helper, so the
  // generated client keeps its row types all the way through.
  function buildFilteredTaskQuery() {
    let query = supabase
      .from('tasks')
      .select(TASK_SELECT + ', estimated_minutes')
      .eq('workspace_id', workspace.id)
      .not('status', 'eq', 'cancelled')
      .limit(2000);

    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    if (filters.assigneeId) query = query.eq('assignee_id', filters.assigneeId);
    if (filters.status?.length) query = query.in('status', filters.status);
    if (filters.priority?.length) query = query.in('priority', filters.priority);
    if (filters.dueFrom) query = query.gte('due_date', filters.dueFrom);
    if (filters.dueTo) query = query.lte('due_date', filters.dueTo);
    return query;
  }

  const [allRes, membersRes, projectsRes, progressRes, milestonesRes, eventsRes, recentRes] =
    await Promise.all([
      buildFilteredTaskQuery(),
      supabase
        .from('workspace_members')
        .select('user_id, role, profiles(full_name)')
        .eq('workspace_id', workspace.id),
      supabase
        .from('projects')
        .select('id, name, status, target_date')
        .eq('workspace_id', workspace.id)
        .is('archived_at', null)
        .limit(200),
      supabase.from('project_progress').select('*').eq('workspace_id', workspace.id),
      supabase
        .from('milestones')
        .select('id, name, due_date, status, project_id, projects(name)')
        .eq('workspace_id', workspace.id)
        .not('status', 'eq', 'completed')
        .lte('due_date', horizon)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from('calendar_events')
        .select('id, title, is_all_day, start_date, starts_at')
        .eq('workspace_id', workspace.id)
        .or(`start_date.gte.${today},starts_at.gte.${startOfDayUtc(today, tz).toISOString()}`)
        .order('start_date', { ascending: true, nullsFirst: false })
        .limit(10),
      supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('workspace_id', workspace.id)
        .eq('status', 'completed')
        .gte('completed_at', startOfDayUtc(addCalendarDays(today, -7), tz).toISOString())
        .order('completed_at', { ascending: false })
        .limit(15),
    ]);

  type WithEstimate = TaskRow & { estimated_minutes: number | null };
  const all = (allRes.data ?? []) as unknown as WithEstimate[];
  const briefs = all.map(toBrief);

  const open = all.filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status));
  const completed = all.filter((t) => t.status === 'completed');
  const overdue = open.filter((t) => t.due_date !== null && t.due_date < today);
  const blocked = open.filter((t) => t.status === 'blocked');
  const unassigned = open.filter((t) => t.assignee_id === null);

  const priorityDistribution: Record<Priority, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
  for (const t of open) priorityDistribution[t.priority] += 1;

  const workload: TeamMemberWorkload[] = (membersRes.data ?? []).map((m) => {
    const theirs = all.filter((t) => t.assignee_id === m.user_id);
    const theirOpen = theirs.filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status));
    return {
      userId: m.user_id,
      name: m.profiles?.full_name ?? 'Unknown',
      role: m.role,
      assigned: theirs.length,
      completed: theirs.filter((t) => t.status === 'completed').length,
      open: theirOpen.length,
      overdue: theirOpen.filter((t) => t.due_date !== null && t.due_date < today).length,
      blocked: theirOpen.filter((t) => t.status === 'blocked').length,
      estimatedMinutes: theirOpen.reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0),
      dueThisWeek: theirOpen.filter(
        (t) => t.due_date !== null && t.due_date >= today && t.due_date <= weekEnd,
      ).length,
    };
  }).sort((a, b) => b.open - a.open);

  const progressById = new Map((progressRes.data ?? []).map((p) => [p.project_id as string, p]));
  const projects: ProjectProgressBrief[] = (projectsRes.data ?? []).map((p) => {
    const prog = progressById.get(p.id);
    return {
      projectId: p.id, name: p.name, status: p.status, targetDate: p.target_date,
      total: Number(prog?.total_tasks ?? 0),
      completed: Number(prog?.completed_tasks ?? 0),
      remaining: Number(prog?.remaining_tasks ?? 0),
      blocked: Number(prog?.blocked_tasks ?? 0),
      overdue: Number(prog?.overdue_tasks ?? 0),
      percentComplete:
        prog?.percent_complete === null || prog?.percent_complete === undefined
          ? null : Number(prog.percent_complete),
    };
  });

  // "At risk" is stated in terms the user can check: it has overdue or blocked
  // work, or its target date has passed with work still open.
  const projectsAtRisk = projects.filter(
    (p) =>
      p.overdue > 0 ||
      p.blocked > 0 ||
      (p.targetDate !== null && p.targetDate < today && p.remaining > 0),
  );

  return {
    today,
    counts: {
      assigned: all.filter((t) => t.assignee_id !== null).length,
      completed: completed.length,
      pending: open.length,
      overdue: overdue.length,
      blocked: blocked.length,
      unassigned: unassigned.length,
    },
    priorityDistribution,
    workload,
    projectsAtRisk,
    projects,
    upcomingMilestones: (milestonesRes.data ?? []).map((m) => ({
      id: m.id, name: m.name, dueDate: m.due_date, status: m.status,
      projectId: m.project_id, projectName: m.projects?.name ?? null,
      atRisk: m.due_date !== null && m.due_date < today,
    })),
    upcomingDeadlines: briefs
      .filter((t) => !(CLOSED_STATUSES as readonly string[]).includes(t.status))
      .filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= weekEnd)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    recentlyCompleted: ((recentRes.data ?? []) as unknown as TaskRow[]).map(toBrief),
    needsOwner: unassigned.map(toBrief).sort(byPriorityThenDue),
    blocked: blocked.map(toBrief),
    events: (eventsRes.data ?? []).map((e) => ({
      id: e.id, title: e.title, isAllDay: e.is_all_day,
      startDate: e.start_date, startsAt: e.starts_at,
    })),
  };
}
