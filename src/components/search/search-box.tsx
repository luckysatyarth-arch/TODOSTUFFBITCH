'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const EXAMPLES = [
  'What is blocking the current project?',
  'Which tasks are still open for the investor presentation?',
  'Which team member owns the overdue deliverables?',
  'What did I promise to finish this week?',
];

export function SearchBox({
  workspaceId, initialQuery,
}: { workspaceId: string; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    startTransition(() =>
      router.push(`/search?workspace=${workspaceId}&q=${encodeURIComponent(trimmed)}`),
    );
  }

  return (
    <div className="mb-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); run(query); }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question about your work…"
            aria-label="Search query"
            className="h-10 pl-8"
          />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={pending || !query.trim()}>
          {pending ? 'Searching…' : 'Ask'}
        </Button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => { setQuery(e); run(e); }}
            className="rounded-full border border-hairline bg-paper px-2.5 py-1 text-[11px] text-ink-soft hover:bg-sunken"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
