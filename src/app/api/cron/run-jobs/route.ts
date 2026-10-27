import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { JOB_TYPES, runDueJobs, type JobType } from '@/server/services/jobs';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The job worker.
 *
 * Claims due jobs from `job_runs` and runs them. Claiming is atomic in SQL
 * (`for update skip locked`), so two overlapping invocations cannot take the
 * same job -- which for a transcription would mean paying twice and for a
 * delivery would mean sending twice.
 *
 * Returns 200 even when individual jobs failed: the request did its work, and
 * a failed job is recorded on its own row with its attempt count and backoff.
 * Failing the response would make the scheduler retry the whole batch and
 * double-count attempts on the jobs that succeeded. The counts in the body say
 * what happened, and `dead` is the number that have given up and need a human.
 *
 * Authenticated by the same shared secret as the other scheduled routes:
 * Vercel Cron's Authorization header, or the `x-cron-secret` header that
 * OPERATIONS.md documents for a manual drain. Compared in constant time.
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
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured; the queue is service-role only.' },
      { status: 503 },
    );
  }

  const params = request.nextUrl.searchParams;

  const limitParam = Number(params.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, 50)
    : 10;

  // An unknown type is rejected rather than ignored: silently claiming
  // everything when a caller asked for one type would be the wrong surprise.
  const requested = params.getAll('type').filter(Boolean);
  const unknown = requested.filter((t) => !JOB_TYPES.includes(t as JobType));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown job type(s): ${unknown.join(', ')}`, known: JOB_TYPES },
      { status: 400 },
    );
  }

  try {
    const report = await runDueJobs(createSupabaseAdminClient(), {
      limit,
      types: requested.length > 0 ? (requested as JobType[]) : undefined,
    });
    return NextResponse.json(report);
  } catch (error) {
    // Claiming itself failed, so nothing was taken and nothing is half-done.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The worker could not run.' },
      { status: 500 },
    );
  }
}

function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get('authorization');
  const custom = request.headers.get('x-cron-secret');
  const candidate = header?.startsWith('Bearer ') ? header.slice(7) : custom;
  if (!candidate) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first; the length of a secret is not what an attacker is probing for.
  return a.length === b.length && timingSafeEqual(a, b);
}
