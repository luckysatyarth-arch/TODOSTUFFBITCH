import { resolvePageContext, one } from '@/server/page-context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canManage } from '@/server/auth';
import { capabilities } from '@/lib/env';
import { allConnectors } from '@/server/connectors/registry';
import { getWhatsAppAdapter, allWhatsAppAdapters } from '@/server/connectors/whatsapp';
import { formatDateIn } from '@/lib/dates';
import { oauthFamily } from '@/server/connectors/oauth';
import { ConnectorControls } from '@/components/integrations/connector-controls';
import { ReindexButton } from '@/components/integrations/reindex-button';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorNotice, SetupNotice } from '@/components/ui/feedback';
import type { Database } from '@/lib/supabase/database.types';

export const metadata = { title: 'Integrations' };

type Provider = Database['public']['Enums']['integration_provider'];

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, workspace, params } = await resolvePageContext(searchParams);
  const supabase = await createSupabaseServerClient();
  const caps = capabilities();

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, provider, status, display_name, last_success_at, last_error, scope_level, owner_id')
    .eq('workspace_id', workspace.id);

  const { data: runs } = await supabase
    .from('integration_sync_runs')
    .select('integration_id, status, started_at, finished_at, documents_indexed, error')
    .order('started_at', { ascending: false })
    .limit(60);

  const byProvider = new Map<Provider, NonNullable<typeof integrations>[number]>();
  for (const i of integrations ?? []) byProvider.set(i.provider, i);

  const lastRun = new Map<string, NonNullable<typeof runs>[number]>();
  for (const r of runs ?? []) {
    if (!lastRun.has(r.integration_id)) lastRun.set(r.integration_id, r);
  }

  const whatsapp = getWhatsAppAdapter();
  const isAdmin = canManage(workspace.role);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Integrations"
        description="Each connector lists what it can actually do, and what it cannot."
      />

      {/* The OAuth start and callback routes redirect back here with these. */}
      {one(params.error) ? (
        <ErrorNotice
          className="mb-4"
          title="Could not connect"
          detail={one(params.error)}
        />
      ) : null}

      {one(params.notice) ? (
        <p className="mb-4 rounded-md border border-done/30 bg-done-soft px-3 py-2 text-xs text-done">
          {one(params.notice)}
        </p>
      ) : null}

      {!caps.credentialEncryption ? (
        <SetupNotice
          className="mb-4"
          title="CREDENTIALS_ENCRYPTION_KEY is not set"
          detail={
            'No integration can be connected until it is. OAuth tokens are encrypted with ' +
            'AES-256-GCM before storage, and without a key there is nowhere safe to put them.'
          }
        />
      ) : null}

      {!isAdmin ? (
        <SetupNotice
          className="mb-4"
          title="Read-only view"
          detail={`Connecting a workspace-level integration needs an owner or admin role; yours is ${workspace.role}.`}
        />
      ) : null}

      <div className="space-y-3">
        {allConnectors().map((connector) => {
          const record = byProvider.get(connector.provider);
          const run = record ? lastRun.get(record.id) : undefined;

          // A connector with no client credentials is 'requires_setup'. It is
          // never shown as connected, which is the distinction the brief asks
          // for between a screen existing and an integration working.
          const effectiveStatus = !connector.isConfigured()
            ? 'requires_setup'
            : (record?.status ?? 'disconnected');

          return (
            <Card key={connector.provider}>
              <CardHeader>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <CardTitle>{connector.label}</CardTitle>
                  <Badge
                    tone={
                      effectiveStatus === 'connected' ? 'done'
                        : effectiveStatus === 'error' ? 'urgent'
                          : effectiveStatus === 'unsupported' ? 'blocked' : 'high'
                    }
                  >
                    {effectiveStatus.replace(/_/g, ' ')}
                  </Badge>
                </div>
                {record?.last_success_at ? (
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    last sync {formatDateIn(record.last_success_at, workspace.timezone, 'd MMM, HH:mm')}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-ink-faint">never synced</span>
                )}
              </CardHeader>

              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <Capability on={connector.capabilities.search} label="Search" />
                  <Capability on={connector.capabilities.fullContent} label="Full content" />
                  <Capability on={connector.capabilities.incrementalSync} label="Incremental sync" />
                  <Capability on={connector.capabilities.deepLinks} label="Deep links" />
                  <Capability on={connector.capabilities.capture} label="Capture" />
                </div>

                {connector.scopes().length > 0 ? (
                  <p className="text-[11px] text-ink-faint">
                    <span className="font-medium">Scopes requested: </span>
                    {connector.scopes().join(', ')}
                  </p>
                ) : null}

                <ul className="list-inside list-disc space-y-0.5 text-[11px] text-ink-soft">
                  {connector.capabilities.notes.map((note, i) => <li key={i}>{note}</li>)}
                </ul>

                {!connector.isConfigured() ? (
                  <p className="rounded-md border border-high/30 bg-high-soft px-2.5 py-1.5 text-[11px] text-high">
                    Not configured in this deployment. Add its client credentials (see
                    docs/INTEGRATIONS.md), then connect it here.
                  </p>
                ) : null}

                {record?.last_error ? (
                  <p className="rounded-md border border-urgent/30 bg-urgent-soft px-2.5 py-1.5 text-[11px] text-urgent">
                    {record.last_error}
                  </p>
                ) : null}

                {run ? (
                  <p className="text-[11px] text-ink-faint">
                    Last run: {run.status} · {run.documents_indexed} document(s) indexed
                    {run.error ? ` · ${run.error}` : ''}
                  </p>
                ) : null}

                <ConnectorControls
                  provider={connector.provider}
                  family={oauthFamily(connector.provider)}
                  workspaceId={workspace.id}
                  integrationId={record?.id ?? null}
                  configured={connector.isConfigured()}
                  canConnect={
                    // A per-user connector is the user's own; a workspace-level
                    // one changes what the whole team can reach.
                    connector.provider === 'whatsapp' ? isAdmin : true
                  }
                />
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardHeader>
            <CardTitle>WhatsApp delivery</CardTitle>
            <Badge tone={whatsapp.isConfigured() ? 'done' : 'high'}>
              {whatsapp.provider}
              {whatsapp.provider === 'dry_run' ? ' (records only)' : ''}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-ink-soft">
              Outbound delivery for the 9 PM reports. Capability is read from the active adapter,
              so the application never claims something the provider cannot do.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-[11px]">
                <caption className="sr-only">WhatsApp provider capabilities</caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-ink-faint">
                    <th scope="col" className="py-1 pr-2 font-medium">Provider</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Direct</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Group</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Group max</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Read inbox</th>
                    <th scope="col" className="py-1 font-medium">Configured</th>
                  </tr>
                </thead>
                <tbody>
                  {allWhatsAppAdapters().map((a) => (
                    <tr key={a.provider} className="border-b border-hairline last:border-0">
                      <td className="py-1 pr-2 text-ink">
                        {a.provider}
                        {a.provider === whatsapp.provider ? ' (active)' : ''}
                      </td>
                      <td className="py-1 pr-2">{a.capabilities.sendDirect ? 'yes' : 'no'}</td>
                      <td className="py-1 pr-2">{a.capabilities.sendGroup ? 'yes' : 'no'}</td>
                      <td className="py-1 pr-2">{a.capabilities.groupMaxParticipants ?? '—'}</td>
                      <td className="py-1 pr-2 text-urgent">no</td>
                      <td className="py-1">{a.isConfigured() ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="rounded-md border border-urgent/30 bg-urgent-soft px-2.5 py-1.5 text-[11px] text-urgent">
              <strong>Not supported, by any provider:</strong> reading a personal WhatsApp
              account&apos;s inbox. No official API offers it. Capture works by forwarding chosen
              messages to the business number instead. See docs/RESEARCH-WHATSAPP.md.
            </p>

            {whatsapp.capabilities.sendGroup ? (
              <p className="text-[11px] text-ink-faint">
                Group sending needs an Official Business Account and is capped at{' '}
                {whatsapp.capabilities.groupMaxParticipants} participants including the sender.
                A larger team is reported as a limitation before any send is attempted, and the
                report fans out to individual numbers instead.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Internal search index</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-ink-soft">
              Tasks, projects, comments and notes are indexed automatically: a write updates the
              keyword index immediately, and the scheduled pass adds the chunks and embeddings
              that semantic search needs. Rebuild it by hand after changing the embeddings
              configuration, or to backfill records created before this deployment.
            </p>
            {isAdmin ? (
              <ReindexButton workspaceId={workspace.id} />
            ) : (
              <p className="text-[11px] text-ink-faint">
                Rebuilding the index needs an owner or admin role.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Your capture endpoint</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-ink-soft">
            <p>
              Forward a WhatsApp message to the configured business number and it arrives here as
              a capture awaiting your review.
            </p>
            <p className="text-[11px] text-ink-faint">
              Webhook path: <code className="rounded bg-sunken px-1">/api/webhooks/whatsapp</code>
              {' '}· signature verified with WHATSAPP_APP_SECRET · owner resolved by sender number,
              so a message from an unknown number is rejected rather than attributed to someone.
            </p>
            <p className="text-[11px] text-ink-faint">
              Your number on file:{' '}
              {session.personalWhatsapp ?? 'not set — add it in Settings to receive reports and capture by forwarding.'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Capability({ on, label }: { on: boolean; label: string }) {
  return (
    <Badge tone={on ? 'done' : 'neutral'}>
      {on ? '✓' : '✗'} {label}
    </Badge>
  );
}
