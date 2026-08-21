-- =============================================================================
-- 0025  JG Installations submissions
-- =============================================================================
--
-- JG Installations is who pays Mall Consultants for a job -- not the customer
-- billed by the 0024 invoice, and not the contractor paid through jobs /
-- job_pricing. JG sets their own fixed rate per task (src/lib/jg/rate-card.ts,
-- taken from JG's own submission workbook), and Mall Consultants reports which
-- of those tasks were performed, on how many, plus mileage and receipts.
--
-- Same draft/frozen shape as 0024's invoices, and for the same reason: this is
-- its own copy of the job, editable freely until it is sent, then fixed;
-- voiding is reachable from either state so a mistake can be corrected and a
-- fresh submission issued without touching what already went to JG.
-- ---------------------------------------------------------------------------

create type public.jg_submission_status as enum ('draft', 'sent', 'void');

create table public.jg_submissions (
  id              uuid primary key default extensions.gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,

  status          public.jg_submission_status not null default 'draft',

  -- The form's own header block. Prefilled from the job, but this is the
  -- document's own copy.
  account_name    text,
  account_number  text,
  rsm_name        text,
  opco            text,

  -- Mileage, exactly as JG's form asks for it. contractor_miles is not reused
  -- directly: this is what gets typed onto JG's form, and a job's own mileage
  -- fields may be edited later without this submission moving.
  start_mileage   numeric(10, 2) not null default 0 check (start_mileage >= 0),
  end_mileage     numeric(10, 2) not null default 0 check (end_mileage >= 0),
  commuter_miles  numeric(10, 2) not null default 0 check (commuter_miles >= 0),
  mileage_rate    numeric(10, 4) not null default 0 check (mileage_rate >= 0),
  mileage_cents   integer not null default 0 check (mileage_cents >= 0),

  -- Receipts, itemised the way JG's form itemises them -- by store, not as
  -- one lump sum. The app has no per-store data of its own to prefill these
  -- from, so they start at zero and are entered by hand.
  home_depot_cents      integer not null default 0 check (home_depot_cents >= 0),
  lowes_cents            integer not null default 0 check (lowes_cents >= 0),
  harbor_freight_cents   integer not null default 0 check (harbor_freight_cents >= 0),
  local_hardware_cents   integer not null default 0 check (local_hardware_cents >= 0),
  hotel_cents            integer not null default 0 check (hotel_cents >= 0),
  tolls_parking_cents    integer not null default 0 check (tolls_parking_cents >= 0),

  -- Maintained from jg_submission_lines by trigger, below -- this is JG's own
  -- "Total Job $", the task lines only. Mileage and receipts are reported to
  -- JG as separate figures on the same form, not folded into this number,
  -- because that is how their own template keeps them.
  lines_subtotal_cents integer not null default 0 check (lines_subtotal_cents >= 0),

  sent_at              timestamptz,
  sent_to_email        text,
  email_message_id     uuid references public.email_messages (id) on delete set null,
  send_error           text,

  voided_at       timestamptz,
  void_reason     text,

  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint jg_submissions_sent_has_time check (status <> 'sent' or sent_at is not null),
  constraint jg_submissions_void_has_time check ((status = 'void') = (voided_at is not null))
);

create unique index jg_submissions_job_live_idx
  on public.jg_submissions (job_id)
  where status <> 'void';

create index jg_submissions_job_idx on public.jg_submissions (job_id, created_at desc);

create trigger jg_submissions_set_updated_at
  before update on public.jg_submissions
  for each row execute function public.set_updated_at();

create table public.jg_submission_lines (
  id               uuid primary key default extensions.gen_random_uuid(),
  submission_id    uuid not null references public.jg_submissions (id) on delete cascade,

  -- The rate card's own slug, kept only so the editor can show which entry a
  -- line was picked from. Not a foreign key -- the rate card is a constant in
  -- application code (src/lib/jg/rate-card.ts), not a table, because it is
  -- JG's price list, not one Mall Consultants ever edits.
  rate_card_item_id text,

  category         text not null check (length(btrim(category)) > 0),
  description      text not null check (length(btrim(description)) > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity         numeric(10, 2) not null default 1 check (quantity > 0),

  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

alter table public.jg_submission_lines
  add column line_total_cents integer
    generated always as (round(unit_price_cents * quantity)::integer) stored;

create index jg_submission_lines_submission_idx
  on public.jg_submission_lines (submission_id, sort_order);

-- ---------------------------------------------------------------------------
-- Subtotal and freeze-on-send: identical shape to 0024's invoices.
-- ---------------------------------------------------------------------------

create or replace function public.set_jg_submission_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.lines_subtotal_cents := coalesce(
    (select sum(line_total_cents) from public.jg_submission_lines where submission_id = new.id),
    0
  );
  return new;
end;
$$;

create trigger jg_submissions_set_subtotal
  before insert or update on public.jg_submissions
  for each row execute function public.set_jg_submission_subtotal();

create or replace function public.refresh_jg_submission_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission_id uuid := coalesce(new.submission_id, old.submission_id);
begin
  update public.jg_submissions
     set lines_subtotal_cents = coalesce(
           (select sum(line_total_cents) from public.jg_submission_lines where submission_id = v_submission_id),
           0
         )
   where id = v_submission_id;

  return coalesce(new, old);
end;
$$;

create trigger jg_submission_lines_refresh_subtotal
  after insert or update or delete on public.jg_submission_lines
  for each row execute function public.refresh_jg_submission_subtotal();

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

  if old.status <> 'draft' then
    raise exception 'submission % is fixed once it is no longer a draft (status %)', old.id, old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger jg_submissions_enforce_editable
  before update or delete on public.jg_submissions
  for each row execute function public.enforce_jg_submission_editable();

create or replace function public.enforce_jg_submission_lines_editable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.jg_submission_status;
begin
  select status into v_status from public.jg_submissions
   where id = coalesce(new.submission_id, old.submission_id);

  if v_status is not null and v_status <> 'draft' then
    raise exception 'submission lines are fixed once the submission is no longer a draft (status %)', v_status
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger jg_submission_lines_enforce_editable
  before insert or update or delete on public.jg_submission_lines
  for each row execute function public.enforce_jg_submission_lines_editable();

-- ---------------------------------------------------------------------------
-- Visibility -- administrator only, same reasoning as job_pricing and 0024's
-- invoices: this is customer/vendor money, not something a contractor sees.
-- ---------------------------------------------------------------------------

alter table public.jg_submissions enable row level security;

create policy jg_submissions_admin_only on public.jg_submissions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.jg_submissions to authenticated;

alter table public.jg_submission_lines enable row level security;

create policy jg_submission_lines_admin_only on public.jg_submission_lines
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.jg_submission_lines to authenticated;
