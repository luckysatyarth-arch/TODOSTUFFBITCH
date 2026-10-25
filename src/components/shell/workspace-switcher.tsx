'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, ChevronsUpDown, Lock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceSummary } from '@/server/auth';

export function WorkspaceSwitcher({
  workspaces, active,
}: { workspaces: WorkspaceSummary[]; active: WorkspaceSummary }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();

  function select(id: string) {
    setOpen(false);
    if (id === active.id) return;
    // Workspace lives in the query string so every view is linkable and the
    // server can authorize it per request.
    const params = new URLSearchParams(searchParams.toString());
    params.set('workspace', id);
    startTransition(() => router.push(`?${params.toString()}`));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={pending}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sunken"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-accent text-[10px] font-semibold text-white">
          {active.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{active.name}</span>
          <span className="block truncate text-[11px] text-ink-faint">
            {active.kind === 'personal' ? 'Private' : `Team · ${active.role}`}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-ink-faint" />
      </button>

      {open ? (
        <>
          {/* Click-away layer. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-hairline bg-paper py-1 shadow-lg"
          >
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={w.id === active.id}
                  onClick={() => select(w.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-sunken',
                    w.id === active.id ? 'text-ink' : 'text-ink-soft',
                  )}
                >
                  {w.kind === 'personal'
                    ? <Lock className="size-3.5 shrink-0 text-ink-faint" />
                    : <Users className="size-3.5 shrink-0 text-ink-faint" />}
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === active.id ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
