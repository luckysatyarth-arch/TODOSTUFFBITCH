'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { NAV_ITEMS } from './nav-items';
import { Input } from '@/components/ui/input';

/**
 * Keyboard-first navigation. Cmd/Ctrl+K opens it from anywhere; "/" opens it
 * too, unless focus is already in a text field.
 */
export function CommandPalette({
  workspaceId, isTeam,
}: { workspaceId: string; isTeam: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === 'Escape') setOpen(false);

      if (event.key === '/' && !event.metaKey && !event.ctrlKey) {
        const el = event.target as HTMLElement | null;
        const typing =
          el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
        if (!typing) {
          event.preventDefault();
          setOpen(true);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commands = useMemo(() => {
    const nav = NAV_ITEMS.filter((i) => !i.teamOnly || isTeam).map((i) => ({
      label: `Go to ${i.label}`,
      href: `${i.href}?workspace=${workspaceId}`,
    }));
    const searchHref = query.trim()
      ? [{
          label: `Search for "${query.trim()}"`,
          href: `/search?workspace=${workspaceId}&q=${encodeURIComponent(query.trim())}`,
        }]
      : [];
    return [...searchHref, ...nav];
  }, [isTeam, workspaceId, query]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    // Keep the search command first even when it does not match itself.
    return commands.filter((c, i) => i === 0 || c.label.toLowerCase().includes(needle));
  }, [commands, query]);

  useEffect(() => { setCursor(0); }, [query]);

  if (!open) return null;

  function run(index: number) {
    const target = filtered[index];
    if (!target) return;
    setOpen(false);
    setQuery('');
    router.push(target.href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]">
      <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-paper shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
          <Search className="size-4 shrink-0 text-ink-faint" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or jump to…"
            className="border-0 bg-transparent px-0 focus:ring-0"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(cursor);
              }
            }}
          />
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-faint">No matches.</li>
          ) : (
            filtered.map((c, i) => (
              <li key={c.href + c.label}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(i)}
                  className={`w-full px-3 py-1.5 text-left text-sm ${
                    i === cursor ? 'bg-sunken text-ink' : 'text-ink-soft'
                  }`}
                >
                  {c.label}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-hairline px-3 py-1.5 text-[11px] text-ink-faint">
          ⌘K to toggle · ↑↓ to move · ↵ to open
        </p>
      </div>
    </div>
  );
}
