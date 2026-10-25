'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';
import { WorkspaceSwitcher } from './workspace-switcher';
import type { WorkspaceSummary } from '@/server/auth';

export function Sidebar({
  workspaces, active, pendingProposals,
}: {
  workspaces: WorkspaceSummary[];
  active: WorkspaceSummary;
  pendingProposals: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Carry the active workspace through every nav link.
  const qs = active ? `?workspace=${active.id}` : '';
  const items = NAV_ITEMS.filter((i) => !i.teamOnly || active.kind === 'team');

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={`${item.href}${qs}`}
            onClick={() => setMobileOpen(false)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
              isActive
                ? 'bg-sunken font-medium text-ink'
                : 'text-ink-soft hover:bg-sunken hover:text-ink',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.href === '/inbox' && pendingProposals > 0 ? (
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white">
                {pendingProposals}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile trigger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-30 rounded-md border border-hairline bg-paper p-1.5 md:hidden"
      >
        <Menu className="size-4 text-ink-soft" />
      </button>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col gap-3 border-r border-hairline bg-paper p-3">
            <div className="flex items-center justify-between">
              <WorkspaceSwitcher workspaces={workspaces} active={active} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="ml-1 rounded p-1 hover:bg-sunken"
              >
                <X className="size-4 text-ink-faint" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      {/* Desktop rail */}
      <aside className="hidden w-60 shrink-0 flex-col gap-3 border-r border-hairline bg-paper p-3 md:flex">
        <WorkspaceSwitcher workspaces={workspaces} active={active} />
        {nav}
      </aside>
    </>
  );
}
