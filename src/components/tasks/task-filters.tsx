'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PRIORITY_LABELS, STATUS_LABELS, STATUS_ORDER } from '@/components/ui/labels';
import type { Priority } from './types';

const VIEWS = [
  { value: 'all', label: 'All tasks' },
  { value: 'mine', label: 'My tasks' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' },
  { value: 'unscheduled', label: 'No due date' },
] as const;

const LAYOUTS = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
  { value: 'table', label: 'Table' },
] as const;

/**
 * Filters live in the URL, so a filtered view is shareable, survives a reload,
 * and is what a "saved view" is: a bookmarked link.
 */
export function TaskFilters({
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

  const current = (key: string, fallback = '') => params.get(key) ?? fallback;
  const activeFilters = ['status', 'priority', 'assignee', 'project', 'q', 'dueFrom', 'dueTo']
    .filter((k) => params.get(k));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {VIEWS.map((v) => (
          <Button
            key={v.value}
            variant={current('view', 'all') === v.value ? 'subtle' : 'ghost'}
            size="sm"
            disabled={pending}
            onClick={() => set('view', v.value === 'all' ? '' : v.value)}
          >
            {v.label}
          </Button>
        ))}

        <span className="mx-1 h-4 w-px bg-hairline-strong" aria-hidden />

        {LAYOUTS.map((l) => (
          <Button
            key={l.value}
            variant={current('layout', 'list') === l.value ? 'subtle' : 'ghost'}
            size="sm"
            disabled={pending}
            onClick={() => set('layout', l.value === 'list' ? '' : l.value)}
          >
            {l.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          placeholder="Filter by text…"
          aria-label="Filter tasks by text"
          className="w-44"
          defaultValue={current('q')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') set('q', (e.target as HTMLInputElement).value.trim());
          }}
        />

        <Select
          aria-label="Filter by status"
          className="w-36"
          value={current('status')}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="">Any status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </Select>

        <Select
          aria-label="Filter by priority"
          className="w-32"
          value={current('priority')}
          onChange={(e) => set('priority', e.target.value)}
        >
          <option value="">Any priority</option>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </Select>

        <Select
          aria-label="Filter by assignee"
          className="w-40"
          value={current('assignee')}
          onChange={(e) => set('assignee', e.target.value)}
        >
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name ?? m.id.slice(0, 8)}</option>
          ))}
        </Select>

        <Select
          aria-label="Filter by project"
          className="w-40"
          value={current('project')}
          onChange={(e) => set('project', e.target.value)}
        >
          <option value="">Any project</option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>

        <Select
          aria-label="Group by"
          className="w-36"
          value={current('groupBy')}
          onChange={(e) => set('groupBy', e.target.value)}
        >
          <option value="">No grouping</option>
          <option value="status">Group by status</option>
          <option value="priority">Group by priority</option>
          <option value="assignee">Group by assignee</option>
          <option value="project">Group by project</option>
          <option value="due">Group by due date</option>
        </Select>

        <Select
          aria-label="Sort by"
          className="w-36"
          value={current('sortBy', 'due_date')}
          onChange={(e) => set('sortBy', e.target.value)}
        >
          <option value="due_date">Sort by due date</option>
          <option value="priority">Sort by priority</option>
          <option value="created_at">Sort by created</option>
          <option value="updated_at">Sort by updated</option>
          <option value="title">Sort by title</option>
        </Select>

        {activeFilters.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams();
              const ws = params.get('workspace');
              if (ws) next.set('workspace', ws);
              const layout = params.get('layout');
              if (layout) next.set('layout', layout);
              startTransition(() => router.push(`?${next.toString()}`));
            }}
          >
            Clear {activeFilters.length} filter{activeFilters.length === 1 ? '' : 's'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
