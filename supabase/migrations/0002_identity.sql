-- =============================================================================
-- 0002  Identity: profiles, contractors, skills, service areas, documents
-- =============================================================================

-- One row per authenticated human, keyed to the Supabase auth user.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'contractor',
  full_name   text not null check (length(btrim(full_name)) between 1 and 120),
  -- Phone is the contractor's dispatch address, so it is stored strictly in
  -- E.164 and is unique across the system.
  phone       text unique check (phone ~ '^\+[1-9]\d{6,14}$'),
  email       text check (email is null or position('@' in email) > 1),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role) where is_active;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Contractor-specific attributes. 1:1 extension of profiles, so a contractor's
-- id is the same uuid as their auth user throughout the system.
create table public.contractors (
  id               uuid primary key references public.profiles (id) on delete cascade,
  status           public.contractor_status not null default 'pending',
  company_name     text,
  -- Contractor-controlled dispatch preferences.
  sms_opt_in       boolean not null default true,
  is_available     boolean not null default true,
  max_travel_miles integer check (max_travel_miles is null or max_travel_miles between 0 and 5000),
  approved_at      timestamptz,
  approved_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- 'approved' is the only status that carries an approval timestamp.
  constraint contractors_approval_consistency
    check ((status = 'approved') = (approved_at is not null))
);

create index contractors_dispatchable_idx
  on public.contractors (status)
  where status = 'approved' and is_available and sms_opt_in;

create trigger contractors_set_updated_at
  before update on public.contractors
  for each row execute function public.set_updated_at();

-- Internal notes an admin keeps about a contractor. Split into its own table
-- so row-level security can hide it from the contractor entirely; column-level
-- privacy inside `contractors` would not be expressible in RLS.
create table public.contractor_notes (
  id            uuid primary key default extensions.gen_random_uuid(),
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  author_id     uuid references public.profiles (id) on delete set null,
  body          text not null check (length(btrim(body)) > 0),
  created_at    timestamptz not null default now()
);

create index contractor_notes_contractor_idx
  on public.contractor_notes (contractor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Skills: the qualification gate for accepting a job.
-- ---------------------------------------------------------------------------
create table public.skills (
  id          uuid primary key default extensions.gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.contractor_skills (
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  skill_id      uuid not null references public.skills (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (contractor_id, skill_id)
);

create index contractor_skills_skill_idx on public.contractor_skills (skill_id);

-- ---------------------------------------------------------------------------
-- Service areas: the geographic gate for matching (not for accepting).
-- ---------------------------------------------------------------------------
create table public.service_areas (
  id               uuid primary key default extensions.gen_random_uuid(),
  name             text not null,
  state_code       text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  -- Leading digits of postal codes covered, e.g. {'770','775','78'}.
  -- A job matches when its postal code starts with any listed prefix.
  postal_prefixes  text[] not null default '{}',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.contractor_service_areas (
  contractor_id   uuid not null references public.contractors (id) on delete cascade,
  service_area_id uuid not null references public.service_areas (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (contractor_id, service_area_id)
);

create index contractor_service_areas_area_idx
  on public.contractor_service_areas (service_area_id);

-- ---------------------------------------------------------------------------
-- Compliance documents (insurance certificates, W-9s, licenses).
-- ---------------------------------------------------------------------------
create table public.contractor_documents (
  id            uuid primary key default extensions.gen_random_uuid(),
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  kind          text not null check (kind in ('insurance', 'w9', 'license', 'agreement', 'other')),
  file_path     text not null unique,
  file_name     text,
  content_type  text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  issued_on     date,
  expires_on    date,
  verified_at   timestamptz,
  verified_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index contractor_documents_contractor_idx
  on public.contractor_documents (contractor_id, kind);
