-- =============================================================================
-- 0024  Customer invoices
-- =============================================================================
--
-- A job's customer-side pricing (job_pricing, job_service_lines) freezes at
-- dispatch -- it is the labor figure a contractor accepted, and changing it
-- afterwards would be changing what they were promised. An invoice is a
-- different document: it is billed to the customer once the work is done, an
-- administrator routinely adjusts it before it goes out (a line struck, a
-- note added, a total corrected against what the site actually agreed to),
-- and none of that may touch the contractor's pay.
--
-- So an invoice is its own copy. Creating one reads the job's pricing once,
-- at that moment, into invoice_line_items; after that the two are unrelated
-- rows, and editing one cannot move the other.
--
-- Same freeze pattern as job_pricing: editable while 'draft', fixed the
-- moment it is 'sent'. 'void' is the one exception -- it is reachable from
-- either state, because calling off a mistake and reissuing a corrected
-- invoice has to be possible even after the first one went out.
-- ---------------------------------------------------------------------------

create type public.invoice_status as enum ('draft', 'sent', 'void');

-- Sequential and independent of the job number: an invoice number is an
-- accounting reference, and two invoices for the same account should not
-- collide just because they share a job.
create sequence public.invoice_number_seq start with 1001;

create table public.invoices (
  id              uuid primary key default extensions.gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,
  invoice_number  integer not null unique default nextval('public.invoice_number_seq'),

  status          public.invoice_status not null default 'draft',

  -- Who the invoice is addressed to. Prefilled from the job, but this is the
  -- document's own copy -- editing it here does not touch the job.
  bill_to_name    text,
  bill_to_address text,
  notes           text,

  -- Maintained from invoice_line_items by trigger, below. Never written
  -- directly.
  subtotal_cents  integer not null default 0 check (subtotal_cents >= 0),

  sent_at             timestamptz,
  sent_to_email        text,
  -- The email_messages row the send produced, so delivery status can be
  -- traced through the same log every other outbound email uses.
  email_message_id    uuid references public.email_messages (id) on delete set null,
  send_error           text,

  voided_at       timestamptz,
  void_reason     text,

  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- An implication, not an equivalence: voiding a sent invoice moves it to
  -- 'void' without clearing sent_at, because when it was sent is still true
  -- and worth keeping. Only 'sent' itself requires the timestamp.
  constraint invoices_sent_has_time check (status <> 'sent' or sent_at is not null),
  constraint invoices_void_has_time check ((status = 'void') = (voided_at is not null))
);

-- One live invoice per job. Voiding it is what frees the job up for a
-- corrected reissue -- the old row stays, excluded from this index by its
-- own status.
create unique index invoices_job_live_idx
  on public.invoices (job_id)
  where status <> 'void';

create index invoices_job_idx on public.invoices (job_id, created_at desc);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_line_items (
  id               uuid primary key default extensions.gen_random_uuid(),
  invoice_id       uuid not null references public.invoices (id) on delete cascade,

  description      text not null check (length(btrim(description)) > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity         numeric(10, 2) not null default 1 check (quantity > 0),

  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

alter table public.invoice_line_items
  add column line_total_cents integer
    generated always as (round(unit_price_cents * quantity)::integer) stored;

create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, sort_order);

-- ---------------------------------------------------------------------------
-- Keeping the subtotal true -- same two-trigger shape as job_service_lines
-- (0016): a write to invoices recomputes from the lines rather than trusting
-- a passed value, and a write to a line pushes the recomputed sum back up.
-- ---------------------------------------------------------------------------

create or replace function public.set_invoice_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.subtotal_cents := coalesce(
    (select sum(line_total_cents) from public.invoice_line_items where invoice_id = new.id),
    0
  );
  return new;
end;
$$;

create trigger invoices_set_subtotal
  before insert or update on public.invoices
  for each row execute function public.set_invoice_subtotal();

create or replace function public.refresh_invoice_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices
     set subtotal_cents = coalesce(
           (select sum(line_total_cents) from public.invoice_line_items where invoice_id = v_invoice_id),
           0
         )
   where id = v_invoice_id;

  return coalesce(new, old);
end;
$$;

create trigger invoice_line_items_refresh_subtotal
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.refresh_invoice_subtotal();

-- ---------------------------------------------------------------------------
-- Freezing on send
-- ---------------------------------------------------------------------------

create or replace function public.enforce_invoice_editable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'an invoice can only be deleted while still a draft (status %)', old.status
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- Voiding is reachable from any status: it is how a sent invoice gets
  -- corrected, not an edit to what was sent.
  if new.status = 'void' and old.status <> 'void' then
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception 'invoice % is fixed once it is no longer a draft (status %)', old.id, old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger invoices_enforce_editable
  before update or delete on public.invoices
  for each row execute function public.enforce_invoice_editable();

create or replace function public.enforce_invoice_lines_editable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status from public.invoices
   where id = coalesce(new.invoice_id, old.invoice_id);

  if v_status is not null and v_status <> 'draft' then
    raise exception 'invoice lines are fixed once the invoice is no longer a draft (status %)', v_status
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger invoice_line_items_enforce_editable
  before insert or update or delete on public.invoice_line_items
  for each row execute function public.enforce_invoice_lines_editable();

-- ---------------------------------------------------------------------------
-- Visibility -- the customer price is administrator-only for the same reason
-- job_pricing is.
-- ---------------------------------------------------------------------------

alter table public.invoices enable row level security;

create policy invoices_admin_only on public.invoices
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.invoices to authenticated;
grant usage on sequence public.invoice_number_seq to authenticated;

alter table public.invoice_line_items enable row level security;

create policy invoice_line_items_admin_only on public.invoice_line_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.invoice_line_items to authenticated;
