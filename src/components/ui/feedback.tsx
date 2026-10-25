import * as React from 'react';
import { cn } from '@/lib/utils';

/** Skeleton block for loading states. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded bg-sunken', className)} {...props} />;
}

/**
 * Empty state. `hint` explains what to do next rather than only reporting
 * absence, which is the difference between a dead end and a starting point.
 */
export function EmptyState({
  title, hint, icon, action, className,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      {icon ? <div className="text-ink-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-ink-faint">{hint}</p> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

/** Inline error. `detail` is shown verbatim so failures stay diagnosable. */
export function ErrorNotice({
  title = 'Something went wrong', detail, className,
}: { title?: string; detail?: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn('rounded-md border border-urgent/30 bg-urgent-soft px-3 py-2', className)}
    >
      <p className="text-xs font-semibold text-urgent">{title}</p>
      {detail ? <p className="mt-0.5 text-xs text-urgent/90">{detail}</p> : null}
    </div>
  );
}

/**
 * States that a feature needs configuration. Used instead of letting an
 * unconfigured integration look like a working one.
 */
export function SetupNotice({
  title, detail, className,
}: { title: string; detail?: string; className?: string }) {
  return (
    <div className={cn('rounded-md border border-high/30 bg-high-soft px-3 py-2', className)}>
      <p className="text-xs font-semibold text-high">{title}</p>
      {detail ? <p className="mt-0.5 text-xs text-high/90">{detail}</p> : null}
    </div>
  );
}
