-- =============================================================================
-- 0009  Private storage buckets and their access policies
-- =============================================================================
-- All three buckets are private. Nothing is ever served from a public URL; the
-- application mints short-lived signed URLs for the specific objects a viewer
-- is entitled to see.
--
-- Path conventions (the first folder segment is the authorization key):
--   job-photos/<job_id>/<uuid>.<ext>
--   job-briefs/<job_id>/<uuid>.<ext>
--   contractor-docs/<contractor_id>/<uuid>.<ext>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-photos', 'job-photos', false, 15728640,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('job-briefs', 'job-briefs', false, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('contractor-docs', 'contractor-docs', false, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- job-photos: before/after evidence
-- ---------------------------------------------------------------------------
create policy job_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and public.can_access_job(((storage.foldername(name))[1])::uuid)
  );

create policy job_photos_contractor_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.jobs j
        where j.id = ((storage.foldername(name))[1])::uuid
          and j.assigned_contractor_id = auth.uid()
          and j.status in ('assigned', 'in_progress', 'needs_rework')
      )
    )
  );

create policy job_photos_admin_manage on storage.objects
  for all to authenticated
  using (bucket_id = 'job-photos' and public.is_admin())
  with check (bucket_id = 'job-photos' and public.is_admin());

-- ---------------------------------------------------------------------------
-- job-briefs: admin-supplied reference material, readable by whoever can see
-- the job it belongs to.
-- ---------------------------------------------------------------------------
create policy job_briefs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-briefs'
    and public.can_access_job(((storage.foldername(name))[1])::uuid)
  );

create policy job_briefs_admin_manage on storage.objects
  for all to authenticated
  using (bucket_id = 'job-briefs' and public.is_admin())
  with check (bucket_id = 'job-briefs' and public.is_admin());

-- ---------------------------------------------------------------------------
-- contractor-docs: compliance paperwork, private to its owner and admins.
-- ---------------------------------------------------------------------------
create policy contractor_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contractor-docs'
    and (
      public.is_admin()
      or ((storage.foldername(name))[1])::uuid = auth.uid()
    )
  );

create policy contractor_docs_self_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contractor-docs'
    and (
      public.is_admin()
      or ((storage.foldername(name))[1])::uuid = auth.uid()
    )
  );

create policy contractor_docs_admin_manage on storage.objects
  for all to authenticated
  using (bucket_id = 'contractor-docs' and public.is_admin())
  with check (bucket_id = 'contractor-docs' and public.is_admin());
