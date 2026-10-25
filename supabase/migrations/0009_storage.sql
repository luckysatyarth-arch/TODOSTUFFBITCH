-- 0009: private storage buckets and their access policies.
--
-- Both buckets are private (public = false). Clients never hold a durable URL
-- to an object; the server mints a short-lived signed URL on demand, so
-- revoking workspace access revokes file access with it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'captures', 'captures', false,
  52428800, -- 50 MB: a long voice note, not a video library
  array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav',
        'audio/x-m4a', 'audio/aac', 'audio/flac', 'text/plain', 'text/vtt']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400) -- 25 MB
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, public = false;

-- Captures are laid out as {owner_uuid}/{capture_uuid}/{filename}, so the
-- first path segment is the authorization check. A user can only ever reach
-- their own audio, which matches the owner-only RLS on the captures table.
create policy captures_read_own on storage.objects for select to authenticated
  using (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy captures_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy captures_delete_own on storage.objects for delete to authenticated
  using (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Attachments are laid out as {workspace_uuid}/{task_uuid}/{filename} and are
-- shared, so the first segment is checked against workspace membership.
create policy attachments_read_member on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and app.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy attachments_insert_writer on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and app.can_write_workspace(((storage.foldername(name))[1])::uuid)
  );

create policy attachments_delete_writer on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and app.can_write_workspace(((storage.foldername(name))[1])::uuid)
  );
