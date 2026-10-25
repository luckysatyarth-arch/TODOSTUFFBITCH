import { CheckSquare } from 'lucide-react';
import { resolvePageContext, one, many } from '@/server/page-context';
import { listTasks, listWorkspaceMembers, listWorkspaceProjects } from '@/server/services/tasks';
import { taskFilters } from '@/lib/validation/tasks';
import { canWrite } from '@/server/auth';
import { todayIn, formatDateIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { TaskRow } from '@/components/task-row';
import { TaskFilters } from '@/components/tasks/task-filters';
import { TaskBoard } from '@/components/tasks/task-board';
import { TaskTable } from '@/components/tasks/task-table';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/components/ui/labels';
import type { TaskListItem } from '@/server/services/tasks';

export const metadata = { title: 'My Tasks' };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, workspace, params } = await resolvePageContext(searchParams);

  const filters = taskFilters.parse({
    workspaceId: workspace.id,
    view: one(params.view) ?? 'all',
    status: many(params.status).length ? many(params.status) : undefined,
    priority: many(params.priority).length ? many(params.priority) : undefined,
    assigneeId: one(params.assignee),
    projectId: one(params.project),
    dueFrom: one(params.dueFrom),
    dueTo: one(params.dueTo),
    search: one(params.q),
    groupBy: one(params.groupBy) ?? 'none',
    sortBy: one(params.sortBy) ?? 'due_date',
    sortDir: one(params.sortDir) ?? 'asc',
  });

  const [tasks, members, projects] = await Promise.all([
    listTasks(workspace, session.userId, filters),
    listWorkspaceMembers(workspace.id),
    listWorkspaceProjects(workspace.id),
  ]);

  const layout = one(params.layout) ?? 'list';
  const today = todayIn(workspace.timezone);
  const writable = canWrite(workspace.role);

  return (
    <>
      <PageHeader
        title="Tasks"
        description={`${tasks.length} task${tasks.length === 1 ? '' : 's'} in ${workspace.name}${
          writable ? '' : ' · read-only role'
        }`}
      >
        <TaskFilters
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </PageHeader>

      {tasks.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No tasks match these filters"
              hint={
                filters.view === 'all'
                  ? 'Use the Capture button to add one, or clear the filters above.'
                  : 'Try a different view or clear the filters above.'
              }
              icon={<CheckSquare className="size-5" />}
            />
          </CardContent>
        </Card>
      ) : layout === 'board' ? (
        <TaskBoard
          tasks={tasks}
          workspaceId={workspace.id}
          today={today}
          canWrite={writable}
        />
      ) : layout === 'table' ? (
        <TaskTable
          tasks={tasks}
          workspaceId={workspace.id}
          today={today}
          canWrite={writable}
          members={members.map((m) => ({ id: m.id, name: m.name }))}
        />
      ) : (
        <GroupedList
          tasks={tasks}
          groupBy={filters.groupBy}
          workspaceId={workspace.id}
          today={today}
          members={members}
          projects={projects}
        />
      )}
    </>
  );
}

/** List view, optionally grouped. Groups are rendered in a stable order. */
function GroupedList({
  tasks, groupBy, workspaceId, today, members, projects,
}: {
  tasks: TaskListItem[];
  groupBy: 'none' | 'status' | 'priority' | 'assignee' | 'project' | 'due';
  workspaceId: string;
  today: string;
  members: Array<{ id: string; name: string | null }>;
  projects: Array<{ id: string; name: string }>;
}) {
  if (groupBy === 'none') {
    return (
      <Card>
        <CardContent className="pt-2">
          <ul>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} workspaceId={workspaceId} today={today} showAssignee />
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const groups = new Map<string, TaskListItem[]>();
  for (const task of tasks) {
    const key = groupKey(task, groupBy, today, members, projects);
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([label, group]) => (
        <Card key={label}>
          <CardContent className="pt-3">
            <h2 className="mb-1 flex items-center justify-between text-xs font-semibold text-ink">
              <span>{label}</span>
              <span className="tabular-nums text-ink-faint">{group.length}</span>
            </h2>
            <ul>
              {group.map((t) => (
                <TaskRow key={t.id} task={t} workspaceId={workspaceId} today={today} showAssignee />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function groupKey(
  task: TaskListItem,
  groupBy: 'status' | 'priority' | 'assignee' | 'project' | 'due',
  today: string,
  members: Array<{ id: string; name: string | null }>,
  projects: Array<{ id: string; name: string }>,
): string {
  switch (groupBy) {
    case 'status':
      return STATUS_LABELS[task.status];
    case 'priority':
      return PRIORITY_LABELS[task.priority];
    case 'assignee':
      return task.assigneeId
        ? (members.find((m) => m.id === task.assigneeId)?.name ?? 'Unknown')
        : 'Unassigned';
    case 'project':
      return task.projectId
        ? (projects.find((p) => p.id === task.projectId)?.name ?? 'Unknown project')
        : 'No project';
    case 'due': {
      if (!task.dueDate) return 'No due date';
      if (task.dueDate < today) return 'Overdue';
      if (task.dueDate === today) return 'Today';
      return formatDateIn(task.dueDate, undefined, 'MMMM yyyy');
    }
  }
}
