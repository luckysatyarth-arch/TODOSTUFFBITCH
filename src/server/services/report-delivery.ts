import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { buildReport, renderReportText, type ReportContent } from './reports';
import { getWhatsAppAdapter, type Recipient } from '@/server/connectors/whatsapp';
import { DEFAULT_TIMEZONE, todayIn } from '@/lib/dates';
import { serverEnv } from '@/lib/env';
import type { Json } from '@/lib/supabase/database.types';

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Deterministic key for one delivery attempt.
 *
 * Derived from the report, the recipient and the provider, so a retried send
 * reuses the same row rather than creating a second delivery. This is the
 * mechanism behind "duplicate scheduled executions do not create duplicate
 * deliveries".
 */
function deliveryKey(
  reportId: string, provider: string, recipientKind: string, recipient: string,
): string {
  return createHash('sha256')
    .update([reportId, provider, recipientKind, recipient].join('|'))
    .digest('hex')
    .slice(0, 48);
}

export interface GenerateOptions {
  workspaceId: string;
  scope: 'personal' | 'team';
  subjectUserId: string | null;
  reportDate?: string;
  client?: Admin;
}

export interface GenerateResult {
  reportId: string;
  status: 'generated' | 'skipped_no_data' | 'already_generated';
  reportDate: string;
  content: ReportContent | null;
  text: string | null;
}

/**
 * Generates and stores one report, idempotently.
 *
 * The unique indexes on daily_reports make (workspace, scope, subject, date) a
 * single row, so a second cron firing for the same day updates that row rather
 * than creating another. A report that already reached a delivered state is
 * left strictly alone.
 */
export async function generateReport(options: GenerateOptions): Promise<GenerateResult> {
  const client = options.client ?? createSupabaseAdminClient();

  const { data: workspace } = await client
    .from('workspaces').select('timezone').eq('id', options.workspaceId).maybeSingle();
  const timezone = workspace?.timezone ?? DEFAULT_TIMEZONE;
  const reportDate = options.reportDate ?? todayIn(timezone);

  // Does one already exist for this scope and date?
  const existingQuery = client
    .from('daily_reports')
    .select('id, status')
    .eq('workspace_id', options.workspaceId)
    .eq('scope', options.scope)
    .eq('report_date', reportDate);

  const { data: existing } = options.scope === 'personal' && options.subjectUserId
    ? await existingQuery.eq('subject_user_id', options.subjectUserId).maybeSingle()
    : await existingQuery.is('subject_user_id', null).maybeSingle();

  if (existing && (existing.status === 'delivered' || existing.status === 'delivering')) {
    return {
      reportId: existing.id, status: 'already_generated', reportDate,
      content: null, text: null,
    };
  }

  const { content, metrics } = await buildReport({
    client,
    workspaceId: options.workspaceId,
    scope: options.scope,
    subjectUserId: options.subjectUserId,
    reportDate,
  });

  // The brief forbids sending empty or misleading reports. A workspace with no
  // records at all records a deliberate non-send rather than delivering a
  // summary of nothing.
  if (!metrics.hasActivity) {
    const row = {
      workspace_id: options.workspaceId,
      scope: options.scope,
      subject_user_id: options.subjectUserId,
      report_date: reportDate,
      timezone,
      status: 'skipped_no_data' as const,
      content: { reason: 'No task, project or event records exist for this workspace.' },
      metrics: metrics as unknown as Json,
      rendered_text: null,
      generated_at: new Date().toISOString(),
    };

    const { data } = existing
      ? await client.from('daily_reports').update(row).eq('id', existing.id).select('id').single()
      : await client.from('daily_reports').insert(row).select('id').single();

    return {
      reportId: data?.id ?? existing?.id ?? '', status: 'skipped_no_data',
      reportDate, content, text: null,
    };
  }

  const text = renderReportText(content);

  const row = {
    workspace_id: options.workspaceId,
    scope: options.scope,
    subject_user_id: options.subjectUserId,
    report_date: reportDate,
    timezone,
    status: 'generated' as const,
    content: content as unknown as Json,
    metrics: metrics as unknown as Json,
    rendered_text: text,
    generated_at: new Date().toISOString(),
    error: null,
  };

  const { data, error } = existing
    ? await client.from('daily_reports').update(row).eq('id', existing.id).select('id').single()
    : await client.from('daily_reports').insert(row).select('id').single();

  if (error) throw new Error(`Could not store the report: ${error.message}`);

  return { reportId: data.id, status: 'generated', reportDate, content, text };
}

