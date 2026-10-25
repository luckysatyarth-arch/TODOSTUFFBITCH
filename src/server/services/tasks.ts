import { createSupabaseServerClient } from '@/lib/supabase/server';
import { OPEN_STATUSES, PRIORITY_ORDER } from '@/lib/validation/common';
import { todayIn } from '@/lib/dates';
import type { TaskFilters } from '@/lib/validation/tasks';
import type { Database } from '@/lib/supabase/database.types';
import type { WorkspaceSummary } from '@/server/auth';

type TaskStatus = Database['public']['Enums']['task_status'];
type Priority = Database['public']['Enums']['priority_level'];

export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  startDate: string | null;
  projectId: string | null;
  projectName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  tags: string[];
  estimatedMinutes: number | null;
  boardPosition: number;
  parentTaskId: string | null;
  sourceCaptureId: string | null;
  completedAt: string | null;
  updatedAt: string;
}

const LIST_SELECT =
  'id, title, description, status, priority, due_date, start_date, project_id, ' +
  'assignee_id, tags, estimated_minutes, board_position, parent_task_id, ' +
  'source_capture_id, completed_at, updated_at, ' +
  'projects(name), profiles!tasks_assignee_id_fkey(full_name)';

type Row = {
  id: string; title: string; description: string | null;
  status: TaskStatus; priority: Priority;
  due_date: string | null; start_date: string | null;
  project_id: string | null; assignee_id: string | null;
  tags: string[]; estimated_minutes: number | null; board_position: number;
  parent_task_id: string | null; source_capture_id: string | null;
  completed_at: string | null; updated_at: string;
  projects: { name: string } | null;
  profiles: { full_name: string | null } | null;
};

function mapRow(row: Row): TaskListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    startDate: row.start_date,
    projectId: row.project_id,
    projectName: row.projects?.name ?? null,
    assigneeId: row.assignee_id,
    assigneeName: row.profiles?.full_name ?? null,
    tags: row.tags ?? [],
    estimatedMinutes: row.estimated_minutes,
    boardPosition: Number(row.board_position ?? 0),
    parentTaskId: row.parent_task_id,
    sourceCaptureId: row.source_capture_id,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists tasks for a workspace under the caller's RLS.
 *
 * The named views ('overdue', 'blocked', ...) are applied as filters rather
 * than stored anywhere: "overdue" means an open task whose due date is before
 * today in the workspace timezone, and computing it here keeps that definition
 * in one place and identical to the dashboards and the reports.
 */
