'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Moon, Search, Sun, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QuickCapture } from './quick-capture';
import type { SessionContext, WorkspaceSummary } from '@/server/auth';

export function Topbar({
  session, workspace,
}: { session: SessionContext; workspace: WorkspaceSummary }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  function toggleTheme() {
    const root = document.documentElement;
    const next = root.classList.contains('dark') ? 'light' : 'dark';
    root.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private browsing or blocked storage: the theme still applies for this
      // visit, it just will not be remembered.
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-paper px-3 pl-12 md:pl-3">
      <form
        className="relative hidden min-w-0 flex-1 sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim();
          if (q) router.push(`/search?workspace=${workspace.id}&q=${encodeURIComponent(q)}`);
        }}
      >
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, projects and connected sources…"
          aria-label="Search"
          className="max-w-md pl-7"
        />
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <QuickCapture workspaceId={workspace.id} />

        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>

        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
          >
            <User />
          </Button>

          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-hairline bg-paper py-1 shadow-lg">
                <div className="border-b border-hairline px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink">
                    {session.fullName ?? session.email}
                  </p>
                  <p className="truncate text-[11px] text-ink-faint">{session.email}</p>
                </div>
                <a
                  href={`/settings?workspace=${workspace.id}`}
                  className="block px-3 py-1.5 text-sm text-ink-soft hover:bg-sunken"
                >
                  Settings
                </a>
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-sunken"
                  >
                    <LogOut className="size-3.5" />
                    Sign out
                  </button>
                </form>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
