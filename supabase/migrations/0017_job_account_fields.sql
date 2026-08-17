-- =============================================================================
-- 0017  Program and RSM carried on the job
-- =============================================================================
--
-- An install request arrives against a customer account, under a program, owned
-- by a regional sales manager. The account number has been on the job since
-- 0014; the other two had nowhere to go, so they were either lost at intake or
-- crammed into `customer_reference` alongside the PO.
--
-- Plain nullable text, because they are identifiers rather than money or scope,
-- and because install sheets do not reliably carry all three -- a job missing
-- an RSM is still a job that has to be dispatched today.
--
-- Released to the contractor with the rest of the work order: a site asking who
-- you are here for is asking for exactly these.
-- ---------------------------------------------------------------------------

alter table public.jobs
  add column program_name text,
  add column rsm_name     text;

comment on column public.jobs.program_name is
  'Operating company or program the work is performed under.';
comment on column public.jobs.rsm_name is
  'Regional sales manager who owns the account.';

-- "What else have we done at this account?" is the common lookup, and it is
-- made against a table that only grows. The account number arrived in 0014
-- without one.
create index if not exists jobs_account_number_idx
  on public.jobs (account_number)
  where account_number is not null;
