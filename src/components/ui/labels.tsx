import { Badge } from './badge';
import type { Database } from '@/lib/supabase/database.types';

type TaskStatus = Database['public']['Enums']['task_status'];
type Priority = Database['public']['Enums']['priority_level'];
type ProjectStatus = Database['public']['Enums']['project_status'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  in_review: 'In Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_ORDER: TaskStatus[] = [
  'inbox', 'todo', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled',
];

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning', active: 'Active', on_hold: 'On Hold',
  completed: 'Completed', cancelled: 'Cancelled',
};

const STATUS_TONE: Record<TaskStatus, 'neutral' | 'accent' | 'done' | 'blocked' | 'high'> = {
  inbox: 'neutral', todo: 'neutral', in_progress: 'accent',
  blocked: 'blocked', in_review: 'high', completed: 'done', cancelled: 'neutral',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={priority}>{PRIORITY_LABELS[priority]}</Badge>;
}

/** Thin bar; `null` percent means "no tasks yet", not 0%. */
export function ProgressBar({
  percent, label,
}: { percent: number | null; label?: string }) {
  if (percent === null) {
    return <p className="text-xs text-ink-faint">{label ?? 'No tasks yet'}</p>;
  }
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-faint">
        {percent}%
      </span>
    </div>
  );
}

/** Compact metric tile used across both dashboards. */
export function Stat({
  label, value, tone, hint,
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'urgent' | 'done' | 'blocked';
  hint?: string;
}) {
  const valueTone =
    tone === 'urgent' ? 'text-urgent'
      : tone === 'done' ? 'text-done'
        : tone === 'blocked' ? 'text-blocked'
          : 'text-ink';
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}