export async function listTasks(
  workspace: WorkspaceSummary,
  userId: string,
  filters: TaskFilters,
  now = new Date(),
): Promise<TaskListItem[]> {
  const supabase = await createSupabaseServerClient();
  const today = todayIn(workspace.timezone, now);

  let query = supabase
    .from('tasks')
    .select(LIST_SELECT)
    .eq('workspace_id', workspace.id);

  switch (filters.view) {
    case 'mine':
      query = query.eq('assignee_id', userId);
      break;
    case 'overdue':
      query = query.in('status', [...OPEN_STATUSES]).lt('due_date', today);
      break;
    case 'blocked':
      query = query.eq('status', 'blocked');
      break;
    case 'completed':
      query = query.eq('status', 'completed');
      break;
    case 'unscheduled':
      query = query.in('status', [...OPEN_STATUSES]).is('due_date', null);
      break;
    default:
      break;
  }

  if (filters.status?.length) query = query.in('status', filters.status);
  if (filters.priority?.length) query = query.in('priority', filters.priority);

  if (filters.assigneeId === 'unassigned') query = query.is('assignee_id', null);
  else if (filters.assigneeId === 'me') query = query.eq('assignee_id', userId);
  else if (filters.assigneeId) query = query.eq('assignee_id', filters.assigneeId);

  if (filters.projectId === 'none') query = query.is('project_id', null);
  else if (filters.projectId) query = query.eq('project_id', filters.projectId);

  if (filters.dueFrom) query = query.gte('due_date', filters.dueFrom);
  if (filters.dueTo) query = query.lte('due_date', filters.dueTo);
  if (filters.tags?.length) query = query.overlaps('tags', filters.tags);

  // Escaping % and _ keeps a user's literal search text from acting as a
  // wildcard pattern.
  if (filters.search) {
    const safe = filters.search.replace(/[%_\\]/g, (m) => `\\${m}`);
    query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const dbSortable = filters.sortBy !== 'priority';
  if (dbSortable) {
    query = query.order(filters.sortBy, {
      ascending: filters.sortDir === 'asc',
      nullsFirst: false,
    });
  }

  const { data, error } = await query.limit(1000);
  if (error) throw new Error(`Could not load tasks: ${error.message}`);

  const items = ((data ?? []) as unknown as Row[]).map(mapRow);

  // Priority is an enum, so the database would sort it alphabetically
  // (high, low, medium, urgent). Sort by real severity instead.
  if (!dbSortable) {
    items.sort((a, b) => {
      const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return filters.sortDir === 'asc' ? diff : -diff;
    });
  }

  return items;
}

export interface TaskDetail extends TaskListItem {
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  actualMinutes: number | null;
  dueAt: string | null;
  subtasks: TaskListItem[];
  comments: Array<{
    id: string; body: string; createdAt: string;
    authorId: string | null; authorName: string | null;
  }>;
  activity: Array<{
    id: string; action: string; field: string | null;
    fromValue: unknown; toValue: unknown;
    createdAt: string; actorName: string | null;
  }>;
  dependencies: Array<{ id: string; title: string; status: TaskStatus }>;
  dependents: Array<{ id: string; title: string; status: TaskStatus }>;
  attachments: Array<{ id: string; fileName: string; storagePath: string; sizeBytes: number | null }>;
  capture: { id: string; kind: string; title: string | null } | null;
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: taskData } = await supabase
    .from('tasks')
    .select(
      LIST_SELECT +
        ', created_by, created_at, actual_minutes, due_at, workspace_id, ' +
        'captures(id, kind, title)',
    )
    .eq('id', taskId)
    .maybeSingle();

  // Null here means either missing or filtered out by RLS; the caller treats
  // both as "not found", which avoids confirming that an id exists.
  if (!taskData) return null;

  // The select list is assembled from a constant, so it is not statically
  // analysable by the generated client types; narrow it once here.
  const task = taskData as unknown as Row & {
    created_by: string | null;
    created_at: string;
    actual_minutes: number | null;
    due_at: string | null;
    captures: { id: string; kind: string; title: string | null } | null;
  };

  const [subtasksRes, commentsRes, activityRes, depsRes, dependentsRes, attachRes, creatorRes] =
    await Promise.all([
      supabase.from('tasks').select(LIST_SELECT).eq('parent_task_id', taskId)
        .order('board_position', { ascending: true }),
      supabase.from('task_comments')
        .select('id, body, created_at, author_id, profiles(full_name)')
        .eq('task_id', taskId).order('created_at', { ascending: true }),
      supabase.from('task_activity')
        .select('id, action, field, from_value, to_value, created_at, profiles(full_name)')
        .eq('task_id', taskId).order('created_at', { ascending: false }).limit(60),
      supabase.from('task_dependencies')
        .select('depends_on_task_id, tasks!task_dependencies_depends_on_task_id_fkey(id, title, status)')
        .eq('task_id', taskId),
      supabase.from('task_dependencies')
        .select('task_id, tasks!task_dependencies_task_id_fkey(id, title, status)')
        .eq('depends_on_task_id', taskId),
      supabase.from('task_attachments')
        .select('id, file_name, storage_path, size_bytes').eq('task_id', taskId),
      task.created_by
        ? supabase.from('profiles').select('full_name').eq('id', task.created_by).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const base = mapRow(task);

  return {
    ...base,
    createdBy: task.created_by,
    createdByName: (creatorRes.data as { full_name: string | null } | null)?.full_name ?? null,
    createdAt: task.created_at,
    actualMinutes: task.actual_minutes,
    dueAt: task.due_at,
    capture: task.captures ?? null,
    subtasks: ((subtasksRes.data ?? []) as unknown as Row[]).map(mapRow),
    comments: (commentsRes.data ?? []).map((c) => ({
      id: c.id, body: c.body, createdAt: c.created_at,
      authorId: c.author_id,
      authorName: (c.profiles as { full_name: string | null } | null)?.full_name ?? null,
    })),
    activity: (activityRes.data ?? []).map((a) => ({
      id: a.id, action: a.action, field: a.field,
      fromValue: a.from_value, toValue: a.to_value, createdAt: a.created_at,
      actorName: (a.profiles as { full_name: string | null } | null)?.full_name ?? null,
    })),
    dependencies: (depsRes.data ?? []).flatMap((d) => {
      const t = d.tasks as { id: string; title: string; status: TaskStatus } | null;
      return t ? [t] : [];
    }),
    dependents: (dependentsRes.data ?? []).flatMap((d) => {
      const t = d.tasks as { id: string; title: string; status: TaskStatus } | null;
      return t ? [t] : [];
    }),
    attachments: (attachRes.data ?? []).map((a) => ({
      id: a.id, fileName: a.file_name, storagePath: a.storage_path, sizeBytes: a.size_bytes,
    })),
  };
}

/** Members of a workspace, for assignee pickers and workload views. */
export async function listWorkspaceMembers(workspaceId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('workspace_members')
    .select('user_id, role, profiles(full_name, email, avatar_url)')
    .eq('workspace_id', workspaceId);

  return (data ?? []).map((m) => ({
    id: m.user_id,
    role: m.role,
    name: (m.profiles as { full_name: string | null } | null)?.full_name ?? null,
    email: (m.profiles as { email: string } | null)?.email ?? null,
    avatarUrl: (m.profiles as { avatar_url: string | null } | null)?.avatar_url ?? null,
  }));
}

export async function listWorkspaceProjects(workspaceId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('projects')
    .select('id, name, status, priority, target_date')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('name');
  return data ?? [];
}
