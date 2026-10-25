'use client';

import { useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PriorityBadge, STATUS_LABELS } from '@/components/ui/labels';
import { formatDateIn } from '@/lib/dates';
import { describeRecurrence, recurrenceBadge } from '@/lib/validation/recurrence';
import { updateTask } from '@/app/(app)/actions';
import { ErrorNotice } from '@/components/ui/feedback';
import type { TaskListItem } from '@/server/services/tasks';
import type { Database } from '@/lib/supabase/database.types';

type TaskStatus = Database['public']['Enums']['task_status'];

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'in_review', 'completed'];

/**
 * Kanban board with drag-to-change-status.
 *
 * The move is applied optimistically and reverts if the server rejects it, so
 * a dropped card never appears to succeed when the user lacks write access.
 */
export function TaskBoard({
  tasks, workspaceId, today, canWrite,
}: {
  tasks: TaskListItem[];
  workspaceId: string;
  today: string;
  canWrite: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimistic, applyOptimistic] = useOptimistic(
    tasks,
    (state: TaskListItem[], move: { id: string; status: TaskStatus }) =>
      state.map((t) => (t.id === move.id ? { ...t, status: move.status } : t)),
  );
  const [dragging, setDragging] = useState<string | null>(null);

  function move(id: string, status: TaskStatus) {
    const current = optimistic.find((t) => t.id === id);
    if (!current || current.status === status) return;

    setError(null);
    startTransition(async () => {
      applyOptimistic({ id, status });
      const result = await updateTask({ id, status });
      if (!result.ok) setError(result.error ?? 'Could not move that task.');
    });
  }

  return (
    <div>
      {error ? <ErrorNotice className="mb-2" detail={error} /> : null}
      <div className="grid gap-3 overflow-x-auto md:grid-cols-3 xl:grid-cols-5">
        {COLUMNS.map((status) => {
          const column = optimistic.filter((t) => t.status === status);
          return (
            <section
              key={status}
              aria-label={STATUS_LABELS[status]}
              onDragOver={(e) => { if (canWrite) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                if (!canWrite || !dragging) return;
                move(dragging, status);
                setDragging(null);
              }}
              className="min-w-56 rounded-[var(--radius-card)] border border-hairline bg-canvas p-2"
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold text-ink">{STATUS_LABELS[status]}</h3>
                <span className="text-[11px] tabular-nums text-ink-faint">{column.length}</span>
              </header>

              <ul className="space-y-1.5">
                {column.map((task) => {
                  const overdue =
                    task.dueDate !== null && task.dueDate < today && status !== 'completed';
                  return (
                    <li
                      key={task.id}
                      draggable={canWrite}
                      onDragStart={() => setDragging(task.id)}
                      onDragEnd={() => setDragging(null)}
                      className={cn(
                        'rounded-md border border-hairline bg-paper p-2',
                        canWrite && 'cursor-grab active:cursor-grabbing',
                        dragging === task.id && 'opacity-50',
                      )}
                    >
                      <Link
                        href={`/tasks/${task.id}?workspace=${workspaceId}`}
                        className="block text-sm text-ink hover:text-accent"
                      >
                        {task.title}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <PriorityBadge priority={task.priority} />
                        {task.dueDate ? (
                          <span
                            className={cn(
                              'text-[11px] tabular-nums',
                              overdue ? 'font-medium text-urgent' : 'text-ink-faint',
                            )}
                          >
                            {formatDateIn(task.dueDate, undefined, 'd MMM')}
                          </span>
                        ) : null}
                        {task.assigneeName ? (
                          <span className="truncate text-[11px] text-ink-faint">
                            {task.assigneeName}
                          </span>
                        ) : null}
                        {task.recurrence ? (
                          <span
                            className="text-[11px] text-ink-faint"
                            title={describeRecurrence(task.recurrence) ?? undefined}
                          >
                            ↻ {recurrenceBadge(task.recurrence)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {column.length === 0 ? (
                  <li className="px-1 py-3 text-center text-[11px] text-ink-faint">
                    {canWrite ? 'Drop a task here' : 'Nothing here'}
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
