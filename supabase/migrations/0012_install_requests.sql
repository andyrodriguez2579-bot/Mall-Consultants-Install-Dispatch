-- =============================================================================
-- 0012  Install request intake
-- =============================================================================
-- Work arrives as free text -- a forwarded email, a customer's work order, a
-- note from a phone call. An administrator pastes it in, the system extracts
-- what it can recognise, and the result becomes a draft job to correct rather
-- than a blank form to re-key.
--
-- The raw text is kept verbatim alongside the extraction. When a job is later
-- disputed, the original request is the record of what was actually asked for.

create type public.request_status as enum ('new', 'converted', 'discarded');

create table public.install_requests (
  id            uuid primary key default extensions.gen_random_uuid(),
  status        public.request_status not null default 'new',

  -- Exactly as received, never rewritten.
  raw_text      text not null check (length(btrim(raw_text)) > 0),
  source        text not null default 'paste'
                  check (source in ('paste', 'email', 'phone', 'manual')),
  received_at   timestamptz not null default now(),

  -- What the parser recognised, kept as-is so an extraction can be reviewed
  -- and the parser improved against real inputs.
  parsed        jsonb not null default '{}'::jsonb,

  -- Set when the request becomes a job.
  job_id        uuid references public.jobs (id) on delete set null,
  converted_at  timestamptz,
  discard_reason text,

  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A converted request always points at the job it became.
  constraint install_requests_conversion_consistency
    check ((status = 'converted') = (job_id is not null and converted_at is not null))
);

create index install_requests_status_idx on public.install_requests (status, received_at desc);
create index install_requests_job_idx    on public.install_requests (job_id)
                                         where job_id is not null;

create trigger install_requests_set_updated_at
  before update on public.install_requests
  for each row execute function public.set_updated_at();

-- Intake is administrative. Contractors never see requests -- only the jobs
-- that come out of them.
alter table public.install_requests enable row level security;

create policy install_requests_admin_only on public.install_requests
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.audit_install_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('install_request', new.id, 'request.received',
      jsonb_build_object('source', new.source, 'length', length(new.raw_text)));
  elsif new.status is distinct from old.status then
    perform public.write_audit('install_request', new.id, 'request.' || new.status,
      jsonb_build_object('job_id', new.job_id));
  end if;
  return new;
end;
$$;

create trigger install_requests_audit_insert
  after insert on public.install_requests
  for each row execute function public.audit_install_request();

create trigger install_requests_audit_update
  after update on public.install_requests
  for each row execute function public.audit_install_request();
