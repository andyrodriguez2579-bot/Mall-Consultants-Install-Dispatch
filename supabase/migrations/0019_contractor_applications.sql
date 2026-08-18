-- =============================================================================
-- 0019  Contractor applications
-- =============================================================================
--
-- Adding a contractor meant an administrator retyping someone's name, mobile
-- number and email from a phone call. A mistyped mobile fails silently: offers
-- go nowhere and nobody finds out until the work is unfilled. Letting people
-- enter their own details removes the transcription step entirely -- they are
-- the authority on their own phone number.
--
-- An application is deliberately NOT a contractor. Nothing here creates a login
-- or a profile; approval does that, through the same path the admin form uses.
-- That keeps the public surface incapable of minting an auth user, so the worst
-- an abusive submission achieves is a row an administrator deletes.
--
-- The SMS consent captured here is worth more than the paper form it replaces.
-- A2P campaign review asks to see that consent was knowing, specific and
-- voluntary; a stored checkbox state, the exact sentence that was on screen,
-- and the moment it was agreed is evidence of all three, per contractor, rather
-- than a template a reviewer has to take on trust.
-- ---------------------------------------------------------------------------

create type public.application_status as enum ('pending', 'approved', 'declined');

create table public.contractor_applications (
  id             uuid primary key default extensions.gen_random_uuid(),

  full_name      text not null check (length(btrim(full_name)) > 1),
  company_name   text,
  -- Same shape as profiles.phone, so an application cannot be approved into a
  -- profile the constraint would reject.
  phone          text not null check (phone ~ '^\+[1-9]\d{6,14}$'),
  email          text not null check (position('@' in email) > 1),

  city           text,
  state_code     text,
  max_travel_miles integer check (max_travel_miles is null or max_travel_miles >= 0),
  experience     text,

  -- Consent, and the evidence for it. `consent_text` stores the wording that
  -- was actually on screen: the page will be edited over the years, and proof
  -- of what someone agreed to is worthless if it only points at today's copy.
  sms_opt_in     boolean not null default false,
  consent_text   text,
  consented_at   timestamptz,
  accepted_terms boolean not null default false,

  -- Kept for abuse review only, and never shown next to the person's name.
  source_ip      text,
  user_agent     text,

  status         public.application_status not null default 'pending',
  reviewed_at    timestamptz,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  decline_reason text,
  -- Set on approval, so an application and the contractor it became stay linked.
  contractor_id  uuid references public.profiles (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index contractor_applications_status_idx
  on public.contractor_applications (status, created_at desc);

-- One open application per number. Re-applying after a decline is allowed --
-- circumstances change -- but a second pending row for the same person is just
-- two things for an administrator to read.
create unique index contractor_applications_pending_phone_idx
  on public.contractor_applications (phone)
  where status = 'pending';

create trigger contractor_applications_set_updated_at
  before update on public.contractor_applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- No policy for anon or for contractors: submissions are written by the server
-- with the service role, which bypasses RLS, so the public form needs no grant
-- of its own. An application holds a private mobile number and email before
-- anyone has agreed to anything, and the people most likely to guess at this
-- table are the ones it must not serve.
-- ---------------------------------------------------------------------------
alter table public.contractor_applications enable row level security;

create policy contractor_applications_admin_read on public.contractor_applications
  for select to authenticated
  using (public.is_admin());

create policy contractor_applications_admin_write on public.contractor_applications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy contractor_applications_admin_delete on public.contractor_applications
  for delete to authenticated
  using (public.is_admin());
