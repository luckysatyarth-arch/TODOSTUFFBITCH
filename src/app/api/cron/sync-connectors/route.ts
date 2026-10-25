import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { syncIntegration } from '@/server/services/integrations';
import { indexWorkspaceRecords } from '@/server/services/indexer';
import { pruneRateLimits } from '@/server/services/rate-limit';
import { enqueueJob } from '@/server/services/jobs';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Scheduled connector sync and index maintenance.
 *
 * Two jobs in one pass:
 *
 *  - Every connected integration is synced and its documents indexed.
 *  - Every workspace's own records are re-indexed, which backfills anything
 *    the inline write hooks missed and builds the chunks and embeddings that
 *    the inline path deliberately skips. Keyword search is therefore fresh
 *    immediately on a write, and semantic search becomes available here.
 *
 * Authenticated by the same shared secret as the report run, compared in
 * constant time.
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

  const client = createSupabaseAdminClient();
  const started = Date.now();
  const onlyWorkspace = request.nextUrl.searchParams.get('workspace');
  const skipConnectors = request.nextUrl.searchParams.get('internalOnly') === 'true';
  // `?queue=true` enqueues the work instead of doing it inline, so one slow
  // provider cannot consume the request budget and starve the integrations
  // after it. The worker then runs them with per-job attempts and backoff.
  const queue = request.nextUrl.searchParams.get('queue') === 'true';

  const outcome = {
    integrations: 0,
    synced: 0,
    failed: 0,
    documentsIndexed: 0,
    workspacesReindexed: 0,
    internalDocumentsIndexed: 0,
    embeddingsWritten: 0,
    errors: [] as Array<{ integrationId: string; provider: string; error: string }>,
    queued: 0,
    durationMs: 0,
  };

  if (!skipConnectors) {
    let query = client
      .from('integrations')
      .select('id, provider, workspace_id, status')
      // A connector needing setup has nothing to sync; one in error is retried
      // here, since the cause is often an expired token that refresh fixes.
      .in('status', ['connected', 'error']);

    if (onlyWorkspace) query = query.eq('workspace_id', onlyWorkspace);

    const { data: integrations, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Could not list integrations: ${error.message}` }, { status: 500 });
    }

    outcome.integrations = (integrations ?? []).length;

    for (const integration of integrations ?? []) {
      if (queue) {
        // One job per integration per run. The key keeps a retried cron from
        // stacking duplicates for the same integration and hour.
        const key = `sync:${integration.id}:${new Date().toISOString().slice(0, 13)}`;
        await enqueueJob(client, 'sync_integration', { integrationId: integration.id }, {
          idempotencyKey: key,
        }).then(() => { outcome.queued += 1; })
          .catch((err: unknown) => {
            outcome.errors.push({
              integrationId: integration.id,
              provider: integration.provider,
              error: err instanceof Error ? err.message : 'Could not enqueue.',
            });
          });
        continue;
      }

      // Sequential on purpose: these hit third-party rate limits, and a burst
      // of parallel syncs is the quickest way to get throttled.
      const result = await syncIntegration(client, integration.id, { limit: 50 })
        .catch((err) => ({
          integrationId: integration.id,
          provider: integration.provider,
          status: 'failed' as const,
          documentsIndexed: 0,
          documentsSkipped: 0,
          error: err instanceof Error ? err.message : 'Sync threw.',
        }));

      if (result.status === 'failed') {
        outcome.failed += 1;
        outcome.errors.push({
          integrationId: integration.id,
          provider: integration.provider,
          error: result.error ?? 'unknown',
        });
      } else {
        outcome.synced += 1;
        outcome.documentsIndexed += result.documentsIndexed;
      }
    }
  }

  // Internal reindex, which is what makes internal search work at all.
  let workspaceQuery = client.from('workspaces').select('id');
  if (onlyWorkspace) workspaceQuery = workspaceQuery.eq('id', onlyWorkspace);
  const { data: workspaces } = await workspaceQuery;

  for (const workspace of workspaces ?? []) {
    const result = await indexWorkspaceRecords(client, workspace.id).catch(() => null);
    if (result) {
      outcome.workspacesReindexed += 1;
      outcome.internalDocumentsIndexed += result.indexed;
      outcome.embeddingsWritten += result.embedded;
    }
  }

  await pruneRateLimits().catch(() => undefined);

  outcome.durationMs = Date.now() - started;
  return NextResponse.json(outcome);
}

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
