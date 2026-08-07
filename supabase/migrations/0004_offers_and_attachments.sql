-- =============================================================================
-- 0004  Dispatch offers, file attachments
-- =============================================================================

-- One row per (job, contractor, dispatch round). This table is the only path
-- by which a contractor learns a job exists.
create table public.job_offers (
  id             uuid primary key default extensions.gen_random_uuid(),
  job_id         uuid not null references public.jobs (id) on delete cascade,
  contractor_id  uuid not null references public.contractors (id) on delete cascade,
  round          integer not null default 1 check (round >= 1),
  status         public.offer_status not null default 'pending',

  -- Only the SHA-256 of the link token is stored. A database leak therefore
  -- does not yield working offer links, and the raw token exists solely in the
  -- SMS body and the contractor's browser.
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at     timestamptz not null,

  sent_at        timestamptz,
  delivered_at   timestamptz,
  viewed_at      timestamptz,
  responded_at   timestamptz,

  -- Free-text question a contractor may submit instead of accepting/passing.
  question       text,
  question_at    timestamptz,

  failure_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A contractor is offered a given job at most once per dispatch round.
  unique (job_id, contractor_id, round)
);

create index job_offers_job_idx        on public.job_offers (job_id, status);
create index job_offers_contractor_idx on public.job_offers (contractor_id, status);
create index job_offers_live_idx       on public.job_offers (expires_at)
                                       where status in ('pending', 'sent', 'delivered', 'viewed');

create trigger job_offers_set_updated_at
  before update on public.job_offers
  for each row execute function public.set_updated_at();

-- Files attached to a job: the admin's brief, and the contractor's
-- before/after photographic evidence.
create table public.job_attachments (
  id           uuid primary key default extensions.gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  kind         public.attachment_kind not null,
  -- Path within the private storage bucket. Never a public URL; the
  -- application issues short-lived signed URLs on demand.
  file_path    text not null unique,
  file_name    text,
  content_type text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  caption      text,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index job_attachments_job_idx on public.job_attachments (job_id, kind);
