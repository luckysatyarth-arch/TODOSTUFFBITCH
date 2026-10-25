import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import { syncIntegration } from '@/server/services/integrations';
import { indexWorkspaceRecords } from '@/server/services/indexer';
import { retryDueDeliveries } from '@/server/services/report-delivery';

type Admin = SupabaseClient<Database>;

/**
 * The durable job queue.
 *
 * `job_runs` has existed since the first schema, with attempts, backoff and
 * lock columns, but nothing claimed from it. Migration 0011 added the claim,
 * completion and failure operations in SQL -- atomic claiming is the one part
 * that cannot be done correctly from application code -- and this is the
 * worker that drives them.
 *
 * Everything here goes through the service role. The queue's table carries RLS
 * with no policies and the SQL functions are revoked from `authenticated`, so
 * a client can neither read a payload nor enqueue work.
 */

export type JobType =
  | 'sync_integration'
  | 'index_workspace'
  | 'retry_deliveries';

export const JOB_TYPES: readonly JobType[] = [
  'sync_integration', 'index_workspace', 'retry_deliveries',
] as const;

export interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** What a handler reports back. */
export interface JobOutcome {
  result?: Record<string, unknown>;
  /** False for a failure that another attempt cannot fix. */
  retryable?: boolean;
}

export class PermanentJobError extends Error {
  readonly retryable = false;
}

/**
 * Queues work, or returns the job already queued under the same key.
 *
 * The key is how an inline path and a scheduled sweep can both ask for the
 * same unit of work and get one job rather than two.
 */
export async function enqueueJob(
  client: Admin,
  jobType: JobType,
  payload: Record<string, unknown> = {},
  options: { idempotencyKey?: string; runAfter?: Date; maxAttempts?: number } = {},
): Promise<string | null> {
  // Absent arguments are omitted rather than sent as null, so the function's
  // own defaults apply. PostgREST treats a missing key and an explicit null
  // differently, and the generated types say so.
  const { data, error } = await client.rpc('enqueue_job', {
    p_job_type: jobType,
    p_payload: payload as Json,
    p_max_attempts: options.maxAttempts ?? 5,
    ...(options.idempotencyKey ? { p_idempotency_key: options.idempotencyKey } : {}),
    ...(options.runAfter ? { p_run_after: options.runAfter.toISOString() } : {}),
  });

  if (error) throw new Error(`Could not enqueue ${jobType}: ${error.message}`);
  return data ?? null;
}

export interface WorkerReport {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
  reclaimed: number;
  results: Array<{ id: string; jobType: string; status: string; error?: string }>;
  durationMs: number;
}

/**
 * Claims and runs up to `limit` due jobs.
 *
 * Jobs run one at a time. They are mostly third-party calls, and running them
 * in parallel is the quickest way to be rate limited by the very services the
 * retries exist to tolerate.
 */
export async function runDueJobs(
  client: Admin,
  options: { worker?: string; limit?: number; types?: JobType[] } = {},
): Promise<WorkerReport> {
  const started = Date.now();
  const worker = options.worker ?? `worker-${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}`;

  const report: WorkerReport = {
    claimed: 0, succeeded: 0, failed: 0, dead: 0, reclaimed: 0,
    results: [], durationMs: 0,
  };

  // First return anything a previous worker died holding. The attempt is
  // already counted against it, so a job that reliably kills its worker still
  // reaches max_attempts and stops rather than looping forever.
  const { data: reclaimed } = await client.rpc('reclaim_stale_jobs', {});
  report.reclaimed = typeof reclaimed === 'number' ? reclaimed : 0;

  const { data: claimed, error } = await client.rpc('claim_jobs', {
    p_worker: worker,
    p_limit: options.limit ?? 5,
    ...(options.types ? { p_types: options.types } : {}),
  });

  if (error) throw new Error(`Could not claim jobs: ${error.message}`);

  // The column is jsonb, so the generated type gives `payload: Json`. A
  // handler reads named keys off it and checks each one, so it is narrowed to
  // an object here rather than every handler re-proving it.
  const jobs = (claimed ?? []) as unknown as JobRow[];
  report.claimed = jobs.length;

  for (const job of jobs) {
    try {
      const outcome = await runJob(client, job);
      await client.rpc('complete_job', {
        p_id: job.id,
        p_result: (outcome.result ?? {}) as Json,
      });
      report.succeeded += 1;
      report.results.push({ id: job.id, jobType: job.job_type, status: 'succeeded' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Job threw a non-error.';
      const retryable = !(error instanceof PermanentJobError);

      const { data: status } = await client.rpc('fail_job', {
        p_id: job.id,
        p_error: message,
        p_retryable: retryable,
      });

      if (status === 'dead') report.dead += 1;
      else report.failed += 1;

      report.results.push({
        id: job.id,
        jobType: job.job_type,
        status: typeof status === 'string' ? status : 'failed',
        error: message,
      });
    }
  }

  report.durationMs = Date.now() - started;
  return report;
}

/**
 * Dispatches one job.
 *
 * An unknown type is permanent, not retryable: retrying a job no handler
 * recognises four more times only delays the moment someone notices. The
 * handlers are the same functions the cron routes call, so moving work onto
 * the queue does not change what it does.
 */
async function runJob(client: Admin, job: JobRow): Promise<JobOutcome> {
  switch (job.job_type as JobType) {
    case 'sync_integration': {
      const integrationId = asString(job.payload.integrationId);
      if (!integrationId) {
        throw new PermanentJobError('sync_integration needs an integrationId.');
      }
      const result = await syncIntegration(client, integrationId, { limit: 50 });
      if (result.status === 'failed') {
        // A sync failure is usually an expired token or a throttle, both of
        // which a later attempt can get past.
        throw new Error(result.error ?? 'Sync failed.');
      }
      return {
        result: {
          status: result.status,
          documentsIndexed: result.documentsIndexed,
          documentsSkipped: result.documentsSkipped,
        },
      };
    }

    case 'index_workspace': {
      const workspaceId = asString(job.payload.workspaceId);
      if (!workspaceId) {
        throw new PermanentJobError('index_workspace needs a workspaceId.');
      }
      const result = await indexWorkspaceRecords(client, workspaceId);
      return { result: { indexed: result.indexed, embedded: result.embedded } };
    }

    case 'retry_deliveries': {
      const result = await retryDueDeliveries();
      return { result: { ...result } };
    }

    default:
      throw new PermanentJobError(`No handler for job type '${job.job_type}'.`);
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
