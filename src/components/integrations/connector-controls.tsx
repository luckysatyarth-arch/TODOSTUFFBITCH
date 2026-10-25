'use client';

import { useState, useTransition } from 'react';
import { Link2, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { disconnect, syncNow } from '@/app/(app)/integrations/actions';

/**
 * Connect, sync and disconnect for one connector.
 *
 * Connecting is a plain link to the OAuth start route rather than a server
 * action, because the browser has to follow a redirect out to the provider.
 */
export function ConnectorControls({
  provider, family, workspaceId, integrationId, configured, canConnect,
}: {
  provider: string;
  family: 'google' | 'microsoft' | 'notion' | 'none';
  workspaceId: string;
  integrationId: string | null;
  configured: boolean;
  canConnect: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function runSync() {
    if (!integrationId) return;
    setNote(null);
    setError(null);
    startTransition(async () => {
      const result = await syncNow(integrationId);
      if (!result.ok) {
        setError(result.error ?? 'Sync failed.');
        return;
      }
      const d = result.data;
      setNote(
        d?.status === 'failed'
          ? `Sync failed: ${d.error ?? 'unknown error'}`
          : `${d?.indexed ?? 0} document(s) indexed, ${d?.skipped ?? 0} unchanged.`,
      );
    });
  }

  function runDisconnect(purge: boolean) {
    if (!integrationId) return;
    setNote(null);
    setError(null);
    startTransition(async () => {
      const result = await disconnect(integrationId, purge);
      if (!result.ok) setError(result.error ?? 'Could not disconnect.');
      else setConfirming(false);
    });
  }

  if (family === 'none') {
    return (
      <p className="text-[11px] text-ink-faint">
        Configured through environment variables rather than OAuth. See
        docs/INTEGRATIONS.md.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {integrationId ? (
          <>
            <Button size="sm" onClick={runSync} disabled={pending}>
              <RefreshCw />
              {pending ? 'Syncing…' : 'Sync now'}
            </Button>

            {confirming ? (
              <>
                <span className="text-[11px] text-ink-faint">Also delete indexed content?</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() => runDisconnect(true)}
                >
                  Disconnect and purge
                </Button>
                <Button size="sm" disabled={pending} onClick={() => runDisconnect(false)}>
                  Keep indexed content
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-urgent"
                onClick={() => setConfirming(true)}
              >
                <Unplug />
                Disconnect
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            asChild={configured && canConnect}
            disabled={!configured || !canConnect}
          >
            {configured && canConnect ? (
              <a
                href={`/api/integrations/${family}/start?provider=${provider}&workspace=${workspaceId}`}
              >
                <Link2 />
                Connect
              </a>
            ) : (
              <span>
                <Link2 />
                Connect
              </span>
            )}
          </Button>
        )}
      </div>

      {!configured ? (
        <p className="text-[11px] text-ink-faint">
          Connecting is disabled until this provider&apos;s OAuth client is configured.
        </p>
      ) : null}

      {note ? <p className="text-[11px] text-ink-soft">{note}</p> : null}
      {error ? <ErrorNotice detail={error} /> : null}
    </div>
  );
}
