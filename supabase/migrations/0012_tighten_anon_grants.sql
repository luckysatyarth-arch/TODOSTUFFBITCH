-- Removes the PUBLIC EXECUTE grant from the three RPCs, so `anon` cannot
-- reach them.
--
-- Found by Supabase's database linter against the deployed schema, which flags
-- `approve_proposed_task` as a SECURITY DEFINER function reachable by `anon`
-- through /rest/v1/rpc/.
--
-- The grant to remove is the one PostgreSQL makes to PUBLIC when a function is
-- created -- the `=X/postgres` entry in the ACL. `anon` holds no grant of its
-- own, so `revoke ... from anon` is a no-op and leaves the function reachable;
-- it has to be revoked from PUBLIC. `authenticated` is unaffected because 0008
-- granted it EXECUTE explicitly, which survives revoking PUBLIC.
--
-- None of the three was actually exploitable by an anonymous caller:
-- `approve_proposed_task` raises insufficient_privilege when auth.uid() is
-- null, and the two search functions are SECURITY INVOKER, so RLS filters them
-- and the policies they rely on are `to authenticated`. But each was relying
-- on a second mechanism to hold rather than simply being unreachable, and an
-- anonymous caller has no reason to reach any of them.
--
-- `authenticated` deliberately keeps all three: the approval flow calls
-- approve_proposed_task over RPC, and it makes its own ownership and role
-- checks internally precisely because it is client-callable. The linter
-- reports that too, and it is the intended design rather than a finding to
-- clear.

revoke execute on function public.approve_proposed_task(
  uuid, text, text, uuid, uuid, date, public.priority_level, public.task_status
) from public;

revoke execute on function public.search_documents_fts(
  uuid, text, integer, public.document_source[]
) from public;

revoke execute on function public.match_document_chunks(
  uuid, extensions.vector, integer, double precision, public.document_source[]
) from public;

-- Belt and braces: make the grant these three rely on explicit rather than
-- inherited, so a future `revoke ... from public` cannot take it away.
grant execute on function public.approve_proposed_task(
  uuid, text, text, uuid, uuid, date, public.priority_level, public.task_status
) to authenticated, service_role;

grant execute on function public.search_documents_fts(
  uuid, text, integer, public.document_source[]
) to authenticated, service_role;

grant execute on function public.match_document_chunks(
  uuid, extensions.vector, integer, double precision, public.document_source[]
) to authenticated, service_role;
