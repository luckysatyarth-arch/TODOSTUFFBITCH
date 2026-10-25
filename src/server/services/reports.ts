import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';
import { OPEN_STATUSES } from '@/lib/validation/common';
import {
  DEFAULT_TIMEZONE, addCalendarDays, endOfDayUtc, nextWorkingDay, startOfDayUtc, todayIn,
} from '@/lib/dates';
import { getAiProvider } from '@/server/ai/provider';
import { reportNarrative } from '@/server/ai/schemas';
import { publicEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/database.types';

type Client = ReturnType<typeof createSupabaseAdminClient>
  | Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Priority = Database['public']['Enums']['priority_level'];

export interface ReportTaskRef {
  id: string;
  title: string;
  priority: Priority;
  status: string;
  dueDate: string | null;
  assigneeName: string | null;
  projectName: string | null;
  url: string;
}

export interface ReportContent {
  scope: 'personal' | 'team';
  reportDate: string;
  timezone: string;
  workspaceName: string;
  subjectName: string | null;
  completedToday: ReportTaskRef[];
  remainingToday: ReportTaskRef[];
  overdue: ReportTaskRef[];
  importantUnfinished: ReportTaskRef[];
  blocked: ReportTaskRef[];
  upcomingDeadlines: ReportTaskRef[];
  tomorrowPriorities: ReportTaskRef[];
  needsOwner: ReportTaskRef[];
  projects: Array<{
    id: string; name: string; completed: number; total: number;
    percent: number | null; overdue: number; blocked: number; url: string;
  }>;
  milestonesAtRisk: Array<{ id: string; name: string; dueDate: string | null; projectName: string | null }>;
  upcomingEvents: Array<{ id: string; title: string; when: string }>;
  perMember: Array<{ name: string; completed: number; open: number; overdue: number }>;
  /** Narrative is optional; the numbers above never depend on it. */
  narrative: { headline: string; attention: string[]; tomorrow: string[] } | null;
}

export interface ReportMetrics {
  completedToday: number;
  remainingToday: number;
  overdue: number;
  blocked: number;
  upcoming: number;
  /** Any record at all. Drives the "do not send an empty report" rule. */
  hasActivity: boolean;
}

const TASK_SELECT =
  'id, title, status, priority, due_date, assignee_id, project_id, projects(name), profiles!tasks_assignee_id_fkey(full_name)';

type TaskRow = {
  id: string; title: string; status: string; priority: Priority;
  due_date: string | null; assignee_id: string | null; project_id: string | null;
  projects: { name: string } | null; profiles: { full_name: string | null } | null;
};

function toRef(row: TaskRow, workspaceId: string): ReportTaskRef {
  return {
    id: row.id,
    title: row.title,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date,
    assigneeName: row.profiles?.full_name ?? null,
    projectName: row.projects?.name ?? null,
    url: `${publicEnv.NEXT_PUBLIC_APP_URL}/tasks/${row.id}?workspace=${workspaceId}`,
  };
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export interface BuildReportOptions {
  client: Client;
  workspaceId: string;
  scope: 'personal' | 'team';
  /** Required for a personal report; must be null for a team report. */
  subjectUserId: string | null;
  reportDate?: string;
  /** Narrative generation is skipped when false or when no AI key is set. */
  withNarrative?: boolean;
}

/**
 * Assembles a report from task records.
 *
 * Every count and every list here comes from a SQL query over real rows. The
 * model, if configured at all, only writes a headline and two short lists of
 * emphasis over data that was already computed -- it is never the source of a
 * number, a name or a date. That is what the brief means by reports using
 * actual task records rather than AI assumptions.
 */
export async function buildReport(
  options: BuildReportOptions,
): Promise<{ content: ReportContent; metrics: ReportMetrics }> {
  const { client, workspaceId, scope, subjectUserId } = options;

  const { data: workspace } = await client
    .from('workspaces').select('name, timezone').eq('id', workspaceId).maybeSingle();
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found.`);

  const timezone = workspace.timezone ?? DEFAULT_TIMEZONE;
  const reportDate = options.reportDate ?? todayIn(timezone);
  const tomorrow = nextWorkingDay(reportDate);
  const horizon = addCalendarDays(reportDate, 7);

  let subjectName: string | null = null;
  if (scope === 'personal' && subjectUserId) {
    const { data: profile } = await client
      .from('profiles').select('full_name').eq('id', subjectUserId).maybeSingle();
    subjectName = profile?.full_name ?? null;
  }

  // A personal report covers only that person's own work; a team report covers
  // the whole team workspace. The two never mix.
  const scoped = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    scope === 'personal' && subjectUserId ? q.eq('assignee_id', subjectUserId) : q;

  const [completedRes, openRes, projectsRes, progressRes, milestonesRes, eventsRes, membersRes] =
    await Promise.all([
      scoped(
        client.from('tasks').select(TASK_SELECT)
          .eq('workspace_id', workspaceId)
          .eq('status', 'completed')
          .gte('completed_at', startOfDayUtc(reportDate, timezone).toISOString())
          .lt('completed_at', endOfDayUtc(reportDate, timezone).toISOString())
          .limit(500),
      ),
      scoped(
        client.from('tasks').select(TASK_SELECT)
          .eq('workspace_id', workspaceId)
          .in('status', [...OPEN_STATUSES])
          .limit(2000),
      ),
      client.from('projects').select('id, name, status')
        .eq('workspace_id', workspaceId).is('archived_at', null)
        .not('status', 'in', '("completed","cancelled")').limit(100),
      client.from('project_progress').select('*').eq('workspace_id', workspaceId),
      client.from('milestones').select('id, name, due_date, status, projects(name)')
        .eq('workspace_id', workspaceId)
        .not('status', 'eq', 'completed')
        .lte('due_date', horizon)
        .order('due_date', { ascending: true }).limit(20),
      client.from('calendar_events')
        .select('id, title, is_all_day, start_date, starts_at')
        .eq('workspace_id', workspaceId)
        .or(
          `and(start_date.gte.${reportDate},start_date.lte.${horizon}),` +
          `and(starts_at.gte.${startOfDayUtc(reportDate, timezone).toISOString()},` +
          `starts_at.lt.${endOfDayUtc(horizon, timezone).toISOString()})`,
        )
        .limit(20),
      scope === 'team'
        ? client.from('workspace_members').select('user_id, profiles(full_name)')
            .eq('workspace_id', workspaceId)
        : Promise.resolve({ data: null }),
    ]);

  const completed = ((completedRes.data ?? []) as unknown as TaskRow[]).map((r) => toRef(r, workspaceId));
  const open = ((openRes.data ?? []) as unknown as TaskRow[]).map((r) => toRef(r, workspaceId));

  const remainingToday = open.filter((t) => t.dueDate === reportDate);
  const overdue = open
    .filter((t) => t.dueDate !== null && t.dueDate < reportDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const blocked = open.filter((t) => t.status === 'blocked');
  const upcomingDeadlines = open
    .filter((t) => t.dueDate !== null && t.dueDate > reportDate && t.dueDate <= horizon)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));

  // "Important but unfinished": urgent/high work that is not due today and is
  // not already counted as overdue, so the lists do not repeat each other.
  const importantUnfinished = open
    .filter(
      (t) =>
        (t.priority === 'urgent' || t.priority === 'high') &&
        t.dueDate !== reportDate &&
        !(t.dueDate !== null && t.dueDate < reportDate),
    )
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 10);

  const tomorrowPriorities = [
    ...open.filter((t) => t.dueDate === tomorrow),
    ...overdue.slice(0, 5),
  ]
    .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 8);

  const needsOwner = scope === 'team' ? open.filter((t) => t.assigneeName === null) : [];

  const progressById = new Map((progressRes.data ?? []).map((p) => [p.project_id as string, p]));
  const projects = (projectsRes.data ?? []).map((p) => {
    const prog = progressById.get(p.id);
    return {
      id: p.id,
      name: p.name,
      completed: Number(prog?.completed_tasks ?? 0),
      total: Number(prog?.total_tasks ?? 0),
      percent:
        prog?.percent_complete === null || prog?.percent_complete === undefined
          ? null
          : Number(prog.percent_complete),
      overdue: Number(prog?.overdue_tasks ?? 0),
      blocked: Number(prog?.blocked_tasks ?? 0),
      url: `${publicEnv.NEXT_PUBLIC_APP_URL}/projects/${p.id}?workspace=${workspaceId}`,
    };
  });

  const perMember = (membersRes.data ?? [])
    .map((m) => {
      const name = (m.profiles as { full_name: string | null } | null)?.full_name ?? 'Unknown';
      const theirs = open.filter((t) => t.assigneeName === name);
      return {
        name,
        completed: completed.filter((t) => t.assigneeName === name).length,
        open: theirs.length,
        overdue: theirs.filter((t) => t.dueDate !== null && t.dueDate < reportDate).length,
      };
    })
    .filter((m) => m.completed > 0 || m.open > 0);

  const content: ReportContent = {
    scope,
    reportDate,
    timezone,
    workspaceName: workspace.name,
    subjectName,
    completedToday: completed,
    remainingToday,
    overdue,
    importantUnfinished,
    blocked,
    upcomingDeadlines,
    tomorrowPriorities,
    needsOwner,
    projects,
    milestonesAtRisk: (milestonesRes.data ?? [])
      .filter((m) => m.due_date !== null && m.due_date <= horizon)
      .map((m) => ({
        id: m.id, name: m.name, dueDate: m.due_date,
        projectName: (m.projects as { name: string } | null)?.name ?? null,
      })),
    upcomingEvents: (eventsRes.data ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      when: e.is_all_day
        ? `${e.start_date} (all day)`
        : (e.starts_at ?? ''),
    })),
    perMember,
    narrative: null,
  };

  const metrics: ReportMetrics = {
    completedToday: completed.length,
    remainingToday: remainingToday.length,
    overdue: overdue.length,
    blocked: blocked.length,
    upcoming: upcomingDeadlines.length,
    hasActivity:
      completed.length + open.length + projects.length + content.upcomingEvents.length > 0,
  };

  if (options.withNarrative !== false) {
    content.narrative = await buildNarrative(content).catch(() => null);
  }

  return { content, metrics };
}

/**
 * Optional narrative layer.
 *
 * The model is given only the already-computed figures and told to add no new
 * facts. If it is unavailable or fails, the report still sends with its
 * numbers intact, which is why the caller treats a failure as non-fatal.
 */
async function buildNarrative(content: ReportContent) {
  const provider = getAiProvider();
  if (!provider) return null;

  const facts = {
    scope: content.scope,
    date: content.reportDate,
    completed_today: content.completedToday.map((t) => t.title),
    remaining_today: content.remainingToday.map((t) => t.title),
    overdue: content.overdue.map((t) => `${t.title} (due ${t.dueDate})`),
    blocked: content.blocked.map((t) => t.title),
    upcoming: content.upcomingDeadlines.map((t) => `${t.title} (due ${t.dueDate})`),
    tomorrow: content.tomorrowPriorities.map((t) => t.title),
    needs_owner: content.needsOwner.map((t) => t.title),
    projects: content.projects.map((p) => `${p.name}: ${p.completed}/${p.total}`),
    milestones_at_risk: content.milestonesAtRisk.map((m) => `${m.name} (${m.dueDate})`),
  };

  return provider.structured({
    system:
      'You write a two-line framing for a daily work report. You are given figures that ' +
      'have already been computed from database records. Use ONLY those figures. Do not ' +
      'invent tasks, people, dates, numbers or progress. Do not restate every item: pick ' +
      'what genuinely needs attention. If a list is empty, say nothing about it rather ' +
      'than speculating. Be concise and factual, never encouraging or evaluative.',
    user: `Figures:\n${JSON.stringify(facts, null, 2)}`,
    schema: reportNarrative,
    schemaName: 'report_narrative',
    effort: 'low',
    maxTokens: 2_000,
  });
}

/** Renders the report as WhatsApp-friendly plain text. */
export function renderReportText(content: ReportContent): string {
  const lines: string[] = [];
  const heading =
    content.scope === 'personal'
      ? `*Daily summary — ${formatDay(content.reportDate)}*`
      : `*${content.workspaceName} — team summary, ${formatDay(content.reportDate)}*`;
  lines.push(heading);

  if (content.narrative?.headline) lines.push('', content.narrative.headline);

  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push('', `*${title}*`);
    for (const item of items.slice(0, 10)) lines.push(`• ${item}`);
    if (items.length > 10) lines.push(`• …and ${items.length - 10} more`);
  };

  const label = (t: ReportTaskRef, withOwner = false) => {
    const owner = withOwner && t.assigneeName ? ` — ${t.assigneeName}` : '';
    const due = t.dueDate ? ` (due ${formatDay(t.dueDate)})` : '';
    return `${t.title}${owner}${due}`;
  };

  const team = content.scope === 'team';

  section(
    team ? 'Completed by the team today' : 'Completed today',
    content.completedToday.map((t) => label(t, team)),
  );
  section('Still open today', content.remainingToday.map((t) => label(t, team)));
  section('Overdue', content.overdue.map((t) => label(t, team)));
  section('Important and unfinished', content.importantUnfinished.map((t) => label(t, team)));
  section('Blocked', content.blocked.map((t) => label(t, team)));
  section('Upcoming deadlines', content.upcomingDeadlines.map((t) => label(t, team)));

  if (team) section('Needs an owner or a decision', content.needsOwner.map((t) => t.title));

  if (content.milestonesAtRisk.length > 0) {
    section(
      'Milestones at risk',
      content.milestonesAtRisk.map(
        (m) => `${m.name}${m.projectName ? ` (${m.projectName})` : ''} — ${m.dueDate}`,
      ),
    );
  }

  if (content.projects.length > 0) {
    section(
      'Project progress',
      content.projects.map(
        (p) =>
          `${p.name}: ${p.completed}/${p.total}` +
          `${p.percent === null ? ' (no tasks yet)' : ` (${p.percent}%)`}` +
          `${p.overdue > 0 ? `, ${p.overdue} overdue` : ''}` +
          `${p.blocked > 0 ? `, ${p.blocked} blocked` : ''}`,
      ),
    );
  }

  if (team && content.perMember.length > 0) {
    section(
      'By team member',
      content.perMember.map(
        (m) =>
          `${m.name}: ${m.completed} done, ${m.open} open` +
          `${m.overdue > 0 ? `, ${m.overdue} overdue` : ''}`,
      ),
    );
  }

  section(
    team ? 'Priorities for the next working day' : 'Top priorities for tomorrow',
    content.tomorrowPriorities.map((t) => label(t, team)),
  );

  if (content.narrative?.attention?.length) {
    section('Needs attention', content.narrative.attention);
  }

  lines.push('', `${publicEnv.NEXT_PUBLIC_APP_URL}/home`);
  return lines.join('\n');
}

function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
}
