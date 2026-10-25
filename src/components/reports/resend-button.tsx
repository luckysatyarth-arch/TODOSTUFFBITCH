'use client';

import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { resendReport } from '@/app/(app)/reports/actions';

/**
 * Resends one report.
 *
 * Safe to press twice: delivery is keyed on an idempotency hash, so a
 * recipient that already received the message is skipped rather than messaged
 * again. The result says exactly what happened.
 */
export function ResendButton({ reportId }: { reportId: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setNote(null);
    startTransition(async () => {
      const result = await resendReport(reportId);
      if (!result.ok) {
        setNote(result.error ?? 'Failed.');
        return;
      }
      const d = result.data;
      setNote(
        d
          ? `${d.sent} sent, ${d.failed} failed, ${d.unsupported} unsupported, ${d.skipped} already delivered`
          : 'Done.',
      );
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {note ? <span className="text-[11px] text-ink-faint">{note}</span> : null}
      <Button variant="ghost" size="sm" onClick={send} disabled={pending}>
        <Send />
        {pending ? 'Sending…' : 'Resend'}
      </Button>
    </span>
  );
}
