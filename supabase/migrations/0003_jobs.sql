-- =============================================================================
-- 0003  Jobs
-- =============================================================================

create sequence public.job_number_seq as bigint start 1001;

-- Human-facing job identifier, e.g. MID-2026-1042. The uuid primary key is
-- what the application routes on; this is what people say out loud.
create or replace function public.next_job_number()
returns text
language sql
volatile
as $$
  select 'MID-' || to_char(now(), 'YYYY') || '-'
         || lpad(nextval('public.job_number_seq')::text, 4, '0');
$$;

create table public.jobs (
  id                    uuid primary key default extensions.gen_random_uuid(),
  job_number            text not null unique default public.next_job_number(),
  status                public.job_status not null default 'draft',

  -- What and where -------------------------------------------------------
  title                 text not null check (length(btrim(title)) between 1 and 160),
  customer_name         text not null check (length(btrim(customer_name)) between 1 and 160),
  site_name             text,
  address_line1         text not null,
  address_line2         text,
  city                  text not null,
  state_code            text not null check (state_code ~ '^[A-Z]{2}$'),
  postal_code           text not null check (postal_code ~ '^\d{5}(-\d{4})?$'),
  scope                 text not null check (length(btrim(scope)) > 0),
  instructions          text,

  -- The commercial term. Fixed at dispatch time and enforced immutable by
  -- trigger from 'offered' onward, so what a contractor was shown is always
  -- what they are owed.
  contractor_pay_cents  integer not null check (contractor_pay_cents >= 0),
  currency              char(3) not null default 'USD',

  -- Schedule -------------------------------------------------------------
  scheduled_start       timestamptz,
  scheduled_end         timestamptz,
  deadline_at           timestamptz,
  -- When the current dispatch round stops accepting responses.
  offer_expires_at      timestamptz,
  offer_round           integer not null default 0 check (offer_round >= 0),

  -- Assignment -----------------------------------------------------------
  assigned_contractor_id uuid references public.contractors (id) on delete restrict,
  assigned_at            timestamptz,

  -- Execution ------------------------------------------------------------
  arrival_confirmed_at  timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  completion_notes      text,

  -- Review ---------------------------------------------------------------
  approved_at           timestamptz,
  approved_by           uuid references public.profiles (id) on delete set null,
  rework_requested_at   timestamptz,
  rework_notes          text,
  rework_count          integer not null default 0 check (rework_count >= 0),

  -- Payment. Recorded, not processed -- no payment rail is integrated.
  paid_at               timestamptz,
  payment_reference     text,
  payment_method        text,
  paid_by               uuid references public.profiles (id) on delete set null,

  -- Exceptional states ---------------------------------------------------
  hold_reason           text,
  cancel_reason         text,
  unfilled_at           timestamptz,

  created_by            uuid not null references public.profiles (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint jobs_schedule_order
    check (scheduled_start is null or scheduled_end is null
           or scheduled_end >= scheduled_start),

  -- An assignment is always a (contractor, timestamp) pair or neither.
  constraint jobs_assignment_consistency
    check ((assigned_contractor_id is null) = (assigned_at is null)),

  -- Every status from 'assigned' onward requires an actual assignee.
  constraint jobs_assigned_statuses_have_contractor
    check (
      status not in ('assigned', 'in_progress', 'completed',
                     'needs_rework', 'approved', 'paid')
      or assigned_contractor_id is not null
    ),

  constraint jobs_paid_requires_approval
    check (status <> 'paid' or approved_at is not null)
);

create index jobs_status_idx           on public.jobs (status);
create index jobs_assigned_idx         on public.jobs (assigned_contractor_id)
                                       where assigned_contractor_id is not null;
create index jobs_created_at_idx       on public.jobs (created_at desc);
create index jobs_postal_idx           on public.jobs (postal_code);
-- Supports the sweep that expires stale dispatch rounds.
create index jobs_open_offers_idx      on public.jobs (offer_expires_at)
                                       where status = 'offered';

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Skills a contractor must hold to be eligible for this job.
create table public.job_skills (
  job_id     uuid not null references public.jobs (id) on delete cascade,
  skill_id   uuid not null references public.skills (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (job_id, skill_id)
);

create index job_skills_skill_idx on public.job_skills (skill_id);
