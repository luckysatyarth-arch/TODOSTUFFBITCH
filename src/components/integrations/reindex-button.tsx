'use client';

import { useState, useTransition } from 'react';
import { DatabaseZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { reindexWorkspace } from '@/app/(app)/integrations/actions';

/**
 * Rebuilds the workspace's search index on demand.
 *
 * The write paths keep keyword search current; this is for the chunks and
 * embeddings that the inline path skips, so semantic search becomes available
 * without waiting for the scheduled run.
 */
export function ReindexButton({ workspaceId }: { workspaceId: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setNote(null);
    setError(null);
    startTransition(async () => {
      const result = await reindexWorkspace(workspaceId);
      if (!result.ok) {
        setError(result.error ?? 'Reindex failed.');
        return;
      }
      const d = result.data;
      setNote(
        `${d?.indexed ?? 0} record(s) indexed, ${d?.skipped ?? 0} unchanged, ` +
        `${d?.embedded ?? 0} embedding(s) written.`,
      );
    });
  }

  return (
    <div className="space-y-1.5">
      <Button onClick={run} disabled={pending}>
        <DatabaseZap />
        {pending ? 'Rebuilding…' : 'Rebuild search index'}
      </Button>
      {note ? <p className="text-[11px] text-ink-soft">{note}</p> : null}
      {error ? <ErrorNotice detail={error} /> : null}
    </div>
  );
}
