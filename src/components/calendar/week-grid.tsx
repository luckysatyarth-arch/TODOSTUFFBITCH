'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { formatTimeIn } from '@/lib/dates';
import { updateTask } from '@/app/(app)/actions';
import { ErrorNotice } from '@/components/ui/feedback';
import type { DayCell } from './month-grid';

/**
 * Week view: the same seven columns as a month row, but tall enough to show
 * everything on a day instead of truncating to "+3 more".
 *
 * That is the whole reason the layout exists, so it deliberately does not cap
 * the list. Drag-to-reschedule behaves exactly as it does in the month grid,
 * because a calendar where the same gesture means different things depending
 * on the zoom level is worse than one with fewer layouts.
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function WeekGrid({
  cells, selected, canWrite, workspaceId, timeZone,
}: {
  cells: DayCell[];
  selected: string | null;
  canWrite: boolean;
  workspaceId: string;
  /**
   * The workspace's timezone, formatted here rather than on the server.
   *
   * A formatter function cannot cross the server/client boundary -- React
   * cannot serialize it, and the page throws at request time -- so what comes
   * over is the zone name.
   */
  timeZone: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function selectDate(date: string) {
    const next = new URLSearchParams(params.toString());
    next.set('date', date);
    startTransition(() => router.push(`?${next.toString()}`, { scroll: false }));
  }

  function reschedule(taskId: string, date: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateTask({ id: taskId, dueDate: date });
      if (!result.ok) setError(result.error ?? 'Could not move that task.');
    });
  }

  return (
    <div>
      {error ? <ErrorNotice className="mb-2" detail={error} /> : null}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-paper">
        <div className="grid grid-cols-1 sm:grid-cols-7">
          {cells.map((cell, index) => {
            const open = cell.tasks.filter(
              (t) => t.status !== 'completed' && t.status !== 'cancelled',
            );
            // Closed work sorts after open, but every task is shown: the
            // emptiness check below counts all of them, so anything left out
            // here would leave a blank column with no placeholder.
            const closed = cell.tasks.filter(
              (t) => t.status === 'completed' || t.status === 'cancelled',
            );
            const empty =
              cell.tasks.length + cell.events.length + cell.milestones.length === 0;

            return (
              <section
                key={cell.date}
                onDragOver={(e) => {
                  if (!canWrite || !dragging) return;
                  e.preventDefault();
                  setOver(cell.date);
                }}
                onDragLeave={() => setOver((d) => (d === cell.date ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  if (!canWrite || !dragging) return;
                  reschedule(dragging, cell.date);
                  setDragging(null);
                }}
                className={cn(
                  'min-w-0 border-b border-hairline p-2 sm:min-h-[22rem] sm:border-b-0 sm:border-r sm:last:border-r-0',
                  cell.date === selected && 'ring-2 ring-inset ring-accent',
                  over === cell.date && 'bg-accent-soft',
                )}
              >
                <button
                  type="button"
                  onClick={() => selectDate(cell.date)}
                  aria-current={cell.date === selected ? 'date' : undefined}
                  className="mb-1.5 flex w-full items-baseline gap-1.5 text-left"
                >
                  <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    {DOW[index] ?? ''}
                  </span>
                  <span
                    className={cn(
                      'inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                      cell.isToday ? 'bg-accent font-semibold text-white' : 'text-ink',
                    )}
                  >
                    {Number(cell.date.slice(8, 10))}
                  </span>
                  {open.length > 0 ? (
                    <span className="ml-auto text-[10px] tabular-nums text-ink-faint">
                      {open.length} open
                    </span>
                  ) : null}
                </button>

                <div className="space-y-1">
                  {cell.milestones.map((m) => (
                    <p
                      key={m.id}
                      className="rounded bg-high-soft px-1.5 py-0.5 text-[11px] text-high"
                    >
                      ◆ {m.name}
                    </p>
                  ))}

                  {cell.events.map((e) => (
                    <p
                      key={e.id}
                      className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent"
                    >
                      {e.isAllDay
                        ? '▭ '
                        : e.startsAt
                          ? `${formatTimeIn(e.startsAt, timeZone)} `
                          : '◷ '}
                      {e.title}
                    </p>
                  ))}

                  {[...open, ...closed].map((t) => (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}?workspace=${workspaceId}`}
                      draggable={canWrite}
                      onDragStart={(ev) => {
                        ev.stopPropagation();
                        setDragging(t.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      className={cn(
                        'block rounded px-1.5 py-0.5 text-[11px] hover:underline',
                        t.status === 'completed'
                          ? 'bg-done-soft text-done line-through'
                          : t.status === 'cancelled'
                            ? 'bg-sunken text-ink-faint line-through'
                            : t.priority === 'urgent'
                              ? 'bg-urgent-soft text-urgent'
                              : 'bg-sunken text-ink-soft',
                        canWrite && 'cursor-grab',
                        dragging === t.id && 'opacity-50',
                      )}
                    >
                      {t.title}
                    </Link>
                  ))}

                  {empty ? (
                    <p className="px-1.5 py-0.5 text-[11px] text-ink-faint">Nothing scheduled</p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {canWrite ? (
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Click a day for its full breakdown. Drag a task onto another day to reschedule it.
        </p>
      ) : null}
    </div>
  );
}
