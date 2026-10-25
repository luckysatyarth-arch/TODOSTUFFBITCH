-- 0001: extensions, enum types and the private helper schema.
-- Extensions live in the dedicated `extensions` schema so that `public` holds
-- application objects only.

create schema if not exists extensions;
create schema if not exists app;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

-- `app` holds SECURITY DEFINER helpers used by RLS policies. It is never
-- exposed through the API: only the policies and server code call into it.
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

do $$ begin
  create type public.workspace_kind as enum ('personal', 'team');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum (
    'inbox', 'todo', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.priority_level as enum ('urgent', 'high', 'medium', 'low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_status as enum (
    'planning', 'active', 'on_hold', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.milestone_status as enum ('pending', 'at_risk', 'completed', 'missed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.capture_kind as enum (
    'voice', 'text', 'whatsapp', 'meeting_transcript', 'email'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.capture_status as enum (
    'pending', 'transcribing', 'extracting', 'ready', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.proposal_status as enum ('pending', 'approved', 'rejected', 'deferred');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_provider as enum (
    'google_drive', 'gmail', 'microsoft_graph_email', 'microsoft_teams', 'notion', 'whatsapp'
  );
exception when duplicate_object then null; end $$;

-- `requires_setup` means credentials are absent; `unsupported` means the
-- provider cannot do what the UI would otherwise imply (see docs/INTEGRATIONS.md).
do $$ begin
  create type public.integration_status as enum (
    'disconnected', 'requires_setup', 'connected', 'error', 'unsupported'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sync_status as enum ('running', 'succeeded', 'partial', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_source as enum (
    'internal_task', 'internal_project', 'internal_comment', 'internal_note',
    'google_drive', 'email', 'teams', 'notion', 'whatsapp'
  );
exception when duplicate_object then null; end $$;

-- `owner_only` documents never surface in a team-scoped answer.
do $$ begin
  create type public.access_scope as enum ('workspace', 'owner_only');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_scope as enum ('personal', 'team');
exception when duplicate_object then null; end $$;

-- `skipped_no_data` records a deliberate non-send: the spec forbids delivering
-- empty or misleading reports.
do $$ begin
  create type public.report_status as enum (
    'pending', 'generated', 'delivering', 'delivered', 'failed', 'skipped_no_data'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.delivery_status as enum (
    'pending', 'sent', 'delivered', 'read', 'failed', 'unsupported'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead');
exception when duplicate_object then null; end $$;
