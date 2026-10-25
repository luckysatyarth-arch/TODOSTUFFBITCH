import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { resolvePageContext, one, many } from '@/server/page-context';
import { getTeamDashboard } from '@/server/services/dashboard';
import { listWorkspaceMembers, listWorkspaceProjects } from '@/server/services/tasks';
import { formatDateIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { PRIORITY_LABELS, ProgressBar, Stat } from '@/components/ui/labels';
import { TaskRow } from '@/components/task-row';
import { TeamFilters } from '@/components/team/team-filters';
import type { Priority, TaskStatus } from '@/components/tasks/types';

export const metadata = { title: 'Team' };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, params } = await resolvePageContext(searchParams);

  // The team view only means anything in a team workspace; a personal one has
  // no other members to report on.
  if (workspace.kind !== 'team') redirect(`/home?workspace=${workspace.id}`);

  const filters = {
    projectId: one(params.project),
    assigneeId: one(params.assignee),
    status: many(params.status) as TaskStatus[],
    priority: many(params.priority) as Priority[],
    dueFrom: one(params.dueFrom),
    dueTo: one(params.dueTo),
  };

  const [team, members, projects] = await Promise.all([
    getTeamDashboard(workspace, {
      projectId: filters.projectId,
      assigneeId: filters.assigneeId,
      status: filters.status.length ? filters.status : undefined,
      priority: filters.priority.length ? filters.priority : undefined,
      dueFrom: filters.dueFrom,
      dueTo: filters.dueTo,
    }),
    listWorkspaceMembers(workspace.id),
    listWorkspaceProjects(workspace.id),
  ]);

  const maxOpen = Math.max(1, ...team.workload.map((w) => w.open));

  return (
    <>
      <PageHeader
        title="Team"
        description={`${members.length} member${members.length === 1 ? '' : 's'} · ${workspace.name}`}
      >
        <TeamFilters
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </PageHeader>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Assigned" value={team.counts.assigned} />
        <Stat label="Completed" value={team.counts.completed} tone="done" />
        <Stat label="Pending" value={team.counts.pending} />
        <Stat label="Overdue" value={team.counts.overdue} tone="urgent" />
        <Stat label="Blocked" value={team.counts.blocked} tone="blocked" />
        <Stat label="Unassigned" value={team.counts.unassigned} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Workload by member</CardTitle>
            <span className="text-[11px] text-ink-faint">
              a guide to capacity, not a measure of productivity
            </span>
          </CardHeader>
          <CardContent>
            {team.workload.length === 0 ? (
              <EmptyState title="No members yet" icon={<Users className="size-5" />} />
            ) : (
              <ul className="space-y-2.5">
                {team.workload.map((w) => {
                  // Flagged relative to the busiest person, so a "heavy" label
                  // is about distribution rather than an invented threshold.
                  const heavy = w.open >= 8 && w.open >= maxOpen * 0.8;
                  return (
                    <li key={w.userId}>
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-ink">
                          {w.name}
                          <span className="ml-1.5 text-[11px] text-ink-faint">{w.role}</span>
                        </span>
                        <span className="text-[11px] tabular-nums text-ink-faint">
                          {w.open} open · {w.completed} done
                          {w.overdue > 0 ? ` · ${w.overdue} overdue` : ''}
                          {w.blocked > 0 ? ` · ${w.blocked} blocked` : ''}
                          {w.estimatedMinutes > 0
                            ? ` · ~${Math.round(w.estimatedMinutes / 60)}h estimated`
                            : ''}
                        </span>
                      </div>
                      <ProgressBar
                        percent={Math.round((w.open / maxOpen) * 100)}
                        label={`${w.name} relative load`}
                      />
                      {heavy ? (
                        <p className="mt-0.5 text-[11px] text-high">
                          Carrying the most open work on the team — worth checking before assigning more.
                        </p>
                      ) : null}
                      {w.dueThisWeek > 0 ? (
                        <p className="mt-0.5 text-[11px] text-ink-faint">
                          {w.dueThisWeek} due in the next 7 days
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Priority distribution</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => {
                const count = team.priorityDistribution[p];
                const total = Object.values(team.priorityDistribution).reduce((a, b) => a + b, 0);
                return (
                  <li key={p}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="text-ink">{PRIORITY_LABELS[p]}</span>
                      <span className="tabular-nums text-ink-faint">{count}</span>
                    </div>
                    <ProgressBar
                      percent={total === 0 ? null : Math.round((count / total) * 100)}
                      label={`${PRIORITY_LABELS[p]} share`}
                    />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects at risk</CardTitle>
            <Badge tone={team.projectsAtRisk.length > 0 ? 'urgent' : 'neutral'}>
              {team.projectsAtRisk.length}
            </Badge>
          </CardHeader>
          <CardContent>
            {team.projectsAtRisk.length === 0 ? (
              <EmptyState title="Nothing flagged" hint="A project is flagged when it has overdue or blocked work, or has passed its target date with work open." />
            ) : (
              <ul className="space-y-1.5">
                {team.projectsAtRisk.map((p) => (
                  <li key={p.projectId} className="text-sm">
                    <Link
                      href={`/projects/${p.projectId}?workspace=${workspace.id}`}
                      className="text-ink hover:text-accent hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="text-[11px] text-ink-faint">
                      {[
                        p.overdue > 0 ? `${p.overdue} overdue` : null,
                        p.blocked > 0 ? `${p.blocked} blocked` : null,
                        p.targetDate !== null && p.targetDate < team.today && p.remaining > 0
                          ? `target was ${formatDateIn(p.targetDate)}`
                          : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming milestones</CardTitle>
            <Badge>{team.upcomingMilestones.length}</Badge>
          </CardHeader>
          <CardContent>
            {team.upcomingMilestones.length === 0 ? (
              <EmptyState title="No milestones in the next 30 days" />
            ) : (
              <ul className="space-y-1">
                {team.upcomingMilestones.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    {m.atRisk ? <Badge tone="urgent">late</Badge> : null}
                    <Link
                      href={`/projects/${m.projectId}?workspace=${workspace.id}`}
                      className="min-w-0 flex-1 truncate text-ink hover:text-accent"
                    >
                      {m.name}
                    </Link>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {m.dueDate ? formatDateIn(m.dueDate, undefined, 'd MMM') : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs an owner or a decision</CardTitle>
            <Badge tone={team.needsOwner.length > 0 ? 'high' : 'neutral'}>
              {team.needsOwner.length}
            </Badge>
          </CardHeader>
          <CardContent>
            {team.needsOwner.length === 0 ? (
              <EmptyState title="Everything has an owner" />
            ) : (
              <ul>
                {team.needsOwner.slice(0, 10).map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={team.today} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Blocked work</CardTitle>
            <Badge tone={team.blocked.length > 0 ? 'blocked' : 'neutral'}>
              {team.blocked.length}
            </Badge>
          </CardHeader>
          <CardContent>
            {team.blocked.length === 0 ? (
              <EmptyState title="Nothing blocked" />
            ) : (
              <ul>
                {team.blocked.map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={team.today} showAssignee />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
            <span className="text-[11px] text-ink-faint">next 7 days</span>
          </CardHeader>
          <CardContent>
            {team.upcomingDeadlines.length === 0 ? (
              <EmptyState title="Nothing due this week" />
            ) : (
              <ul>
                {team.upcomingDeadlines.map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={team.today} showAssignee />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recently completed</CardTitle></CardHeader>
          <CardContent>
            {team.recentlyCompleted.length === 0 ? (
              <EmptyState title="Nothing completed in the last week" />
            ) : (
              <ul>
                {team.recentlyCompleted.map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={team.today} showAssignee />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
