'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

let cached: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Browser client. Only ever sees the publishable key and the user's session. */
export function createSupabaseBrowserClient() {
  cached ??= createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return cached;
}
