-- Supabase-managed objects, recreated locally so the real migrations can be
-- applied to a plain PostgreSQL 16 cluster.
--
-- This is NOT part of the deployed schema: on Supabase these objects already
-- exist and are owned by the platform. It exists so the authorization rules in
-- the migrations can be executed and tested without a hosted project, which is
-- the only way to prove that an RLS policy does what it claims.
--
-- Everything here mirrors Supabase's own definitions closely enough for the
-- policies to behave identically: `auth.uid()` reads the request's JWT claims
-- from a GUC, and the three roles are the ones the policies name.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- The subset of auth.users the migrations reference: the profiles foreign key
-- and the signup trigger, which reads email and the display name metadata.
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

/*
 * Supabase derives the current user from the verified JWT the API gateway
 * attaches to the session. Locally the test harness sets the same GUC
 * directly, so every policy sees exactly the value it would see in
 * production, and a session that sets no claims is anonymous rather than
 * accidentally privileged.
 */
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id) on delete cascade,
  name text not null,
  owner uuid,
  created_at timestamptz not null default now(),
  metadata jsonb
);

alter table storage.objects enable row level security;

-- Splits an object key into path segments, as the storage policies expect.
create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select string_to_array(name, '/');
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
