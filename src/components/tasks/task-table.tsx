'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { ErrorNotice } from '@/components/ui/feedback';
import { PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER } from '@/components/ui/labels';
import { formatDateIn } from '@/lib/dates';
import { bulkUpdateTasks, updateTask } from '@/app/(app)/actions';
import { cn } from '@/lib/utils';
import type { TaskListItem } from '@/server/services/tasks';
import type { Database } from '@/lib/supabase/database.types';

type TaskStatus = Database['public']['Enums']['task_status'];
type Priority = Database['public']['Enums']['priority_level'];

/** Dense table with inline editing and bulk actions on the selection. */
export function TaskTable({
  tasks, workspaceId, today, canWrite, members,
}: {
  tasks: TaskListItem[];
  workspaceId: string;
  today: string;
  canWrite: boolean;
  members: Array<{ id: string; name: string | null }>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function inlineEdit(id: string, patch: Record<string, unknown>) {
    setError(null);
    startTransition(async () => {
      const result = await updateTask({ id, ...patch });
      if (!result.ok) setError(result.error ?? 'Could not save that change.');
    });
  }

  function bulk(patch: Record<string, unknown>) {
    if (selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkUpdateTasks({ ids: [...selected], ...patch });
      if (!result.ok) setError(result.error ?? 'Could not apply that change.');
      else setSelected(new Set());
    });
  }

  const allSelected = tasks.length > 0 && selected.size === tasks.length;

  return (
    <div>
      {error ? <ErrorNotice className="mb-2" detail={error} /> : null}

      {selected.size > 0 && canWrite ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2">
          <span className="text-xs font-medium text-accent">{selected.size} selected</span>
          <Select
            aria-label="Set status for selected"
            className="h-7 w-36"
            value=""
            onChange={(e) => e.target.value && bulk({ status: e.target.value })}
          >
            <option value="">Set status…</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </Select>
          <Select
            aria-label="Set priority for selected"
            className="h-7 w-36"
            value=""
            onChange={(e) => e.target.value && bulk({ priority: e.target.value })}
          >
            <option value="">Set priority…</option>
            {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </Select>
          <Select
            aria-label="Assign selected"
            className="h-7 w-40"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              bulk({ assigneeId: e.target.value === '__none' ? null : e.target.value });
            }}
          >
            <option value="">Assign to…</option>
            <option value="__none">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.id.slice(0, 8)}</option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-hairline bg-paper">
        <table className="w-full min-w-[42rem] text-sm">
          <caption className="sr-only">Tasks</caption>
          <thead>
            <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-faint">
              {canWrite ? (
                <th scope="col" className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.id)))
                    }
                  />
                </th>
              ) : null}
              <th scope="col" className="px-2 py-2 font-medium">Task</th>
              <th scope="col" className="w-32 px-2 py-2 font-medium">Status</th>
              <th scope="col" className="w-28 px-2 py-2 font-medium">Priority</th>
              <th scope="col" className="w-36 px-2 py-2 font-medium">Assignee</th>
              <th scope="col" className="w-28 px-2 py-2 font-medium">Due</th>
              <th scope="col" className="hidden w-32 px-2 py-2 font-medium lg:table-cell">Project</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const overdue =
                task.dueDate !== null &&
                task.dueDate < today &&
                task.status !== 'completed' &&
                task.status !== 'cancelled';
              return (
                <tr key={task.id} className="border-b border-hairline last:border-0">
                  {canWrite ? (
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${task.title}`}
                        checked={selected.has(task.id)}
                        onChange={() => toggle(task.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/tasks/${task.id}?workspace=${workspaceId}`}
                      className="text-ink hover:text-accent hover:underline"
                    >
                      {task.title}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    {canWrite ? (
                      <Select
                        aria-label={`Status of ${task.title}`}
                        className="h-7"
                        value={task.status}
                        disabled={pending}
                        onChange={(e) => inlineEdit(task.id, { status: e.target.value as TaskStatus })}
                      >
                        {STATUS_ORDER.map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </Select>
                    ) : (
                      STATUS_LABELS[task.status]
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {canWrite ? (
                      <Select
                        aria-label={`Priority of ${task.title}`}
                        className="h-7"
                        value={task.priority}
                        disabled={pending}
                        onChange={(e) => inlineEdit(task.id, { priority: e.target.value as Priority })}
                      >
                        {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                        ))}
                      </Select>
                    ) : (
                      PRIORITY_LABELS[task.priority]
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {canWrite ? (
                      <Select
                        aria-label={`Assignee of ${task.title}`}
                        className="h-7"
                        value={task.assigneeId ?? ''}
                        disabled={pending}
                        onChange={(e) =>
                          inlineEdit(task.id, { assigneeId: e.target.value || null })
                        }
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.name ?? m.id.slice(0, 8)}</option>
                        ))}
                      </Select>
                    ) : (
                      (task.assigneeName ?? 'Unassigned')
                    )}
                  </td>
                  <td className={cn('px-2 py-1.5', overdue && 'font-medium text-urgent')}>
                    {canWrite ? (
                      <input
                        type="date"
                        aria-label={`Due date of ${task.title}`}
                        className="h-7 w-full rounded border border-hairline-strong bg-paper px-1.5 text-xs"
                        value={task.dueDate ?? ''}
                        disabled={pending}
                        onChange={(e) => inlineEdit(task.id, { dueDate: e.target.value || null })}
                      />
                    ) : task.dueDate ? (
                      formatDateIn(task.dueDate, undefined, 'd MMM yyyy')
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="hidden truncate px-2 py-1.5 text-ink-faint lg:table-cell">
                    {task.projectName ?? '—'}
                  </td>
                </tr>
              );
            })}
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 7 : 6} className="px-3 py-8 text-center text-xs text-ink-faint">
                  No tasks match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
