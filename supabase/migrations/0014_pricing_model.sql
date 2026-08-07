-- =============================================================================
-- 0014  Customer-price pricing model: 45/55 labor split, separate mileage
-- =============================================================================
-- Replaces the earlier model, in which the price list held contractor rates
-- directly. It now holds the CUSTOMER labor price, and the contractor's share
-- is derived from it.
--
--   Base Labor Total      = Customer Labor Price x Number of Tasks
--   Total Labor Revenue   = Base Labor Total + Additional Approved Labor
--   Contractor Labor Pay  = Total Labor Revenue x contractor %
--   Mall Consultants      = Total Labor Revenue - Contractor Labor Pay
--   Payable Miles         = max(0, Contractor Miles - Excluded/Commuter Miles)
--   Mileage Payment       = Payable Miles x Mileage Rate
--   Total Contractor Pay  = Labor Pay + Mileage + Reimbursable Expenses
--   Total Customer Charge = Total Labor Revenue + Mileage + Expenses
--
-- Two rules are load-bearing and are enforced here rather than in application
-- code:
--
--   1. The Mall Consultants share is computed as revenue MINUS contractor pay,
--      never as its own percentage. A 55% multiplication would disagree with
--      the 45% one by a cent on odd amounts; subtraction cannot.
--   2. The split never touches mileage or reimbursable expenses. Those pass
--      through to the contractor whole, and are added after the split.

-- ---------------------------------------------------------------------------
-- Administrator settings
--
-- Percentages and the mileage rate are configuration, not code, so they can be
-- changed without a deployment. Admin-only by RLS: a contractor who could read
-- the split percentage could derive the customer price from their own pay.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       numeric not null,
  unit        text not null,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

alter table public.app_settings enable row level security;

create policy app_settings_admin_only on public.app_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value, unit, description) values
  ('contractor_percentage_bps', 4500, 'basis_points',
   'Contractor share of total labor revenue. 4500 = 45%. Mall Consultants receives the remainder.'),
  ('mileage_rate', 0.7250, 'usd_per_mile',
   'Paid per payable mile. Not subject to the labor split.'),
  ('commuter_deduction_miles', 30, 'miles',
   'Miles deducted from each trip before mileage is paid (commuter rule).');

create or replace function public.setting_value(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value from public.app_settings where key = p_key;
$$;

create or replace function public.default_contractor_bps()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.setting_value('contractor_percentage_bps'), 4500)::integer;
$$;

create or replace function public.default_mileage_rate()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.setting_value('mileage_rate'), 0.7250);
$$;

create or replace function public.default_commuter_miles()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.setting_value('commuter_deduction_miles'), 30);
$$;

-- ---------------------------------------------------------------------------
-- Calculation primitives
--
-- Immutable so they can be used in generated columns, which is what makes the
-- arithmetic impossible to bypass: there is no code path that writes a total
-- without going through these.
-- ---------------------------------------------------------------------------

-- Customer Labor Price x Number of Tasks.
create or replace function public.calc_base_labor_cents(
  p_price_cents integer,
  p_tasks       numeric
)
returns integer
language sql
immutable
as $$
  select round(coalesce(p_price_cents, 0)::numeric * coalesce(p_tasks, 0))::integer;
$$;

-- Base Labor Total + Additional Approved Labor Charges.
create or replace function public.calc_labor_revenue_cents(
  p_price_cents      integer,
  p_tasks            numeric,
  p_additional_cents integer
)
returns integer
language sql
immutable
as $$
  select public.calc_base_labor_cents(p_price_cents, p_tasks)
       + coalesce(p_additional_cents, 0);
$$;

-- Total Labor Revenue x contractor percentage.
create or replace function public.calc_contractor_labor_cents(
  p_revenue_cents integer,
  p_bps           integer
)
returns integer
language sql
immutable
as $$
  select round(coalesce(p_revenue_cents, 0)::numeric * coalesce(p_bps, 0) / 10000)::integer;
$$;

-- Never negative: a short trip inside the commuter radius pays no mileage.
create or replace function public.calc_payable_miles(
  p_miles          numeric,
  p_excluded_miles numeric
)
returns numeric
language sql
immutable
as $$
  select greatest(0, coalesce(p_miles, 0) - coalesce(p_excluded_miles, 0));
$$;

