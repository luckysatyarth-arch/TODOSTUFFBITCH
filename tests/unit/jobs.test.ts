import { describe, expect, it, vi } from 'vitest';
import { JOB_TYPES, runDueJobs } from '@/server/services/jobs';

/**
 * The worker's decision about whether failed work gets another turn.
 *
 * The queue's claim, backoff and dead-lettering live in SQL and are covered by
 * supabase/local/04_verify_jobs.sql against a real PostgreSQL. What only the
 * application decides is which failures are worth retrying — and getting that
 * wrong is expensive in both directions: a permanent failure retried five
 * times delays the moment anyone notices, and a transient one marked permanent
 * drops the work silently.
 */

type Call = { fn: string; args: Record<string, unknown> };

/** A Supabase client stub that records rpc calls and replays queued jobs. */
function fakeClient(jobs: Array<Record<string, unknown>>) {
  const calls: Call[] = [];

  const client = {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'reclaim_stale_jobs') return Promise.resolve({ data: 0, error: null });
      if (fn === 'claim_jobs') return Promise.resolve({ data: jobs, error: null });
      if (fn === 'fail_job') {
        // Mirror the SQL: a retryable failure with attempts left is requeued.
        const attempts = Number(
          jobs.find((j) => j.id === args.p_id)?.attempts ?? 1,
        );
        const max = Number(jobs.find((j) => j.id === args.p_id)?.max_attempts ?? 5);
        const status = args.p_retryable && attempts < max ? 'queued' : 'dead';
        return Promise.resolve({ data: status, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  };

  return { client, calls };
}

const call = (calls: Call[], fn: string) => calls.find((c) => c.fn === fn);

describe('runDueJobs', () => {
  it('reclaims abandoned jobs before claiming new ones', async () => {
    const { client, calls } = fakeClient([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runDueJobs(client as any);

    // Order matters: a job left 'running' by a dead worker has to be returned
    // to the queue before this worker asks what is due, or it waits a whole
    // extra cycle.
    expect(calls.map((c) => c.fn)).toEqual(['reclaim_stale_jobs', 'claim_jobs']);
  });

  it('reports nothing done when the queue is empty', async () => {
    const { client } = fakeClient([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await runDueJobs(client as any);

    expect(report.claimed).toBe(0);
    expect(report.succeeded).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.dead).toBe(0);
  });

  it('marks an unknown job type dead instead of retrying it', async () => {
    const { client, calls } = fakeClient([
      { id: 'job-1', job_type: 'does_not_exist', payload: {}, attempts: 1, max_attempts: 5 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await runDueJobs(client as any);

    const failed = call(calls, 'fail_job');
    expect(failed?.args.p_retryable).toBe(false);
    expect(String(failed?.args.p_error)).toContain('does_not_exist');
    // Four more attempts would not grow a handler.
    expect(report.dead).toBe(1);
    expect(report.failed).toBe(0);
  });

  it('marks a job missing its payload dead, not retryable', async () => {
    const { client, calls } = fakeClient([
      { id: 'job-2', job_type: 'sync_integration', payload: {}, attempts: 1, max_attempts: 5 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await runDueJobs(client as any);

    // A job enqueued without an integrationId will never acquire one.
    const failed = call(calls, 'fail_job');
    expect(failed?.args.p_retryable).toBe(false);
    expect(String(failed?.args.p_error)).toContain('integrationId');
    expect(report.dead).toBe(1);
  });

  it('passes the worker name and limit through to the claim', async () => {
    const { client, calls } = fakeClient([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runDueJobs(client as any, { worker: 'worker-7', limit: 3 });

    const claim = call(calls, 'claim_jobs');
    expect(claim?.args.p_worker).toBe('worker-7');
    expect(claim?.args.p_limit).toBe(3);
  });

  it('only asks for the requested types', async () => {
    const { client, calls } = fakeClient([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runDueJobs(client as any, { types: ['retry_deliveries'] });

    expect(call(calls, 'claim_jobs')?.args.p_types).toEqual(['retry_deliveries']);
  });

  it('omits the type filter when none is given, rather than sending an empty one', async () => {
    const { client, calls } = fakeClient([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runDueJobs(client as any);

    // An empty array would match no types and quietly claim nothing.
    expect(call(calls, 'claim_jobs')?.args).not.toHaveProperty('p_types');
  });

  it('surfaces a failure to claim rather than reporting an empty run', async () => {
    const client = {
      rpc: vi.fn((fn: string) =>
        fn === 'claim_jobs'
          ? Promise.resolve({ data: null, error: { message: 'connection lost' } })
          : Promise.resolve({ data: 0, error: null }),
      ),
    };

    // A worker that could not reach the queue has not established that there
    // is nothing to do, so it must not look like a clean, empty run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(runDueJobs(client as any)).rejects.toThrow(/connection lost/);
  });
});

describe('JOB_TYPES', () => {
  it('lists every type the dispatcher handles', () => {
    // The route validates `?type=` against this list, so a handler missing
    // from it cannot be asked for by name.
    expect([...JOB_TYPES]).toEqual([
      'sync_integration', 'index_workspace', 'retry_deliveries',
    ]);
  });
});
