import { BarChart3 } from 'lucide-react';
import { resolvePageContext } from '@/server/page-context';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canManage } from '@/server/auth';
import { capabilities } from '@/lib/env';
import { REPORT_CRON_UTC, REPORT_LOCAL_HOUR, formatDateIn } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, SetupNotice } from '@/components/ui/feedback';
import { Stat } from '@/components/ui/labels';
import { ReportControls } from '@/components/reports/report-controls';
import { ResendButton } from '@/components/reports/resend-button';
import { getWhatsAppAdapter } from '@/server/connectors/whatsapp';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, workspace } = await resolvePageContext(searchParams);
  const supabase = await createSupabaseServerClient();
  const caps = capabilities();
  const adapter = getWhatsAppAdapter();

  // RLS limits this to team reports plus the caller's own personal ones.
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('id, scope, subject_user_id, report_date, status, metrics, rendered_text, generated_at, error, timezone')
    .eq('workspace_id', workspace.id)
    .order('report_date', { ascending: false })
    .limit(30);

  const { data: deliveries } = await supabase
    .from('report_deliveries')
    .select('id, daily_report_id, provider, recipient_kind, recipient, status, provider_status, attempt_count, error, last_attempt_at')
    .order('created_at', { ascending: false })
    .limit(120);

  const byReport = new Map<string, typeof deliveries>();
  for (const d of deliveries ?? []) {
    const bucket = byReport.get(d.daily_report_id) ?? [];
    bucket.push(d);
    byReport.set(d.daily_report_id, bucket as typeof deliveries);
  }

  const failed = (deliveries ?? []).filter((d) => d.status === 'failed').length;
  const unsupported = (deliveries ?? []).filter((d) => d.status === 'unsupported').length;
  const isAdmin = canManage(workspace.role);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Generated at ${REPORT_LOCAL_HOUR}:00 ${workspace.timezone} each day, independently of the browser.`}
      />

      {!caps.serviceRole ? (
        <SetupNotice
          className="mb-4"
          title="Scheduled reporting is not operational"
          detail={
            'SUPABASE_SERVICE_ROLE_KEY is not set. Reports cannot be generated or sent without ' +
            'it, because the scheduled run has no user session to act under.'
          }
        />
      ) : null}

      {!caps.cron ? (
        <SetupNotice
          className="mb-4"
          title="CRON_SECRET is not set"
          detail="The scheduled endpoint refuses to run without it, so nothing will fire at 21:00."
        />
      ) : null}

      {caps.whatsapp === 'dry_run' ? (
        <SetupNotice
          className="mb-4"
          title="WhatsApp is in dry-run mode"
          detail={
            'Reports are generated and delivery records are written, but no message is sent. ' +
            'Set WHATSAPP_PROVIDER to meta_cloud or twilio with credentials to deliver for real.'
          }
        />
      ) : null}

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Reports on record" value={(reports ?? []).length} />
        <Stat label="Failed deliveries" value={failed} tone={failed > 0 ? 'urgent' : 'default'} />
        <Stat label="Unsupported" value={unsupported} tone={unsupported > 0 ? 'blocked' : 'default'} />
        <Stat label="Provider" value={adapter.provider} />
      </section>

      <Card className="mb-4">
        <CardHeader><CardTitle>Schedule</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-ink-soft">
          <p>
            <span className="text-ink-faint">Cron expression: </span>
            <code className="rounded bg-sunken px-1">{REPORT_CRON_UTC}</code>
            <span className="text-ink-faint"> (UTC) = {REPORT_LOCAL_HOUR}:00 Asia/Kolkata</span>
          </p>
          <p className="text-ink-faint">
            IST has no daylight saving, so the fixed UTC expression maps to 21:00 all year. The
            endpoint re-checks the local hour when it runs and reports a mismatch rather than
            quietly producing reports at the wrong time.
          </p>
          <p>
            <span className="text-ink-faint">Group delivery: </span>
            {adapter.capabilities.sendGroup
              ? `supported, up to ${adapter.capabilities.groupMaxParticipants ?? 'unknown'} participants`
              : `not supported by ${adapter.provider}; reports fan out to individual numbers instead`}
          </p>
        </CardContent>
      </Card>

      <ReportControls
        workspaceId={workspace.id}
        canManageTeam={isAdmin}
        serviceRoleAvailable={caps.serviceRole}
      />

      {(reports ?? []).length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="No reports yet"
              hint="Use Preview above to generate one now, or wait for the 21:00 run."
              icon={<BarChart3 className="size-5" />}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(reports ?? []).map((r) => {
            const metrics = (r.metrics ?? {}) as Record<string, number | boolean>;
            const rows = byReport.get(r.id) ?? [];
            const isMine = r.scope === 'personal' && r.subject_user_id === session.userId;

            return (
              <Card key={r.id}>
                <CardHeader>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge tone={r.scope === 'team' ? 'accent' : 'neutral'}>
                      {r.scope === 'team' ? 'Team' : isMine ? 'Personal (yours)' : 'Personal'}
                    </Badge>
                    <CardTitle>{formatDateIn(r.report_date)}</CardTitle>
                    <Badge
                      tone={
                        r.status === 'delivered' ? 'done'
                          : r.status === 'failed' ? 'urgent'
                            : r.status === 'skipped_no_data' ? 'high' : 'neutral'
                      }
                    >
                      {r.status.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-ink-faint">
                      {r.generated_at ? formatDateIn(r.generated_at, r.timezone, 'd MMM, HH:mm') : ''}
                    </span>
                    {r.status !== 'skipped_no_data' && (r.scope === 'team' ? isAdmin : isMine) ? (
                      <ResendButton reportId={r.id} />
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="space-y-2">
                  {r.status === 'skipped_no_data' ? (
                    <p className="rounded-md border border-high/30 bg-high-soft px-3 py-2 text-xs text-high">
                      Deliberately not sent: there were no records to report on. An empty summary
                      would have been misleading.
                    </p>
                  ) : null}

                  {r.error ? (
                    <p className="rounded-md border border-urgent/30 bg-urgent-soft px-3 py-2 text-xs text-urgent">
                      {r.error}
                    </p>
                  ) : null}

                  <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                    {(['completedToday', 'remainingToday', 'overdue', 'blocked', 'upcoming'] as const)
                      .map((key) => (
                        <div key={key}>
                          <dt className="inline text-ink-faint">
                            {key.replace(/([A-Z])/g, ' $1').toLowerCase()}:{' '}
                          </dt>
                          <dd className="inline tabular-nums text-ink">
                            {String(metrics[key] ?? 0)}
                          </dd>
                        </div>
                      ))}
                  </dl>

                  {r.rendered_text ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-accent">
                        Show the message that was prepared
                      </summary>
                      <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-canvas px-2 py-1.5 text-[11px] text-ink-soft">
                        {r.rendered_text}
                      </pre>
                    </details>
                  ) : null}

                  <div>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Deliveries ({rows.length})
                    </p>
                    {rows.length === 0 ? (
                      <p className="text-xs text-ink-faint">No delivery attempted.</p>
                    ) : (
                      <ul className="space-y-1">
                        {rows.map((d) => (
                          <li key={d.id} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <Badge
                              tone={
                                d.status === 'sent' || d.status === 'delivered' || d.status === 'read'
                                  ? 'done'
                                  : d.status === 'failed' ? 'urgent' : 'high'
                              }
                            >
                              {d.status}
                            </Badge>
                            <span className="text-ink-soft">{d.provider}</span>
                            <span className="text-ink-faint">{d.recipient_kind}</span>
                            <span className="text-ink-faint">{maskRecipient(d.recipient)}</span>
                            {d.attempt_count > 1 ? (
                              <span className="text-ink-faint">{d.attempt_count} attempts</span>
                            ) : null}
                            {d.error ? <span className="text-urgent">{d.error}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Phone numbers are shown partially: enough to identify, not to harvest. */
function maskRecipient(recipient: string): string {
  if (recipient.length <= 6) return recipient;
  if (recipient.startsWith('+')) {
    return `${recipient.slice(0, 4)}•••${recipient.slice(-3)}`;
  }
  return `${recipient.slice(0, 4)}…`;
}
