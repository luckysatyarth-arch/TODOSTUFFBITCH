import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { resolvePageContext, one } from '@/server/page-context';
import { getCalendarMonth, getDayDetail } from '@/server/services/calendar';
import { canWrite } from '@/server/auth';
import { addCalendarDays, formatDateIn, formatTimeIn, monthRange, todayIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { Stat } from '@/components/ui/labels';
import { MonthGrid, type DayCell } from '@/components/calendar/month-grid';
import { TaskRow } from '@/components/task-row';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, params } = await resolvePageContext(searchParams);
  const today = todayIn(workspace.timezone);

  const monthParam = one(params.month);
  const [yearStr, monthStr] = (monthParam ?? today.slice(0, 7)).split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const valid = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
  const safeYear = valid ? year : Number(today.slice(0, 4));
  const safeMonth = valid ? month : Number(today.slice(5, 7));

  const selectedDate = one(params.date) ?? today;

  const [calendar, day] = await Promise.all([
    getCalendarMonth(workspace, safeYear, safeMonth),
    getDayDetail(workspace, selectedDate),
  ]);

  const cells = buildCells(safeYear, safeMonth, today, calendar);
  const writable = canWrite(workspace.role);

  const prev = shiftMonth(safeYear, safeMonth, -1);
  const next = shiftMonth(safeYear, safeMonth, 1);
  const monthLabel = formatDateIn(`${safeYear}-${String(safeMonth).padStart(2, '0')}-01`, undefined, 'MMMM yyyy');

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`${workspace.name} · times shown in ${workspace.timezone}`}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" asChild aria-label="Previous month">
              <Link href={`/calendar?workspace=${workspace.id}&month=${prev}&date=${selectedDate}`}>
                <ChevronLeft />
              </Link>
            </Button>
            <span className="min-w-32 text-center text-sm font-medium text-ink">{monthLabel}</span>
            <Button variant="ghost" size="icon" asChild aria-label="Next month">
              <Link href={`/calendar?workspace=${workspace.id}&month=${next}&date=${selectedDate}`}>
                <ChevronRight />
              </Link>
            </Button>
            <Button variant="default" size="sm" asChild>
              <Link href={`/calendar?workspace=${workspace.id}&date=${today}`}>Today</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <MonthGrid cells={cells} selected={selectedDate} canWrite={writable} />

        <aside className="min-w-0 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {formatDateIn(selectedDate, undefined, 'EEEE, d MMMM yyyy')}
            </h2>
            <p className="text-[11px] text-ink-faint">
              {selectedDate === today
                ? 'Today'
                : selectedDate < today
                  ? `${Math.abs(daysBetween(selectedDate, today))} day(s) ago`
                  : `in ${daysBetween(selectedDate, today)} day(s)`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Completed" value={day.completed.length} tone="done" />
            <Stat label="Remaining" value={day.incomplete.length} />
            <Stat label="Overdue as of then" value={day.overdueAsOf.length} tone="urgent" />
            <Stat label="Blocked" value={day.blocked.length} tone="blocked" />
          </div>

          <DaySection title="Events & meetings" count={day.events.length}>
            {day.events.length === 0 ? (
              <EmptyState title="Nothing scheduled" />
            ) : (
              <ul className="space-y-1">
                {day.events.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2 text-xs">
                    <span className="w-14 shrink-0 tabular-nums text-ink-faint">
                      {e.isAllDay
                        ? 'All day'
                        : e.startsAt
                          ? formatTimeIn(e.startsAt, workspace.timezone)
                          : ''}
                    </span>
                    <span className="min-w-0 flex-1 text-ink">{e.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </DaySection>

          <DaySection title="Milestones" count={day.milestones.length}>
            {day.milestones.length === 0 ? (
              <EmptyState title="No milestones" />
            ) : (
              <ul className="space-y-1">
                {day.milestones.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-xs">
                    <Badge tone={m.status === 'completed' ? 'done' : 'high'}>{m.status}</Badge>
                    <Link
                      href={`/projects/${m.projectId}?workspace=${workspace.id}`}
                      className="min-w-0 flex-1 truncate text-ink hover:text-accent"
                    >
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DaySection>

          <DaySection title="Remaining that day" count={day.incomplete.length}>
            {day.incomplete.length === 0 ? (
              <EmptyState title="Nothing outstanding" />
            ) : (
              <ul>
                {day.incomplete.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    workspaceId={workspace.id}
                    today={today}
                    showAssignee
                  />
                ))}
              </ul>
            )}
          </DaySection>

          <DaySection title="Completed that day" count={day.completed.length}>
            {day.completed.length === 0 ? (
              <EmptyState title="Nothing completed" />
            ) : (
              <ul>
                {day.completed.map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={today} showAssignee />
                ))}
              </ul>
            )}
          </DaySection>

          {day.overdueAsOf.length > 0 ? (
            <DaySection title="Overdue as of that date" count={day.overdueAsOf.length}>
              <ul>
                {day.overdueAsOf.slice(0, 10).map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={today} showAssignee />
                ))}
              </ul>
            </DaySection>
          ) : null}

          {workspace.kind === 'team' && day.byAssignee.length > 0 ? (
            <DaySection title="By team member" count={day.byAssignee.length}>
              <ul className="space-y-1">
                {day.byAssignee.map((p) => (
                  <li
                    key={p.userId ?? 'unassigned'}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate text-ink">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-faint">
                      {p.completed} done · {p.open} open
                    </span>
                  </li>
                ))}
              </ul>
            </DaySection>
          ) : null}

          {day.projects.length > 0 ? (
            <DaySection title="Projects touched" count={day.projects.length}>
              <ul className="space-y-1">
                {day.projects.map((p) => (
                  <li key={p.projectId} className="flex items-center justify-between gap-2 text-xs">
                    <Link
                      href={`/projects/${p.projectId}?workspace=${workspace.id}`}
                      className="min-w-0 truncate text-ink hover:text-accent hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="shrink-0 tabular-nums text-ink-faint">
                      {p.completedThisDay}/{p.dueThisDay}
                    </span>
                  </li>
                ))}
              </ul>
            </DaySection>
          ) : null}

          <DaySection title="Next 7 days" count={day.upcomingAfter.length}>
            {day.upcomingAfter.length === 0 ? (
              <EmptyState title="Nothing due in the week after" />
            ) : (
              <ul>
                {day.upcomingAfter.slice(0, 10).map((t) => (
                  <TaskRow key={t.id} task={t} workspaceId={workspace.id} today={today} />
                ))}
              </ul>
            )}
          </DaySection>
        </aside>
      </div>
    </>
  );
}

