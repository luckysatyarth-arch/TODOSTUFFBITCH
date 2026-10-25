'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { updateTask } from '@/app/(app)/actions';
import { ErrorNotice } from '@/components/ui/feedback';

export interface DayCell {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  tasks: Array<{ id: string; title: string; status: string; priority: string }>;
  events: Array<{ id: string; title: string; isAllDay: boolean }>;
  milestones: Array<{ id: string; name: string }>;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Month grid with click-to-inspect and drag-to-reschedule.
 *
 * Dropping a task on a day changes its due date and persists immediately; the
 * change is confirmed by the row re-rendering from the server, and an error is
 * surfaced rather than silently swallowed.
 */
export function MonthGrid({
  cells, selected, canWrite,
}: {
  cells: DayCell[];
  selected: string | null;
  canWrite: boolean;
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
        <div className="grid grid-cols-7 border-b border-hairline">
          {DOW.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint"
            >
              <span className="hidden sm:inline">{d}</span>
              <span className="sm:hidden">{d.slice(0, 1)}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const openCount = cell.tasks.filter(
              (t) => t.status !== 'completed' && t.status !== 'cancelled',
            ).length;
            const doneCount = cell.tasks.filter((t) => t.status === 'completed').length;

            return (
              <button
                type="button"
                key={cell.date}
                onClick={() => selectDate(cell.date)}
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
                aria-label={`${cell.date}: ${openCount} open, ${doneCount} completed`}
                aria-current={cell.date === selected ? 'date' : undefined}
                className={cn(
                  'min-h-20 border-b border-r border-hairline p-1 text-left align-top transition-colors last:border-r-0 sm:min-h-24',
                  !cell.inMonth && 'bg-canvas',
                  cell.date === selected && 'ring-2 ring-inset ring-accent',
                  over === cell.date && 'bg-accent-soft',
                )}
              >
                <span
                  className={cn(
                    'mb-0.5 inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                    cell.isToday
                      ? 'bg-accent font-semibold text-white'
                      : cell.inMonth ? 'text-ink' : 'text-ink-faint',
                  )}
                >
                  {Number(cell.date.slice(8, 10))}
                </span>

                <span className="block space-y-0.5">
                  {cell.milestones.slice(0, 1).map((m) => (
                    <span
                      key={m.id}
                      className="block truncate rounded bg-high-soft px-1 text-[10px] text-high"
                    >
                      ◆ {m.name}
                    </span>
                  ))}
                  {cell.events.slice(0, 1).map((e) => (
                    <span
                      key={e.id}
                      className="block truncate rounded bg-accent-soft px-1 text-[10px] text-accent"
                    >
                      {e.isAllDay ? '▭' : '◷'} {e.title}
                    </span>
                  ))}
                  {cell.tasks.slice(0, 2).map((t) => (
                    <span
                      key={t.id}
                      draggable={canWrite}
                      onDragStart={(ev) => {
                        ev.stopPropagation();
                        setDragging(t.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      className={cn(
                        'block truncate rounded px-1 text-[10px]',
                        t.status === 'completed'
                          ? 'bg-done-soft text-done line-through'
                          : t.priority === 'urgent'
                            ? 'bg-urgent-soft text-urgent'
                            : 'bg-sunken text-ink-soft',
                        canWrite && 'cursor-grab',
                        dragging === t.id && 'opacity-50',
                      )}
                    >
                      {t.title}
                    </span>
                  ))}

                  {cell.tasks.length + cell.events.length + cell.milestones.length > 4 ? (
                    <span className="block px-1 text-[10px] text-ink-faint">
                      +{cell.tasks.length + cell.events.length + cell.milestones.length - 4} more
                    </span>
                  ) : null}
                </span>
              </button>
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
