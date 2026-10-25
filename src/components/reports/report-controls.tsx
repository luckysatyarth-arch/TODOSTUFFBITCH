'use client';

import { useState, useTransition } from 'react';
import { Eye, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { previewReport } from '@/app/(app)/reports/actions';

/**
 * Manual preview, kept distinct from sending.
 *
 * Preview generates and stores the report but delivers nothing, so an operator
 * can see exactly what would go out before any message leaves.
 */
export function ReportControls({
  workspaceId, canManageTeam, serviceRoleAvailable,
}: {
  workspaceId: string;
  canManageTeam: boolean;
  serviceRoleAvailable: boolean;
}) {
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(scope: 'personal' | 'team') {
    setError(null);
    setPreview(null);
    setStatus(null);
    startTransition(async () => {
      const result = await previewReport(workspaceId, scope, date || undefined);
      if (!result.ok) {
        setError(result.error ?? 'Could not generate.');
        return;
      }
      setStatus(result.data?.status ?? null);
      setPreview(
        result.data?.text ??
          'Nothing was generated: there were no records for this date, so no report was produced.',
      );
    });
  }

  return (
    <Card className="mb-4">
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="r-date">Report date (defaults to today)</Label>
            <Input
              id="r-date"
              type="date"
              className="w-40"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <Button
            onClick={() => run('personal')}
            disabled={pending || !serviceRoleAvailable}
          >
            <Eye />
            Preview my personal report
          </Button>

          {canManageTeam ? (
            <Button
              onClick={() => run('team')}
              disabled={pending || !serviceRoleAvailable}
            >
              <Eye />
              Preview the team report
            </Button>
          ) : null}
        </div>

        <p className="text-[11px] text-ink-faint">
          <Send className="inline size-3" /> Preview generates and stores the report but sends
          nothing. Use Resend on a report below to deliver it.
        </p>

        {error ? <ErrorNotice detail={error} /> : null}

        {preview ? (
          <div>
            {status ? (
              <p className="mb-1 text-[11px] text-ink-faint">Generation status: {status}</p>
            ) : null}
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-canvas px-2.5 py-2 text-[11px] text-ink-soft">
              {preview}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
