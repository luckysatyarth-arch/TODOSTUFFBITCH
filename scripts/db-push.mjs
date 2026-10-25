#!/usr/bin/env node
/**
 * Applies the SQL files in supabase/migrations, in filename order, to the
 * database named by DATABASE_URL.
 *
 *   DATABASE_URL=postgresql://... npm run db:push
 *   npm run db:push -- --dry-run
 *
 * Applied files are recorded in app.schema_migrations, so re-running applies
 * only what is new. That matters because the migrations are not all
 * idempotent -- `alter table ... add constraint` fails on a second run -- so
 * "just run them all again" is not a safe strategy and the ledger is what
 * makes repeat runs predictable.
 *
 * Each file runs inside its own transaction: a file that fails rolls back
 * whole and is not recorded, leaving the database on the last good migration
 * rather than halfway through a broken one.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const dryRun = process.argv.includes('--dry-run');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      'Supabase shows it under Project Settings -> Database -> Connection string\n' +
      '(use the pooler URI for a one-off run). Never commit it.\n\n' +
      '  DATABASE_URL=postgresql://... npm run db:push',
  );
  process.exit(1);
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * Whether to negotiate TLS.
 *
 * A local cluster -- a unix socket, or a loopback address -- speaks plaintext
 * and rejects a TLS handshake outright, so asking for one fails to connect at
 * all. Anything remote gets TLS. Verification is relaxed there because
 * Supabase's chain is not in Node's trust store; that is a deliberate choice
 * for a one-off admin script run by the database's owner, and the alternative
 * on offer would have been plaintext over the internet, not a verified
 * connection.
 */
function sslFor(url) {
  if (/[?&]sslmode=disable\b/.test(url) || process.env.PGSSLMODE === 'disable') return false;

  let host = '';
  try {
    const parsed = new URL(url);
    host = parsed.searchParams.get('host') ?? parsed.hostname;
  } catch {
    host = '';
  }

  const local =
    host.startsWith('/') ||       // unix socket
    host === '' ||                // socket via PGHOST
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1';

  return local ? false : { rejectUnauthorized: false };
}

const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });

try {
  await client.connect();

  await client.query('create schema if not exists app');
  await client.query(`
    create table if not exists app.schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows: applied } = await client.query(
    'select filename, checksum from app.schema_migrations',
  );
  const appliedBy = new Map(applied.map((r) => [r.filename, r.checksum]));

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let pending = 0;
  let drifted = 0;

  for (const filename of files) {
    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    const checksum = sha(sql);
    const previous = appliedBy.get(filename);

    if (previous !== undefined) {
      if (previous !== checksum) {
        // An edited migration means the database and the repository disagree
        // about what was run. Say so rather than silently re-running it.
        console.warn(
          `  ~ ${filename} already applied, but its contents have changed ` +
            `since (${previous} -> ${checksum}). Not re-running it; write a ` +
            'new migration for the change.',
        );
        drifted += 1;
      } else {
        console.log(`  = ${filename}`);
      }
      continue;
    }

    pending += 1;

    if (dryRun) {
      console.log(`  + ${filename} (would apply)`);
      continue;
    }

    process.stdout.write(`  + ${filename} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into app.schema_migrations (filename, checksum) values ($1, $2)',
        [filename, checksum],
      );
      await client.query('commit');
      console.log('applied');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      console.log('FAILED');
      console.error(`\n${filename} failed and was rolled back:\n  ${error.message}\n`);
      console.error('The database is still on the previous migration.');
      process.exit(1);
    }
  }

  if (drifted > 0) {
    console.log(
      `\n${drifted} already-applied migration(s) differ from the repository. ` +
        'Resolve that before relying on this schema.',
    );
  }
  console.log(
    pending === 0
      ? '\nUp to date.'
      : dryRun
        ? `\n${pending} migration(s) would be applied.`
        : `\n${pending} migration(s) applied.`,
  );
  process.exit(drifted > 0 ? 1 : 0);
} finally {
  await client.end().catch(() => {});
}
