// Deterministic configuration for unit tests. Nothing here reaches a network
// or a real database; integration tests supply their own credentials and skip
// themselves when those are absent.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'sb_publishable_testtesttesttest';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.REPORT_TIMEZONE ??= 'Asia/Kolkata';
