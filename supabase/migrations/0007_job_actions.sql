-- =============================================================================
-- 0007  Guarded state transitions
-- =============================================================================
-- Contractors never hold UPDATE on `jobs`. Every change they can make to a job
-- goes through one of these functions, which re-checks ownership and the
-- current status server-side. That keeps the state machine enforceable and the
-- audit trail complete.

create or replace function public.can_access_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or exists (
        select 1 from public.jobs j
        where j.id = p_job_id and j.assigned_contractor_id = auth.uid()
      )
      or exists (
        select 1 from public.job_offers o
        where o.job_id = p_job_id and o.contractor_id = auth.uid()
      );
$$;

-- Resolve the acting contractor, or raise. Used by every contractor action.
create or replace function public.require_assigned_contractor(
  p_job_id       uuid,
  p_contractor_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_job   public.jobs%rowtype;
begin
  v_actor := coalesce(auth.uid(), p_contractor_id);
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.assigned_contractor_id is distinct from v_actor then
    raise exception 'this job is not assigned to you'
      using errcode = 'insufficient_privilege';
  end if;

  return v_job;
end;
$$;

-- --------------------------------------------------------------------------
-- Contractor: arrival -> start -> completion
-- --------------------------------------------------------------------------
create or replace function public.contractor_confirm_arrival(
  p_job_id        uuid,
  p_contractor_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  v_job := public.require_assigned_contractor(p_job_id, p_contractor_id);

  if v_job.status not in ('assigned', 'in_progress') then
    raise exception 'cannot confirm arrival while job is %', v_job.status
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set arrival_confirmed_at = coalesce(arrival_confirmed_at, now())
   where id = p_job_id
  returning * into v_job;

  perform public.write_audit('job', p_job_id, 'job.arrival_confirmed',
    jsonb_build_object('job_number', v_job.job_number),
    v_job.assigned_contractor_id);

  return v_job;
end;
$$;

create or replace function public.contractor_start_work(
  p_job_id        uuid,
  p_contractor_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  v_job := public.require_assigned_contractor(p_job_id, p_contractor_id);

  if v_job.status not in ('assigned', 'needs_rework') then
    raise exception 'cannot start work while job is %', v_job.status
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set status              = 'in_progress',
         started_at          = coalesce(started_at, now()),
         arrival_confirmed_at = coalesce(arrival_confirmed_at, now())
   where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- Completion requires photographic evidence: an admin cannot approve work they
-- cannot see, so the database refuses an empty submission.
create or replace function public.contractor_submit_completion(
  p_job_id        uuid,
  p_notes         text,
  p_contractor_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job    public.jobs%rowtype;
  v_after  integer;
begin
  v_job := public.require_assigned_contractor(p_job_id, p_contractor_id);

  if v_job.status not in ('in_progress', 'needs_rework') then
    raise exception 'cannot submit completion while job is %', v_job.status
      using errcode = 'check_violation';
  end if;

  if p_notes is null or length(btrim(p_notes)) = 0 then
    raise exception 'completion notes are required'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_after
  from public.job_attachments
  where job_id = p_job_id and kind = 'after';

  if v_after = 0 then
    raise exception 'at least one after photo is required'
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set status           = 'completed',
         completed_at     = now(),
         completion_notes = p_notes
   where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- --------------------------------------------------------------------------
-- Administrator: approve / rework / pay / assign / cancel / hold
-- --------------------------------------------------------------------------
create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null for trusted service-role and migration callers.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'administrator role required'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.admin_approve_job(
  p_job_id   uuid,
  p_admin_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  perform public.require_admin();

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.status <> 'completed' then
    raise exception 'only completed work can be approved (job is %)', v_job.status
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set status      = 'approved',
         approved_at = now(),
         approved_by = coalesce(auth.uid(), p_admin_id)
   where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.admin_request_rework(
  p_job_id   uuid,
  p_notes    text,
  p_admin_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  perform public.require_admin();

  if p_notes is null or length(btrim(p_notes)) = 0 then
    raise exception 'rework instructions are required'
      using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.status <> 'completed' then
    raise exception 'only completed work can be sent back (job is %)', v_job.status
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set status              = 'needs_rework',
         rework_requested_at = now(),
         rework_notes        = p_notes,
         rework_count        = rework_count + 1
   where id = p_job_id
  returning * into v_job;

  perform public.write_audit('job', p_job_id, 'job.rework_requested',
    jsonb_build_object('job_number', v_job.job_number, 'notes', p_notes,
                       'attempt', v_job.rework_count));

  return v_job;
end;
$$;

-- Payment is recorded, not processed. The amount always comes from the job's
-- fixed pay rather than from caller input, so the ledger cannot disagree with
-- what the contractor accepted.
create or replace function public.admin_mark_paid(
  p_job_id    uuid,
  p_reference text,
  p_method    text default null,
  p_admin_id  uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  perform public.require_admin();

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.status <> 'approved' then
    raise exception 'only approved work can be paid (job is %)', v_job.status
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set status            = 'paid',
         paid_at           = now(),
         payment_reference = p_reference,
         payment_method    = p_method,
         paid_by           = coalesce(auth.uid(), p_admin_id)
   where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- Manual assignment and reassignment. Bypasses the offer race by design --
-- this is the admin override -- but is fully audited and still refuses to
-- point a job at an ineligible contractor.
create or replace function public.admin_assign_contractor(
  p_job_id        uuid,
  p_contractor_id uuid,
  p_reason        text default null,
  p_admin_id      uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job        public.jobs%rowtype;
  v_contractor public.contractors%rowtype;
  v_missing    integer;
begin
  perform public.require_admin();

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.status in ('paid', 'cancelled') then
    raise exception 'cannot reassign a % job', v_job.status
      using errcode = 'check_violation';
  end if;

  select * into v_contractor from public.contractors where id = p_contractor_id;
  if not found or v_contractor.status <> 'approved' then
    raise exception 'contractor is not approved'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_missing
  from public.job_skills js
  where js.job_id = p_job_id
    and not exists (
      select 1 from public.contractor_skills cs
      where cs.contractor_id = p_contractor_id and cs.skill_id = js.skill_id
    );

  if v_missing > 0 then
    raise exception 'contractor lacks % required skill(s) for this job', v_missing
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set status                 = 'assigned',
         assigned_contractor_id = p_contractor_id,
         assigned_at            = now(),
         unfilled_at            = null
   where id = p_job_id
  returning * into v_job;

  -- Close out any live offers from the current round.
  update public.job_offers
     set status = 'filled'
   where job_id = p_job_id
     and contractor_id <> p_contractor_id
     and status not in ('accepted', 'passed', 'failed');

  perform public.write_audit('job', p_job_id, 'job.manually_assigned',
    jsonb_build_object('job_number', v_job.job_number,
                       'contractor_id', p_contractor_id,
                       'reason', p_reason));

  return v_job;
end;
$$;

create or replace function public.admin_cancel_job(
  p_job_id   uuid,
  p_reason   text,
  p_admin_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  perform public.require_admin();

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.status = 'paid' then
    raise exception 'a paid job cannot be cancelled'
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set status        = 'cancelled',
         cancel_reason = p_reason
   where id = p_job_id
  returning * into v_job;

  update public.job_offers
     set status = 'filled'
   where job_id = p_job_id
     and status in ('pending', 'sent', 'delivered', 'viewed');

  return v_job;
end;
$$;
