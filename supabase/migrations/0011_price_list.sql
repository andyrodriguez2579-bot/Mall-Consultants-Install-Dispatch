-- =============================================================================
-- 0011  Contractor price list and job line items
-- =============================================================================
-- A job's contractor payment is normally built from priced work items rather
-- than typed in: pick the items and quantities, and the total follows. That
-- keeps pricing consistent across jobs and gives an auditable reason for every
-- figure a contractor is offered.
--
-- An administrator can still override the total for an unusual job, but the
-- override is explicit, requires a reason, and is logged.

create type public.pay_source as enum ('line_items', 'manual');

-- The catalogue of work items and what a contractor is paid for each.
create table public.price_list_items (
  id               uuid primary key default extensions.gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  name             text not null,
  description      text,
  -- What the contractor earns per unit. Customer pricing is deliberately not
  -- modelled here -- invoicing happens outside this system.
  unit_price_cents integer not null check (unit_price_cents >= 0),
  unit             text not null default 'each',
  category         text,
  is_active        boolean not null default true,
  sort_order       integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index price_list_items_active_idx
  on public.price_list_items (sort_order, name)
  where is_active;

create trigger price_list_items_set_updated_at
  before update on public.price_list_items
  for each row execute function public.set_updated_at();

-- The priced work that makes up one job.
create table public.job_line_items (
  id                  uuid primary key default extensions.gen_random_uuid(),
  job_id              uuid not null references public.jobs (id) on delete cascade,
  -- Kept as a reference for reporting, but the description and unit price are
  -- copied onto the row. Re-pricing the catalogue must never retroactively
  -- change what a contractor already accepted.
  price_list_item_id  uuid references public.price_list_items (id) on delete set null,
  code                text,
  description         text not null,
  unit                text not null default 'each',
  unit_price_cents    integer not null check (unit_price_cents >= 0),
  quantity            numeric(10, 2) not null default 1 check (quantity > 0),
  line_total_cents    integer generated always as
                        (round(unit_price_cents * quantity)::integer) stored,
  sort_order          integer not null default 100,
  created_at          timestamptz not null default now()
);

create index job_line_items_job_idx on public.job_line_items (job_id, sort_order);

-- How this job's contractor pay was arrived at.
alter table public.jobs
  add column pay_source          public.pay_source not null default 'manual',
  add column pay_override_reason text;

-- ---------------------------------------------------------------------------
-- Keeping the total in step with the line items
-- ---------------------------------------------------------------------------
create or replace function public.recalc_job_pay(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
begin
  select coalesce(sum(line_total_cents), 0)
    into v_total
  from public.job_line_items
  where job_id = p_job_id;

  -- Only jobs priced from line items follow the sum. A job whose total was
  -- overridden keeps the figure an administrator entered.
  update public.jobs
     set contractor_pay_cents = v_total
   where id = p_job_id
     and pay_source = 'line_items'
     and contractor_pay_cents is distinct from v_total;
end;
$$;

-- Line items are only editable while the job is still editable. Without this,
-- adding a line to a dispatched job would try to move a frozen total and fail
-- with a confusing error from the pay trigger instead of a clear one here.
create or replace function public.enforce_line_items_editable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
  v_status public.job_status;
begin
  v_job_id := coalesce(new.job_id, old.job_id);

  select status into v_status from public.jobs where id = v_job_id;

  if v_status is not null and v_status not in ('draft', 'ready') then
    raise exception
      'work items cannot be changed once a job is dispatched (job is %)', v_status
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger job_line_items_enforce_editable
  before insert or update or delete on public.job_line_items
  for each row execute function public.enforce_line_items_editable();

create or replace function public.job_line_items_recalc()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recalc_job_pay(coalesce(new.job_id, old.job_id));
  return coalesce(new, old);
end;
$$;

create trigger job_line_items_recalc_total
  after insert or update or delete on public.job_line_items
  for each row execute function public.job_line_items_recalc();

-- ---------------------------------------------------------------------------
-- Explicit override
-- ---------------------------------------------------------------------------
create or replace function public.admin_override_job_pay(
  p_job_id     uuid,
  p_pay_cents  integer,
  p_reason     text,
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

  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'an override needs a reason' using errcode = 'check_violation';
  end if;

  if p_pay_cents is null or p_pay_cents < 0 then
    raise exception 'override amount must be zero or more' using errcode = 'check_violation';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.status not in ('draft', 'ready') then
    raise exception 'pay is fixed once a job is dispatched (job is %)', v_job.status
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set contractor_pay_cents = p_pay_cents,
         pay_source           = 'manual',
         pay_override_reason  = p_reason
   where id = p_job_id
  returning * into v_job;

  -- The pay change itself is logged by the audit trigger; this records why.
  perform public.write_audit('job', p_job_id, 'job.pay_overridden',
    jsonb_build_object(
      'job_number', v_job.job_number,
      'pay_cents',  p_pay_cents,
      'reason',     p_reason
    ),
    coalesce(auth.uid(), p_admin_id));

  return v_job;
end;
$$;

-- Return a job to line-item pricing, recomputing from its work items.
create or replace function public.admin_use_line_item_pricing(
  p_job_id   uuid,
  p_admin_id uuid default null
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

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'no_data_found';
  end if;

  if v_job.status not in ('draft', 'ready') then
    raise exception 'pay is fixed once a job is dispatched (job is %)', v_job.status
      using errcode = 'check_violation';
  end if;

  update public.jobs
     set pay_source          = 'line_items',
         pay_override_reason = null
   where id = p_job_id;

  perform public.recalc_job_pay(p_job_id);

  select * into v_job from public.jobs where id = p_job_id;
  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.price_list_items enable row level security;
alter table public.job_line_items   enable row level security;

-- The price list is what a contractor is paid, so they may read it.
create policy price_list_read on public.price_list_items
  for select to authenticated using (true);

create policy price_list_admin_write on public.price_list_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A contractor sees the breakdown of a job they can see -- it is the
-- justification for the figure they are being offered.
create policy job_line_items_select on public.job_line_items
  for select to authenticated
  using (public.can_access_job(job_id));

create policy job_line_items_admin_write on public.job_line_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke execute on function public.recalc_job_pay(uuid) from public, anon, authenticated;

grant execute on function public.admin_override_job_pay(uuid, integer, text, uuid) to authenticated;
grant execute on function public.admin_use_line_item_pricing(uuid, uuid)            to authenticated;

-- ---------------------------------------------------------------------------
-- A starting catalogue. Prices are placeholders -- edit them in
-- Admin -> Price list before dispatching real work.
-- ---------------------------------------------------------------------------
insert into public.price_list_items (code, name, description, unit_price_cents, unit, category, sort_order)
values
  ('SSDC-INSTALL',  'SSDC unit install',        'Install and commission one SSDC unit.',            18000, 'each', 'SSDC',      10),
  ('SSDC-SWAP',     'SSDC unit replacement',    'Remove and replace one SSDC unit, re-commission.', 22000, 'each', 'SSDC',      20),
  ('SSDC-BOARD',    'Controller board swap',    'Replace controller board and verify handshake.',   14000, 'each', 'SSDC',      30),
  ('SSDC-COMMISH',  'Commissioning only',       'Point-to-point verification and sign-off sheet.',   9500, 'each', 'SSDC',      40),
  ('LV-RUN',        'Low voltage run',          'Cable run back to the IDF, terminated and tested.',  6500, 'each', 'Cabling',   50),
  ('LV-TERM',       'Low voltage termination',  'Terminate and test one end.',                       2500, 'each', 'Cabling',   60),
  ('FA-INTERFACE',  'Fire alarm interface',     'Interface and verify with the building panel.',     16000, 'each', 'Life safety', 70),
  ('LIFT-DAY',      'Lift day rate',            'Scissor or boom lift operation, per day on site.',  25000, 'day',  'Equipment', 80),
  ('TRIP-STD',      'Site trip charge',         'Standard mobilisation to site.',                     7500, 'each', 'Travel',    90),
  ('TRIP-EMERG',    'Emergency call-out',       'Same-day or after-hours mobilisation.',             15000, 'each', 'Travel',   100),
  ('LABOR-HR',      'Additional labour',        'Field labour beyond the scoped items.',              8500, 'hour', 'Labour',   110)
on conflict (code) do nothing;
