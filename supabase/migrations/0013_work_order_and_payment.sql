-- =============================================================================
-- 0013  Work order release, field-ticket proof, Friday payment runs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Work order details, released on assignment
--
-- A contractor deciding whether to accept sees the neighbourhood and the scope.
-- The site contact, exact access arrangements and customer reference are only
-- useful once the job is theirs, and are withheld until then by the
-- application's job views (row-level security already limits the row itself).
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column site_contact_name  text,
  add column site_contact_phone text,
  add column access_notes       text,
  add column customer_reference text;

-- ---------------------------------------------------------------------------
-- Proof of completion
--
-- Completion evidence lives in the field ticket application the business
-- already runs. This system records the ticket reference so the two can be
-- reconciled, and treats photos here as supporting material rather than the
-- proof itself.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column field_ticket_ref text,
  add column field_ticket_url text;

-- ---------------------------------------------------------------------------
-- Payment scheduling
--
-- Contractors are paid on Fridays. Approving work schedules it into the next
-- Friday's run; payment itself is recorded by hand when that run is made.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column scheduled_pay_date date;

create index jobs_pay_run_idx on public.jobs (scheduled_pay_date)
  where status = 'approved';

-- The coming Friday, or today when today is a Friday. Dates are evaluated in
-- the database's timezone, which on Supabase is UTC.
create or replace function public.next_friday(p_from date)
returns date
language sql
immutable
as $$
  select p_from + ((5 - extract(isodow from p_from)::int + 7) % 7);
$$;

-- Approving now also schedules the payment.
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
     set status             = 'approved',
         approved_at        = now(),
         approved_by        = coalesce(auth.uid(), p_admin_id),
         scheduled_pay_date = public.next_friday(current_date)
   where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- Record payment for a whole Friday run in one transaction, so a run is
-- all-or-nothing rather than half-recorded if something fails midway.
create or replace function public.admin_mark_paid_batch(
  p_job_ids   uuid[],
  p_reference text,
  p_method    text default null,
  p_admin_id  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id  uuid;
  v_count   integer := 0;
  v_status  public.job_status;
begin
  perform public.require_admin();

  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return 0;
  end if;

  foreach v_job_id in array p_job_ids loop
    select status into v_status from public.jobs where id = v_job_id for update;

    if v_status is null then
      raise exception 'job % not found', v_job_id using errcode = 'no_data_found';
    end if;

    if v_status <> 'approved' then
      raise exception 'job % is %, not approved', v_job_id, v_status
        using errcode = 'check_violation';
    end if;

    update public.jobs
       set status            = 'paid',
           paid_at           = now(),
           payment_reference = p_reference,
           payment_method    = p_method,
           paid_by           = coalesce(auth.uid(), p_admin_id)
     where id = v_job_id;

    v_count := v_count + 1;
  end loop;

  perform public.write_audit('payment_run', null, 'payment_run.recorded',
    jsonb_build_object('jobs', v_count, 'reference', p_reference, 'method', p_method),
    coalesce(auth.uid(), p_admin_id));

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Completion now turns on the field ticket rather than a photo
-- ---------------------------------------------------------------------------
drop function if exists public.contractor_submit_completion(uuid, text, uuid);

create or replace function public.contractor_submit_completion(
  p_job_id           uuid,
  p_notes            text,
  p_field_ticket_ref text,
  p_contractor_id    uuid default null
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

  if v_job.status not in ('in_progress', 'needs_rework') then
    raise exception 'cannot submit completion while job is %', v_job.status
      using errcode = 'check_violation';
  end if;

  if p_notes is null or length(btrim(p_notes)) = 0 then
    raise exception 'completion notes are required' using errcode = 'check_violation';
  end if;

  -- The field ticket is the proof of work. Without a reference there is
  -- nothing for an administrator to reconcile against.
  if p_field_ticket_ref is null or length(btrim(p_field_ticket_ref)) = 0 then
    raise exception 'a field ticket number is required' using errcode = 'check_violation';
  end if;

  update public.jobs
     set status           = 'completed',
         completed_at     = now(),
         completion_notes = p_notes,
         field_ticket_ref = btrim(p_field_ticket_ref)
   where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function public.contractor_submit_completion(uuid, text, text, uuid) to authenticated;
grant execute on function public.admin_mark_paid_batch(uuid[], text, text, uuid)      to authenticated;
grant execute on function public.next_friday(date)                                    to authenticated;
