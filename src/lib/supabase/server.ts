import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Request-scoped client that carries the signed-in user's session, so every
 * query it makes is filtered by RLS. This is the default for all user-facing
 * reads and writes.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Session refresh is handled
            // by the middleware instead, so this is safe to swallow.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely, so it is reserved for work that
 * has no user session to act under: the cron report run, inbound provider
 * webhooks, and background job workers.
 *
 * Every caller must scope its own queries by workspace, because the database
 * will not do it here. Reach for createSupabaseServerClient() unless there is
 * genuinely no user in the request.
 */
export function createSupabaseAdminClient() {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required for scheduled ' +
        'reports, webhook ingestion and background jobs. See .env.example.',
    );
  }

  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
