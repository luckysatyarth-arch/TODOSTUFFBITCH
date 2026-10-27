import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatDateIn, formatTimeIn } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import type { DayCell } from './month-grid';

/**
 * Agenda: a flat chronological list of what is scheduled, skipping empty days.
 *
 * The grids answer "what does this week look like"; this answers "what is
 * next", which is a different question and the one a long scroll of mostly
 * empty cells answers badly. It is a server component because there is nothing
 * to drag — reordering an agenda would mean rescheduling, and that belongs on
 * a surface where the target date is visible.
 */

export function AgendaList({
  cells, today, workspaceId, timeZone,
}: {
  cells: DayCell[];
  today: string;
  workspaceId: string;
  /**
   * Formatted here rather than passed in as functions. This is a server
   * component, so a function prop would work -- but the week view's did not,
   * and taking the same shape keeps the two from diverging on a detail that
   * breaks only at request time.
   */
  timeZone: string;
}) {
  const days = cells.filter(
    (c) => c.tasks.length + c.events.length + c.milestones.length > 0,
  );

  if (days.length === 0) {
    return (
      <EmptyState
        title="Nothing scheduled"
        hint="No tasks, events or milestones fall in this range."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-paper">
      <ol>
        {days.map((cell) => {
          const open = cell.tasks.filter(
            (t) => t.status !== 'completed' && t.status !== 'cancelled',
          );
          const done = cell.tasks.filter((t) => t.status === 'completed');
          // Cancelled work is listed too: a day is filtered in by its task
          // count, so omitting any task renders an empty row.
          const cancelled = cell.tasks.filter((t) => t.status === 'cancelled');
          const past = cell.date < today;

          return (
            <li
              key={cell.date}
              className="grid gap-x-4 border-b border-hairline px-3 py-2.5 last:border-b-0 sm:grid-cols-[9rem_1fr]"
            >
              <div className="mb-1.5 sm:mb-0">
                <p
                  className={cn(
                    'text-sm font-medium',
                    cell.isToday ? 'text-accent' : past ? 'text-ink-faint' : 'text-ink',
                  )}
                >
                  {cell.isToday ? 'Today' : formatDateIn(cell.date, undefined, 'EEE d MMM')}
                </p>
                <p className="text-[11px] text-ink-faint">
                  {open.length > 0 ? `${open.length} open` : null}
                  {open.length > 0 && done.length > 0 ? ' · ' : null}
                  {done.length > 0 ? `${done.length} done` : null}
                </p>
              </div>

              <div className="min-w-0 space-y-1">
                {cell.milestones.map((m) => (
                  <p key={m.id} className="flex items-baseline gap-2 text-sm">
                    <Badge tone="high">Milestone</Badge>
                    <span className="min-w-0 truncate text-ink">{m.name}</span>
                  </p>
                ))}

                {cell.events.map((e) => (
                  <p key={e.id} className="flex items-baseline gap-2 text-sm">
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                      {e.isAllDay
                        ? 'All day'
                        : e.startsAt
                          ? formatTimeIn(e.startsAt, timeZone)
                          : '—'}
                    </span>
                    <span className="min-w-0 truncate text-ink">{e.title}</span>
                  </p>
                ))}

                {[...open, ...done, ...cancelled].map((t) => (
                  <p key={t.id} className="flex items-baseline gap-2 text-sm">
                    {t.priority === 'urgent' && t.status !== 'completed' ? (
                      <Badge tone="urgent">Urgent</Badge>
                    ) : null}
                    <Link
                      href={`/tasks/${t.id}?workspace=${workspaceId}`}
                      className={cn(
                        'min-w-0 truncate hover:underline',
                        t.status === 'completed' || t.status === 'cancelled'
                          ? 'text-ink-faint line-through'
                          : 'text-ink hover:text-accent',
                      )}
                    >
                      {t.title}
                    </Link>
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
