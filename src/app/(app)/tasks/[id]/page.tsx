import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mic } from 'lucide-react';
import { resolvePageContext } from '@/server/page-context';
import { getTaskDetail, listWorkspaceMembers, listWorkspaceProjects } from '@/server/services/tasks';
import { canWrite } from '@/server/auth';
import { formatDateIn, todayIn } from '@/lib/dates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, PriorityBadge, STATUS_LABELS } from '@/components/ui/labels';
import { TaskEditor } from '@/components/tasks/task-editor';
import { CommentThread } from '@/components/tasks/comment-thread';

export const metadata = { title: 'Task' };

export default async function TaskDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { session, workspace } = await resolvePageContext(searchParams);

  const task = await getTaskDetail(id);
  // Covers both "no such task" and "filtered out by RLS", without confirming
  // which, so a probe cannot learn that an id exists.
  if (!task) notFound();

  const [members, projects] = await Promise.all([
    listWorkspaceMembers(workspace.id),
    listWorkspaceProjects(workspace.id),
  ]);

  const writable = canWrite(workspace.role);
  const today = todayIn(workspace.timezone);
  const overdue =
    task.dueDate !== null &&
    task.dueDate < today &&
    task.status !== 'completed' &&
    task.status !== 'cancelled';

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/tasks?workspace=${workspace.id}`}
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        All tasks
      </Link>

      <div className="mb-4">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {overdue ? <Badge tone="urgent">Overdue</Badge> : null}
          {task.projectName ? (
            <Link href={`/projects/${task.projectId}?workspace=${workspace.id}`}>
              <Badge tone="outline">{task.projectName}</Badge>
            </Link>
          ) : null}
        </div>
        <h1 className="text-xl font-semibold text-ink">{task.title}</h1>
        <p className="mt-1 text-xs text-ink-faint">
          Created {formatDateIn(task.createdAt, workspace.timezone)}
          {task.createdByName ? ` by ${task.createdByName}` : ''}
          {task.completedAt
            ? ` · Completed ${formatDateIn(task.completedAt, workspace.timezone)}`
            : ''}
        </p>
      </div>

      {task.capture ? (
        <Card className="mb-4 border-accent/30 bg-accent-soft/30">
          <CardContent className="flex items-center gap-2 pt-3">
            <Mic className="size-3.5 shrink-0 text-accent" />
            <p className="text-xs text-ink-soft">
              Created from an approved proposal out of a{' '}
              {task.capture.kind.replace('_', ' ')} capture
              {task.capture.title ? ` (“${task.capture.title}”)` : ''}.
            </p>
            <Link
              href={`/inbox?workspace=${workspace.id}&capture=${task.capture.id}`}
              className="ml-auto shrink-0 text-xs text-accent hover:underline"
            >
              View source
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-4">
          <TaskEditor
            task={task}
            canWrite={writable}
            members={members.map((m) => ({ id: m.id, name: m.name }))}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            workspaceId={workspace.id}
          />

          {task.subtasks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Subtasks</CardTitle>
                <Badge>
                  {task.subtasks.filter((s) => s.status === 'completed').length}/
                  {task.subtasks.length}
                </Badge>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {task.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-sm">
                      <StatusBadge status={s.status} />
                      <Link
                        href={`/tasks/${s.id}?workspace=${workspace.id}`}
                        className="min-w-0 flex-1 truncate text-ink hover:text-accent"
                      >
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {task.dependencies.length > 0 || task.dependents.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Dependencies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {task.dependencies.length > 0 ? (
                  <div>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Waiting on
                    </p>
                    <ul className="space-y-1">
                      {task.dependencies.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-sm">
                          <StatusBadge status={d.status} />
                          <Link
                            href={`/tasks/${d.id}?workspace=${workspace.id}`}
                            className="min-w-0 flex-1 truncate text-ink hover:text-accent"
                          >
                            {d.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {task.dependents.length > 0 ? (
                  <div>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Blocking
                    </p>
                    <ul className="space-y-1">
                      {task.dependents.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-sm">
                          <StatusBadge status={d.status} />
                          <Link
                            href={`/tasks/${d.id}?workspace=${workspace.id}`}
                            className="min-w-0 flex-1 truncate text-ink hover:text-accent"
                          >
                            {d.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <CommentThread
            taskId={task.id}
            comments={task.comments}
            canWrite={writable}
            timezone={workspace.timezone}
            currentUserId={session.userId}
          />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <Field label="Assignee" value={task.assigneeName ?? 'Unassigned'} />
              <Field
                label="Start"
                value={task.startDate ? formatDateIn(task.startDate) : '—'}
              />
              <Field
                label="Due"
                value={task.dueDate ? formatDateIn(task.dueDate) : '—'}
              />
              <Field
                label="Estimated"
                value={task.estimatedMinutes ? `${task.estimatedMinutes} min` : '—'}
              />
              <Field
                label="Logged"
                value={task.actualMinutes ? `${task.actualMinutes} min` : '—'}
              />
              {task.tags.length > 0 ? (
                <div>
                  <p className="text-ink-faint">Tags</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {task.tags.map((t) => <Badge key={t} tone="outline">{t}</Badge>)}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              {task.activity.length === 0 ? (
                <p className="text-xs text-ink-faint">No activity recorded.</p>
              ) : (
                <ol className="space-y-2">
                  {task.activity.map((a) => (
                    <li key={a.id} className="text-[11px] leading-snug text-ink-faint">
                      <span className="text-ink-soft">{describeActivity(a)}</span>
                      <br />
                      {formatDateIn(a.createdAt, workspace.timezone, 'd MMM, HH:mm')}
                      {a.actorName ? ` · ${a.actorName}` : ''}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-faint">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}

/** Renders a trigger-written activity row in plain language. */
function describeActivity(a: {
  action: string; field: string | null; fromValue: unknown; toValue: unknown;
}): string {
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return 'nothing';
    if (typeof v === 'string') {
      return (STATUS_LABELS as Record<string, string>)[v] ?? v;
    }
    return String(v);
  };

  switch (a.action) {
    case 'created': return 'Task created';
    case 'created_from_proposal': return 'Created from an approved AI proposal';
    case 'status_changed': return `Status: ${text(a.fromValue)} → ${text(a.toValue)}`;
    case 'priority_changed': return `Priority: ${text(a.fromValue)} → ${text(a.toValue)}`;
    case 'due_date_changed': return `Due date: ${text(a.fromValue)} → ${text(a.toValue)}`;
    case 'assignee_changed': return 'Assignee changed';
    default: return a.action.replace(/_/g, ' ');
  }
}
