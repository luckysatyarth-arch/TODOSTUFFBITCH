import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limit backed by a table.
 *
 * Serverless instances share no memory, so an in-process counter would not
 * actually limit anything. The window start is floored to the period so a
 * bucket is a single row that can be incremented atomically.
 *
 * Fails open when the service role is unavailable: a deployment without it
 * should not have every AI request refused, and the AI surface is already
 * behind authentication.
 */
export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true, limit, remaining: limit, retryAfterSeconds: 0 };
  }

  const client = createSupabaseAdminClient();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs).toISOString();

  const { data: existing } = await client
    .from('rate_limit_counters')
    .select('count')
    .eq('bucket', bucket)
    .eq('window_start', windowStart)
    .maybeSingle();

  const used = existing?.count ?? 0;
  const retryAfter = Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000);

  if (used >= limit) {
    return { ok: false, limit, remaining: 0, retryAfterSeconds: retryAfter };
  }

  await client
    .from('rate_limit_counters')
    .upsert(
      { bucket, window_start: windowStart, count: used + 1 },
      { onConflict: 'bucket,window_start' },
    );

  return {
    ok: true,
    limit,
    remaining: Math.max(0, limit - used - 1),
    retryAfterSeconds: retryAfter,
  };
}

/** Housekeeping: drops counters from windows that can no longer be hit. */
export async function pruneRateLimits(olderThanHours = 48): Promise<void> {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000).toISOString();
  await createSupabaseAdminClient()
    .from('rate_limit_counters').delete().lt('window_start', cutoff);
}
