import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { resolvePageContext } from '@/server/page-context';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import { formatDateIn, todayIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { PROJECT_STATUS_LABELS, ProgressBar, Stat } from '@/components/ui/labels';
import { TaskRow } from '@/components/task-row';

export const metadata = { title: 'Project' };

export default async function ProjectDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { workspace } = await resolvePageContext(searchParams);
  const supabase = await createSupabaseServerClient();
  const today = todayIn(workspace.timezone);

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description, status, priority, start_date, target_date, owner_id, workspace_id, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!project || project.workspace_id !== workspace.id) notFound();

  const [{ data: tasks }, { data: milestones }, { data: progress }, { data: notes }] =
    await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, assignee_id, project_id, profiles!tasks_assignee_id_fkey(full_name)')
        .eq('project_id', id)
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('milestones')
        .select('id, name, description, due_date, status')
        .eq('project_id', id)
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('project_progress').select('*').eq('project_id', id).maybeSingle(),
      supabase.from('notes').select('id, title, updated_at').eq('project_id', id).limit(20),
    ]);

  const rows = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.due_date,
    assigneeName: (t.profiles as { full_name: string | null } | null)?.full_name ?? null,
    projectName: null,
  }));

  const total = Number(progress?.total_tasks ?? 0);
  const completed = Number(progress?.completed_tasks ?? 0);
  const remaining = Number(progress?.remaining_tasks ?? 0);
  const blocked = Number(progress?.blocked_tasks ?? 0);
  const overdue = Number(progress?.overdue_tasks ?? 0);
  const percent =
    progress?.percent_complete === null || progress?.percent_complete === undefined
      ? null
      : Number(progress.percent_complete);

  // Stated in terms the reader can verify from the figures above.
  const scheduleHealth =
    project.target_date === null
      ? 'No target date set'
      : project.target_date < today && remaining > 0
        ? `Past its target date (${formatDateIn(project.target_date)}) with ${remaining} task(s) open`
        : overdue > 0
          ? `${overdue} task(s) past their own due date`
          : blocked > 0
            ? `${blocked} task(s) blocked`
            : 'On track against the recorded dates';

  const owners = new Map<string, { name: string; open: number; completed: number }>();
  for (const t of rows) {
    const key = t.assigneeName ?? 'Unassigned';
    const entry = owners.get(key) ?? { name: key, open: 0, completed: 0 };
    if (t.status === 'completed') entry.completed += 1;
    else if (t.status !== 'cancelled') entry.open += 1;
    owners.set(key, entry);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/projects?workspace=${workspace.id}`}
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        All projects
      </Link>

      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        actions={
          <div className="flex items-center gap-1.5">
            <Badge tone={project.status === 'active' ? 'accent' : 'neutral'}>
              {PROJECT_STATUS_LABELS[project.status]}
            </Badge>
            <Badge tone={project.priority}>{project.priority}</Badge>
          </div>
        }
      />

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total tasks" value={total} />
        <Stat label="Completed" value={completed} tone="done" />
        <Stat label="Remaining" value={remaining} />
        <Stat label="Overdue" value={overdue} tone="urgent" />
        <Stat label="Blocked" value={blocked} tone="blocked" />
      </section>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <ProgressBar percent={percent} label={`${project.name} progress`} />
          <p className="mt-1.5 text-xs text-ink-faint">
            {total === 0
              ? 'No tasks yet, so there is no progress figure to report.'
              : `${completed} of ${total} non-cancelled tasks complete. ` +
                'Progress is completed tasks divided by non-cancelled tasks.'}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            <span className="text-ink-faint">Schedule: </span>
            {scheduleHealth}
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-ink-faint">
            {project.start_date ? (
              <div><dt className="inline">Start: </dt>
                <dd className="inline text-ink-soft">{formatDateIn(project.start_date)}</dd></div>
            ) : null}
            {project.target_date ? (
              <div><dt className="inline">Target: </dt>
                <dd className="inline text-ink-soft">{formatDateIn(project.target_date)}</dd></div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
            <Badge>{(milestones ?? []).length}</Badge>
          </CardHeader>
          <CardContent>
            {(milestones ?? []).length === 0 ? (
              <EmptyState title="No milestones" />
            ) : (
              <ul className="space-y-1.5">
                {(milestones ?? []).map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <Badge
                      tone={
                        m.status === 'completed' ? 'done'
                          : m.due_date !== null && m.due_date < today ? 'urgent' : 'high'
                      }
                    >
                      {m.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {m.due_date ? formatDateIn(m.due_date, undefined, 'd MMM') : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workload</CardTitle>
          </CardHeader>
          <CardContent>
            {owners.size === 0 ? (
              <EmptyState title="No tasks assigned" />
            ) : (
              <ul className="space-y-1">
                {[...owners.values()].sort((a, b) => b.open - a.open).map((o) => (
                  <li key={o.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-ink">{o.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                      {o.completed} done · {o.open} open
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <Badge>{rows.length}</Badge>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState
                title="No tasks in this project"
                hint="Add one from the Tasks page and set its project to this one."
              />
            ) : (
              <ul>
                {rows.map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={today} showAssignee />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {(notes ?? []).length > 0 ? (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Documents & notes</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {(notes ?? []).map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-ink">{n.title}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {formatDateIn(n.updated_at, workspace.timezone, 'd MMM')}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
