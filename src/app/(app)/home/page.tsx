import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Inbox as InboxIcon, Mic } from 'lucide-react';
import { resolvePageContext } from '@/server/page-context';
import { getPersonalDashboard, getTeamDashboard } from '@/server/services/dashboard';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { ProgressBar, Stat } from '@/components/ui/labels';
import { TaskRow } from '@/components/task-row';
import { formatDateIn, formatTimeIn } from '@/lib/dates';

export const metadata = { title: 'Home' };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, workspace } = await resolvePageContext(searchParams);

  // A personal workspace shows the private view; a team workspace shows both,
  // with the team summary first since that is why you switched to it.
  const isTeam = workspace.kind === 'team';
  const [personal, team] = await Promise.all([
    getPersonalDashboard(workspace, session.userId),
    isTeam ? getTeamDashboard(workspace) : Promise.resolve(null),
  ]);

  const firstName = session.fullName?.split(' ')[0] ?? 'there';

  return (
    <>
      <PageHeader
        title={isTeam ? `${workspace.name}` : `Good day, ${firstName}`}
        description={
          isTeam
            ? `Team workspace · you are ${workspace.role} · ${formatDateIn(personal.today)}`
            : `Your private workspace · ${formatDateIn(personal.today)}`
        }
        actions={
          personal.pendingProposals > 0 ? (
            <Button variant="primary" size="default" asChild>
              <Link href={`/inbox?workspace=${workspace.id}`}>
                <InboxIcon />
                {personal.pendingProposals} awaiting review
              </Link>
            </Button>
          ) : null
        }
      />

      <section
        aria-label="Today at a glance"
        className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
      >
        <Stat label="Due today" value={personal.counts.dueToday} />
        <Stat label="Completed today" value={personal.counts.completedToday} tone="done" />
        <Stat label="Remaining" value={personal.counts.remaining} />
        <Stat label="Overdue" value={personal.counts.overdue} tone="urgent" />
        <Stat label="Blocked" value={personal.counts.blocked} tone="blocked" />
      </section>

      <DailyProgress
        completed={personal.counts.completedToday}
        dueToday={personal.counts.dueToday}
      />

      {personal.topPriorities.length > 0 ? (
        <Card className="mb-4 border-accent/30 bg-accent-soft/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-high" />
              Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {personal.topPriorities.map((t) => (
                <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={personal.today} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Due today</CardTitle>
            <Badge>{personal.dueToday.length}</Badge>
          </CardHeader>
          <CardContent>
            {personal.dueToday.length === 0 ? (
              <EmptyState
                title="Nothing due today"
                hint="Work with a due date of today appears here."
                icon={<Clock className="size-5" />}
              />
            ) : (
              <ul>
                {personal.dueToday.map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={personal.today} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overdue</CardTitle>
            <Badge tone={personal.overdue.length > 0 ? 'urgent' : 'neutral'}>
              {personal.overdue.length}
            </Badge>
          </CardHeader>
          <CardContent>
            {personal.overdue.length === 0 ? (
              <EmptyState title="Nothing overdue" icon={<CheckCircle2 className="size-5" />} />
            ) : (
              <ul>
                {personal.overdue.slice(0, 8).map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={personal.today} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Completed today</CardTitle>
            <Badge tone="done">{personal.completedToday.length}</Badge>
          </CardHeader>
          <CardContent>
            {personal.completedToday.length === 0 ? (
              <EmptyState
                title="Nothing completed yet today"
                hint="A task counts here only when its status is set to Completed."
              />
            ) : (
              <ul>
                {personal.completedToday.map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={personal.today} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
            <CardTitle className="font-normal text-ink-faint">next 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            {personal.upcoming.length === 0 ? (
              <EmptyState title="No deadlines in the next two weeks" />
            ) : (
              <ul>
                {personal.upcoming.slice(0, 8).map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={personal.today} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active projects</CardTitle>
          </CardHeader>
          <CardContent>
            {personal.projects.length === 0 ? (
              <EmptyState
                title="No active projects"
                hint="Create one from the Projects page to group related tasks."
              />
            ) : (
              <ul className="space-y-2.5">
                {personal.projects.slice(0, 6).map((p) => (
                  <li key={p.projectId}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Link
                        href={`/projects/${p.projectId}?workspace=${workspace.id}`}
                        className="min-w-0 truncate text-sm text-ink hover:text-accent hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {p.completed}/{p.total}
                      </span>
                    </div>
                    <ProgressBar percent={p.percentComplete} label={`${p.name} progress`} />
                    {p.overdue > 0 || p.blocked > 0 ? (
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {p.overdue > 0 ? `${p.overdue} overdue` : null}
                        {p.overdue > 0 && p.blocked > 0 ? ' · ' : null}
                        {p.blocked > 0 ? `${p.blocked} blocked` : null}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming meetings & events</CardTitle>
          </CardHeader>
          <CardContent>
            {personal.events.length === 0 ? (
              <EmptyState title="Nothing scheduled" />
            ) : (
              <ul className="space-y-1.5">
                {personal.events.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2 text-sm">
                    <span className="w-28 shrink-0 text-[11px] tabular-nums text-ink-faint">
                      {e.isAllDay
                        ? `${formatDateIn(e.startDate ?? personal.today, undefined, 'd MMM')} · all day`
                        : e.startsAt
                          ? `${formatDateIn(e.startsAt, workspace.timezone, 'd MMM')} · ${formatTimeIn(e.startsAt, workspace.timezone)}`
                          : ''}
                    </span>
                    <span className="min-w-0 truncate text-ink">{e.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent captures</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/inbox?workspace=${workspace.id}`}>Open inbox</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {personal.recentCaptures.length === 0 ? (
              <EmptyState
                title="No captures yet"
                hint="Record a voice note or paste a transcript to have tasks proposed from it."
                icon={<Mic className="size-5" />}
              />
            ) : (
              <ul className="space-y-1.5">
                {personal.recentCaptures.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <Badge tone={c.status === 'ready' ? 'done' : c.status === 'failed' ? 'urgent' : 'neutral'}>
                      {c.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">
                      {c.title ?? c.kind.replace('_', ' ')}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {formatDateIn(c.createdAt, workspace.timezone, 'd MMM')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {team ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-ink">Team summary</h2>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Assigned" value={team.counts.assigned} />
            <Stat label="Completed" value={team.counts.completed} tone="done" />
            <Stat label="Pending" value={team.counts.pending} />
            <Stat label="Overdue" value={team.counts.overdue} tone="urgent" />
            <Stat label="Blocked" value={team.counts.blocked} tone="blocked" />
            <Stat label="Unassigned" value={team.counts.unassigned} />
          </div>
          <Button variant="default" asChild>
            <Link href={`/team?workspace=${workspace.id}`}>Open the team dashboard</Link>
          </Button>
        </section>
      ) : null}
    </>
  );
}

/**
 * Compact daily progress.
 *
 * Deliberately shows the ratio it is computed from, so the number is checkable
 * rather than an opaque score.
 */
function DailyProgress({ completed, dueToday }: { completed: number; dueToday: number }) {
  const planned = completed + dueToday;
  const percent = planned === 0 ? null : Math.round((completed / planned) * 100);

  return (
    <div className="mb-4 rounded-[var(--radius-card)] border border-hairline bg-paper px-4 py-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-ink">Today&apos;s progress</p>
        <p className="text-[11px] text-ink-faint">
          {planned === 0
            ? 'Nothing scheduled for today'
            : `${completed} of ${planned} done`}
        </p>
      </div>
      <ProgressBar percent={percent} label="Today's progress" />
    </div>
  );
}