create or replace function public.calc_mileage_cents(
  p_miles          numeric,
  p_excluded_miles numeric,
  p_rate           numeric
)
returns integer
language sql
immutable
as $$
  select round(
    public.calc_payable_miles(p_miles, p_excluded_miles) * coalesce(p_rate, 0) * 100
  )::integer;
$$;

create or replace function public.calc_expenses_cents(
  p_materials integer,
  p_tolls     integer,
  p_hotel     integer,
  p_other     integer
)
returns integer
language sql
immutable
as $$
  select coalesce(p_materials, 0) + coalesce(p_tolls, 0)
       + coalesce(p_hotel, 0) + coalesce(p_other, 0);
$$;

-- ---------------------------------------------------------------------------
-- Price list: now holds the customer labor price
-- ---------------------------------------------------------------------------
alter table public.price_list_items
  add column customer_labor_price_cents integer not null default 0
    check (customer_labor_price_cents >= 0),
  add column contractor_percentage_bps integer not null default public.default_contractor_bps()
    check (contractor_percentage_bps between 0 and 10000),
  add column scope_description text,
  add column allows_quantity boolean not null default true,
  add column allows_additional_labor boolean not null default true,
  add column allows_mileage boolean not null default true;

-- Carry the old contractor rates over as a starting point, then retire them:
-- they meant something different, so leaving them active would misprice work.
update public.price_list_items
   set customer_labor_price_cents = unit_price_cents,
       scope_description = description,
       is_active = false;

alter table public.price_list_items drop column unit_price_cents;

-- Derived and stored, so a mispriced catalogue row is not expressible.
alter table public.price_list_items
  add column contractor_labor_pay_cents integer
    generated always as (
      public.calc_contractor_labor_cents(customer_labor_price_cents, contractor_percentage_bps)
    ) stored,
  add column mall_share_cents integer
    generated always as (
      customer_labor_price_cents
      - public.calc_contractor_labor_cents(customer_labor_price_cents, contractor_percentage_bps)
    ) stored;

-- ---------------------------------------------------------------------------
-- Contractor home base, for estimating mileage on the job board
-- ---------------------------------------------------------------------------
alter table public.contractors
  add column base_address     text,
  add column base_city        text,
  add column base_state_code  text check (base_state_code is null or base_state_code ~ '^[A-Z]{2}$'),
  add column base_postal_code text,
  add column base_latitude    numeric(9, 6) check (base_latitude is null or base_latitude between -90 and 90),
  add column base_longitude   numeric(9, 6) check (base_longitude is null or base_longitude between -180 and 180);

alter table public.jobs
  add column site_latitude  numeric(9, 6) check (site_latitude is null or site_latitude between -90 and 90),
  add column site_longitude numeric(9, 6) check (site_longitude is null or site_longitude between -180 and 180);

/*
 * Straight-line distance between two points, in miles.
 *
 * Used to estimate the round trip shown on the job board when both the
 * contractor's base and the site have coordinates. It is an estimate and is
 * labelled as one in the UI -- actual mileage is whatever the contractor
 * reports from their odometer, which is what the IRS requires and what gets
 * paid. The circuity factor turns straight-line into a rough road distance.
 */
