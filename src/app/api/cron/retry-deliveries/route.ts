import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { retryDueDeliveries } from '@/server/services/report-delivery';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Hourly retry sweep for deliveries that failed with a retryable error.
 *
 * Separate from the 9pm run so a transient provider outage at 21:00 does not
 * mean waiting a full day. Each retry reuses the delivery's idempotency key,
 * so a message that did get through is never sent twice.
 */
export async function GET(request: NextRequest) {
  const env = serverEnv();
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }

  const header = request.headers.get('authorization');
  const custom = request.headers.get('x-cron-secret');
  const candidate = header?.startsWith('Bearer ') ? header.slice(7) : custom;
  if (!candidate) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const a = Buffer.from(candidate);
  const b = Buffer.from(env.CRON_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await retryDueDeliveries(createSupabaseAdminClient());
  return NextResponse.json(result);
}
