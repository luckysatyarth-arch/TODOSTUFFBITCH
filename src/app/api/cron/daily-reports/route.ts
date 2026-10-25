import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { generateReport, deliverReport, retryDueDeliveries } from '@/server/services/report-delivery';
import { serverEnv } from '@/lib/env';
import { DEFAULT_TIMEZONE, REPORT_LOCAL_HOUR, localClock, todayIn } from '@/lib/dates';

// Report generation fans out over every workspace, so this needs room to run
// and must never be cached.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The 9pm IST daily report run.
 *
 * Scheduled by Vercel Cron at 15:30 UTC (see vercel.json), which is 21:00 in
 * Asia/Kolkata. IST observes no daylight saving, so the fixed UTC expression
 * is stable year-round; the route re-checks the local hour at runtime anyway
 * and reports a mismatch rather than trusting the deployment config.
 *
 * Authenticated by a shared secret, not a user session, so it works with no
 * browser open. Safe to call repeatedly: generation is keyed on
 * (workspace, scope, subject, date) and delivery on a per-recipient
 * idempotency key, so a duplicate firing produces no duplicate messages.
 */
export async function GET(request: NextRequest) {
  const env = serverEnv();

  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; refusing to run.' },
      { status: 503 },
    );
  }

  if (!authorized(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  // Lets an operator re-run a specific date, or force a run outside the window
  // when verifying the deployment.
  const requestedDate = url.searchParams.get('date') ?? undefined;
  const force = url.searchParams.get('force') === 'true';
  const dryRun = url.searchParams.get('generateOnly') === 'true';

  const timezone = env.REPORT_TIMEZONE || DEFAULT_TIMEZONE;
  const clock = localClock(new Date(), timezone);

  // A deployment misconfiguration (wrong cron expression, wrong timezone) is
  // reported rather than silently producing reports at the wrong hour. One
  // hour of tolerance covers normal scheduler drift.
  const inWindow = Math.abs(clock.hour - REPORT_LOCAL_HOUR) <= 1;
  if (!inWindow && !force && !requestedDate) {
    return NextResponse.json({
      skipped: true,
      reason:
        `Local time in ${timezone} is ${String(clock.hour).padStart(2, '0')}:` +
        `${String(clock.minute).padStart(2, '0')}, which is outside the ` +
        `${REPORT_LOCAL_HOUR}:00 window. Check the cron expression (expected ` +
        '30 15 * * * in UTC). Add ?force=true to run anyway.',
      localHour: clock.hour,
      timezone,
    }, { status: 409 });
  }

  const client = createSupabaseAdminClient();
  const started = Date.now();

  const outcome: {
    reportDate: string | null;
    timezone: string;
    localTime: string;
    workspaces: number;
    generated: number;
    skippedNoData: number;
    alreadyGenerated: number;
    delivered: number;
    failed: number;
    unsupported: number;
    retried: number;
    errors: Array<{ workspaceId: string; scope: string; error: string }>;
    durationMs?: number;
  } = {
    reportDate: requestedDate ?? null,
    timezone,
    localTime: `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`,
    workspaces: 0,
    generated: 0,
    skippedNoData: 0,
    alreadyGenerated: 0,
    delivered: 0,
    failed: 0,
    unsupported: 0,
    retried: 0,
    errors: [],
  };

  const { data: workspaces, error } = await client
    .from('workspaces')
    .select('id, kind, timezone, owner_id');

  if (error) {
    return NextResponse.json({ error: `Could not list workspaces: ${error.message}` }, { status: 500 });
  }

  outcome.workspaces = (workspaces ?? []).length;

  for (const workspace of workspaces ?? []) {
    const wsTimezone = workspace.timezone ?? timezone;
    const reportDate = requestedDate ?? todayIn(wsTimezone);
    outcome.reportDate ??= reportDate;

    // A personal report per member (private, to their own number), and one
    // team report per team workspace. Personal data never enters the team one
    // because the two are built from different queries.
    const { data: members } = await client
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspace.id);

    for (const member of members ?? []) {
      await runOne(
        client, outcome, workspace.id, 'personal', member.user_id, reportDate, dryRun,
      );
    }

    if (workspace.kind === 'team') {
      await runOne(client, outcome, workspace.id, 'team', null, reportDate, dryRun);
    }
  }

  // Covers earlier failures whose backoff has elapsed, so a transient provider
  // outage recovers on the next run without manual intervention.
  if (!dryRun) {
    const retry = await retryDueDeliveries(client).catch(() => ({ retried: 0 }));
    outcome.retried = retry.retried;
  }

  outcome.durationMs = Date.now() - started;
  return NextResponse.json(outcome);
}

async function runOne(
  client: ReturnType<typeof createSupabaseAdminClient>,
  outcome: {
    generated: number; skippedNoData: number; alreadyGenerated: number;
    delivered: number; failed: number; unsupported: number;
    errors: Array<{ workspaceId: string; scope: string; error: string }>;
  },
  workspaceId: string,
  scope: 'personal' | 'team',
  subjectUserId: string | null,
  reportDate: string,
  generateOnly: boolean,
) {
  try {
    const generated = await generateReport({
      workspaceId, scope, subjectUserId, reportDate, client,
    });

    if (generated.status === 'generated') outcome.generated += 1;
    else if (generated.status === 'skipped_no_data') outcome.skippedNoData += 1;
    else outcome.alreadyGenerated += 1;

    if (generateOnly || generated.status === 'skipped_no_data') return;
    if (generated.status === 'already_generated') return;

    const delivery = await deliverReport(generated.reportId, client);
    outcome.delivered += delivery.sent;
    outcome.failed += delivery.failed;
    outcome.unsupported += delivery.unsupported;
  } catch (err) {
    // One workspace's failure must not abort the whole run.
    outcome.errors.push({
      workspaceId,
      scope,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

/**
 * Accepts either Vercel Cron's Authorization header or an x-cron-secret
 * header, compared in constant time so the secret cannot be probed by timing.
 */
function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get('authorization');
  const custom = request.headers.get('x-cron-secret');
  const candidate = header?.startsWith('Bearer ') ? header.slice(7) : custom;
  if (!candidate) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