create or replace function public.distance_miles(
  p_lat1 numeric, p_lon1 numeric,
  p_lat2 numeric, p_lon2 numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_lat1 is null or p_lon1 is null or p_lat2 is null or p_lon2 is null then null
    else round((
      3958.7613 * 2 * asin(sqrt(
          power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * power(sin(radians(p_lon2 - p_lon1) / 2), 2)
      ))
    )::numeric, 2)
  end;
$$;

-- Road miles run longer than the crow flies; 1.2 is the usual planning factor.
create or replace function public.estimate_road_miles(
  p_lat1 numeric, p_lon1 numeric,
  p_lat2 numeric, p_lon2 numeric,
  p_round_trip boolean default true
)
returns numeric
language sql
immutable
as $$
  select case
    when public.distance_miles(p_lat1, p_lon1, p_lat2, p_lon2) is null then null
    else round(
      public.distance_miles(p_lat1, p_lon1, p_lat2, p_lon2)
      * 1.2 * (case when p_round_trip then 2 else 1 end), 1)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Job: contractor-facing money and the mileage / expense inputs
--
-- Everything on `jobs` may be read by the assigned or offered contractor. The
-- customer's price and the Mall Consultants share live in `job_pricing`, which
-- contractors have no policy granting access to at all.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column service_item_id uuid references public.price_list_items (id) on delete set null,
  add column service_type    text,
  add column account_number  text,

  -- The contractor's labor share, mirrored from job_pricing by trigger so the
  -- contractor can read it without reaching into the customer-side table.
  add column contractor_labor_pay_cents integer not null default 0
    check (contractor_labor_pay_cents >= 0),

  -- Mileage. Odometer readings are kept because they are what the IRS wants.
  add column start_odometer   numeric(10, 1) check (start_odometer is null or start_odometer >= 0),
  add column end_odometer     numeric(10, 1) check (end_odometer is null or end_odometer >= 0),
  add column contractor_miles numeric(10, 2) not null default 0 check (contractor_miles >= 0),
  add column excluded_miles   numeric(10, 2) not null default 0 check (excluded_miles >= 0),
  add column mileage_rate     numeric(10, 4) not null default public.default_mileage_rate()
    check (mileage_rate >= 0),
  add column estimated_miles  numeric(10, 2) check (estimated_miles is null or estimated_miles >= 0),

  -- Reimbursable expenses, each requiring approval before they are payable.
  add column materials_cents      integer not null default 0 check (materials_cents >= 0),
  add column tolls_parking_cents  integer not null default 0 check (tolls_parking_cents >= 0),
  add column hotel_cents          integer not null default 0 check (hotel_cents >= 0),
  add column other_expenses_cents integer not null default 0 check (other_expenses_cents >= 0),
  add column expenses_approved_at timestamptz,
  add column expenses_approved_by uuid references public.profiles (id) on delete set null;

alter table public.jobs
  add column payable_miles numeric(10, 2)
    generated always as (public.calc_payable_miles(contractor_miles, excluded_miles)) stored,
  add column mileage_payment_cents integer
    generated always as (public.calc_mileage_cents(contractor_miles, excluded_miles, mileage_rate)) stored,
  add column total_expenses_cents integer
    generated always as (
      public.calc_expenses_cents(materials_cents, tolls_parking_cents, hotel_cents, other_expenses_cents)
    ) stored;

-- ---------------------------------------------------------------------------
-- job_pricing: the customer side. Administrators only.
-- ---------------------------------------------------------------------------
create table public.job_pricing (
  job_id                     uuid primary key references public.jobs (id) on delete cascade,

  customer_labor_price_cents integer not null default 0 check (customer_labor_price_cents >= 0),
  task_count                 numeric(10, 2) not null default 1 check (task_count >= 0),

  -- Additional labor is payable only once an administrator has approved it.
  additional_labor_cents     integer not null default 0 check (additional_labor_cents >= 0),
  additional_labor_reason    text,
  additional_labor_approved_at timestamptz,
  additional_labor_approved_by uuid references public.profiles (id) on delete set null,

  -- Snapshot, so changing the setting later cannot reprice a job already quoted.
  contractor_percentage_bps  integer not null default public.default_contractor_bps()
    check (contractor_percentage_bps between 0 and 10000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Approved additional labor always records who approved it.
  constraint job_pricing_additional_labor_approval
    check (additional_labor_cents = 0 or additional_labor_approved_at is not null)
);

alter table public.job_pricing
  add column base_labor_total_cents integer
    generated always as (public.calc_base_labor_cents(customer_labor_price_cents, task_count)) stored,
  add column total_labor_revenue_cents integer
    generated always as (
      public.calc_labor_revenue_cents(customer_labor_price_cents, task_count, additional_labor_cents)
    ) stored,
  add column contractor_labor_pay_cents integer
    generated always as (
      public.calc_contractor_labor_cents(
        public.calc_labor_revenue_cents(customer_labor_price_cents, task_count, additional_labor_cents),
        contractor_percentage_bps
      )
    ) stored,
  -- Revenue minus contractor pay, never its own percentage. This is what makes
  -- the two shares add up to the penny on every amount.
  add column mall_share_cents integer
    generated always as (
      public.calc_labor_revenue_cents(customer_labor_price_cents, task_count, additional_labor_cents)
      - public.calc_contractor_labor_cents(
          public.calc_labor_revenue_cents(customer_labor_price_cents, task_count, additional_labor_cents),
          contractor_percentage_bps
        )
    ) stored;

create trigger job_pricing_set_updated_at
  before update on public.job_pricing
  for each row execute function public.set_updated_at();

alter table public.job_pricing enable row level security;

-- No contractor-facing policy exists. This is the whole mechanism by which the
-- customer price and the Mall Consultants share stay invisible.
create policy job_pricing_admin_only on public.job_pricing
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Keeping the job's totals in step
-- ---------------------------------------------------------------------------

-- contractor_pay_cents is the TOTAL the contractor receives: labor + mileage +
-- reimbursables. It is what is offered, accepted, and paid.
create or replace function public.recalc_contractor_total()
returns trigger
language plpgsql
as $$
begin
  new.contractor_pay_cents :=
      coalesce(new.contractor_labor_pay_cents, 0)
    + public.calc_mileage_cents(new.contractor_miles, new.excluded_miles, new.mileage_rate)
    + public.calc_expenses_cents(
        new.materials_cents, new.tolls_parking_cents, new.hotel_cents, new.other_expenses_cents
      );
  return new;
end;
$$;

-- Runs before the invariant trigger from 0006, so the total is settled before
-- it is checked.
create trigger jobs_recalc_contractor_total
  before insert or update on public.jobs
  for each row execute function public.recalc_contractor_total();

-- Mirror the labor share onto the job whenever the customer-side pricing moves.
create or replace function public.sync_job_labor_pay()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.jobs
     set contractor_labor_pay_cents = new.contractor_labor_pay_cents
   where id = new.job_id
     and contractor_labor_pay_cents is distinct from new.contractor_labor_pay_cents;
  return new;
end;
$$;

create trigger job_pricing_sync_labor
  after insert or update on public.job_pricing
  for each row execute function public.sync_job_labor_pay();

-- Customer-side pricing freezes at dispatch: the labor figure a contractor
-- accepted cannot move afterwards.
create or replace function public.enforce_pricing_editable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.job_status;
begin
  select status into v_status from public.jobs where id = coalesce(new.job_id, old.job_id);

  if v_status is not null and v_status not in ('draft', 'ready') then
    raise exception 'job pricing is fixed once a job is dispatched (job is %)', v_status
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger job_pricing_enforce_editable
  before insert or update or delete on public.job_pricing
  for each row execute function public.enforce_pricing_editable();

-- ---------------------------------------------------------------------------
-- Revised job invariants
--
-- The previous rule froze the contractor's TOTAL at dispatch. That is now too
-- strong: mileage and reimbursable expenses are only knowable after the trip,
-- and by definition sit outside the labor agreement. What must not move is the
-- LABOR figure the contractor accepted.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_job_invariants()
returns trigger
language plpgsql
as $$
begin
  -- The accepted labor pay is fixed once the job leaves the editable states.
  if new.contractor_labor_pay_cents is distinct from old.contractor_labor_pay_cents
     and old.status not in ('draft', 'ready') then
    raise exception
      'contractor labor pay is fixed once a job is dispatched (job %, status %)',
      old.job_number, old.status
      using errcode = 'check_violation';
  end if;

  -- So is the mileage rate the offer was made at.
  if new.mileage_rate is distinct from old.mileage_rate
     and old.status not in ('draft', 'ready') then
    raise exception 'the mileage rate is fixed once a job is dispatched'
      using errcode = 'check_violation';
  end if;

  -- Nothing may be paid twice.
  if old.status = 'paid' and new.status <> 'paid'
     and new.paid_at is distinct from old.paid_at then
    raise exception 'a paid job cannot be un-paid; cancel and re-issue instead'
      using errcode = 'check_violation';
  end if;

  -- Reimbursables cannot be revised after payment has gone out.
  if old.status = 'paid'
     and public.calc_expenses_cents(
           new.materials_cents, new.tolls_parking_cents, new.hotel_cents, new.other_expenses_cents)
         is distinct from
         public.calc_expenses_cents(
           old.materials_cents, old.tolls_parking_cents, old.hotel_cents, old.other_expenses_cents) then
    raise exception 'expenses cannot be changed after a job has been paid'
      using errcode = 'check_violation';
  end if;

  if new.job_number is distinct from old.job_number then
    raise exception 'job_number is immutable' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval of additional labor and reimbursable expenses
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_expenses(
  p_job_id     uuid,
  p_materials  integer default 0,
  p_tolls      integer default 0,
  p_hotel      integer default 0,
  p_other      integer default 0,
  p_admin_id   uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  perform public.require_admin();

  if least(coalesce(p_materials,0), coalesce(p_tolls,0),
           coalesce(p_hotel,0), coalesce(p_other,0)) < 0 then
    raise exception 'expenses cannot be negative' using errcode = 'check_violation';
  end if;

  update public.jobs
     set materials_cents      = coalesce(p_materials, 0),
         tolls_parking_cents  = coalesce(p_tolls, 0),
         hotel_cents          = coalesce(p_hotel, 0),
         other_expenses_cents = coalesce(p_other, 0),
         expenses_approved_at = now(),
         expenses_approved_by = coalesce(auth.uid(), p_admin_id)
   where id = p_job_id
  returning * into v_job;

  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  perform public.write_audit('job', p_job_id, 'job.expenses_approved',
    jsonb_build_object(
      'job_number', v_job.job_number,
      'materials',  coalesce(p_materials, 0),
      'tolls',      coalesce(p_tolls, 0),
      'hotel',      coalesce(p_hotel, 0),
      'other',      coalesce(p_other, 0),
      'total',      v_job.total_expenses_cents
    ),
    coalesce(auth.uid(), p_admin_id));

  return v_job;
end;
$$;

-- Record the miles a contractor reported. Payable miles and the payment follow
-- automatically from the generated columns.
create or replace function public.record_job_mileage(
  p_job_id          uuid,
  p_contractor_miles numeric,
  p_excluded_miles   numeric default null,
  p_start_odometer   numeric default null,
  p_end_odometer     numeric default null,
  p_actor_id         uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.jobs%rowtype;
begin
  if coalesce(p_contractor_miles, 0) < 0 or coalesce(p_excluded_miles, 0) < 0 then
    raise exception 'miles cannot be negative' using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  -- Either an administrator, or the contractor the job belongs to.
  if auth.uid() is not null
     and not public.is_admin()
     and v_job.assigned_contractor_id is distinct from auth.uid() then
    raise exception 'this job is not assigned to you' using errcode = 'insufficient_privilege';
  end if;

  update public.jobs
     set contractor_miles = coalesce(p_contractor_miles, 0),
         excluded_miles   = coalesce(p_excluded_miles, public.default_commuter_miles()),
         start_odometer   = coalesce(p_start_odometer, start_odometer),
         end_odometer     = coalesce(p_end_odometer, end_odometer)
   where id = p_job_id
  returning * into v_job;

  perform public.write_audit('job', p_job_id, 'job.mileage_recorded',
    jsonb_build_object(
      'job_number',    v_job.job_number,
      'miles',         v_job.contractor_miles,
      'excluded',      v_job.excluded_miles,
      'payable',       v_job.payable_miles,
      'payment_cents', v_job.mileage_payment_cents
    ),
    coalesce(auth.uid(), p_actor_id));

  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrator financial view
--
-- security_invoker means row-level security is applied as the querying user,
-- so this view cannot become a way around job_pricing's admin-only policy.
-- ---------------------------------------------------------------------------
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
  jp.customer_labor_price_cents,
  jp.task_count,
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

-- ---------------------------------------------------------------------------
-- Retire the previous line-item costing model
--
-- It computed the contractor's pay directly, which contradicts deriving it from
-- the customer price. Leaving it in place would give two disagreeing sources of
-- truth for the same number.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_override_job_pay(uuid, integer, text, uuid);
drop function if exists public.admin_use_line_item_pricing(uuid, uuid);
drop trigger if exists job_line_items_recalc_total on public.job_line_items;
drop trigger if exists job_line_items_enforce_editable on public.job_line_items;
drop function if exists public.job_line_items_recalc();
drop function if exists public.enforce_line_items_editable();
drop function if exists public.recalc_job_pay(uuid);
drop table if exists public.job_line_items;

alter table public.jobs drop column if exists pay_source;
alter table public.jobs drop column if exists pay_override_reason;
drop type if exists public.pay_source;

grant execute on function public.admin_approve_expenses(uuid, integer, integer, integer, integer, uuid) to authenticated;
grant execute on function public.record_job_mileage(uuid, numeric, numeric, numeric, numeric, uuid) to authenticated;
grant execute on function public.estimate_road_miles(numeric, numeric, numeric, numeric, boolean) to authenticated;
grant execute on function public.distance_miles(numeric, numeric, numeric, numeric) to authenticated;
grant select on public.job_financials to authenticated;

revoke execute on function public.setting_value(text) from public, anon, authenticated;
