'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER } from '@/components/ui/labels';
import type { Priority } from '@/components/tasks/types';

/** Filters for the team dashboard, kept in the URL so a view is shareable. */
export function TeamFilters({
  members, projects,
}: {
  members: Array<{ id: string; name: string | null }>;
  projects: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`?${next.toString()}`));
  }

  const active = ['project', 'assignee', 'status', 'priority', 'dueFrom', 'dueTo']
    .filter((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        aria-label="Filter by project"
        className="w-40"
        value={params.get('project') ?? ''}
        onChange={(e) => set('project', e.target.value)}
        disabled={pending}
      >
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>

      <Select
        aria-label="Filter by owner"
        className="w-40"
        value={params.get('assignee') ?? ''}
        onChange={(e) => set('assignee', e.target.value)}
        disabled={pending}
      >
        <option value="">Everyone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.name ?? m.id.slice(0, 8)}</option>
        ))}
      </Select>

      <Select
        aria-label="Filter by status"
        className="w-36"
        value={params.get('status') ?? ''}
        onChange={(e) => set('status', e.target.value)}
        disabled={pending}
      >
        <option value="">Any status</option>
        {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
      </Select>

      <Select
        aria-label="Filter by priority"
        className="w-32"
        value={params.get('priority') ?? ''}
        onChange={(e) => set('priority', e.target.value)}
        disabled={pending}
      >
        <option value="">Any priority</option>
        {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
        ))}
      </Select>

      <Input
        type="date"
        aria-label="Due from"
        className="w-36"
        value={params.get('dueFrom') ?? ''}
        onChange={(e) => set('dueFrom', e.target.value)}
      />
      <Input
        type="date"
        aria-label="Due to"
        className="w-36"
        value={params.get('dueTo') ?? ''}
        onChange={(e) => set('dueTo', e.target.value)}
      />

      {active.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = new URLSearchParams();
            const ws = params.get('workspace');
            if (ws) next.set('workspace', ws);
            startTransition(() => router.push(`?${next.toString()}`));
          }}
        >
          Clear {active.length} filter{active.length === 1 ? '' : 's'}
        </Button>
      ) : null}
    </div>
  );
}
