-- =============================================================================
-- 0026  QuickBooks connection
-- =============================================================================
--
-- One company, one connection: Mall Consultants has one QuickBooks Online
-- company, so this is a single row rather than a table of connections. The
-- unique index on a constant enforces that directly instead of trusting the
-- application never to insert a second one.
--
-- No policy is granted to `authenticated` at all. This is not customer money
-- like job_pricing or the invoice tables -- it is the literal credentials that
-- can create and read records in the real QuickBooks company, so only the
-- service-role client (which bypasses RLS entirely) may touch it. Nothing
-- here is ever read by a request carrying a user's own session.
-- ---------------------------------------------------------------------------

create table public.quickbooks_connection (
  id                       boolean primary key default true,
  realm_id                 text not null,
  access_token             text not null,
  refresh_token            text not null,
  access_token_expires_at  timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  connected_by             uuid references public.profiles (id) on delete set null,
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint quickbooks_connection_singleton check (id)
);

create trigger quickbooks_connection_set_updated_at
  before update on public.quickbooks_connection
  for each row execute function public.set_updated_at();

alter table public.quickbooks_connection enable row level security;
-- Deliberately no policies: RLS with none defined denies every row to every
-- role except the service role, which does not go through RLS at all.

-- ---------------------------------------------------------------------------
-- What gets mirrored into QuickBooks, and whether JG has paid it.
--
-- On jg_submissions, not the customer-facing invoices table: JG Installations
-- is who pays Mall Consultants, so from Mall Consultants' own books JG is the
-- customer being invoiced, and a submission is what that invoice is for. The
-- QuickBooks copy is for Mall Consultants' records only -- it is never sent
-- to JG, who already has their own workbook from the email this row records.
-- ---------------------------------------------------------------------------

alter table public.jg_submissions
  add column quickbooks_invoice_id text,
  add column quickbooks_synced_at  timestamptz,
  add column paid_at               timestamptz,
  add column paid_amount_cents     integer check (paid_amount_cents is null or paid_amount_cents >= 0);

-- 0025's freeze-on-send trigger blocked every update once a submission left
-- 'draft', which is right for the submission itself but wrong for these four
-- columns: recording that QuickBooks has a copy, or that JG paid, happens
-- after the submission has already gone out and is not an edit to what was
-- sent. Replaced rather than bypassed, so a sent submission's actual content
-- -- amounts, lines, mileage -- is still fixed exactly as before.
create or replace function public.enforce_jg_submission_editable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'a submission can only be deleted while still a draft (status %)', old.status
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.status = 'void' and old.status <> 'void' then
    return new;
  end if;

  if old.status = 'sent' and new.status = 'sent'
     and new.job_id             is not distinct from old.job_id
     and new.account_name       is not distinct from old.account_name
     and new.account_number     is not distinct from old.account_number
     and new.rsm_name           is not distinct from old.rsm_name
     and new.opco               is not distinct from old.opco
     and new.start_mileage      is not distinct from old.start_mileage
     and new.end_mileage        is not distinct from old.end_mileage
     and new.commuter_miles     is not distinct from old.commuter_miles
     and new.mileage_rate       is not distinct from old.mileage_rate
     and new.mileage_cents      is not distinct from old.mileage_cents
     and new.home_depot_cents   is not distinct from old.home_depot_cents
     and new.lowes_cents        is not distinct from old.lowes_cents
     and new.harbor_freight_cents is not distinct from old.harbor_freight_cents
     and new.local_hardware_cents is not distinct from old.local_hardware_cents
     and new.hotel_cents        is not distinct from old.hotel_cents
     and new.tolls_parking_cents is not distinct from old.tolls_parking_cents
     and new.lines_subtotal_cents is not distinct from old.lines_subtotal_cents
     and new.sent_at            is not distinct from old.sent_at
     and new.sent_to_email      is not distinct from old.sent_to_email
     and new.email_message_id   is not distinct from old.email_message_id
     and new.send_error         is not distinct from old.send_error
  then
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception 'submission % is fixed once it is no longer a draft (status %)', old.id, old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
