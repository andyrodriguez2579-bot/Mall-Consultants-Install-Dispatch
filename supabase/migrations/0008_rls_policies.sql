-- =============================================================================
-- 0008  Row-level security
-- =============================================================================
-- Default posture: every table is locked, and access is granted back only where
-- a policy says so. Supabase's `service_role` carries BYPASSRLS, so trusted
-- server-side code is unaffected; everything reached with a user's JWT (the
-- `authenticated` role) is filtered by the policies below.

alter table public.profiles                 enable row level security;
alter table public.contractors              enable row level security;
alter table public.contractor_notes         enable row level security;
alter table public.skills                   enable row level security;
alter table public.contractor_skills        enable row level security;
alter table public.service_areas            enable row level security;
alter table public.contractor_service_areas enable row level security;
alter table public.contractor_documents     enable row level security;
alter table public.jobs                     enable row level security;
alter table public.job_skills               enable row level security;
alter table public.job_offers               enable row level security;
alter table public.job_attachments          enable row level security;
alter table public.audit_log                enable row level security;
alter table public.sms_messages             enable row level security;
alter table public.login_tokens             enable row level security;

-- Force RLS even for the tables' owner, so a mistake in a SECURITY DEFINER
-- function cannot quietly hand out unfiltered reads.
alter table public.login_tokens force row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Role and activation are administrative facts; a user editing their own
-- profile row must not be able to promote themselves.
create or replace function public.enforce_profile_self_service()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active then
    raise exception 'role and activation are managed by an administrator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger profiles_enforce_self_service
  before update on public.profiles
  for each row execute function public.enforce_profile_self_service();

-- ---------------------------------------------------------------------------
-- contractors  (status changes are blocked by trigger, see 0006)
-- ---------------------------------------------------------------------------
create policy contractors_select_self_or_admin on public.contractors
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy contractors_update_self on public.contractors
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy contractors_admin_write on public.contractors
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Internal notes are invisible to the contractor they describe.
create policy contractor_notes_admin_only on public.contractor_notes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Reference data: readable by any signed-in user, writable by admins.
-- ---------------------------------------------------------------------------
create policy skills_read on public.skills
  for select to authenticated using (true);

create policy skills_admin_write on public.skills
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy service_areas_read on public.service_areas
  for select to authenticated using (true);

create policy service_areas_admin_write on public.service_areas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Contractors maintain their own skill and coverage claims (see README for the
-- verification tradeoff this implies); admins can edit anyone's.
create policy contractor_skills_select on public.contractor_skills
  for select to authenticated
  using (contractor_id = auth.uid() or public.is_admin());

create policy contractor_skills_self_write on public.contractor_skills
  for all to authenticated
  using (contractor_id = auth.uid() or public.is_admin())
  with check (contractor_id = auth.uid() or public.is_admin());

create policy contractor_areas_select on public.contractor_service_areas
  for select to authenticated
  using (contractor_id = auth.uid() or public.is_admin());

create policy contractor_areas_self_write on public.contractor_service_areas
  for all to authenticated
  using (contractor_id = auth.uid() or public.is_admin())
  with check (contractor_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- contractor_documents
-- ---------------------------------------------------------------------------
create policy contractor_documents_select on public.contractor_documents
  for select to authenticated
  using (contractor_id = auth.uid() or public.is_admin());

create policy contractor_documents_self_insert on public.contractor_documents
  for insert to authenticated
  with check (contractor_id = auth.uid() or public.is_admin());

create policy contractor_documents_admin_write on public.contractor_documents
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- jobs
--
-- A contractor sees a job only when it is theirs or has been offered to them.
-- There is no policy granting contractors UPDATE: every change they make goes
-- through the guarded functions in 0007.
-- ---------------------------------------------------------------------------
create policy jobs_select_offered_or_assigned on public.jobs
  for select to authenticated
  using (
    public.is_admin()
    or assigned_contractor_id = auth.uid()
    or exists (
      select 1 from public.job_offers o
      where o.job_id = jobs.id and o.contractor_id = auth.uid()
    )
  );

create policy jobs_admin_write on public.jobs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy job_skills_select on public.job_skills
  for select to authenticated
  using (public.can_access_job(job_id));

create policy job_skills_admin_write on public.job_skills
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- job_offers
--
-- Contractors read only their own offers -- never the roster of who else was
-- asked. Responses go through accept_job_offer / pass_job_offer.
-- ---------------------------------------------------------------------------
create policy job_offers_select_own on public.job_offers
  for select to authenticated
  using (contractor_id = auth.uid() or public.is_admin());

create policy job_offers_admin_write on public.job_offers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- job_attachments
-- ---------------------------------------------------------------------------
create policy job_attachments_select on public.job_attachments
  for select to authenticated
  using (public.can_access_job(job_id));

-- The assigned contractor uploads evidence; only while the job is actually
-- theirs and still open for work.
create policy job_attachments_contractor_insert on public.job_attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.assigned_contractor_id = auth.uid()
        and j.status in ('assigned', 'in_progress', 'needs_rework')
    )
  );

create policy job_attachments_admin_write on public.job_attachments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- audit_log -- readable by admins, writable by nobody through the API.
-- Inserts happen only inside SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- sms_messages -- operational data, admins only.
-- ---------------------------------------------------------------------------
create policy sms_messages_admin_read on public.sms_messages
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- login_tokens -- no policy at all. Only the service role can touch these.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Function execution grants
-- ---------------------------------------------------------------------------
revoke execute on function public.write_audit(text, uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.expire_stale_offers() from public, anon, authenticated;
revoke execute on function public.require_assigned_contractor(uuid, uuid) from public, anon, authenticated;

grant execute on function public.accept_job_offer(text)              to authenticated;
grant execute on function public.pass_job_offer(text)                to authenticated;
grant execute on function public.contractor_confirm_arrival(uuid, uuid)   to authenticated;
grant execute on function public.contractor_start_work(uuid, uuid)        to authenticated;
grant execute on function public.contractor_submit_completion(uuid, text, uuid) to authenticated;
grant execute on function public.admin_approve_job(uuid, uuid)            to authenticated;
grant execute on function public.admin_request_rework(uuid, text, uuid)   to authenticated;
grant execute on function public.admin_mark_paid(uuid, text, text, uuid)  to authenticated;
grant execute on function public.admin_assign_contractor(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.admin_cancel_job(uuid, text, uuid)       to authenticated;
grant execute on function public.match_contractors_for_job(uuid)          to authenticated;
grant execute on function public.is_admin()                               to authenticated;
grant execute on function public.can_access_job(uuid)                     to authenticated;
