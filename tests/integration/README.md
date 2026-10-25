# Integration tests

These exercise the real database: row level security, the approval RPC's
idempotency, the uniqueness guarantees behind the daily reports, and the
integrity triggers.

They need a Supabase project and **the service role key**, because they create
and clean up test users. They skip themselves with a clear message when
`SUPABASE_SERVICE_ROLE_KEY` is absent, so `npm test` stays green on a machine
that has no credentials.

```bash
# .env.local must contain NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
node --env-file=.env.local ./node_modules/.bin/vitest run tests/integration
```

Each run creates users under `@integration.test`, does its work, and deletes
them. Nothing is left behind, and no existing row is modified.
