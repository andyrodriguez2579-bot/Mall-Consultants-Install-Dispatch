-- =============================================================================
-- 0006  Authorization helpers, invariant triggers, dispatch logic
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Authorization helpers
--
-- These are SECURITY DEFINER on purpose. Row-level security on `profiles`
-- would otherwise recurse infinitely: reading a profile to decide whether you
-- may read profiles.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active
  );
$$;

create or replace function public.is_active_contractor()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.contractors c on c.id = p.id
    where p.id = auth.uid()
      and p.is_active
      and c.status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_entity_type text,
  p_entity_id   uuid,
  p_action      text,
  p_detail      jsonb default '{}'::jsonb,
  p_actor_id    uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_role  public.user_role;
  v_label text;
  v_id    bigint;
begin
  v_actor := coalesce(p_actor_id, auth.uid());

  if v_actor is not null then
    select role, full_name into v_role, v_label
    from public.profiles
    where id = v_actor;
  end if;

  insert into public.audit_log (
    actor_id, actor_role, actor_label, entity_type, entity_id, action, detail
  )
  values (
    v_actor, v_role, coalesce(v_label, 'system'), p_entity_type, p_entity_id,
    p_action, coalesce(p_detail, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Job invariants
-- ---------------------------------------------------------------------------
create or replace function public.enforce_job_invariants()
returns trigger
language plpgsql
as $$
begin
  -- The offered payment is fixed. Once a job has left the editable states it
  -- cannot be repriced, so the figure a contractor accepted is always the
  -- figure they are owed.
  if new.contractor_pay_cents is distinct from old.contractor_pay_cents
     and old.status not in ('draft', 'ready') then
    raise exception
      'contractor pay is fixed once a job is dispatched (job %, status %)',
      old.job_number, old.status
      using errcode = 'check_violation';
  end if;

  -- Job numbers are quoted in the field and in payment records.
  if new.job_number is distinct from old.job_number then
    raise exception 'job_number is immutable' using errcode = 'check_violation';
  end if;

  -- Paying a job never rewrites what it cost.
  if old.status = 'paid' and new.status <> 'paid'
     and new.paid_at is distinct from old.paid_at then
    raise exception 'a paid job cannot be un-paid; cancel and re-issue instead'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger jobs_enforce_invariants
  before update on public.jobs
  for each row execute function public.enforce_job_invariants();

-- Material job changes are logged by the database itself, so the audit trail
-- cannot be bypassed by a code path that forgets to call the logger.
create or replace function public.audit_job_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('job', new.id, 'job.created', jsonb_build_object(
      'job_number', new.job_number,
      'status',     new.status,
      'pay_cents',  new.contractor_pay_cents
    ));
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.write_audit('job', new.id, 'job.status_changed', jsonb_build_object(
      'job_number', new.job_number,
      'from',       old.status,
      'to',         new.status
    ));
  end if;

  if new.assigned_contractor_id is distinct from old.assigned_contractor_id then
    perform public.write_audit('job', new.id, 'job.assignment_changed', jsonb_build_object(
      'job_number', new.job_number,
      'from',       old.assigned_contractor_id,
      'to',         new.assigned_contractor_id
    ));
  end if;

  if new.contractor_pay_cents is distinct from old.contractor_pay_cents then
    perform public.write_audit('job', new.id, 'job.pay_changed', jsonb_build_object(
      'job_number', new.job_number,
      'from_cents', old.contractor_pay_cents,
      'to_cents',   new.contractor_pay_cents
    ));
  end if;

  if new.paid_at is distinct from old.paid_at and new.paid_at is not null then
    perform public.write_audit('job', new.id, 'job.paid', jsonb_build_object(
      'job_number', new.job_number,
      'amount_cents', new.contractor_pay_cents,
      'reference',  new.payment_reference
    ));
  end if;

  return new;
end;
$$;

create trigger jobs_audit_insert
  after insert on public.jobs
  for each row execute function public.audit_job_changes();

create trigger jobs_audit_update
  after update on public.jobs
  for each row execute function public.audit_job_changes();

-- A contractor may manage their own availability and preferences, but their
-- approval standing is an administrative decision.
create or replace function public.enforce_contractor_self_service()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;  -- service role or administrator
  end if;

  if new.status is distinct from old.status
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    raise exception 'contractors cannot change their own approval status'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger contractors_enforce_self_service
  before update on public.contractors
  for each row execute function public.enforce_contractor_self_service();

-- ---------------------------------------------------------------------------
-- Contractor matching
--
-- Returns approved, available, SMS-reachable contractors who hold every skill
-- the job requires, flagging whether the job also falls inside a declared
-- service area. Geography informs the admin's choice; skills are the hard gate.
-- ---------------------------------------------------------------------------
create or replace function public.match_contractors_for_job(p_job_id uuid)
returns table (
  contractor_id   uuid,
  full_name       text,
  phone           text,
  company_name    text,
  has_all_skills  boolean,
  in_service_area boolean,
  already_offered boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with job as (
    select id, postal_code, state_code, offer_round
    from public.jobs
    where id = p_job_id
  ),
  required as (
    select skill_id from public.job_skills where job_id = p_job_id
  )
  select
    c.id,
    p.full_name,
    p.phone,
    c.company_name,
    not exists (
      select 1
      from required r
      where not exists (
        select 1
        from public.contractor_skills cs
        where cs.contractor_id = c.id
          and cs.skill_id = r.skill_id
      )
    ) as has_all_skills,
    exists (
      select 1
      from public.contractor_service_areas csa
      join public.service_areas sa on sa.id = csa.service_area_id
      join job j on true
      where csa.contractor_id = c.id
        and sa.is_active
        and (
          sa.state_code = j.state_code
          or exists (
            select 1
            from unnest(sa.postal_prefixes) as prefix
            where j.postal_code like prefix || '%'
          )
        )
    ) as in_service_area,
    exists (
      select 1
      from public.job_offers o
      join job j on j.id = o.job_id
      where o.contractor_id = c.id
        and o.round = j.offer_round
    ) as already_offered
  from public.contractors c
  join public.profiles p on p.id = c.id
  where c.status = 'approved'
    and c.is_available
    and c.sms_opt_in
    and p.is_active
    and p.phone is not null
  order by 5 desc, 6 desc, p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Acceptance: the concurrency-critical path
--
-- Correctness argument. All competing acceptances for a job funnel through the
-- `select ... for update` on that job's row. The first transaction to arrive
-- takes the lock and flips the status to 'assigned'; every other transaction
-- blocks there. Under READ COMMITTED, a blocked statement re-reads the row once
-- the lock clears, so the losers observe the winner's committed 'assigned'
-- status and fall through to 'already_filled'. The guarded UPDATE afterwards is
-- a second, independent barrier: its WHERE clause only matches an unassigned,
-- still-offered job, so even if the lock reasoning were wrong, at most one
-- statement can report a row count of 1.
-- ---------------------------------------------------------------------------
create or replace function public.accept_job_offer(p_token_hash text)
returns table (
  result   public.accept_result,
  job_id   uuid,
  offer_id uuid,
  message  text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer      public.job_offers%rowtype;
  v_job        public.jobs%rowtype;
  v_contractor public.contractors%rowtype;
  v_profile    public.profiles%rowtype;
  v_caller     uuid;
  v_missing    integer;
  v_updated    integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'offer_invalid'::public.accept_result, null::uuid, null::uuid,
                        'This link is not valid.';
    return;
  end if;

  select * into v_offer from public.job_offers where token_hash = p_token_hash;
  if not found then
    return query select 'offer_invalid'::public.accept_result, null::uuid, null::uuid,
                        'This link is not valid.';
    return;
  end if;

  -- The link identifies the offer; the session identifies the person holding
  -- it. A signed-in user may act only on their own offer. auth.uid() is null
  -- for trusted service-role callers.
  v_caller := auth.uid();
  if v_caller is not null and v_caller <> v_offer.contractor_id then
    return query select 'not_eligible'::public.accept_result, v_offer.job_id, v_offer.id,
                        'This offer belongs to another contractor.';
    return;
  end if;

  -- Re-tapping the link after winning is not an error.
  if v_offer.status = 'accepted' then
    return query select 'accepted'::public.accept_result, v_offer.job_id, v_offer.id,
                        'You already have this job.';
    return;
  end if;

  if v_offer.status = 'passed' then
    return query select 'not_eligible'::public.accept_result, v_offer.job_id, v_offer.id,
                        'You already passed on this job.';
    return;
  end if;

  if v_offer.status in ('filled', 'expired') or v_offer.expires_at <= now() then
    if v_offer.status = 'filled' then
      return query select 'already_filled'::public.accept_result, v_offer.job_id, v_offer.id,
                          'Job already filled.';
    else
      return query select 'offer_expired'::public.accept_result, v_offer.job_id, v_offer.id,
                          'This offer has expired.';
    end if;
    return;
  end if;

  -- Serialization point. Everything below runs one-acceptance-at-a-time per job.
  select * into v_job from public.jobs where id = v_offer.job_id for update;
  if not found then
    return query select 'offer_invalid'::public.accept_result, null::uuid, v_offer.id,
                        'This link is not valid.';
    return;
  end if;

  if v_job.status <> 'offered' then
    if v_job.assigned_contractor_id is not null then
      -- Mark the losing offer so the dashboard reflects reality.
      update public.job_offers
         set status = 'filled', responded_at = coalesce(responded_at, now())
       where id = v_offer.id
         and status not in ('accepted', 'passed');
      return query select 'already_filled'::public.accept_result, v_job.id, v_offer.id,
                          'Job already filled.';
    else
      return query select 'job_not_open'::public.accept_result, v_job.id, v_offer.id,
                          'This job is no longer open for acceptance.';
    end if;
    return;
  end if;

  if v_job.offer_expires_at is not null and v_job.offer_expires_at <= now() then
    return query select 'offer_expired'::public.accept_result, v_job.id, v_offer.id,
                        'This offer has expired.';
    return;
  end if;

  -- Eligibility: active, approved, and qualified.
  select * into v_contractor from public.contractors where id = v_offer.contractor_id;
  select * into v_profile    from public.profiles    where id = v_offer.contractor_id;

  if v_contractor.status <> 'approved' or not v_profile.is_active then
    return query select 'not_eligible'::public.accept_result, v_job.id, v_offer.id,
                        'Your account is not currently eligible to accept work.';
    return;
  end if;

  select count(*) into v_missing
  from public.job_skills js
  where js.job_id = v_job.id
    and not exists (
      select 1
      from public.contractor_skills cs
      where cs.contractor_id = v_offer.contractor_id
        and cs.skill_id = js.skill_id
    );

  if v_missing > 0 then
    return query select 'not_eligible'::public.accept_result, v_job.id, v_offer.id,
                        'This job requires a certification your account does not list.';
    return;
  end if;

  -- Guarded claim. Only an unassigned, still-offered job matches.
  update public.jobs
     set status                 = 'assigned',
         assigned_contractor_id = v_offer.contractor_id,
         assigned_at            = now(),
         unfilled_at            = null
   where id = v_job.id
     and status = 'offered'
     and assigned_contractor_id is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    update public.job_offers
       set status = 'filled', responded_at = coalesce(responded_at, now())
     where id = v_offer.id
       and status not in ('accepted', 'passed');
    return query select 'already_filled'::public.accept_result, v_job.id, v_offer.id,
                        'Job already filled.';
    return;
  end if;

  -- Winner.
  update public.job_offers
     set status = 'accepted', responded_at = now()
   where id = v_offer.id;

  -- Everyone else in this round is out. The application reads these rows to
  -- send the "job has been filled" notifications.
  --
  -- The alias is required: this function's RETURNS TABLE declares an output
  -- column named job_id, which would otherwise shadow job_offers.job_id and
  -- make the predicate ambiguous.
  update public.job_offers o
     set status = 'filled'
   where o.job_id = v_job.id
     and o.id <> v_offer.id
     and o.status not in ('accepted', 'passed', 'failed');

  perform public.write_audit(
    'job', v_job.id, 'offer.accepted',
    jsonb_build_object(
      'job_number',    v_job.job_number,
      'offer_id',      v_offer.id,
      'contractor_id', v_offer.contractor_id,
      'pay_cents',     v_job.contractor_pay_cents
    ),
    v_offer.contractor_id
  );

  return query select 'accepted'::public.accept_result, v_job.id, v_offer.id,
                      'You have this job.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Passing on an offer, and asking a question about one.
-- ---------------------------------------------------------------------------
create or replace function public.pass_job_offer(p_token_hash text)
returns table (
  result   public.accept_result,
  job_id   uuid,
  offer_id uuid,
  message  text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer  public.job_offers%rowtype;
  v_caller uuid;
begin
  select * into v_offer from public.job_offers where token_hash = p_token_hash;
  if not found then
    return query select 'offer_invalid'::public.accept_result, null::uuid, null::uuid,
                        'This link is not valid.';
    return;
  end if;

  v_caller := auth.uid();
  if v_caller is not null and v_caller <> v_offer.contractor_id then
    return query select 'not_eligible'::public.accept_result, v_offer.job_id, v_offer.id,
                        'This offer belongs to another contractor.';
    return;
  end if;

  if v_offer.status = 'accepted' then
    return query select 'not_eligible'::public.accept_result, v_offer.job_id, v_offer.id,
                        'You have already accepted this job.';
    return;
  end if;

  update public.job_offers
     set status = 'passed', responded_at = now()
   where id = v_offer.id
     and status not in ('accepted', 'passed');

  perform public.write_audit(
    'job', v_offer.job_id, 'offer.passed',
    jsonb_build_object('offer_id', v_offer.id, 'contractor_id', v_offer.contractor_id),
    v_offer.contractor_id
  );

  return query select 'accepted'::public.accept_result, v_offer.job_id, v_offer.id,
                      'Thanks -- we have recorded that you passed.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Expiry sweep. Closes dispatch rounds whose window has elapsed and marks the
-- job 'unfilled' so an admin can re-offer it. Safe to call repeatedly.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_offers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offers integer;
  v_jobs   integer;
begin
  update public.job_offers
     set status = 'expired'
   where expires_at <= now()
     and status in ('pending', 'sent', 'delivered', 'viewed');
  get diagnostics v_offers = row_count;

  update public.jobs
     set status = 'unfilled', unfilled_at = now()
   where status = 'offered'
     and offer_expires_at is not null
     and offer_expires_at <= now()
     and assigned_contractor_id is null;
  get diagnostics v_jobs = row_count;

  if v_jobs > 0 then
    perform public.write_audit('system', null, 'offers.expired',
      jsonb_build_object('offers', v_offers, 'jobs_unfilled', v_jobs));
  end if;

  return v_offers;
end;
$$;
