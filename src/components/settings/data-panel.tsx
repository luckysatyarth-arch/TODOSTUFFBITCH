'use client';

import { useState, useTransition } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNotice } from '@/components/ui/feedback';
import { exportWorkspaceData } from '@/app/(app)/settings/actions';

export function DataPanel({ workspaceId }: { workspaceId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function exportData() {
    setError(null);
    startTransition(async () => {
      const result = await exportWorkspaceData(workspaceId);
      if (!result.ok || !result.data) {
        setError(result.error ?? 'Could not export.');
        return;
      }
      // Built client-side from the returned JSON so the file never has to be
      // staged anywhere on the server.
      const blob = new Blob([result.data.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `workspace-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Your data</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-ink-soft">
          Export every record you can see in this workspace as JSON. The export is filtered by the
          same row level security as the rest of the application, so it contains exactly what you
          are entitled to and nothing more.
        </p>

        <Button onClick={exportData} disabled={pending}>
          <Download />
          {pending ? 'Preparing…' : 'Export workspace data'}
        </Button>

        {error ? <ErrorNotice detail={error} /> : null}

        <div className="border-t border-hairline pt-2">
          <p className="text-xs font-medium text-ink">Deleting your account</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            Deleting your account removes your profile, your personal workspace and everything in
            it, and every capture and recording you own. Records in shared team workspaces stay,
            with your name detached from them. This is irreversible, so it is done by an
            administrator on request rather than by a button here — email the workspace owner, or
            delete the project from the Supabase dashboard if you run this deployment yourself.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
