-- 0005: connector registry, sync bookkeeping and the retrieval index.

create table if not exists public.integrations (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Null for a workspace-level connector (e.g. the shared WhatsApp sender);
  -- set for a per-user connector (e.g. this user's own Gmail).
  owner_id uuid references public.profiles (id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'disconnected',
  scope_level text not null default 'user' check (scope_level in ('user', 'workspace')),
  external_account_id text,
  display_name text,
  -- What this connection can actually do, as reported by the adapter. The UI
  -- renders from this rather than assuming a provider's feature set, so a
  -- capability the provider lacks is never shown as working.
  capabilities jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_error text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_scope_owner check (
    (scope_level = 'user' and owner_id is not null)
    or (scope_level = 'workspace' and owner_id is null)
  )
);
-- One connection per provider per user, and one per provider per workspace.
create unique index if not exists integrations_user_unique
  on public.integrations (workspace_id, provider, owner_id) where owner_id is not null;
create unique index if not exists integrations_workspace_unique
  on public.integrations (workspace_id, provider) where owner_id is null;

-- Credentials live in their own table with no RLS policy at all, so the
-- `authenticated` role cannot read them even with a forged request: PostgREST
-- sees a table with RLS on and zero policies, which denies everything. Only
-- the service role, used exclusively server-side, touches this.
create table if not exists public.integration_credentials (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  -- AES-256-GCM ciphertext, keyed by CREDENTIALS_ENCRYPTION_KEY. The plaintext
  -- token never reaches the database.
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  integration_id uuid not null references public.integrations (id) on delete cascade,
  status public.sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Provider cursor/delta token, so the next run is incremental.
  cursor text,
  documents_indexed integer not null default 0,
  documents_skipped integer not null default 0,
  error text,
  stats jsonb not null default '{}'::jsonb
);
create index if not exists integration_sync_runs_integration_idx
  on public.integration_sync_runs (integration_id, started_at desc);

-- One row per retrievable thing, internal or external, normalised to a common
-- shape so search ranks them together.
create table if not exists public.indexed_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete cascade,
  source_type public.document_source not null,
  -- The id in the originating system: a task uuid, a Drive file id, a Notion
  -- page id. Paired with source_type for dedup.
  source_record_id text not null,
  title text not null default '',
  excerpt text,
  url text,
  content text not null default '',
  author text,
  source_timestamp timestamptz,
  -- `owner_only` is the load-bearing privacy flag: such a document is visible
  -- only to owner_id and can never surface in a team-scoped answer, even to
  -- another member of the same workspace.
  access_scope public.access_scope not null default 'workspace',
  owner_id uuid references public.profiles (id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  -- Lets a re-sync skip unchanged documents instead of re-embedding them.
  content_hash text,
  indexed_at timestamptz not null default now(),
  -- Generated, so it can never drift from title/content.
  fts tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored,
  constraint indexed_documents_owner_required
    check (access_scope = 'workspace' or owner_id is not null)
);
create unique index if not exists indexed_documents_source_unique
  on public.indexed_documents (workspace_id, source_type, source_record_id);
create index if not exists indexed_documents_fts_idx on public.indexed_documents using gin (fts);
create index if not exists indexed_documents_workspace_idx
  on public.indexed_documents (workspace_id, source_type);
create index if not exists indexed_documents_owner_idx on public.indexed_documents (owner_id);
create index if not exists indexed_documents_title_trgm_idx
  on public.indexed_documents using gin (title extensions.gin_trgm_ops);

create table if not exists public.document_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  document_id uuid not null references public.indexed_documents (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  token_count integer,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index if not exists document_chunks_document_idx on public.document_chunks (document_id);

-- Separate from chunks so re-embedding with a different model does not rewrite
-- the chunk text, and so a chunk can exist before its embedding is computed.
create table if not exists public.document_embeddings (
  id uuid primary key default extensions.gen_random_uuid(),
  chunk_id uuid not null unique references public.document_chunks (id) on delete cascade,
  -- 1536 dims matches text-embedding-3-small; change in step with EMBEDDING_MODEL.
  embedding extensions.vector(1536) not null,
  model text not null,
  created_at timestamptz not null default now()
);
-- HNSW gives better recall/latency than ivfflat and needs no training pass,
-- which matters because the index is built before any rows exist.
create index if not exists document_embeddings_hnsw_idx
  on public.document_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create or replace trigger integrations_touch before update on public.integrations
  for each row execute function app.touch_updated_at();
create or replace trigger integration_credentials_touch before update on public.integration_credentials
  for each row execute function app.touch_updated_at();