function DaySection({
  title, count, children,
}: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Badge>{count}</Badge>
      </CardHeader>
      <CardContent className="pb-3">{children}</CardContent>
    </Card>
  );
}

/**
 * Builds a Monday-first 6x7 grid covering the month plus the adjacent days
 * needed to fill the first and last weeks.
 */
function buildCells(
  year: number,
  month: number,
  today: string,
  calendar: Awaited<ReturnType<typeof getCalendarMonth>>,
): DayCell[] {
  const { first, last } = monthRange(year, month);

  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const firstDow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addCalendarDays(first, -firstDow);

  const lastDow = (new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7;
  const end = addCalendarDays(last, 6 - lastDow);

  const cells: DayCell[] = [];
  let cursor = start;
  // Hard bound at 42 so a bad date can never loop forever.
  for (let i = 0; i < 42 && cursor <= end; i += 1) {
    cells.push({
      date: cursor,
      inMonth: cursor >= first && cursor <= last,
      isToday: cursor === today,
      tasks: (calendar.tasksByDate.get(cursor) ?? []).map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
      })),
      events: (calendar.eventsByDate.get(cursor) ?? []).map((e) => ({
        id: e.id, title: e.title, isAllDay: e.isAllDay,
      })),
      milestones: (calendar.milestonesByDate.get(cursor) ?? []).map((m) => ({
        id: m.id, name: m.name,
      })),
    });
    cursor = addCalendarDays(cursor, 1);
  }
  return cells;
}

function shiftMonth(year: number, month: number, delta: number): string {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000,
  );
}
