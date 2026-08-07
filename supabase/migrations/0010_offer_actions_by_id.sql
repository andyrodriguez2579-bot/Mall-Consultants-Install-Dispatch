-- =============================================================================
-- 0010  In-app offer actions
-- =============================================================================
-- A contractor can reach an offer two ways: by tapping the SMS link (the token
-- is the credential) or from their signed-in job list (the session is the
-- credential). Both must land on exactly the same acceptance logic, or the
-- concurrency guarantee would hold on one path and not the other.
--
-- So the logic moves into accept_offer_core(), and the two entry points differ
-- only in how they establish who is calling.

create or replace function public.accept_offer_core(
  p_offer_id uuid,
  p_caller   uuid
)
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
  v_missing    integer;
  v_updated    integer;
begin
  select * into v_offer from public.job_offers o where o.id = p_offer_id;
  if not found then
    return query select 'offer_invalid'::public.accept_result, null::uuid, null::uuid,
                        'This link is not valid.';
    return;
  end if;

  -- A known caller may only act on their own offer. p_caller is null only for
  -- trusted service-role callers.
  if p_caller is not null and p_caller <> v_offer.contractor_id then
    return query select 'not_eligible'::public.accept_result, v_offer.job_id, v_offer.id,
                        'This offer belongs to another contractor.';
    return;
  end if;

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

  -- Serialization point: competing acceptances for this job queue here.
  select * into v_job from public.jobs j where j.id = v_offer.job_id for update;
  if not found then
    return query select 'offer_invalid'::public.accept_result, null::uuid, v_offer.id,
                        'This link is not valid.';
    return;
  end if;

  if v_job.status <> 'offered' then
    if v_job.assigned_contractor_id is not null then
      update public.job_offers o
         set status = 'filled', responded_at = coalesce(o.responded_at, now())
       where o.id = v_offer.id
         and o.status not in ('accepted', 'passed');
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

  select * into v_contractor from public.contractors c where c.id = v_offer.contractor_id;
  select * into v_profile    from public.profiles p    where p.id = v_offer.contractor_id;

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

  -- Guarded claim: only an unassigned, still-offered job matches.
  update public.jobs j
     set status                 = 'assigned',
         assigned_contractor_id = v_offer.contractor_id,
         assigned_at            = now(),
         unfilled_at            = null
   where j.id = v_job.id
     and j.status = 'offered'
     and j.assigned_contractor_id is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    update public.job_offers o
       set status = 'filled', responded_at = coalesce(o.responded_at, now())
     where o.id = v_offer.id
       and o.status not in ('accepted', 'passed');
    return query select 'already_filled'::public.accept_result, v_job.id, v_offer.id,
                        'Job already filled.';
    return;
  end if;

  update public.job_offers o
     set status = 'accepted', responded_at = now()
   where o.id = v_offer.id;

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

-- Entry point 1: the SMS link. The token is the credential.
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
  v_offer_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'offer_invalid'::public.accept_result, null::uuid, null::uuid,
                        'This link is not valid.';
    return;
  end if;

  select o.id into v_offer_id
  from public.job_offers o
  where o.token_hash = p_token_hash;

  if v_offer_id is null then
    return query select 'offer_invalid'::public.accept_result, null::uuid, null::uuid,
                        'This link is not valid.';
    return;
  end if;

  return query select * from public.accept_offer_core(v_offer_id, auth.uid());
end;
$$;

-- Entry point 2: the signed-in job list. The session is the credential, so a
-- caller is mandatory here -- there is no token to fall back on.
create or replace function public.accept_job_offer_by_id(p_offer_id uuid)
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
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  return query select * from public.accept_offer_core(p_offer_id, auth.uid());
end;
$$;

create or replace function public.pass_job_offer_by_id(p_offer_id uuid)
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
  v_offer public.job_offers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_offer from public.job_offers o where o.id = p_offer_id;
  if not found then
    return query select 'offer_invalid'::public.accept_result, null::uuid, null::uuid,
                        'This offer could not be found.';
    return;
  end if;

  if v_offer.contractor_id <> auth.uid() then
    return query select 'not_eligible'::public.accept_result, v_offer.job_id, v_offer.id,
                        'This offer belongs to another contractor.';
    return;
  end if;

  if v_offer.status = 'accepted' then
    return query select 'not_eligible'::public.accept_result, v_offer.job_id, v_offer.id,
                        'You have already accepted this job.';
    return;
  end if;

  update public.job_offers o
     set status = 'passed', responded_at = now()
   where o.id = v_offer.id
     and o.status not in ('accepted', 'passed');

  perform public.write_audit(
    'job', v_offer.job_id, 'offer.passed',
    jsonb_build_object('offer_id', v_offer.id, 'contractor_id', v_offer.contractor_id),
    v_offer.contractor_id
  );

  return query select 'accepted'::public.accept_result, v_offer.job_id, v_offer.id,
                      'Thanks -- we have recorded that you passed.';
end;
$$;

-- accept_offer_core is an implementation detail; it must not be callable
-- directly, since it takes the caller identity as a parameter.
revoke execute on function public.accept_offer_core(uuid, uuid) from public, anon, authenticated;

grant execute on function public.accept_job_offer_by_id(uuid) to authenticated;
grant execute on function public.pass_job_offer_by_id(uuid)   to authenticated;