export interface DeliveryPlanItem {
  kind: 'personal' | 'group' | 'member_fanout';
  recipient: string;
  /** Set when this destination cannot be served; recorded, never substituted. */
  unsupportedReason?: string;
}

/**
 * Works out where a report should go.
 *
 * Resolution order for a team report: the configured group if the active
 * provider actually supports groups, otherwise a fan-out to members who have
 * their own number on file. If neither is possible the reason is recorded as
 * `unsupported` -- the brief forbids silently substituting a different
 * recipient or claiming a delivery that did not happen.
 */
export async function planDeliveries(
  client: Admin,
  reportId: string,
): Promise<DeliveryPlanItem[]> {
  const { data: report } = await client
    .from('daily_reports')
    .select('id, workspace_id, scope, subject_user_id')
    .eq('id', reportId)
    .maybeSingle();
  if (!report) throw new Error('Report not found.');

  const adapter = getWhatsAppAdapter();

  if (report.scope === 'personal') {
    if (!report.subject_user_id) return [];
    const { data: profile } = await client
      .from('profiles').select('personal_whatsapp_e164')
      .eq('id', report.subject_user_id).maybeSingle();

    if (!profile?.personal_whatsapp_e164) {
      return [{
        kind: 'personal', recipient: 'unset',
        unsupportedReason:
          'No personal WhatsApp number is set on this profile. Add one in Settings.',
      }];
    }
    if (!adapter.capabilities.sendDirect) {
      return [{
        kind: 'personal', recipient: profile.personal_whatsapp_e164,
        unsupportedReason: `Provider '${adapter.provider}' cannot send direct messages.`,
      }];
    }
    return [{ kind: 'personal', recipient: profile.personal_whatsapp_e164 }];
  }

  const { data: workspace } = await client
    .from('workspaces').select('team_whatsapp_destination')
    .eq('id', report.workspace_id).maybeSingle();

  const group = workspace?.team_whatsapp_destination?.trim();

  if (group && adapter.capabilities.sendGroup) {
    const { count } = await client
      .from('workspace_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('workspace_id', report.workspace_id);

    const max = adapter.capabilities.groupMaxParticipants;
    // Checked before sending so an oversized team is reported as a limitation
    // rather than failing opaquely at the provider.
    if (max !== null && (count ?? 0) + 1 > max) {
      return [{
        kind: 'group', recipient: group,
        unsupportedReason:
          `This workspace has ${count} members, but ${adapter.provider} groups are limited ` +
          `to ${max} participants including the sender. Falling back to individual messages.`,
      }, ...(await fanout(client, report.workspace_id))];
    }
    return [{ kind: 'group', recipient: group }];
  }

  if (group && !adapter.capabilities.sendGroup) {
    return [{
      kind: 'group', recipient: group,
      unsupportedReason:
        `A team group is configured, but provider '${adapter.provider}' cannot send to ` +
        'WhatsApp groups. See docs/RESEARCH-WHATSAPP.md.',
    }, ...(await fanout(client, report.workspace_id))];
  }

  return fanout(client, report.workspace_id);
}

/** Individual messages to members who have a number on file. */
async function fanout(client: Admin, workspaceId: string): Promise<DeliveryPlanItem[]> {
  const { data: members } = await client
    .from('workspace_members')
    .select('user_id, profiles(personal_whatsapp_e164)')
    .eq('workspace_id', workspaceId);

  const items: DeliveryPlanItem[] = [];
  for (const m of members ?? []) {
    const number = (m.profiles as { personal_whatsapp_e164: string | null } | null)
      ?.personal_whatsapp_e164;
    if (number) items.push({ kind: 'member_fanout', recipient: number });
  }

  if (items.length === 0) {
    items.push({
      kind: 'member_fanout', recipient: 'none',
      unsupportedReason:
        'No team member has a WhatsApp number on file, and no group destination is usable.',
    });
  }
  return items;
}

export interface DeliverResult {
  attempted: number;
  sent: number;
  failed: number;
  unsupported: number;
  skipped: number;
}

/**
 * Sends a generated report and records every outcome.
 *
 * A delivery is only marked 'sent' when the provider returns a message id;
 * 'delivered' is set later by a provider status webhook, never here. A row
 * that is already sent or delivered is skipped, which is what makes a repeated
 * run safe.
 */
export async function deliverReport(
  reportId: string,
  client: Admin = createSupabaseAdminClient(),
): Promise<DeliverResult> {
  const env = serverEnv();
  const adapter = getWhatsAppAdapter();

  const { data: report } = await client
    .from('daily_reports')
    .select('id, status, rendered_text, scope')
    .eq('id', reportId)
    .maybeSingle();
  if (!report) throw new Error('Report not found.');

  const result: DeliverResult = { attempted: 0, sent: 0, failed: 0, unsupported: 0, skipped: 0 };

  if (report.status === 'skipped_no_data') {
    result.skipped = 1;
    return result;
  }
  if (!report.rendered_text) {
    throw new Error('Report has no rendered text; generate it first.');
  }

  await client.from('daily_reports').update({ status: 'delivering' }).eq('id', reportId);

  const plan = await planDeliveries(client, reportId);

  for (const item of plan) {
    const key = deliveryKey(reportId, adapter.provider, item.kind, item.recipient);

    const { data: existing } = await client
      .from('report_deliveries')
      .select('id, status, attempt_count')
      .eq('idempotency_key', key)
      .maybeSingle();

    if (existing && (existing.status === 'sent' || existing.status === 'delivered'
      || existing.status === 'read')) {
      result.skipped += 1;
      continue;
    }

    const base = {
      daily_report_id: reportId,
      channel: 'whatsapp',
      provider: adapter.provider,
      recipient_kind: item.kind,
      recipient: item.recipient,
      idempotency_key: key,
    };

    // A destination the provider genuinely cannot serve is recorded as
    // 'unsupported' with the reason, not retried and not redirected.
    if (item.unsupportedReason) {
      const row = {
        ...base,
        status: 'unsupported' as const,
        error: item.unsupportedReason,
        attempt_count: (existing?.attempt_count ?? 0),
        last_attempt_at: new Date().toISOString(),
      };
      if (existing) await client.from('report_deliveries').update(row).eq('id', existing.id);
      else await client.from('report_deliveries').insert(row);
      result.unsupported += 1;
      continue;
    }

    result.attempted += 1;
    const recipient: Recipient = item.kind === 'group'
      ? { kind: 'group', groupId: item.recipient }
      : { kind: 'direct', to: item.recipient };

    const send = await adapter.send(recipient, report.rendered_text);
    const attempts = (existing?.attempt_count ?? 0) + 1;

    const row = {
      ...base,
      status: send.status === 'sent' ? ('sent' as const)
        : send.status === 'unsupported' ? ('unsupported' as const)
          : ('failed' as const),
      provider_message_id: send.providerMessageId,
      provider_status: send.providerStatus,
      error: send.error,
      attempt_count: attempts,
      last_attempt_at: new Date().toISOString(),
      // Exponential backoff, capped, and only for failures worth retrying.
      next_retry_at:
        send.status === 'failed' && send.retryable && attempts < 5
          ? new Date(Date.now() + Math.min(2 ** attempts, 32) * 60_000).toISOString()
          : null,
    };

    if (existing) await client.from('report_deliveries').update(row).eq('id', existing.id);
    else await client.from('report_deliveries').insert(row);

    if (send.status === 'sent') result.sent += 1;
    else if (send.status === 'unsupported') result.unsupported += 1;
    else result.failed += 1;
  }

  // The report is 'delivered' only if at least one real send succeeded.
  const finalStatus = result.sent > 0
    ? 'delivered'
    : result.failed > 0 ? 'failed' : 'generated';

  await client.from('daily_reports').update({
    status: finalStatus,
    error: result.sent === 0 && result.unsupported > 0
      ? 'No supported delivery destination; see the delivery records.'
      : null,
  }).eq('id', reportId);

  await client.from('audit_logs').insert({
    workspace_id: null,
    action: 'report.delivered',
    entity_type: 'daily_report',
    entity_id: reportId,
    metadata: {
      provider: adapter.provider,
      timezone: env.REPORT_TIMEZONE,
      ...result,
    },
  });

  return result;
}

/** Retries failed deliveries whose backoff has elapsed. */
export async function retryDueDeliveries(
  client: Admin = createSupabaseAdminClient(),
  limit = 50,
): Promise<{ retried: number }> {
  const { data: due } = await client
    .from('report_deliveries')
    .select('daily_report_id')
    .eq('status', 'failed')
    .not('next_retry_at', 'is', null)
    .lte('next_retry_at', new Date().toISOString())
    .lt('attempt_count', 5)
    .limit(limit);

  const reportIds = [...new Set((due ?? []).map((d) => d.daily_report_id))];
  for (const id of reportIds) {
    await deliverReport(id, client).catch(() => undefined);
  }
  return { retried: reportIds.length };
}
