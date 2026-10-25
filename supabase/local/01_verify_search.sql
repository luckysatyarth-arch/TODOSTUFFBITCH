-- Proves that internal search returns indexed records AND that the
-- authorization boundary holds inside the query.
--
-- Run against a cluster prepared by 00_bootstrap.sql plus the migrations.
-- Every assertion runs as the `authenticated` role with JWT claims set, not as
-- the table owner: a superuser or table owner bypasses RLS, so a test that did
-- not switch role would pass no matter how wrong the policies were.

\set ON_ERROR_STOP on
\timing off

begin;

-- Fixtures -------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com', '{"full_name":"Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com',   '{"full_name":"Bob"}');

-- The signup trigger gives each of them a personal workspace. Its id is
-- generated, so capture it into a psql variable rather than a temp table,
-- which the `authenticated` role could not read.
select id as alice_personal from public.workspaces
  where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'personal'
\gset

insert into public.workspaces (id, name, kind, owner_id)
values ('33333333-3333-4333-8333-333333333333', 'Acme', 'team',
        '11111111-1111-4111-8111-111111111111');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'member');

-- Indexed documents ----------------------------------------------------------
-- Shaped exactly as indexWorkspaceRecords() and the connector sync produce
-- them, including the owner-scoped mail row that must never reach Bob.

insert into public.indexed_documents
  (workspace_id, source_type, source_record_id, title, excerpt, url, content,
   author, source_timestamp, access_scope, owner_id, metadata, content_hash)
values
  ('33333333-3333-4333-8333-333333333333', 'internal_task', 'task-team-1',
   'Migrate the billing ledger', 'Behind a flag first.', '/tasks/task-team-1',
   E'Migrate the billing ledger\nBehind a flag first.\nstatus: in_progress\npriority: high',
   null, now(), 'workspace', null, '{}'::jsonb, 'hash-team-1'),

  ('33333333-3333-4333-8333-333333333333', 'internal_note', 'note-team-1',
   'Ledger migration notes', 'Rollout plan.', '/notes',
   E'Ledger migration notes\nRollout plan for the billing ledger.',
   null, now(), 'workspace', null, '{}'::jsonb, 'hash-team-note'),

  -- Alice's mail, synced into the TEAM workspace but owner-scoped. This is the
  -- row that proves a connector cannot leak one person's mail to colleagues.
  ('33333333-3333-4333-8333-333333333333', 'email', 'msg-alice-1',
   'Billing ledger invoice from the bank', 'Private correspondence.',
   'https://mail.example.com/msg-alice-1',
   E'Billing ledger invoice from the bank\nPrivate correspondence about billing.',
   'bank@example.com', now(), 'owner_only',
   '11111111-1111-4111-8111-111111111111', '{}'::jsonb, 'hash-alice-mail'),

  -- A task in Alice's PERSONAL workspace. Team membership must not reach it.
  (:'alice_personal', 'internal_task', 'task-alice-personal',
   'Personal billing paperwork', 'Mine only.', '/tasks/task-alice-personal',
   E'Personal billing paperwork\nMine only.\nstatus: todo\npriority: low',
   null, now(), 'workspace', null, '{}'::jsonb, 'hash-alice-personal');

grant select on public.indexed_documents to authenticated;
grant execute on function public.search_documents_fts(uuid, text, integer, public.document_source[])
  to authenticated;

-- Assertions -----------------------------------------------------------------

create or replace function pg_temp.check(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok   % (%)', label, actual;
end;
$$;

-- 1. Bob searches the team workspace. The index must actually return rows:
--    this is the half of the feature that was never executed before.
set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';

select pg_temp.check(
  'bob sees both team documents',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger')),
  2::bigint);

select pg_temp.check(
  'bob gets a non-zero relevance rank',
  (select bool_and(rank > 0) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger')),
  true);

-- 2. The owner-scoped document is the one that must not appear.
select pg_temp.check(
  'alice''s mail is absent from bob''s results',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger')
   where source_type = 'email'),
  0::bigint);

select pg_temp.check(
  'bob sees no owner_only row at all',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing')
   where access_scope = 'owner_only'),
  0::bigint);

-- 3. Membership of a team must not reach a member's personal workspace.
select pg_temp.check(
  'bob gets nothing from alice''s personal workspace',
  (select count(*) from public.search_documents_fts(
     :'alice_personal', 'billing')),
  0::bigint);

-- 4. Source filtering still works, and still cannot widen access.
select pg_temp.check(
  'bob can filter to tasks',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger', 20,
     array['internal_task']::public.document_source[])),
  1::bigint);

select pg_temp.check(
  'filtering TO email still returns nothing for bob',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing', 20,
     array['email']::public.document_source[])),
  0::bigint);

-- 5. Alice sees her own owner-scoped mail: the flag restricts, it does not
--    destroy. A test that only proved absence could be passed by a broken
--    index that returned nothing to anyone.
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select pg_temp.check(
  'alice sees her own mail plus both team documents',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger')),
  3::bigint);

select pg_temp.check(
  'alice''s own mail is present',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger')
   where source_record_id = 'msg-alice-1'),
  1::bigint);

select pg_temp.check(
  'alice sees her personal workspace task',
  (select count(*) from public.search_documents_fts(
     :'alice_personal', 'billing')),
  1::bigint);

-- 6. A stranger to the workspace gets nothing, even with a valid id.
set local "request.jwt.claim.sub" = '44444444-4444-4444-8444-444444444444';

select pg_temp.check(
  'a non-member sees nothing in the team workspace',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger')),
  0::bigint);

-- 7. An anonymous session sees nothing.
set local "request.jwt.claim.sub" = '';

select pg_temp.check(
  'an anonymous session sees nothing',
  (select count(*) from public.search_documents_fts(
     '33333333-3333-4333-8333-333333333333', 'billing ledger')),
  0::bigint);

reset role;

-- 8. The privacy flag cannot be set without an owner to scope it to.
do $$
begin
  insert into public.indexed_documents
    (workspace_id, source_type, source_record_id, title, excerpt, url, content,
     author, source_timestamp, access_scope, owner_id, metadata, content_hash)
  values
    ('33333333-3333-4333-8333-333333333333', 'email', 'msg-orphan',
     'Orphan', null, null, 'Orphan body', null, now(),
     'owner_only', null, '{}'::jsonb, 'hash-orphan');
  raise exception 'FAIL an owner_only document with no owner was accepted';
exception
  when check_violation then
    raise notice 'ok   owner_only without an owner is rejected by the table CHECK';
end;
$$;

rollback;
