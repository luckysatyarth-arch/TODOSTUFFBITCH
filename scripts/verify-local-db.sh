#!/usr/bin/env bash
#
# Applies the migrations to a throwaway local PostgreSQL cluster and runs the
# SQL authorization checks against it.
#
# Why this exists: the authorization rules live in RLS policies, and a policy
# can only be proven by executing it. The integration tests in tests/ need a
# hosted Supabase project and a service-role key; this needs neither, so the
# schema and its policies can be checked on any machine and in CI.
#
# It is destructive only to its own cluster directory, and it starts the server
# on a non-default port with no TCP listener.

set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGDATA_DIR="${PGDATA_DIR:-/var/lib/postgresql/16/verify}"
SOCKET_DIR="${SOCKET_DIR:-/var/run/postgresql}"
PORT="${PORT:-5433}"
DB=verify

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL 16 server binaries not found at $PG_BIN." >&2
  echo "Install them, e.g. apt-get install postgresql-16 postgresql-16-pgvector" >&2
  exit 1
fi

# pgvector is not optional: the embeddings table and its HNSW index are part of
# the schema under test.
if [[ ! -f /usr/share/postgresql/16/extension/vector.control ]]; then
  echo "pgvector is not installed. apt-get install postgresql-16-pgvector" >&2
  exit 1
fi

as_postgres() {
  if [[ "$(id -un)" == "postgres" ]]; then bash -c "$1"; else su postgres -c "$1"; fi
}

stop_server() {
  as_postgres "$PG_BIN/pg_ctl -D $PGDATA_DIR stop -m immediate" >/dev/null 2>&1 || true
}

# KEEP=1 leaves the cluster running so the schema can be inspected afterwards:
#   KEEP=1 npm run db:verify
#   psql -h /var/run/postgresql -p 5433 -U postgres -d verify
cleanup() {
  if [[ "${KEEP:-}" == "1" ]]; then
    echo "==> Cluster left running on port $PORT (KEEP=1); stop it with:"
    echo "    $PG_BIN/pg_ctl -D $PGDATA_DIR stop"
  else
    stop_server
  fi
}
trap cleanup EXIT

echo "==> Creating a throwaway cluster at $PGDATA_DIR"
stop_server
rm -rf "$PGDATA_DIR"
mkdir -p "$PGDATA_DIR" "$SOCKET_DIR"
chown postgres:postgres "$PGDATA_DIR" "$SOCKET_DIR" 2>/dev/null || true
as_postgres "$PG_BIN/initdb -D $PGDATA_DIR -U postgres --auth=trust" >/dev/null

echo "==> Starting it on port $PORT (unix socket only)"
as_postgres "$PG_BIN/pg_ctl -D $PGDATA_DIR -o '-k $SOCKET_DIR -p $PORT -c listen_addresses=' -l $PGDATA_DIR/server.log -w start" >/dev/null

export PGHOST="$SOCKET_DIR" PGPORT="$PORT" PGUSER=postgres
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB;"

echo "==> Recreating the Supabase-managed objects"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$here/supabase/local/00_bootstrap.sql"

echo "==> Applying migrations"
for file in "$here"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$file")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "set client_min_messages = warning;" -f "$file" >/dev/null
done

echo "==> Schema"
psql -t -d "$DB" <<'SQL'
select format('    %s tables, all with RLS: %s',
  count(*), bool_and(rowsecurity)) from pg_tables where schemaname = 'public'
union all
select format('    %s policies, %s deny-all tables, %s helper functions',
  (select count(*) from pg_policies where schemaname = 'public'),
  (select count(*) from pg_tables t where schemaname = 'public' and rowsecurity
     and not exists (select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = t.tablename)),
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'));
SQL

echo "==> Authorization checks"
# Assertions raise NOTICE on success and an exception on failure, so a failed
# check exits non-zero via ON_ERROR_STOP.
for file in "$here"/supabase/local/[0-9][1-9]_*.sql; do
  # The assertion helper raises NOTICE on a pass and an exception on a failure,
  # so a failed check must still fail this script: keep psql's exit status
  # rather than the exit status of the pipeline that formats its output.
  set -o pipefail
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$file" 2>&1 \
    | sed -n -e 's/^.*NOTICE:  /    /p' -e 's/^.*ERROR:  /    FAILED: /p'
done

echo "==> All checks passed"
