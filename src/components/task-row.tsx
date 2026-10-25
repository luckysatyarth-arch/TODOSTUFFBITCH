import Link from 'next/link';
import { CalendarClock, GitBranch, Mic } from 'lucide-react';
import { PriorityBadge, STATUS_LABELS } from '@/components/ui/labels';
import { formatDateIn } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { Database } from '@/lib/supabase/database.types';

type TaskStatus = Database['public']['Enums']['task_status'];
type Priority = Database['public']['Enums']['priority_level'];

export interface TaskRowData {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  projectName?: string | null;
  assigneeName?: string | null;
  sourceCaptureId?: string | null;
}

/** One compact task line, shared by the dashboards and the list views. */
export function TaskRow({
  task, workspaceId, today, showAssignee = false,
}: {
  task: TaskRowData;
  workspaceId: string;
  today: string;
  showAssignee?: boolean;
}) {
  const overdue =
    task.dueDate !== null &&
    task.dueDate < today &&
    task.status !== 'completed' &&
    task.status !== 'cancelled';

  return (
    <li className="flex items-center gap-2 border-b border-hairline px-1 py-1.5 last:border-0">
      <Link
        href={`/tasks/${task.id}?workspace=${workspaceId}`}
        className="min-w-0 flex-1 truncate text-sm text-ink hover:text-accent hover:underline"
      >
        {task.title}
      </Link>

      {task.sourceCaptureId ? (
        <Mic className="size-3 shrink-0 text-ink-faint" aria-label="Created from a capture" />
      ) : null}

      {task.projectName ? (
        <span className="hidden shrink-0 truncate text-[11px] text-ink-faint sm:inline sm:max-w-28">
          {task.projectName}
        </span>
      ) : null}

      {showAssignee ? (
        <span className="hidden w-24 shrink-0 truncate text-[11px] text-ink-faint md:inline">
          {task.assigneeName ?? 'Unassigned'}
        </span>
      ) : null}

      {task.status === 'blocked' ? (
        <GitBranch className="size-3 shrink-0 text-blocked" aria-label="Blocked" />
      ) : null}

      <PriorityBadge priority={task.priority} />

      {task.dueDate ? (
        <span
          className={cn(
            'inline-flex w-24 shrink-0 items-center justify-end gap-1 text-[11px] tabular-nums',
            overdue ? 'font-medium text-urgent' : 'text-ink-faint',
          )}
        >
          <CalendarClock className="size-3" />
          {formatDateIn(task.dueDate, undefined, 'd MMM')}
        </span>
      ) : (
        <span className="hidden w-24 shrink-0 text-right text-[11px] text-ink-faint sm:inline">
          {STATUS_LABELS[task.status]}
        </span>
      )}
    </li>
  );
}
