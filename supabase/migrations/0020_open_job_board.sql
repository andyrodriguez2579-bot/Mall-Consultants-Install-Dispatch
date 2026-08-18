-- =============================================================================
-- 0020  Open job board
-- =============================================================================
--
-- Until now a job only became visible by being dispatched: an administrator
-- chose recipients and each got an offer with a token. That works for filling a
-- job today, and not at all for building a backlog. Work can be prepared weeks
-- ahead, and a contractor who joins on Friday should find it waiting rather
-- than needing somebody to remember to re-dispatch.
--
-- So a job can be posted to a board: standing, visible to every approved
-- contractor, claimable without an offer ever being created. Dispatch still
-- exists and is unchanged -- the board is where work waits, dispatch is how it
-- gets pushed when it needs filling now. A job can be on the board and also
-- dispatched; whichever route reaches a contractor first, the claim is settled
-- in one place.
-- ---------------------------------------------------------------------------

alter table public.jobs
  add column board_posted_at timestamptz;

comment on column public.jobs.board_posted_at is
  'When this job was posted to the open board. Null means dispatch-only.';

-- The board is read on every contractor dashboard, so it is worth an index that
-- answers it directly rather than scanning a growing jobs table.
create index jobs_board_open_idx
  on public.jobs (board_posted_at desc)
  where board_posted_at is not null and assigned_contractor_id is null;

-- ---------------------------------------------------------------------------
-- Visibility
--
-- Approved, active contractors can read a job that is on the board and still
-- unclaimed. Deliberately narrow: the moment it is claimed this policy stops
-- matching, so a job leaves the board for everyone except the person who took
-- it (who now matches the assignment policy) and anyone who was offered it.
--
-- This grants the row, not the page. The site's exact address and contact sit
-- on that row and must not be shown before a job is claimed -- the application
-- selects named columns for board views for that reason, exactly as the offer
-- view has always shown an approximate location rather than a doorstep.
-- ---------------------------------------------------------------------------
create policy jobs_select_open_board on public.jobs
  for select to authenticated
  using (
    board_posted_at is not null
    and assigned_contractor_id is null
    and status in ('ready', 'offered', 'unfilled')
    and exists (
      select 1
      from public.contractors c
      join public.profiles p on p.id = c.id
      where c.id = auth.uid()
        and c.status = 'approved'
        and p.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- Claiming
--
-- The same shape as accept_job_offer, and for the same reason: two contractors
-- tapping at once must produce one winner and one clear answer, decided by the
-- database rather than by whichever request happened to arrive first. The row
-- lock serialises, and the guarded update is what actually settles it.
-- ---------------------------------------------------------------------------
create or replace function public.claim_board_job(
  p_job_id       uuid,
  p_contractor_id uuid default null
)
returns table (
  result  public.accept_result,
  job_id  uuid,
  message text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job        public.jobs%rowtype;
  v_contractor public.contractors%rowtype;
  v_profile    public.profiles%rowtype;
  v_actor      uuid;
  v_missing    integer;
  v_updated    integer;
begin
  -- auth.uid() is null for trusted service-role callers, which may name the
  -- contractor explicitly; a signed-in caller may only ever claim for themself.
  v_actor := coalesce(auth.uid(), p_contractor_id);

  if v_actor is null then
    return query select 'not_eligible'::public.accept_result, p_job_id,
                        'Sign in to claim this job.';
    return;
  end if;

  if auth.uid() is not null and p_contractor_id is not null
     and p_contractor_id <> auth.uid() then
    return query select 'not_eligible'::public.accept_result, p_job_id,
                        'You can only claim work for yourself.';
    return;
  end if;

  -- Serialization point. Everything below runs one claim at a time per job.
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    return query select 'offer_invalid'::public.accept_result, p_job_id,
                        'That job could not be found.';
    return;
  end if;

  if v_job.board_posted_at is null then
    return query select 'job_not_open'::public.accept_result, v_job.id,
                        'This job is not open on the board.';
    return;
  end if;

  if v_job.assigned_contractor_id is not null then
    -- Re-tapping after winning is not an error.
    if v_job.assigned_contractor_id = v_actor then
      return query select 'accepted'::public.accept_result, v_job.id,
                          'You already have this job.';
    else
      return query select 'already_filled'::public.accept_result, v_job.id,
                          'Someone else has already taken this job.';
    end if;
    return;
  end if;

  if v_job.status not in ('ready', 'offered', 'unfilled') then
    return query select 'job_not_open'::public.accept_result, v_job.id,
                        'This job is no longer open.';
    return;
  end if;

  select * into v_contractor from public.contractors where id = v_actor;
  select * into v_profile    from public.profiles    where id = v_actor;

  if v_contractor.id is null or v_contractor.status <> 'approved'
     or not coalesce(v_profile.is_active, false) then
    return query select 'not_eligible'::public.accept_result, v_job.id,
                        'Your account is not currently eligible to accept work.';
    return;
  end if;

  select count(*) into v_missing
  from public.job_skills js
  where js.job_id = v_job.id
    and not exists (
      select 1
      from public.contractor_skills cs
      where cs.contractor_id = v_actor
        and cs.skill_id = js.skill_id
    );

  if v_missing > 0 then
    return query select 'not_eligible'::public.accept_result, v_job.id,
                        'This job requires a certification your account does not list.';
    return;
  end if;

  update public.jobs
     set status                 = 'assigned',
         assigned_contractor_id = v_actor,
         assigned_at            = now(),
         unfilled_at            = null
   where id = v_job.id
     and assigned_contractor_id is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return query select 'already_filled'::public.accept_result, v_job.id,
                        'Someone else has already taken this job.';
    return;
  end if;

  -- A job can be on the board and dispatched at the same time. Close any open
  -- offers so a contractor holding a link is told it is filled rather than
  -- meeting a silent refusal.
  update public.job_offers o
     set status = 'filled', responded_at = coalesce(o.responded_at, now())
   where o.job_id = v_job.id
     and o.status not in ('accepted', 'passed', 'failed');

  perform public.write_audit(
    'job', v_job.id, 'job.claimed_from_board',
    jsonb_build_object(
      'job_number',    v_job.job_number,
      'contractor_id', v_actor,
      'pay_cents',     v_job.contractor_pay_cents
    ),
    v_actor
  );

  return query select 'accepted'::public.accept_result, v_job.id, 'This job is yours.';
end;
$$;

grant execute on function public.claim_board_job(uuid, uuid) to authenticated;
