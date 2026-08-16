-- ---------------------------------------------------------------------------
-- 0016 -- Several priced services on one job
--
-- A job was priced as one service repeated: a customer price and a task count.
-- That matches the written pricing rule (Base Labor Total = Customer Labor
-- Price x Number of Tasks) but not the work: a real install sheet asks for four
-- to six different services at different prices -- a dispenser, an air gap, a
-- length of tubing, a sink system -- and there was no way to say so.
--
-- Each service becomes a line. The labor subtotal is the sum of the lines, and
-- everything downstream is unchanged: additional approved labor still adds to
-- revenue, the contractor's share is still a percentage of that, and the Mall
-- Consultants share is still the remainder rather than its own percentage.
--
-- The subtotal is maintained by the database rather than generated, because a
-- generated column cannot aggregate another table. It is still not something a
-- person can write: any write to job_pricing recomputes it from the lines, so
-- passing a value for it has no effect.
-- ---------------------------------------------------------------------------

create table public.job_service_lines (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,

  -- The catalogue entry this came from, kept for reporting. Nullable: a job may
  -- carry a one-off service that is not on the price list.
  service_item_id uuid references public.price_list_items (id) on delete set null,

  -- Copied, never followed. What the job was priced at cannot change because
  -- someone edited the price list afterwards.
  description     text not null check (length(btrim(description)) > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity        numeric(10, 2) not null default 1 check (quantity >= 0),

  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.job_service_lines
  add column line_total_cents integer
    generated always as (round(unit_price_cents * quantity)::integer) stored;

create index job_service_lines_job_idx on public.job_service_lines (job_id, sort_order);

create trigger job_service_lines_set_updated_at
  before update on public.job_service_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The subtotal, and the columns derived from it
-- ---------------------------------------------------------------------------

alter table public.job_pricing
  add column lines_subtotal_cents integer not null default 0
    check (lines_subtotal_cents >= 0);

-- Carry existing single-service pricing over as one line, so nothing already
-- quoted changes value.
insert into public.job_service_lines (job_id, service_item_id, description, unit_price_cents, quantity)
select
  jp.job_id,
  j.service_item_id,
  coalesce(nullif(btrim(j.service_type), ''), 'Service'),
  jp.customer_labor_price_cents,
  jp.task_count
from public.job_pricing jp
join public.jobs j on j.id = jp.job_id
where jp.customer_labor_price_cents > 0;

update public.job_pricing jp
set lines_subtotal_cents = coalesce(
  (select sum(line_total_cents) from public.job_service_lines l where l.job_id = jp.job_id),
  0
);

-- Rebuild the derived columns on the subtotal rather than price x count. The
-- view reads them, so it has to come down first and is recreated at the end.
drop view if exists public.job_financials;

alter table public.job_pricing
  drop column base_labor_total_cents,
  drop column total_labor_revenue_cents,
  drop column contractor_labor_pay_cents,
  drop column mall_share_cents;

alter table public.job_pricing
  add column base_labor_total_cents integer
    generated always as (lines_subtotal_cents) stored,
  add column total_labor_revenue_cents integer
    generated always as (lines_subtotal_cents + additional_labor_cents) stored,
  add column contractor_labor_pay_cents integer
    generated always as (
      public.calc_contractor_labor_cents(
        lines_subtotal_cents + additional_labor_cents,
        contractor_percentage_bps
      )
    ) stored,
  -- Revenue minus contractor pay, never its own percentage. This is what makes
  -- the two shares add up to the penny on every amount.
  add column mall_share_cents integer
    generated always as (
      (lines_subtotal_cents + additional_labor_cents)
      - public.calc_contractor_labor_cents(
          lines_subtotal_cents + additional_labor_cents,
          contractor_percentage_bps
        )
    ) stored;

-- The single-service columns have no meaning now that lines carry the prices.
alter table public.job_pricing
  drop column customer_labor_price_cents,
  drop column task_count;

-- ---------------------------------------------------------------------------
-- Keeping the subtotal true
-- ---------------------------------------------------------------------------

/*
 * Two triggers, because the subtotal has two ways of going stale.
 *
 * A write to job_pricing recomputes it from the lines, so a caller cannot set
 * it: whatever is passed is overwritten. A write to a line updates the pricing
 * row it belongs to.
 */
create or replace function public.set_lines_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.lines_subtotal_cents := coalesce(
    (select sum(line_total_cents) from public.job_service_lines where job_id = new.job_id),
    0
  );
  return new;
end;
$$;

create trigger job_pricing_set_lines_subtotal
  before insert or update on public.job_pricing
  for each row execute function public.set_lines_subtotal();

create or replace function public.refresh_lines_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid := coalesce(new.job_id, old.job_id);
begin
  update public.job_pricing
     set lines_subtotal_cents = coalesce(
           (select sum(line_total_cents) from public.job_service_lines where job_id = v_job_id),
           0
         )
   where job_id = v_job_id;

  return coalesce(new, old);
end;
$$;

create trigger job_service_lines_refresh_subtotal
  after insert or update or delete on public.job_service_lines
  for each row execute function public.refresh_lines_subtotal();

-- Lines are part of the labor agreement, so they freeze when it does.
create trigger job_service_lines_enforce_editable
  before insert or update or delete on public.job_service_lines
  for each row execute function public.enforce_pricing_editable();

-- ---------------------------------------------------------------------------
-- Visibility
--
-- Lines carry the customer price, so they are administrator-only for the same
-- reason job_pricing is. A contractor is told what to install through the job's
-- scope and site instructions, which carry no prices.
-- ---------------------------------------------------------------------------

alter table public.job_service_lines enable row level security;

create policy job_service_lines_admin_only on public.job_service_lines
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.job_service_lines to authenticated;

-- ---------------------------------------------------------------------------
-- The financial view follows the same shape
-- ---------------------------------------------------------------------------

-- Same shape as before, less the two columns that no longer exist and plus the
-- subtotal that replaced them.
create view public.job_financials
with (security_invoker = true)
as
select
  j.id                          as job_id,
  j.job_number,
  j.status,
  j.service_type,
  j.customer_name,
  j.account_number,
  j.assigned_contractor_id,
  jp.lines_subtotal_cents,
  jp.base_labor_total_cents,
  jp.additional_labor_cents,
  jp.total_labor_revenue_cents,
  jp.contractor_percentage_bps,
  jp.contractor_labor_pay_cents,
  jp.mall_share_cents,
  j.contractor_miles,
  j.excluded_miles,
  j.payable_miles,
  j.mileage_rate,
  j.mileage_payment_cents,
  j.materials_cents,
  j.tolls_parking_cents,
  j.hotel_cents,
  j.other_expenses_cents,
  j.total_expenses_cents,
  j.contractor_pay_cents        as total_contractor_payment_cents,
  jp.total_labor_revenue_cents + j.mileage_payment_cents + j.total_expenses_cents
                                as total_customer_charge_cents,
  jp.mall_share_cents           as mall_consultants_margin_cents
from public.jobs j
join public.job_pricing jp on jp.job_id = j.id;

grant select on public.job_financials to authenticated;
