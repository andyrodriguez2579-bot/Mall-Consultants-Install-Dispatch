-- =============================================================================
-- 0021  Automated intake from Outlook
-- =============================================================================
--
-- Installation requests arrive by email in two shapes: an mHelp board
-- assignment, whose body is a labelled table and can be read reliably, and an
-- Excel install sheet, which the application already knows how to parse but
-- only in a browser. Automation therefore aims at different ends for each --
-- straight to a job for the first, into the review queue for the second -- and
-- both need the same thing from the schema: somewhere to put the email itself.
--
-- Nothing here changes existing behaviour. Every column is nullable or
-- defaulted, and a job created by hand is unaffected.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Where the request came from
--
-- The message id is the duplicate guard. n8n retries, Outlook redelivers, and a
-- workflow gets re-run by hand while it is being tuned; without a unique key
-- every one of those creates a second job for work that was only asked for
-- once. It is unique rather than merely indexed because the right outcome for a
-- repeat is a refusal the caller can recognise, not a silent second row.
--
-- The conversation id matters as much, for a different reason: an
-- acknowledgment has to reach the RSM, the sales contact, the manager, the two
-- Ecolab contacts and the installer -- six to ten people who differ per job.
-- Replying to the original thread reaches exactly them, forever, with no list
-- to maintain and none to go stale.
-- ---------------------------------------------------------------------------
alter table public.install_requests
  add column source_message_id      text,
  add column source_conversation_id text,
  add column source_sender          text,
  add column source_subject         text,
  add column source_received_at     timestamptz,
  -- Set when extraction was not confident enough to act on. The request is
  -- still created: a job nobody can read is a job to look at, never one to
  -- discard.
  add column needs_review           boolean not null default false,
  add column review_reason          text;

create unique index install_requests_source_message_idx
  on public.install_requests (source_message_id)
  where source_message_id is not null;

create index install_requests_needs_review_idx
  on public.install_requests (received_at desc)
  where needs_review;

-- 'automation' joins the existing sources. The CHECK is replaced rather than
-- widened in place because Postgres has no "add value to check constraint".
alter table public.install_requests
  drop constraint if exists install_requests_source_check;

alter table public.install_requests
  add constraint install_requests_source_check
  check (source in ('paste', 'email', 'phone', 'manual', 'automation'));

-- ---------------------------------------------------------------------------
-- Fields the install emails carry that the job had nowhere to put
-- ---------------------------------------------------------------------------
alter table public.jobs
  -- The party MALL Consultants bills, which is not the site being installed.
  -- customer_name is the restaurant; this is who pays.
  add column prime_contractor         text,
  -- mHelp assignments carry a site email; every acknowledgment and scheduling
  -- confirmation needs one, and only a name and a phone existed.
  add column site_contact_email       text,
  add column equipment_type           text,
  add column equipment_model          text,
  -- Distinct from deadline_at: what was asked for, versus what is committed to.
  add column requested_completion_date date,
  add column source                   text not null default 'manual'
    check (source in ('manual', 'request', 'automation')),
  -- Set when the contractor confirms the date and arrival window themselves,
  -- which is a different fact from an administrator having scheduled it.
  add column schedule_confirmed_at    timestamptz;

comment on column public.jobs.prime_contractor is
  'The company that hired Mall Consultants and receives the invoice.';
comment on column public.jobs.source is
  'How the job came to exist: entered by hand, converted from a request, or created by automation.';

-- ---------------------------------------------------------------------------
-- Operating companies and RSMs
--
-- Transcribed from the job sheet's dropdowns, which is the point: these were
-- free text, and free text turns "PFS- NY Metro" and "PFS-NY Metro" into two
-- operating companies that no report will ever add back together. Extraction
-- from an email has to match against a fixed set rather than spell something
-- plausible.
--
-- Reference data, so readable by any signed-in user and writable by admins --
-- the rule skills and service areas already follow.
-- ---------------------------------------------------------------------------
create table public.operating_companies (
  id         uuid primary key default extensions.gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  -- Two of forty-five send almost everything; ordering by this puts them where
  -- they are actually reached for.
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table public.rsm_contacts (
  id         uuid primary key default extensions.gen_random_uuid(),
  name       text not null unique,
  email      text,
  is_active  boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

alter table public.operating_companies enable row level security;
alter table public.rsm_contacts        enable row level security;

create policy operating_companies_read on public.operating_companies
  for select to authenticated using (true);
create policy operating_companies_admin_write on public.operating_companies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy rsm_contacts_read on public.rsm_contacts
  for select to authenticated using (true);
create policy rsm_contacts_admin_write on public.rsm_contacts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.operating_companies (name, sort_order) values
  ('PFS- NY Metro', 1), ('PFS- New Jersey', 2),
  ('PFS- Caro', 100), ('PFS- Chicago', 100), ('PFS- S Cali', 100),
  ('PFS- Dallas', 100), ('PFS- Florence', 100), ('PFS- Florida', 100),
  ('PFS- Hale', 100), ('PFS- Hickory', 100), ('PFS- Houston', 100),
  ('PFS- Ledyard', 100), ('PFS- Little Rock', 100), ('PFS- Maryland', 100),
  ('PFS- Miami', 100), ('PFS- Middendorf', 100), ('PFS- Miltons', 100),
  ('PFS- Minnesota', 100), ('PFS- Missouri', 100), ('PFS- Nashville', 100),
  ('PFS- N Cali', 100), ('PFS- Orlando', 100), ('PFS- Pacific NW', 100),
  ('PFS- Powell', 100), ('PFS- Somerset', 100), ('PFS- Springfield', 100),
  ('PFS- Temple', 100), ('PFS- TPC', 100), ('PFS- Victoria', 100),
  ('Nicholas - SLC', 100), ('Nicholas - Las Vegas', 100),
  ('BEK - Florida', 100), ('BEK - Alabama', 100), ('BEK - Carolinas', 100),
  ('BEK - Ft Worth', 100), ('BEK - Little Rock', 100), ('BEK - Amarillo', 100),
  ('BEK - Houston', 100), ('BEK - San Antonio', 100), ('BEK - Albuquerque', 100),
  ('Shake Shack', 100), ('C-Store', 100), ('QSR Multi Unit', 100),
  ('Other', 999)
on conflict (name) do nothing;

insert into public.rsm_contacts (name, sort_order) values
  ('C Medeiros', 1), ('S Whalen', 2),
  ('J Parsons', 100), ('J Moss', 100), ('B Gray', 100), ('J Maravilla', 100),
  ('J Turner', 100), ('R Allen', 100), ('P Monge', 100), ('T Stanojevic', 100),
  ('N Gieselman', 100), ('C Curington', 100), ('J Ebbrecht', 100),
  ('J Olson', 100), ('M Evanosky', 100), ('C Mertz', 100), ('K Lovett', 100),
  ('A Martino', 100), ('D Baldwin', 100), ('A Granger', 100), ('D Flory', 100),
  ('D Rainey', 100), ('D Reed', 100), ('J Greene', 100), ('S Gobran', 100),
  ('SSDC OFFICE', 100), ('US Installs SS', 100), ('US Installs', 100),
  ('Other', 999)
on conflict (name) do nothing;
